import { config } from "dotenv";
config();
import mongoose from "mongoose";

let connectionPromise = null;

const connectToDB = async () => {
  if (mongoose.connection.readyState === 1) return;

  if (!connectionPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not configured");

    connectionPromise = mongoose.connect(uri)
      .then(() => {
        console.log("✅ Connected to MongoDB successfully");
      })
      .catch((err) => {
        connectionPromise = null;
        console.error("❌ Failed to connect to MongoDB:", err);
        throw err;
      });
  }

  await connectionPromise;
};

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected");
});

export default connectToDB;
