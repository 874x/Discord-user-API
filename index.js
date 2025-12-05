require('dotenv').config()
const express = require('express')
const fetch = require('node-fetch')
const { Client, GatewayIntentBits } = require('discord.js')

const TOKEN = process.env.BOT_TOKEN
const CACHE_TTL = Number(process.env.CACHE_TTL) || 120
const API_KEY = process.env.API_KEY

if (!TOKEN) process.exit(1)
if (!API_KEY) process.exit(1)

// DISCORD CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
})

client.login(TOKEN).catch(() => process.exit(1))

const app = express()
const cache = new Map()

// API KEY VALIDATION
function getKey(req) {
  return req.get("x-api-key") || req.query.key || null
}

function checkKey(req, res, next) {
  const key = getKey(req)
  if (!key || key !== API_KEY) {
    return res.status(401).json({ success: false, error: "invalid_api_key" })
  }
  next()
}

app.use(checkKey)

// FLAGS
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
  const out = []
  const n = Number(v) || 0
  for (const k in FLAG_MAP) if (n & Number(k)) out.push(FLAG_MAP[k])
  return out
}

function snowflakeToTime(id) {
  try {
    const t = Number((BigInt(id) >> 22n) + 1420070400000n)
    return { unix: t, iso: new Date(t).toISOString() }
  } catch {
    return { unix: null, iso: null }
  }
}

async function fetchUser(id) {
  const r = await fetch(`https://discord.com/api/v10/users/${id}`, {
    headers: { Authorization: `Bot ${TOKEN}` }
  })
  if (!r.ok) return null
  return await r.json()
}

function avatarUrl(id, hash) {
  if (!hash) return `https://cdn.discordapp.com/embed/avatars/${Number(id) % 5}.png`
  const ext = hash.startsWith('a_') ? 'gif' : 'png'
  return `https://cdn.discordapp.com/avatars/${id}/${hash}.${ext}`
}

function bannerUrl(id, hash) {
  if (!hash) return null
  return `https://cdn.discordapp.com/banners/${id}/${hash}.png`
}

function typeMap(t) {
  return {
    0: "game",
    1: "streaming",
    2: "listening",
    3: "watching",
    4: "custom",
    5: "competing"
  }[t] || "unknown"
}

function presenceState(id) {
  let pr = null
  const platforms = new Set()

  for (const [, g] of client.guilds.cache) {
    const m = g.members.cache.get(id)
    if (m && m.presence) {
      pr = m.presence
      if (m.presence.clientStatus) {
        for (const k of Object.keys(m.presence.clientStatus)) platforms.add(k)
      }
      break
    }
  }

  if (!pr) return { status: "offline", activities: [], platforms: [] }

  const acts = pr.activities.map(a => ({
    type: typeMap(a.type),
    name: a.name || null,
    details: a.details || null,
    state: a.state || null,
    application_id: a.applicationId || null,
    timestamps: a.timestamps || null,
    emoji: a.emoji ? { name: a.emoji.name, id: a.emoji.id } : null,
    created_unix: a.createdTimestamp || null
  }))

  return {
    status: pr.status,
    activities: acts,
    platforms: Array.from(platforms)
  }
}

app.get('/v1/user/:id', async (req, res) => {
  const id = req.params.id
  const now = Date.now()

  // CACHE
  const c = cache.get(id)
  if (c && c.expire > now) {
    return res.json({
      success: true,
      cached: true,
      cache_ttl: Math.floor((c.expire - now) / 1000),
      ...c.payload
    })
  }

  const u = await fetchUser(id)
  if (!u) return res.status(404).json({ success: false, error: "user_not_found" })

  const t = snowflakeToTime(id)
  const flags = decodeFlags(u.public_flags)
  const p = presenceState(id)

  const payload = {
    profile: {
      id: u.id,
      username: u.username,
      global_name: u.global_name || null,
      discriminator: u.discriminator,
      avatar: { hash: u.avatar, url: avatarUrl(u.id, u.avatar) },
      banner: { hash: u.banner, url: bannerUrl(u.id, u.banner) }
    },
    account: {
      created_iso: t.iso,
      created_unix: t.unix,
      accent_color: u.accent_color
    },
    badges: {
      raw: u.public_flags,
      list: flags
    },
    presence: {
      status: p.status,
      activities: p.activities
    },
    platform: {
      active: p.platforms
    }
  }

  cache.set(id, { expire: now + CACHE_TTL * 1000, payload })

  res.json({
    success: true,
    cached: false,
    cache_ttl: CACHE_TTL,
    ...payload
  })
})

app.listen(process.env.PORT || 3000)
