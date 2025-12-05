require('dotenv').config()
const express = require('express')
const fetch = require('node-fetch')
const { Client, GatewayIntentBits } = require('discord.js')

const TOKEN = process.env.BOT_TOKEN
const CACHE_TTL = Number(process.env.CACHE_TTL) || 120
const KEY_LIST = (process.env.API_KEYS || "").split(",").map(a => a.trim()).filter(a => a.length)

if (!TOKEN) process.exit(1)

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

function validKey(k) {
  return KEY_LIST.includes(k)
}

function getKey(req) {
  const h = req.get("x-api-key")
  if (h) return h
  if (req.query.key) return req.query.key
  return null
}

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
  const a = []
  const n = Number(v) || 0
  for (const k in FLAG_MAP) if (n & Number(k)) a.push(FLAG_MAP[k])
  return a
}

function snowflakeToTime(id) {
  try {
    const t = Number((BigInt(id) >> 22n) + 1420070400000n)
    return { created_unix: t, created_iso: new Date(t).toISOString() }
  } catch {
    return { created_unix: null, created_iso: null }
  }
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

async function fetchUser(id) {
  const r = await fetch(`https://discord.com/api/v10/users/${id}`, {
    headers: { Authorization: `Bot ${TOKEN}` }
  })
  if (!r.ok) return null
  return await r.json()
}

function typeMap(t) {
  const map = {
    0: "game",
    1: "streaming",
    2: "listening",
    3: "watching",
    4: "custom",
    5: "competing"
  }
  return map[t] || "unknown"
}

function presenceState(id) {
  const p = new Set()
  let pr = null
  for (const [, g] of client.guilds.cache) {
    const m = g.members.cache.get(id)
    if (m && m.presence) {
      pr = m.presence
      if (m.presence.clientStatus) {
        for (const k of Object.keys(m.presence.clientStatus)) p.add(k)
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
  return { status: pr.status, activities: acts, platforms: Array.from(p) }
}

app.use((req, res, next) => {
  const key = getKey(req)
  if (!key || !validKey(key)) return res.status(401).json({ success: false, error: "invalid_api_key" })
  next()
})

app.get('/v1/user/:id', async (req, res) => {
  const id = req.params.id
  const now = Date.now()
  const cached = cache.get(id)
  if (cached && cached.expire > now)
    return res.json({ success: true, cached: true, cache_ttl: Math.floor((cached.expire - now) / 1000), ...cached.payload })

  const u = await fetchUser(id)
  if (!u) return res.status(404).json({ success: false, error: "user_not_found" })

  const t = snowflakeToTime(id)
  const flags = decodeFlags(u.public_flags)

  const profile = {
    id: u.id,
    username: u.username,
    global_name: u.global_name || null,
    discriminator: u.discriminator,
    avatar: { hash: u.avatar, url: avatarUrl(u.id, u.avatar) },
    banner: { hash: u.banner, url: bannerUrl(u.id, u.banner) }
  }

  const account = {
    created_iso: t.created_iso,
    created_unix: t.created_unix,
    accent_color: u.accent_color
  }

  const badges = {
    raw: u.public_flags,
    list: flags
  }

  const p = presenceState(u.id)

  const presence = {
    status: p.status,
    activities: p.activities
  }

  const platform = {
    active: p.platforms
  }

  let connections = {
    enabled: false,
    message: "provide oauth token ?token= or Authorization: Bearer"
  }

  const auth = req.get('authorization') || ''
  const token = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7)
    : req.query.token || null

  if (token) {
    try {
      const r = await fetch(`https://discord.com/api/v10/users/@me/connections`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (r.ok) connections = { enabled: true, data: await r.json() }
      else connections = { enabled: false, error: `failed_${r.status}` }
    } catch {
      connections = { enabled: false, error: "fetch_error" }
    }
  }

  const payload = { profile, account, badges, presence, platform, connections }

  cache.set(id, { expire: now + CACHE_TTL * 1000, payload })

  res.json({
    success: true,
    cached: false,
    cache_ttl: CACHE_TTL,
    ...payload
  })
})

app.listen(process.env.PORT || 3000)
