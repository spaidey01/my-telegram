import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildTurnIceServers } from "../src/utils/turnCredentials.js";

test("TURN REST credentials are ephemeral, signed, and opaque", () => {
  process.env.TURN_URL = "turn:turn.example.com:3478,turns:turn.example.com:5349?transport=tcp";
  process.env.TURN_SECRET = "unit-test-turn-secret";
  process.env.TURN_CREDENTIAL_TTL_SECONDS = "600";
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_CREDENTIAL;

  const before = Math.floor(Date.now() / 1000);
  const result = buildTurnIceServers("507f1f77bcf86cd799439011");
  const after = Math.floor(Date.now() / 1000);

  assert.equal(result.mode, "ephemeral");
  assert.equal(result.iceServers.length, 1);
  assert.deepEqual(result.iceServers[0].urls, [
    "turn:turn.example.com:3478",
    "turns:turn.example.com:5349?transport=tcp",
  ]);
  assert.ok(result.expiresAt >= before + 600);
  assert.ok(result.expiresAt <= after + 600);
  assert.match(result.iceServers[0].username, /^\d+:[a-f0-9]{36}$/);
  assert.doesNotMatch(result.iceServers[0].username, /507f1f77bcf86cd799439011/);

  const expected = crypto
    .createHmac("sha1", process.env.TURN_SECRET)
    .update(result.iceServers[0].username)
    .digest("base64");
  assert.equal(result.iceServers[0].credential, expected);
  assert.equal(result.ttl, 600);
});

test("TURN supports static credentials as a compatibility fallback", () => {
  process.env.TURN_URL = "turn:turn.example.com:3478";
  delete process.env.TURN_SECRET;
  delete process.env.TURN_CREDENTIAL_TTL_SECONDS;
  process.env.TURN_USERNAME = "stargram";
  process.env.TURN_CREDENTIAL = "static-password";

  const result = buildTurnIceServers("507f1f77bcf86cd799439011");
  assert.equal(result.mode, "static");
  assert.deepEqual(result.iceServers, [{
    urls: ["turn:turn.example.com:3478"],
    username: "stargram",
    credential: "static-password",
  }]);
  assert.equal(result.ttl, null);
});

test("TURN configuration rejects incomplete authentication", () => {
  process.env.TURN_URL = "turn:turn.example.com:3478";
  delete process.env.TURN_SECRET;
  delete process.env.TURN_USERNAME;
  delete process.env.TURN_CREDENTIAL;

  assert.throws(
    () => buildTurnIceServers("507f1f77bcf86cd799439011"),
    /TURN_SECRET or TURN_USERNAME\/TURN_CREDENTIAL/,
  );
});
