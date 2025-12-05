require('dotenv').config()
const express = require('express')
const fetch = require('node-fetch')

const BOT_TOKEN = process.env.BOT_TOKEN
const FIREBASE_URL = process.env.FIREBASE_URL
const FIREBASE_SECRET = process.env.FIREBASE_SECRET
const CACHE_TTL = Number(process.env.CACHE_TTL) || 300
const PORT = process.env.PORT || 3000

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN')
  process.exit(1)
}
if (!FIREBASE_URL || !FIREBASE_SECRET) {
  console.error('Missing FIREBASE_URL or FIREBASE_SECRET')
  process.exit(1)
}

const app = express()
app.use(express.json())

const MEM_CACHE = new Map()

const FLAG_MAP = {
  1: "staff",
  2: "partner",
  4: "hypesquad",
  8: "bug_hunter_level_1",
  16: "green_dot",
  64: "hypesquad_bravery",
  128: "hypesquad_brilliance",
  256: "hypesquad_balance",
  512: "early_supporter",
  1024: "team_user",
  2048: "bug_hunter_level_2",
  4096: "verified_bot",
  8192: "verified_developer",
  16384: "certified_moderator",
  65536: "bot_http_interactions",
  131072: "active_developer",
  4194304: "nitro"
}

function decodeFlags(v) {
  const n = Number(v) || 0
  const out = []
  for (const k in FLAG_MAP) if (n & Number(k)) out.push(FLAG_MAP[k])
  return out
}

function snowflakeToTime(id) {
  try {
    const ts = Number((BigInt(id) >> 22n) + 1420070400000n)
    return { createdTimestamp: ts, createdAt: new Date(ts).toISOString() }
  } catch {
    return { createdTimestamp: null, createdAt: null }
  }
}

function avatarURL(id, hash) {
  if (!hash) return `https://cdn.discordapp.com/embed/avatars/${Number(id) % 5}.png`
  const ext = hash.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}`
}

function bannerURL(id, hash) {
  if (!hash) return null
  return `https://cdn.discordapp.com/banners/${id}/${hash}.png`
}

async function firebaseGetUser(id) {
  const url = `${FIREBASE_URL.replace(/\/$/, '')}/users/${id}.json?auth=${FIREBASE_SECRET}`
  const r = await fetch(url)
  if (!r.ok) return null
  const json = await r.json()
  return json
}

async function firebasePutUser(id, data) {
  const url = `${FIREBASE_URL.replace(/\/$/, '')}/users/${id}.json?auth=${FIREBASE_SECRET}`
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  if (!r.ok) {
    const text = await r.text().catch(()=>null)
    throw new Error('Firebase PUT failed: ' + r.status + ' ' + text)
  }
  return await r.json()
}

function buildPayloadFromDiscord(userObj, cachedPresence = null) {
  const times = snowflakeToTime(userObj.id)
  const flagsRaw = userObj.public_flags ?? userObj.flags ?? 0
  const badges = decodeFlags(flagsRaw)
  return {
    id: userObj.id,
    username: userObj.username,
    discriminator: userObj.discriminator,
    global_name: userObj.global_name || userObj.globalName || null,
    avatar: userObj.avatar || null,
    banner: userObj.banner || null,
    accent_color: userObj.accent_color ?? null,
    defaultAvatarURL: `https://cdn.discordapp.com/embed/avatars/${Number(userObj.discriminator || 0) % 5}.png`,
    avatarURL: avatarURL(userObj.id, userObj.avatar),
    bannerURL: bannerURL(userObj.id, userObj.banner),
    createdAt: times.createdAt,
    createdTimestamp: times.createdTimestamp,
    public_flags: flagsRaw,
    public_flags_array: badges,
    nitro: (userObj.premium_type && Number(userObj.premium_type) > 0) ? true : false,
    updated_at: Date.now(),
    presence: cachedPresence || null
  }
}

function shallowDiff(a, b) {
  if (!a || !b) return true
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.length !== kb.length) return true
  for (let k of ka) {
    const va = a[k]
    const vb = b[k]
    if (typeof va === 'object' && typeof vb === 'object') {
      if (JSON.stringify(va) !== JSON.stringify(vb)) return true
    } else {
      if (String(va) !== String(vb)) return true
    }
  }
  return false
}

async function fetchDiscordUser(id) {
  const r = await fetch(`https://discord.com/api/v10/users/${id}`, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` }
  })
  return r
}

// main route
app.get('/v1/user/:id', async (req, res) => {
  const id = req.params.id
  const force = req.query.refresh === '1' || req.query.force === '1'
  const now = Date.now()

  // memory cache quick hit
  const mem = MEM_CACHE.get(id)
  if (mem && mem.expire > now && !force) {
    return res.json({ success: true, cached: true, cache_ttl: Math.floor((mem.expire - now) / 1000), ...mem.payload })
  }

  // check firebase
  let fb = null
  try {
    fb = await firebaseGetUser(id)
  } catch (e) {
    console.error('firebase get error', e.message)
    return res.status(500).json({ success: false, error: 'firebase_error' })
  }

  // if fb exists and fresh and not forcing, return it
  if (fb && !force) {
    const age = Date.now() - (fb.updated_at || 0)
    if (age <= CACHE_TTL * 1000) {
      MEM_CACHE.set(id, { expire: now + CACHE_TTL * 1000, payload: fb })
      return res.json({ success: true, cached: true, cache_ttl: Math.floor((CACHE_TTL) - (age/1000)), ...fb })
    }
  }

  // attempt fetch from Discord
  let dresponse
  try {
    dresponse = await fetchDiscordUser(id)
  } catch (e) {
    console.error('discord fetch err', e.message)
    if (fb) {
      MEM_CACHE.set(id, { expire: now + CACHE_TTL * 1000, payload: fb })
      return res.json({ success: true, cached: true, cache_ttl: Math.floor(CACHE_TTL), ...fb })
    }
    return res.status(500).json({ success: false, error: 'discord_fetch_error' })
  }

  if (dresponse.status === 404) {
    if (fb) {
      MEM_CACHE.set(id, { expire: now + CACHE_TTL * 1000, payload: fb })
      return res.json({ success: true, cached: true, cache_ttl: Math.floor(CACHE_TTL), ...fb })
    }
    return res.status(404).json({ success: false, error: 'user_not_found' })
  }

  if (!dresponse.ok) {
    const text = await dresponse.text().catch(()=>null)
    console.error('discord non-ok', dresponse.status, text)
    if (fb) {
      MEM_CACHE.set(id, { expire: now + CACHE_TTL * 1000, payload: fb })
      return res.json({ success: true, cached: true, cache_ttl: Math.floor(CACHE_TTL), ...fb })
    }
    return res.status(502).json({ success: false, error: 'discord_error', status: dresponse.status })
  }

  const userObj = await dresponse.json()

  // try to preserve presence from firebase if exists
  const cachedPresence = fb && fb.presence ? fb.presence : null

  const fresh = buildPayloadFromDiscord(userObj, cachedPresence)

  // compare and update firebase only if different
  let needWrite = true
  if (fb) {
    needWrite = shallowDiff(fresh, fb)
  }

  if (needWrite) {
    try {
      await firebasePutUser(id, fresh)
    } catch (e) {
      console.error('firebase put failed', e.message)
    }
  }

  MEM_CACHE.set(id, { expire: now + CACHE_TTL * 1000, payload: fresh })

  return res.json({ success: true, cached: false, cache_ttl: CACHE_TTL, ...fresh })
})

app.get('/', (req, res) => {
  res.json({ status: 'online' })
})

app.listen(PORT, () => {
  console.log('API running on port', PORT)
})
