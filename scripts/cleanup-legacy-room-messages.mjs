import connectToDB from "../src/db/index.js";
import RoomSchema from "../src/schemas/roomSchema.js";

await connectToDB();

const result = await RoomSchema.updateMany(
  { messages: { $exists: true } },
  { $unset: { messages: "" } },
);

console.log(`Removed legacy Room.messages from ${result.modifiedCount} room documents.`);
process.exit(0);
