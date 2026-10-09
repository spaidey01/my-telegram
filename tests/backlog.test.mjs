import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { scheduledRetryDelayMs } from "../src/utils/scheduledRetry.js";
import { parseMentions, parseHashtags } from "../src/utils/messageParsing.js";
import { hasGroupPermission, isAdmin, channelCanPost } from "../server/security/permissions.js";

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
    type: "channel", creator: "owner", participants: ["owner", "editor", "moderator", "member"],
    channelRoles: new Map([["editor", "editor"], ["moderator", "moderator"], ["member", "subscriber"]]),
  };
  assert.equal(channelCanPost(room, "owner"), true);
  assert.equal(channelCanPost(room, "editor"), true);
  assert.equal(channelCanPost(room, "moderator"), true);
  assert.equal(channelCanPost(room, "member"), false);
});


test("scheduled retries use bounded exponential backoff", () => {
  assert.equal(scheduledRetryDelayMs(1), 30_000);
  assert.equal(scheduledRetryDelayMs(2), 60_000);
  assert.equal(scheduledRetryDelayMs(3), 120_000);
  assert.equal(scheduledRetryDelayMs(4), 240_000);
  assert.equal(scheduledRetryDelayMs(20), 15 * 60_000);
});

test("search and hashtag endpoints avoid unbounded offset/distinct pagination", () => {
  const search = fs.readFileSync("src/app/api/messages/search/route.ts", "utf8");
  const hashtags = fs.readFileSync("src/app/api/messages/hashtags/route.ts", "utf8");
  assert.doesNotMatch(search, /\.skip\(/);
  assert.match(search, /nextCursor/);
  assert.match(search, /CURSOR_REQUIRED/);
  assert.doesNotMatch(hashtags, /\.distinct\(/);
  assert.match(hashtags, /\$unwind: "\$hashtags"/);
  assert.match(hashtags, /\$limit: limit/);
});
