import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateProductionEnv } from "../src/utils/productionConfig.js";

const valid = {
  NODE_ENV: "production",
  secretKey: "s".repeat(32),
  MONGODB_URI: "mongodb://localhost/stargram",
  REDIS_URL: "redis://localhost:6379",
  S3_ACCESS_KEY: "access",
  S3_SECRET_KEY: "secret",
  S3_ENDPOINT: "https://storage.example.com",
  S3_BUCKET_NAME: "stargram",
  CLIENT_ORIGIN: "https://chat.example.com",
  NEXT_PUBLIC_APP_URL: "https://chat.example.com",
  NEXT_PUBLIC_SOCKET_SERVER_URL: "https://chat.example.com",
  TURN_URL: "turn:turn.example.com:3478,turns:turn.example.com:5349?transport=tcp",
  TURN_SECRET: "t".repeat(32),
  TURN_CREDENTIAL_TTL_SECONDS: "600",
  CLAMAV_HOST: "127.0.0.1",
  CLAMAV_PORT: "3310",
  TRUSTED_PROXY_COUNT: "1",
};

test("production environment accepts a complete secure configuration", () => {
  assert.deepEqual(validateProductionEnv(valid), { ok: true });
});

for (const [name, mutate] of [
  ["missing Redis", (env) => { delete env.REDIS_URL; }],
  ["missing ClamAV", (env) => { delete env.CLAMAV_HOST; }],
  ["missing ephemeral TURN secret", (env) => { delete env.TURN_SECRET; }],
  ["HTTP public app URL", (env) => { env.NEXT_PUBLIC_APP_URL = "http://chat.example.com"; }],
  ["weak application secret", (env) => { env.secretKey = "short"; }],
  ["invalid proxy count", (env) => { env.TRUSTED_PROXY_COUNT = "1.5"; }],
]) {
  test(`production environment rejects ${name}`, () => {
    const env = { ...valid };
    mutate(env);
    assert.throws(() => validateProductionEnv(env));
  });
}


test("production systemd units are hardened", async () => {
  const web = await readFile(new URL("../deploy/my-telegram-web.service", import.meta.url), "utf8");
  const socket = await readFile(new URL("../deploy/my-telegram-socket.service", import.meta.url), "utf8");
  for (const unit of [web, socket]) {
    assert.match(unit, /^User=telegram$/m);
    assert.match(unit, /^Group=telegram$/m);
    assert.match(unit, /^NoNewPrivileges=true$/m);
    assert.match(unit, /^PrivateTmp=true$/m);
    assert.match(unit, /^ProtectHome=true$/m);
    assert.match(unit, /^ProtectSystem=full$/m);
    assert.match(unit, /^ProtectKernelTunables=true$/m);
    assert.match(unit, /^ProtectKernelModules=true$/m);
    assert.match(unit, /^ProtectControlGroups=true$/m);
    assert.match(unit, /^RestrictSUIDSGID=true$/m);
    assert.match(unit, /^UMask=027$/m);
  }
});

test("file deletion is bound to the active session and browser request policy", async () => {
  const route = await readFile(new URL("../src/app/api/files/delete/route.ts", import.meta.url), "utf8");
  assert.match(route, /isSafeBrowserRequest/);
  assert.match(route, /SessionSchema/);
  assert.match(route, /revokedAt: null/);
  assert.match(route, /sessionVersion/);
  assert.match(route, /sessionId/);
});
