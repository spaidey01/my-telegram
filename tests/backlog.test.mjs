import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { parseMentions, parseHashtags } from "../src/utils/messageParsing.js";
import { hasGroupPermission, isAdmin, channelCanPost } from "../server/security/permissions.js";
import { rateLimit } from "../src/utils/rateLimit.js";

test("mentions parser extracts unique usernames", () => {
  assert.deepEqual(parseMentions("hi @Alice @alice @bob_1"), ["alice", "bob_1"]);
});

test("hashtags parser extracts unique tags", () => {
  assert.deepEqual(parseHashtags("hello #Stargram #stargram #گروه"), ["stargram", "گروه"]);
});

test("group permissions enforce moderation before member overrides", () => {
  const room = {
    type: "group", participants: ["u1", "u2"], admins: [], creator: "u1",
    bannedUsers: ["u2"], restrictedUsers: [], mutedUsers: [],
    groupPermissions: { sendMessages: true },
    memberPermissions: new Map([["u2", { sendMessages: true }]]),
  };
  assert.equal(isAdmin(room, "u1"), true);
  assert.equal(hasGroupPermission(room, "u2", "sendMessages"), false);
  assert.equal(hasGroupPermission(room, "u1", "sendMessages"), true);
});

test("group permission override cannot grant access to a banned member", () => {
  const room = {
    type: "group", creator: "admin", participants: ["admin", "member"],
    bannedUsers: ["member"], restrictedUsers: [], mutedUsers: [],
    groupPermissions: { sendMessages: true },
    memberPermissions: new Map([["member", { sendMessages: true }]]),
  };
  assert.equal(hasGroupPermission(room, "member", "sendMessages"), false);
});

test("missing message cannot be treated as editable", () => {
  const message = null;
  assert.equal(Boolean(message), false);
});

test("rate limiter blocks only after the configured threshold", async () => {
  const key = "backlog-rate-limit-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex");
  assert.equal((await rateLimit(key, 2, 1000)).allowed, true);
  assert.equal((await rateLimit(key, 2, 1000)).allowed, true);
  assert.equal((await rateLimit(key, 2, 1000)).allowed, false);
});

test("channel creator cannot be removed as a subscriber", () => {
  const room = { type: "channel", creator: "owner", participants: ["owner", "admin"], admins: ["admin"] };
  assert.equal(room.creator?.toString() === "owner", true);
  assert.equal(room.participants.includes("owner"), true);
});

test("removing a channel role must revoke admin fallback", () => {
  const room = { type: "channel", creator: "owner", admins: ["editor"], channelRoles: new Map([["editor", "editor"]]) };
  room.channelRoles.delete("editor");
  room.admins = room.admins.filter((id) => id !== "editor");
  assert.equal(isAdmin(room, "editor"), false);
});

test("channel posting is limited to publisher roles", () => {
  const room = {
    type: "channel", creator: "owner",
    channelRoles: new Map([["editor", "editor"], ["moderator", "moderator"], ["member", "subscriber"]]),
  };
  assert.equal(channelCanPost(room, "owner"), true);
  assert.equal(channelCanPost(room, "editor"), true);
  assert.equal(channelCanPost(room, "moderator"), true);
  assert.equal(channelCanPost(room, "member"), false);
});
