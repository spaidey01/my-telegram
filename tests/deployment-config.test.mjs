import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const setup = readFileSync(new URL("../deploy/setup-vps.sh", import.meta.url), "utf8");
const runner = readFileSync(new URL("../deploy/stargram-runner.sh", import.meta.url), "utf8");

test("VPS setup uses the Node.js major required by package.json", () => {
  const engine = packageJson.engines?.node ?? "";
  const major = engine.match(/(?:>=|^)(\d+)/)?.[1];
  assert.ok(major, "package.json must declare a Node.js major version");
  assert.match(setup, new RegExp("setup_" + major + "\\.x"));
  assert.match(setup, new RegExp('node_major" == "' + major + '"'));
  assert.match(setup, new RegExp("Node\\.js " + major + " is required"));
});

test("deployment targets stargram_clone by default, not main", () => {
  assert.match(setup, /BRANCH="\$\{BRANCH:-stargram_clone\}"/);
  assert.match(runner, /BRANCH="\$\{BRANCH:-stargram_clone\}"/);
});

test("runner does not use floating latest container tags", () => {
  assert.doesNotMatch(runner, /(?:mongo|quay\.io\/minio\/(?:minio|mc)):\s*latest/);
  assert.match(runner, /MONGO_IMAGE="\$\{MONGO_IMAGE:-mongo:[0-9.]+\}"/);
  assert.match(runner, /MINIO_IMAGE="\$\{MINIO_IMAGE:-quay\.io\/minio\/minio:RELEASE\.[^}]+\}"/);
  assert.match(runner, /MINIO_MC_IMAGE="\$\{MINIO_MC_IMAGE:-quay\.io\/minio\/mc:RELEASE\.[^}]+\}"/);
});
