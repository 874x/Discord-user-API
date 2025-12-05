require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_KEY)),
    databaseURL: process.env.FIREBASE_URL
  });
}

const db = getDatabase();
const app = express();
app.use(express.json());

/**
 * FAKE USER PROVIDER:
 * This replaces Discord API.
 * You can modify the endpoint to your own data source.
 */
async function getUserFromYourSource(id) {
  const url = `https://japi.rest/discord/v1/user/${id}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

app.get("/user/:id", async (req, res) => {
  const id = req.params.id;
  const ref = db.ref(`users/${id}`);

  try {
    const snap = await ref.get();
    let cached = snap.val();

    // Check your API source
    const fresh = await getUserFromYourSource(id);

    if (!fresh || fresh.error) {
      return res.status(404).json({ success: false, error: "user_not_found" });
    }

    // Only rewrite Firebase if:
    // - not cached
    // - badges updated
    // - username changed
    // - avatar changed etc.
    if (!cached || JSON.stringify(cached) !== JSON.stringify(fresh)) {
      await ref.set(fresh);
    }

    res.json({
      success: true,
      cached: !!cached,
      data: fresh
    });

  } catch (e) {
    console.log("ERROR:", e);
    res.status(500).json({ success: false, error: "internal_error" });
  }
});

app.get("/", (req, res) => {
  res.send("Discord User API is running ✔");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on port ${PORT}`));
