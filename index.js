import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { Client, GatewayIntentBits } from "discord.js";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";

// ----------------------
// LOAD ENV VARIABLES
// ----------------------
dotenv.config();

const TOKEN = process.env.BOT_TOKEN;
const FIREBASE_URL = process.env.FIREBASE_URL;
const FIREBASE_SECRET = process.env.FIREBASE_SECRET;
const CACHE_TTL = parseInt(process.env.CACHE_TTL || "300000"); // 5 min default

if (!TOKEN) {
    console.error("❌ BOT_TOKEN missing");
    process.exit(1);
}
if (!FIREBASE_URL || !FIREBASE_SECRET) {
    console.error("❌ Firebase env missing");
    process.exit(1);
}

// ----------------------
// FIREBASE INIT
// ----------------------
const firebaseConfig = {
    databaseURL: FIREBASE_URL,
    apiKey: FIREBASE_SECRET
};

const firebase = initializeApp(firebaseConfig);
const db = getDatabase(firebase);

// ----------------------
// DISCORD CLIENT
// ----------------------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.login(TOKEN).catch(err => {
    console.error("Login error:", err);
    process.exit(1);
});

// ----------------------
// EXPRESS SERVER
// ----------------------
const app = express();

// convert bitfield into badges
function getBadges(flags) {
    const map = {
        1 << 0: "discord_staff",
        1 << 1: "discord_partner",
        1 << 2: "hypesquad_events",
        1 << 3: "bug_hunter_level_1",
        1 << 6: "house_bravery",
        1 << 7: "house_brilliance",
        1 << 8: "house_balance",
        1 << 9: "early_supporter",
        1 << 14: "bug_hunter_level_2",
        1 << 17: "verified_bot",
        1 << 18: "verified_developer"
    };

    const badges = [];
    Object.keys(map).forEach(bit => {
        if (flags & bit) badges.push(map[bit]);
    });

    return badges;
}

// get nitro type from premiumType
function getNitro(type) {
    return {
        0: null,
        1: "nitro_classic",
        2: "nitro_boost",
        3: "nitro_basic"
    }[type] || null;
}

async function fetchUserRaw(id) {
    const user = await client.users.fetch(id).catch(() => null);
    return user;
}

// ----------------------
// MAIN ENDPOINT — EXACT LIKE JAPI
// ----------------------
app.get("/v1/user/:id", async (req, res) => {
    const id = req.params.id;

    // Firebase REF
    const cacheRef = ref(db, `users/${id}`);

    // Check cache
    const snap = await get(cacheRef);
    const now = Date.now();

    if (snap.exists()) {
        const cached = snap.val();

        if (now - cached.cached_at < CACHE_TTL) {
            return res.json({
                success: true,
                cached: true,
                data: cached.data
            });
        }
    }

    // Fetch user from YOUR BOT, not Discord API
    const u = await fetchUserRaw(id);

    if (!u) {
        return res.json({ success: false, error: "user_not_found" });
    }

    const badges = getBadges(u.flags?.bitfield || 0);
    const nitro = getNitro(u.premiumType);

    const userData = {
        id: u.id,
        username: u.username,
        global_name: u.globalName ?? null,
        discriminator: u.discriminator,
        avatar: u.displayAvatarURL({ extension: "png", size: 4096 }),
        banner: u.bannerURL({ extension: "png", size: 4096 }),
        banner_color: u.hexAccentColor,
        created_timestamp: u.createdTimestamp,
        created_date: new Date(u.createdTimestamp).toISOString(),
        public_flags: badges,
        nitro: nitro
    };

    // Save to cache
    await set(cacheRef, {
        cached_at: now,
        data: userData
    });

    return res.json({
        success: true,
        cached: false,
        data: userData
    });
});

// ----------------------
// START SERVER
// ----------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API running on port " + PORT));
