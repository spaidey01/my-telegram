import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const setup = readFileSync(new URL("../deploy/setup-vps.sh", import.meta.url), "utf8");
const runner = readFileSync(new URL("../deploy/stargram-runner.sh", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../deploy/deploy-vps.sh", import.meta.url), "utf8");

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
  assert.match(setup, /status --porcelain/);
  assert.match(setup, /checkout -b "\$BRANCH" "origin\/\$BRANCH"/);
  assert.match(setup, /merge --ff-only "origin\/\$BRANCH"/);
  assert.match(runner, /BRANCH="\$\{BRANCH:-stargram_clone\}"/);
  assert.match(runner, /checkout "\$BRANCH"/);
  assert.match(runner, /checkout -b "\$BRANCH" "origin\/\$BRANCH"/);
  assert.match(runner, /merge --ff-only "origin\/\$BRANCH"/);
  assert.match(deploy, /BRANCH="\$\{BRANCH:-stargram_clone\}"/);
  assert.match(deploy, /status --porcelain/);
  assert.match(deploy, /checkout -b "\$BRANCH" "origin\/\$BRANCH"/);
  assert.match(deploy, /merge --ff-only "origin\/\$BRANCH"/);
});

test("runner does not use floating latest container tags", () => {
  assert.doesNotMatch(runner, /(?:mongo|quay\.io\/minio\/(?:minio|mc)):\s*latest/);
  assert.match(runner, /MONGO_IMAGE="\$\{MONGO_IMAGE:-mongo:[0-9.]+\}"/);
  assert.match(runner, /MINIO_IMAGE="\$\{MINIO_IMAGE:-quay\.io\/minio\/minio:RELEASE\.[^}]+\}"/);
  assert.match(runner, /MINIO_MC_IMAGE="\$\{MINIO_MC_IMAGE:-quay\.io\/minio\/mc:RELEASE\.[^}]+\}"/);
});

test("runner keeps production environment root-owned and group-readable", () => {
  assert.equal((runner.match(/chown "root:\$\(id -gn "\$APP_USER"\)" "\$ENV_FILE"; chmod 0640 "\$ENV_FILE"/g) ?? []).length, 2);
});

test("runner applies edited configuration instead of exiting after the editor", () => {
  const optionFour = runner.split(/\n\s*4\) /)[1]?.split(/\n\s*5\) /)[0] ?? "";
  assert.match(optionFour, /"\$\{EDITOR:-nano\}" "\$ENV_FILE"; apply_config/);
});

test("runner preserves SSH access when configuring firewalld", () => {
  assert.ok(runner.includes('firewall-cmd --permanent --add-port="${ssh_port}/tcp"'));
});

test("runner refuses to downgrade failed domain HTTPS provisioning to public HTTP", () => {
  assert.match(runner, /if ! certbot --nginx -d "\$domain" --email "\$email" --agree-tos --non-interactive --redirect; then[\s\S]*?die "HTTPS certificate issuance failed\. Refusing to downgrade a domain deployment to public HTTP/);
  assert.doesNotMatch(runner, /certificate issuance failed[^\n]*Keeping HTTP test mode/);
});

test("runner does not export arbitrary environment-file keys into its root shell", () => {
  const loader = runner.split(/load_env_file\(\)\{/)[1]?.split(/\nbuild_env_args\(\)\{/)[0] ?? "";
  assert.match(loader, /case "\$key" in[\s\S]*secretKey\)[\s\S]*TURN_SECRET\)/);
  assert.doesNotMatch(loader, /export "\$key"/);
  assert.match(loader, /Only copy the two values the root runner itself needs/);
});

test("legacy VPS setup keeps the environment file root-owned and non-writable by the app", () => {
  assert.match(setup, /install -m 0640 -o root -g "\$APP_GROUP" "\$APP_DIR\/\.env\.example" "\$ENV_FILE"/);
  assert.match(setup, /chown "root:\$APP_GROUP" "\$ENV_FILE"\s*chmod 0640 "\$ENV_FILE"/);
});

test("runner refuses existing containers and persistent volumes before creating resources", () => {
  const serviceSetup = runner.split(/setup_auto_services\(\)\{/)[1]?.split(/\n\}\nsetup_manual_services\(\)/)[0] ?? "";
  const containerGuard = serviceSetup.indexOf('docker container inspect stargram-mongodb');
  const volumeGuard = serviceSetup.indexOf('docker volume inspect stargram-mongodb-data');
  const volumeCreate = serviceSetup.indexOf('docker volume create stargram-mongodb-data');
  assert.ok(containerGuard >= 0 && volumeGuard >= 0 && volumeCreate >= 0, "service setup must validate existing resources");
  assert.ok(containerGuard < volumeCreate, "existing containers must be checked before resource creation");
  assert.ok(volumeGuard < volumeCreate, "existing volumes must be checked before resource creation");
});


test("VPS setup installs dev dependencies only for building, then prunes them before starting services", () => {
  assert.match(setup, /npm ci --include=dev/);
  assert.match(setup, /npm run build[\s\S]*?npm prune --omit=dev[\s\S]*?systemctl restart my-telegram-web my-telegram-socket/);
});

test("VPS deploy prunes development dependencies after building and before service restart", () => {
  assert.match(deploy, /npm ci --include=dev/);
  assert.match(deploy, /npm run build[\s\S]*?npm prune --omit=dev[\s\S]*?systemctl restart my-telegram-web my-telegram-socket/);
});
