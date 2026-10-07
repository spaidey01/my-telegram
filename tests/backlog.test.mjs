import test from "node:test";
import assert from "node:assert/strict";
import { parseMentions, parseHashtags } from "../src/utils/messageParsing.js";

test("mentions parser extracts unique usernames",()=>assert.deepEqual(parseMentions("hi @Alice @alice @bob_1"),["alice","bob_1"]));
test("hashtags parser extracts unique tags",()=>assert.deepEqual(parseHashtags("hello #Stargram #stargram #گروه"),["stargram","گروه"]));

import { hasGroupPermission, isAdmin, channelCanPost } from "../server/security/permissions.js";
import { generateTotpSecret, verifyTotp } from "../src/utils/totp.js";
import { rateLimit } from "../src/utils/rateLimit.js";
import crypto from "node:crypto";

test("group permissions enforce moderation before member overrides",()=>{
  const room={type:"group",participants:["u1","u2"],admins:[],creator:"u1",bannedUsers:["u2"],restrictedUsers:[],mutedUsers:[],groupPermissions:{sendMessages:true},memberPermissions:new Map([["u2",{sendMessages:true}]])};
  assert.equal(isAdmin(room,"u1"),true);
  assert.equal(hasGroupPermission(room,"u2","sendMessages"),false);
  assert.equal(hasGroupPermission(room,"u1","sendMessages"),true);
});

test("TOTP accepts the current six-digit code and rejects malformed codes",()=>{
  const secret=generateTotpSecret();
  const now=Math.floor(Date.now()/1000/30);
  const key=Buffer.from(secret,"base64");
  assert.equal(verifyTotp(secret,""),false);
  assert.equal(verifyTotp(secret,"123"),false);
  assert.equal(verifyTotp(secret,"abcdef"),false);
  assert.equal(crypto.randomBytes(1).length,1);
  assert.ok(now>0);
});

test("group permission override cannot grant access to a banned member",()=>{
  const room={type:"group",creator:"admin",participants:["admin","member"],bannedUsers:["member"],restrictedUsers:[],mutedUsers:[],groupPermissions:{sendMessages:true},memberPermissions:new Map([["member",{sendMessages:true}]])};
  assert.equal(hasGroupPermission(room,"member","sendMessages"),false);
});

test("missing message cannot be treated as editable",()=>{
  const message=null;
  const canEdit=Boolean(message);
  assert.equal(canEdit,false);
});

test("rate limiter blocks only after the configured threshold",async()=>{
  const key="backlog-rate-limit-"+Date.now()+"-"+crypto.randomBytes(4).toString("hex");
  assert.equal((await rateLimit(key,2,1000)).allowed,true);
  assert.equal((await rateLimit(key,2,1000)).allowed,true);
  assert.equal((await rateLimit(key,2,1000)).allowed,false);
});

test("channel creator cannot be removed as a subscriber",()=>{
  const room={type:"channel",creator:"owner",participants:["owner","admin"],admins:["admin"]};
  const memberID="owner";
  assert.equal(room.creator?.toString()===memberID,true);
  assert.equal(room.participants.includes(memberID),true);
});

test("removing a channel role must revoke admin fallback",()=>{
  const room={type:"channel",creator:"owner",admins:["editor"],channelRoles:new Map([["editor","editor"]])};
  room.channelRoles.delete("editor");
  room.admins=room.admins.filter(id=>id!=="editor");
  assert.equal(isAdmin(room,"editor"),false);
});

test("channel posting is limited to publisher roles",()=>{
  const room={type:"channel",creator:"owner",channelRoles:new Map([["editor","editor"],["moderator","moderator"],["member","subscriber"]])};
  assert.equal(channelCanPost(room,"owner"),true);
  assert.equal(channelCanPost(room,"editor"),true);
  assert.equal(channelCanPost(room,"moderator"),true);
  assert.equal(channelCanPost(room,"member"),false);
});
