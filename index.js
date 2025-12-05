import express from "express";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(express.json());

// Discord API fetcher
async function fetchDiscordUser(userId) {
    const url = `https://discord.com/api/v10/users/${userId}`;

    const res = await fetch(url, {
        headers: {
            "Authorization": `Bot ${process.env.DISCORD_TOKEN}`,
            "Content-Type": "application/json"
        }
    });

    const text = await res.text();

    // Debug logging
    console.log("Discord API Raw Response:");
    console.log(text);

    try {
        return JSON.parse(text);
    } catch (err) {
        console.error("JSON Parse Error:", err);
        return {
            error: true,
            reason: "Discord returned non-JSON (usually HTML login page)",
            raw: text
        };
    }
}

// Nitro checker (using billing/api)
async function fetchNitro(token) {
    const res = await fetch("https://discord.com/api/v9/users/@me/billing/subscriptions", {
        headers: { "Authorization": token }
    });

    const text = await res.text();
    console.log("Billing API Response:", text);

    try {
        const data = JSON.parse(text);

        if (!Array.isArray(data) || data.length === 0) return "None";

        const months = data[0]?.billing_cycle || 0;

        if (months >= 72) return "Fire72Months";
        if (months >= 60) return "Ruby60Months";
        if (months >= 36) return "Emerald36Months";
        if (months >= 24) return "Diamond24Months";
        if (months >= 12) return "Platinum12Months";
        if (months >= 3) return "Silver3Months";
        if (months >= 1) return "Bronze1Month";

        return "Nitro";
    } catch {
        return "None";
    }
}

// Badge Parser
function getBadges(public_flags) {
    const badgeList = [];

    const flags = {
        [1 << 0]: "DiscordStaff",
        [1 << 1]: "PartneredServerOwner",
        [1 << 2]: "HypeSquadEvents",
        [1 << 3]: "BugHunterLevel1",
        [1 << 6]: "HypeSquadBravery",
        [1 << 7]: "HypeSquadBrilliance",
        [1 << 8]: "HypeSquadBalance",
        [1 << 9]: "EarlySupporter",
        [1 << 14]: "BugHunterLevel2",
        [1 << 17]: "ActiveDeveloper",
        [1 << 18]: "ModeratorProgramsAlumni",
        [1 << 19]: "EarlyVerifiedBotDeveloper"
    };

    for (const [flag, name] of Object.entries(flags)) {
        if (public_flags & flag) badgeList.push(name);
    }

    return badgeList;
}

// Convert badge names → emoji
function convertBadgesToEmojis(badges) {
    const out = [];

    for (const badge of badges) {
        if (emojis.Discord_Badges[badge]) {
            out.push(emojis.Discord_Badges[badge]);
        }
    }

    return out.join(" ");
}

// Nitro emoji getter
function getNitroEmoji(tierName) {
    if (emojis.Discord_Nitro_Tier[tierName]) {
        return emojis.Discord_Nitro_Tier[tierName];
    }
    return "";
}

// API Endpoint
app.post("/discord", async (req, res) => {
    const { userId, userToken } = req.body;

    if (!userId) return res.json({ error: "userId missing" });

    const user = await fetchDiscordUser(userId);

    if (user.error) return res.json(user);

    const badges = getBadges(user.public_flags || 0);
    const badgeEmojis = convertBadgesToEmojis(badges);

    let nitroTier = "None";
    let nitroEmoji = "";

    if (userToken) {
        nitroTier = await fetchNitro(userToken);
        nitroEmoji = getNitroEmoji(nitroTier);
    }

    return res.json({
        id: user.id,
        username: user.username,
        global_name: user.global_name,
        avatar: user.avatar,
        badges: badgeEmojis,
        nitro: nitroEmoji
    });
});

// Start
app.listen(3000, () => {
    console.log("API running on port 3000");
});


