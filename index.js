import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.DISCORD_TOKEN;

// ---------------- Fetch Discord User ----------------

async function fetchDiscordUser(userId) {
    const response = await fetch(`https://discord.com/api/v10/users/${userId}`, {
        headers: {
            Authorization: `Bot ${BOT_TOKEN}`
        }
    });

    // If Discord returned HTML instead of JSON
    const contentType = response.headers.get("content-type");

    if (!contentType || !contentType.includes("application/json")) {
        const html = await response.text();
        console.error("❌ Discord returned non-JSON response:");
        console.error(html);
        return null;
    }

    if (response.status === 404) return null;

    return await response.json();
}

// ---------------- Nitro Detection Logic ----------------

function detectNitro(user) {
    const detection_methods = [];

    const has_avatar_decoration = !!user.avatar_decoration_data;
    const has_collectibles = !!user.user_profile?.collectibles;
    const has_display_styles = !!user.user_profile?.bio_styles;
    const has_clan = !!user.clan;
    const has_banner = !!user.banner;

    const avatar_hash = user.avatar;
    const avatar_animated = avatar_hash ? avatar_hash.startsWith("a_") : false;

    if (has_avatar_decoration) detection_methods.push("avatar_decoration");
    if (has_collectibles) detection_methods.push("collectibles");
    if (has_display_styles) detection_methods.push("display_name_styles");
    if (has_clan) detection_methods.push("clan_badge");
    if (avatar_animated) detection_methods.push("animated_avatar");

    const has_nitro =
        has_avatar_decoration ||
        has_collectibles ||
        has_display_styles ||
        has_clan ||
        has_banner ||
        avatar_animated;

    return {
        has_nitro,
        nitro_type: has_nitro ? "Nitro" : "None",
        nitro_tier: has_nitro ? "Nitro" : "None",
        premium_type: user.premium_type || 0,
        detection_methods,
        avatar_animated,
        has_avatar_decoration,
        has_collectibles,
        has_display_styles,
        has_clan,
        has_banner
    };
}

// ----------------------- ROUTES -----------------------

app.get("/", (req, res) => {
    res.json({
        status: "online",
        name: "JS Discord Nitro Detection API",
        version: "1.0.0",
        endpoints: ["/api/nitro/:id", "/api/user/:id"]
    });
});

// Nitro Route
app.get("/api/nitro/:id", async (req, res) => {
    if (!BOT_TOKEN) {
        console.error("❌ DISCORD_TOKEN is missing!");
        return res.status(500).json({ error: "Missing DISCORD_TOKEN" });
    }

    const userId = req.params.id;

    if (!/^\d+$/.test(userId)) {
        return res.status(400).json({ error: "Invalid user ID" });
    }

    const user = await fetchDiscordUser(userId);
    if (!user) {
        return res.status(404).json({ success: false, error: "User not found or Discord blocked the request" });
    }

    const nitroInfo = detectNitro(user);

    res.json({
        success: true,
        user_id: userId,
        username: user.username,
        global_name: user.global_name,
        ...nitroInfo
    });
});

// Basic user info
app.get("/api/user/:id", async (req, res) => {
    const user = await fetchDiscordUser(req.params.id);

    if (!user) {
        return res.status(404).json({ success: false, error: "User not found" });
    }

    res.json({ success: true, user });
});

// ------------------- START SERVER ---------------------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
    console.log("BOT TOKEN LOADED:", BOT_TOKEN ? "YES" : "NO");
});
