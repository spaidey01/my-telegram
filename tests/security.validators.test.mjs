import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import RoomSchema from "../src/schemas/roomSchema.js";
import MessageSchema from "../src/schemas/messageSchema.js";

test("Mongo ObjectId validation rejects malformed identifiers",()=>{
  assert.equal(mongoose.isValidObjectId("abc"),false);
  assert.equal(mongoose.isValidObjectId("507f1f77bcf86cd799439011"),true);
});

test("room schema rejects invalid room types",()=>{
  const room=new RoomSchema({name:"x",type:"not-a-room",creator:new mongoose.Types.ObjectId(),participants:[]});
  assert.ok(room.validateSync()?.errors?.type);
});

test("message schema rejects missing required room/sender fields",()=>{
  const message=new MessageSchema({message:"hello"});
  const errors=message.validateSync()?.errors||{};
  assert.ok(errors.sender);
  assert.ok(errors.roomID);
});

test("message schema enforces message length",()=>{
  const message=new MessageSchema({
    sender:new mongoose.Types.ObjectId(),
    roomID:new mongoose.Types.ObjectId(),
    message:"x".repeat(10001),
  });
  assert.ok(message.validateSync()?.errors?.message);
});
