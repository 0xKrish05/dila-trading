const mongoose = require("mongoose");

async function connect() {
  // Use MONGODB_URI from env, or fall back to local MongoDB
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/dila";
  try {
    await mongoose.connect(uri);
    console.log(`[DB] Connected to MongoDB: ${uri.split("@").pop() || uri}`);
  } catch (err) {
    if (!process.env.MONGODB_URI) {
      console.error("[DB] Could not connect to local MongoDB.");
      console.error("[DB] Set MONGODB_URI in server/.env to use MongoDB Atlas (free tier).");
      console.error("[DB] Get a free connection string at https://cloud.mongodb.com");
    }
    throw err;
  }
}

module.exports = { connect };
