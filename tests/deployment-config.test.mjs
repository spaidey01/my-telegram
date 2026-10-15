import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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


test("runner acquires an exclusive process lock before state-changing operations", async () => {
  const lockStart = runner.indexOf("# Acquire a host-wide exclusive lock before any state-changing operation.");
  const lockEnd = runner.indexOf('command -v apt-get >/dev/null || die "Only Debian/Ubuntu supported."', lockStart);
  assert.ok(lockStart >= 0, "runner must document the lock acquisition block");
  assert.ok(lockEnd > lockStart, "lock must be acquired before package-manager checks and setup");

  const lockBlock = runner.slice(lockStart, lockEnd)
    .replace('RUNNER_LOCK_FILE=/run/lock/stargram-runner.lock', 'RUNNER_LOCK_FILE="$TEST_RUNNER_LOCK_FILE"');
  assert.match(lockBlock, /command -v flock/);
  assert.match(lockBlock, /flock -n "\\$RUNNER_LOCK_FD"/);
  assert.match(lockBlock, /Another Stargram Runner instance is already running/);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stargram-runner-lock-"));
  const lockFile = path.join(tempDir, "runner.lock");
  const harness = `die(){ echo "$*" >&2; exit 1; }\\n${lockBlock}`;
  const first = spawn("bash", ["-c", `${harness}\\nprintf 'LOCK_ACQUIRED\\n'\\nsleep 1.2`], {
    env: { ...process.env, TEST_RUNNER_LOCK_FILE: lockFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let firstStdout = "";
  let firstStderr = "";
  first.stdout.setEncoding("utf8");
  first.stderr.setEncoding("utf8");
  first.stdout.on("data", chunk => { firstStdout += chunk; });
  first.stderr.on("data", chunk => { firstStderr += chunk; });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("first runner did not acquire lock in time")), 2000);
      first.stdout.on("data", () => {
        if (firstStdout.includes("LOCK_ACQUIRED")) {
          clearTimeout(timer);
          resolve();
        }
      });
      first.once("error", error => { clearTimeout(timer); reject(error); });
      first.once("exit", code => {
        if (code !== 0) { clearTimeout(timer); reject(new Error(`first runner exited ${code}: ${firstStderr}`)); }
      });
    });

    const second = spawnSync("bash", ["-c", `${harness}\\nprintf 'UNEXPECTEDLY_ACQUIRED\\n'`], {
      encoding: "utf8",
      env: { ...process.env, TEST_RUNNER_LOCK_FILE: lockFile },
      timeout: 2000,
    });
    assert.notEqual(second.status, 0, "a concurrent runner must be rejected");
    assert.match(second.stderr, /Another Stargram Runner instance is already running/);
    assert.doesNotMatch(second.stdout, /UNEXPECTEDLY_ACQUIRED/);

    const firstExit = await new Promise((resolve, reject) => {
      first.once("error", reject);
      first.once("exit", (code, signal) => resolve({ code, signal }));
    });
    assert.equal(firstExit.code, 0, `first runner failed: ${firstStderr}`);

    const third = spawnSync("bash", ["-c", `${harness}\\nprintf 'ACQUIRED_AFTER_RELEASE\\n'`], {
      encoding: "utf8",
      env: { ...process.env, TEST_RUNNER_LOCK_FILE: lockFile },
      timeout: 2000,
    });
    assert.equal(third.status, 0, third.stderr);
    assert.match(third.stdout, /ACQUIRED_AFTER_RELEASE/);
  } finally {
    if (first.exitCode === null && first.signalCode === null) first.kill("SIGTERM");
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runner separates root-owned Git metadata from the writable runtime tree", () => {
  assert.match(runner, /GIT_DIR=\/opt\/my-telegram\.git/);
  assert.match(runner, /git clone --separate-git-dir="\$GIT_DIR"/);
  assert.match(runner, /git -c core\.hooksPath=\/dev\/null/);
  assert.match(runner, /chown -R root:root "\$GIT_DIR"/);
  assert.match(runner, /chmod -R go-w "\$GIT_DIR"/);
  assert.match(runner, /chown -R "\$APP_USER:\$app_group" "\$APP_DIR"/);
  assert.match(runner, /install -d -o "\$APP_USER" -g "\$app_group" -m 0750 "\$APP_DIR\/node_modules" "\$APP_DIR\/\.next"/);
  assert.match(runner, /npm ci --include=dev/);
  assert.doesNotMatch(runner, /chown -R root:root "\$APP_DIR"\n\s*chmod -R go-w "\$APP_DIR\/\.git"/);
});


test("runner restores app ownership after a failed privileged Git update", () => {
  assert.match(runner, /APP_TREE_PROTECTED=1\s+chown -R root:root "\$APP_DIR"\s+chmod -R go-w "\$APP_DIR"/);
  assert.match(runner, /APP_TREE_PROTECTED=0/);
  assert.match(runner, /local restore_group/);
  assert.match(runner, /restore_group="\$\(id -gn "\$APP_USER"\)"/);
  assert.match(runner, /chown -R "\$APP_USER:\$restore_group" "\$APP_DIR" \|\| true/);
});

test("runner refuses a symlinked .git path and non-directory checkout paths", () => {
  assert.match(runner, /\[\[ ! -L "\$APP_DIR\/.git" \]\] \|\| die "Git metadata path/);
  assert.match(runner, /\[\[ ! -e "\$APP_DIR" \|\| -d "\$APP_DIR" \]\]/);
  assert.match(runner, /\[\[ ! -e "\$GIT_DIR" \|\| -d "\$GIT_DIR" \]\]/);
});

test("manual database URI and secret credentials are not echoed to the terminal", () => {
  assert.match(runner, /ask_secret\(\)\{ local v; read -r -s -p/);
  const manual = runner.split(/write_manual_env\(\)\{/)[1]?.split(/\nconfigure_clamav\(\)\{/)[0] ?? "";
  assert.match(manual, /mongo="\$\(ask_secret "MongoDB URI"\)"/);
  assert.match(manual, /secret="\$\(ask_secret "S3 secret key"\)"/);
  assert.match(manual, /turnsecret="\$\(ask_secret "TURN secret \(32\+ chars\)"\)"/);
});

test("runner refuses symlinked checkout and Git metadata paths", () => {
  assert.match(runner, /\[\[ ! -L "\$APP_DIR" && ! -L "\$GIT_DIR" \]\] \|\| die "Application directory and Git metadata path must not be symlinks\."/);
});

test("runner accepts only the expected separate-Git-dir pointer on repeat installs", () => {
  assert.ok(runner.includes('git clone --separate-git-dir="$GIT_DIR"'));
  assert.ok(runner.includes('gitfile_content'));
  assert.ok(runner.includes('"gitdir: $GIT_DIR"'));
  assert.ok(runner.includes('Unexpected .git pointer in $APP_DIR'));
  assert.ok(runner.includes('Unsupported .git entry in $APP_DIR'));
  assert.match(runner, /printf 'gitdir: %s\\n' "\$GIT_DIR" > "\$APP_DIR\/.git"/);
});

test("setup and deploy scripts support runner-managed .git pointer files", () => {
  assert.match(setup, /if \[\[ -d "\$APP_DIR\/.git" \|\| -f "\$APP_DIR\/.git" \]\]; then/);
  assert.match(deploy, /\[\[ -d "\$APP_DIR\/.git" \|\| -f "\$APP_DIR\/.git" \]\] \|\| die/);
});

test("editing configuration is transactional and restores the prior environment on failure", () => {
  const optionFour = runner.split(/\n\s*4\) /)[1]?.split(/\n\s*5\) /)[0] ?? "";
  assert.ok(optionFour.indexOf("begin_network_transaction") < optionFour.indexOf('"\${EDITOR:-nano}"'));
  assert.ok(optionFour.indexOf("apply_config") < optionFour.indexOf("NETWORK_TXN_ACTIVE=0"));
  assert.match(runner, /restore_path env "\$ENV_FILE"/);
});

test("runner pins container images and uses SeaweedFS instead of MinIO", () => {
  assert.doesNotMatch(runner, /:latest\\b/);
  assert.match(runner, /MONGO_IMAGE=.*mongo:/);
  assert.match(runner, /SEAWEEDFS_IMAGE=.*seaweedfs@sha256:[a-f0-9]{64}/);
  assert.match(runner, /docker run -d --name stargram-seaweedfs/);
  assert.match(runner, /-e S3_BUCKET=stargram/);
  assert.match(runner, /verify_s3_storage/);
  assert.match(runner, /Legacy stargram-minio-data is deliberately left untouched and is not reused/);
});

test("runner keeps production environment root-owned and group-readable", () => {
  assert.equal((runner.match(/chown "root:\$\(id -gn "\$APP_USER"\)" "\$ENV_FILE"; chmod 0640 "\$ENV_FILE"/g) ?? []).length, 2);
});

test("runner applies edited configuration instead of exiting after the editor", () => {
  const optionFour = runner.split(/\n\s*4\) /)[1]?.split(/\n\s*5\) /)[0] ?? "";
  assert.match(optionFour, /"\$\{EDITOR:-nano\}" "\$ENV_FILE"\s+apply_config/);
});

test("runner preserves SSH access when configuring firewalld", () => {
  assert.ok(runner.includes('firewall-cmd --permanent --add-port="${ssh_port}/tcp"'));
});

test("runner rolls back Nginx config if nginx -t rejects the generated site", () => {
  const validationFailure = runner.indexOf('if ! nginx -t; then');
  const rollbackMessage = runner.indexOf("restoring the previous site configuration", validationFailure);
  const failureExit = runner.indexOf("previous configuration was restored", rollbackMessage);
  assert.ok(validationFailure >= 0, "generated Nginx config must be syntax-checked");
  assert.ok(rollbackMessage > validationFailure, "syntax failure must trigger rollback");
  assert.ok(failureExit > rollbackMessage, "syntax failure must report that rollback was attempted");
});

test("runner restores the previous Nginx configuration when certificate provisioning fails", () => {
  assert.ok(runner.includes('local domain email ip url nginx_backup="" default_backup=""'));
  const certbotFailure = runner.indexOf("if ! certbot --nginx");
  const rollbackMessage = runner.indexOf("restoring the previous Nginx site configuration", certbotFailure);
  const restoreSite = runner.indexOf('cp -a "$nginx_backup" /etc/nginx/sites-available/stargram', rollbackMessage);
  const validateRestoredSite = runner.indexOf("if nginx -t; then", restoreSite);
  const failureExit = runner.indexOf('die "HTTPS certificate issuance failed.', validateRestoredSite);
  assert.ok(certbotFailure >= 0 && rollbackMessage > certbotFailure, "Certbot failure must trigger Nginx rollback");
  assert.ok(restoreSite > rollbackMessage, "rollback must restore the prior site config when one existed");
  assert.ok(validateRestoredSite > restoreSite, "restored Nginx config must be validated");
  assert.ok(failureExit > validateRestoredSite, "runner must stop after failed certificate provisioning");
});

test("runner rolls back Nginx site changes when service start or reload fails", () => {
  const failedReload = runner.indexOf('if ! systemctl enable --now nginx || ! systemctl reload nginx; then');
  const rollback = runner.indexOf('restoring the previous site configuration', failedReload);
  const restoreDefault = runner.indexOf('cp -a "$default_backup" /etc/nginx/sites-enabled/default', rollback);
  const fatal = runner.indexOf('Nginx failed to start or reload; previous site configuration was restored.', restoreDefault);
  assert.ok(failedReload >= 0, "Nginx service operations must be checked");
  assert.ok(rollback > failedReload, "service failure must trigger rollback");
  assert.ok(restoreDefault > rollback, "rollback must restore the previous default site");
  assert.ok(fatal > restoreDefault, "runner must stop after rollback");
});

test("runner removes partial auto-created containers and volumes when setup fails", () => {
  assert.match(runner, /AUTO_SETUP_ACTIVE=0/);
  assert.match(runner, /rollback_auto_setup\(\)\{/);
  assert.match(runner, /AUTO_MONGO_VOLUME_CREATED=0/);
  assert.match(runner, /AUTO_SEAWEEDFS_VOLUME_CREATED=0/);
  assert.match(runner, /AUTO_MONGO_CONTAINER_CREATED=0/);
  assert.match(runner, /AUTO_SEAWEEDFS_CONTAINER_CREATED=0/);
  assert.ok(runner.includes(`if [[ "$AUTO_MONGO_VOLUME_CREATED" == 1 ]]; then\n    docker volume rm stargram-mongodb-data`));
  assert.ok(runner.includes(`if [[ "$AUTO_SEAWEEDFS_VOLUME_CREATED" == 1 ]]; then\n    docker volume rm stargram-seaweedfs-data`));
  assert.ok(runner.includes(`if [[ "$AUTO_MONGO_CONTAINER_CREATED" == 1 ]]; then\n    docker rm -f stargram-mongodb`));
  assert.ok(runner.includes(`if [[ "$AUTO_SEAWEEDFS_CONTAINER_CREATED" == 1 ]]; then\n    docker rm -f stargram-seaweedfs`));
  assert.match(runner, /AUTO_MONGO_VOLUME_CREATED=1/);
  assert.match(runner, /AUTO_SEAWEEDFS_VOLUME_CREATED=1/);
  assert.match(runner, /AUTO_MONGO_CONTAINER_CREATED=1/);
  assert.match(runner, /AUTO_SEAWEEDFS_CONTAINER_CREATED=1/);
  assert.match(runner, /AUTO_TURN_CONFIG_TOUCHED=1/);
  assert.match(runner, /if \[\[ "\$status" -ne 0 && "\$AUTO_SETUP_ACTIVE" == 1 \]\]; then\s+rollback_auto_setup/);
  const setupComplete = runner.indexOf("AUTO_SETUP_ACTIVE=0", runner.indexOf('  1) [[ ! -f "$ENV_FILE" ]]'));
  const applyConfig = runner.indexOf("apply_config", runner.indexOf('  1) [[ ! -f "$ENV_FILE" ]]'));
  assert.ok(setupComplete > 0 && applyConfig > 0 && setupComplete > applyConfig, "auto-service rollback must remain active through network setup and app configuration");
});

test("runner validates DNS hostnames and certificate email addresses", () => {
  assert.match(runner, /valid_domain\(\)\{/);
  assert.match(runner, /valid_email\(\)\{/);
  assert.match(runner, /valid_domain "\$domain" \|\| die "Invalid domain hostname/);
  assert.match(runner, /valid_email "\$email" \|\| die "Valid email required/);
  assert.match(runner, /\$value" != \*\.\.\*/);
});

test("TURN realm validator accepts hostnames and bounded IPv4 only", () => {
  const extractFunction = (name) => {
    const start = runner.indexOf(`${name}(){`);
    const end = runner.indexOf("\n}", start) + 2;
    assert.ok(start >= 0 && end > start, `${name} function must exist`);
    return runner.slice(start, end);
  };
  const script = `${extractFunction("valid_domain")}\n${extractFunction("valid_turn_realm")}\nvalid_turn_realm "$1"`;
  for (const realm of ["turn.example.com", "ci.turn.stargram.local", "8.8.8.8"]) {
    const result = spawnSync("bash", ["-c", script, "test", realm], { encoding: "utf8" });
    assert.equal(result.status, 0, `valid TURN realm rejected: ${realm}`);
  }
  for (const realm of ["999.1.1.1", "256.1.1.1", "-bad.example.com", "bad..example.com", "123.456"]) {
    const result = spawnSync("bash", ["-c", script, "test", realm], { encoding: "utf8" });
    assert.notEqual(result.status, 0, `invalid TURN realm accepted: ${realm}`);
  }
});

test("runner validates TURN realm before writing coturn configuration", () => {
  assert.match(runner, /valid_turn_realm\(\)\{/);
  assert.match(runner, /valid_turn_realm "\$realm" \|\| die "TURN realm must be a valid IPv4 address or DNS hostname\."/);
  assert.match(runner, /valid_domain "\$realm"/);
});

test("runner preflights public IP before creating persistent service resources", () => {
  const serviceSetup = runner.split(/setup_auto_services\(\)\{/)[1]?.split(/\n\}\nsetup_network\(\)/)[0] ?? "";
  const publicIp = serviceSetup.indexOf('public_ip="$(public_ipv4)"');
  const firstVolume = serviceSetup.indexOf('docker volume create stargram-mongodb-data');
  assert.ok(publicIp >= 0 && firstVolume > publicIp, "public IP must be validated before creating volumes");
});

test("network updates snapshot config before mutation and roll back on failure", () => {
  assert.match(runner, /begin_network_transaction\(\)/);
  assert.match(runner, /trap 'runner_exit_handler "\$\?"' EXIT/);
  assert.match(runner, /restore_path env "\$ENV_FILE"/);
  assert.match(runner, /restore_path nginx-available \/etc\/nginx\/sites-available\/stargram/);
  assert.match(runner, /restore_path nginx-default \/etc\/nginx\/sites-enabled\/default/);
  const optionThree = runner.split(/\n\s*3\) /)[1]?.split(/\n\s*4\) /)[0] ?? "";
  assert.ok(optionThree.indexOf('cp -a "$ENV_FILE"') < optionThree.indexOf("begin_network_transaction"));
  assert.match(optionThree, /NETWORK_TXN_ACTIVE=0/);
});


test("TURN external address includes the local interface address when behind NAT", () => {
  const start = runner.indexOf("turn_external_ip(){");
  const end = runner.indexOf("\n}", start) + 2;
  assert.ok(start >= 0 && end > start, "turn_external_ip helper must exist");
  const helper = runner.slice(start, end);
  const invoke = `
ip(){ printf '%s\\n' "$IP_ROUTE"; }
${helper}
turn_external_ip "$1"
`;
  const run = (publicIp, route) => spawnSync("bash", ["-c", invoke, "test", publicIp], {
    encoding: "utf8",
    env: { ...process.env, IP_ROUTE: route },
  });
  const nat = run("203.0.113.10", "1.1.1.1 via 10.0.0.1 dev eth0 src 10.0.0.5 uid 0");
  assert.equal(nat.status, 0, nat.stderr);
  assert.equal(nat.stdout, "203.0.113.10/10.0.0.5");
  const direct = run("8.8.8.8", "1.1.1.1 via 8.8.8.1 dev eth0 src 8.8.8.8 uid 0");
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(direct.stdout, "8.8.8.8");
});

test("domain HTTPS setup does not require an external IPv4 lookup", () => {
  const network = runner.split(/setup_network\(\)\{/)[1]?.split(/\nwrite_manual_env\(\)\{/)[0] ?? "";
  const domainBranch = network.split(/if \[\[ -n "\$domain" \]\]; then/)[1]?.split(/\n  else/)[0] ?? "";
  assert.ok(domainBranch.includes('url="https://$domain"'));
  assert.doesNotMatch(domainBranch, /public_ipv4/);
  assert.match(network, /else\s+ip="\$\(public_ipv4\)"/);
});

test("runner fails if the Certbot renewal timer cannot be enabled", () => {
  assert.match(runner, /systemctl enable --now certbot\.timer \|\| die "Certbot renewal timer could not be enabled/);
  assert.doesNotMatch(runner, /systemctl enable --now certbot\.timer \|\| true/);
});

test("runner refuses to downgrade failed domain HTTPS provisioning to public HTTP", () => {
  const certbotFailure = runner.indexOf('if ! certbot --nginx -d "$domain" --email "$email" --agree-tos --non-interactive --redirect; then');
  const refusal = runner.indexOf("HTTPS certificate issuance failed. Previous Nginx configuration was restored", certbotFailure);
  assert.ok(certbotFailure >= 0, "domain HTTPS must use Certbot with redirect");
  assert.ok(refusal > certbotFailure, "failed HTTPS issuance must stop instead of silently leaving public HTTP");
  assert.doesNotMatch(runner, /certificate issuance failed[^\n]*Keeping HTTP test mode/);
});

test("public IPv4 helper accepts public addresses, falls back, and rejects private addresses", () => {
  const start = runner.indexOf("public_ipv4(){");
  const end = runner.indexOf("\n}", start) + 2;
  assert.ok(start >= 0 && end > start, "public_ipv4 helper must exist");
  const helper = runner.slice(start, end);
  const invoke = `
die(){ printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
curl(){
  case "$*" in
    *api.ipify.org*) printf '%s' "\${IPIFY:-}";;
    *checkip.amazonaws.com*) printf '%s\\n' "\${FALLBACK:-}";;
    *) return 22;;
  esac
}
${helper}
public_ipv4
`;
  const run = (env) => spawnSync("bash", ["-c", invoke], { encoding: "utf8", env: { ...process.env, ...env } });
  const direct = run({ IPIFY: "8.8.8.8", FALLBACK: "" });
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(direct.stdout, "8.8.8.8");
  const fallback = run({ IPIFY: "not-an-ip", FALLBACK: "1.1.1.1\n" });
  assert.equal(fallback.status, 0, fallback.stderr);
  assert.equal(fallback.stdout, "1.1.1.1");
  const privateAddress = run({ IPIFY: "192.168.1.4", FALLBACK: "" });
  assert.notEqual(privateAddress.status, 0, "private IPv4 must be rejected");
  assert.match(privateAddress.stderr, /private address/);
  const invalidOctet = run({ IPIFY: "999.1.1.1", FALLBACK: "" });
  assert.notEqual(invalidOctet.status, 0, "out-of-range octets must be rejected");
  for (const address of [
    "0.1.2.3", "100.64.1.2", "169.254.1.2", "192.0.0.8",
    "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.51.100.7",
    "203.0.113.4", "192.52.193.1", "192.175.48.1", "224.0.0.1", "240.0.0.1",
  ]) {
    const rejected = run({ IPIFY: address, FALLBACK: "" });
    assert.notEqual(rejected.status, 0, `special-use IPv4 ${address} must be rejected`);
  }
});

test("runner refuses private or invalid IP fallback for public URLs and TURN relay", () => {
  assert.match(runner, /public_ipv4\(\)\{/);
  assert.match(runner, /https:\/\/api\.ipify\.org/);
  assert.match(runner, /https:\/\/checkip\.amazonaws\.com/);
  assert.match(runner, /Could not determine the public IPv4 address/);
  assert.match(runner, /carrier-grade NAT address/);
  assert.match(runner, /public_ip="\$\(public_ipv4\)"/);
  assert.match(runner, /ip="\$\(public_ipv4\)"/);
  assert.doesNotMatch(runner, /hostname -I \| awk/);
});

test("runner initializes strict-mode secret variables before loading and validating env", () => {
  const secretKeyInit = runner.indexOf('secretKey=""');
  const turnSecretInit = runner.indexOf('TURN_SECRET=""');
  assert.ok(secretKeyInit >= 0, "secretKey must be initialized");
  assert.ok(turnSecretInit > secretKeyInit, "TURN_SECRET must be initialized after secretKey");
});

test("runner correctly skips ordinary comment lines in env files", () => {
  const loader = runner.split(/load_env_file\(\)\{/)[1]?.split(/\nbuild_env_args\(\)\{/)[0] ?? "";
  const builder = runner.split(/build_env_args\(\)\{/)[1]?.split(/\nverify_s3_storage\(\)\{/)[0] ?? "";
  assert.ok(loader.includes(String.raw`line" == \#*`), "secret loader must recognize lines beginning with #");
  assert.ok(builder.includes(String.raw`line" == \#*`), "environment builder must recognize lines beginning with #");
  assert.ok(!loader.includes(String.raw`line" == \\#*`), "secret loader must not require a literal backslash before comments");
  assert.ok(!builder.includes(String.raw`line" == \\#*`), "environment builder must not require a literal backslash before comments");
});

test("runner does not source arbitrary env keys and rejects duplicate keys", () => {
  const loader = runner.split(/load_env_file\(\)\{/)[1]?.split(/\nbuild_env_args\(\)\{/)[0] ?? "";
  assert.match(loader, /case "\$key" in[\s\S]*secretKey\)[\s\S]*TURN_SECRET\)/);
  assert.doesNotMatch(loader, /export "\$key"/);
  assert.match(loader, /Duplicate environment key: \$key/);
  const builder = runner.split(/build_env_args\(\)\{/)[1]?.split(/\nverify_s3_storage\(\)\{/)[0] ?? "";
  assert.match(builder, /Duplicate environment key: \$key/);
});

test("legacy VPS setup keeps the environment file root-owned and non-writable by the app", () => {
  assert.match(setup, /install -m 0640 -o root -g "\$APP_GROUP" "\$APP_DIR\/\.env\.example" "\$ENV_FILE"/);
  assert.match(setup, /chown "root:\$APP_GROUP" "\$ENV_FILE"\s*chmod 0640 "\$ENV_FILE"/);
});

test("runner refuses existing containers and persistent volumes before creating resources", () => {
  const serviceSetup = runner.split(/setup_auto_services\(\)\{/)[1]?.split(/\n\}\nsetup_network\(\)/)[0] ?? "";
  const containerGuard = serviceSetup.indexOf('docker container inspect stargram-mongodb');
  const volumeGuard = serviceSetup.indexOf('docker volume inspect stargram-mongodb-data');
  const volumeCreate = serviceSetup.indexOf('docker volume create stargram-mongodb-data');
  assert.ok(containerGuard >= 0 && volumeGuard >= 0 && volumeCreate >= 0, "service setup must validate existing resources");
  assert.ok(containerGuard < volumeCreate, "existing containers must be checked before resource creation");
  assert.ok(volumeGuard < volumeCreate, "existing volumes must be checked before resource creation");
});



test("manual credentials setup does not write duplicate TRUSTED_PROXY_COUNT", () => {
  const manual = runner.split(/write_manual_env\(\)\{/)[1]?.split(/\nconfigure_clamav\(\)\{/)[0] ?? "";
  assert.ok(manual.includes('$(cat /run/stargram-network.env)'), "manual env must include network settings");
  assert.doesNotMatch(manual, /^TRUSTED_PROXY_COUNT=/m, "network.env already defines TRUSTED_PROXY_COUNT");
});

test("automatic install keeps rollback active through network and app configuration", () => {
  const optionOne = runner.split(/\n\s*1\) /)[1]?.split(/\n\s*2\) /)[0] ?? "";
  assert.ok(optionOne.includes("begin_network_transaction; setup_auto_services; setup_network"));
  assert.ok(optionOne.indexOf("apply_config") < optionOne.indexOf("AUTO_SETUP_ACTIVE=0"));
  assert.match(runner, /snapshot_path coturn-default \/etc\/default\/coturn/);
  assert.match(runner, /restore_path coturn-default \/etc\/default\/coturn/);
  assert.match(runner, /rm -f \/run\/stargram-network\.env \/run\/stargram-generated\.env/);
});

test("runner performs authenticated S3 round-trip verification before building", () => {
  assert.match(runner, /verify_s3_storage\(\)\{/);
  assert.match(runner, /PutObjectCommand/);
  assert.match(runner, /GetObjectCommand/);
  assert.match(runner, /DeleteObjectCommand/);
  assert.match(runner, /npm ci --include=dev\n\s+verify_s3_storage\n\s+sudo -u "\$APP_USER" env "\$\{ENV_ARGS\[@\]\}" NODE_ENV=production npm run build/);
  assert.match(runner, /S3 storage failed authenticated upload\/download verification/);
});
test("runner configures ClamAV TCP and fails closed when scanner or signatures are unavailable", () => {
  assert.match(runner, /configure_clamav\(\)\{/);
  assert.match(runner, /TCPSocket 3310/);
  assert.match(runner, /TCPAddr 127\.0\.0\.1/);
  assert.match(runner, /ClamAV signature database is missing or unusable/);
  assert.match(runner, /ClamAV clamd did not answer PING on 127\.0\.0\.1:3310/);
  assert.match(runner, /systemctl enable --now clamav-freshclam/);
  assert.match(runner, /FreshClam updater could not be enabled/);
  assert.match(runner, /configure_clamav\n\s+cd "\$APP_DIR"; sudo -u "\$APP_USER" npm ci/);
});

test("runner MongoDB readiness check uses a valid mongosh ping command", () => {
  const serviceSetup = runner.split(/setup_auto_services\(\)\{/)[1]?.split(/\n\}\nsetup_network\(\)/)[0] ?? "";
  assert.equal((serviceSetup.match(/db\.adminCommand\(\{ping: 1\}\)\.ok/g) ?? []).length, 2);
  assert.doesNotMatch(serviceSetup, /db\.adminCommand\(\{ping\}\)\.ok/);
});

test("VPS setup installs dev dependencies only for building, then prunes them before starting services", () => {
  assert.match(setup, /npm ci --include=dev/);
  assert.match(setup, /npm run build[\s\S]*?npm prune --omit=dev[\s\S]*?systemctl restart my-telegram-web my-telegram-socket/);
});

test("VPS deploy prunes development dependencies after building and before service restart", () => {
  assert.match(deploy, /npm ci --include=dev/);
  assert.match(deploy, /npm run build[\s\S]*?npm prune --omit=dev[\s\S]*?systemctl restart my-telegram-web my-telegram-socket/);
});


test("setup runner installs dev tools for the build and prunes them before starting production services", () => {
  const applyConfig = runner.split(/apply_config\(\)\{/)[1]?.split(/\necho "Stargram Setup Runner"/)[0] ?? "";
  assert.match(applyConfig, /npm ci --include=dev[\s\S]*?npm run build[\s\S]*?npm prune --omit=dev[\s\S]*?systemctl enable --now my-telegram-web my-telegram-socket/);
});

test("configuration editor backs up the original environment before opening the editor", () => {
  const optionFour = runner.split(/\n\s*4\) /)[1]?.split(/\n\s*5\) /)[0] ?? "";
  assert.ok(optionFour.indexOf('cp -a "$ENV_FILE"') >= 0);
  assert.ok(optionFour.indexOf('cp -a "$ENV_FILE"') < optionFour.indexOf('"${EDITOR:-nano}" "$ENV_FILE"'));
  const applyConfig = runner.split(/apply_config\(\)\{/)[1]?.split(/\necho "Stargram Setup Runner"/)[0] ?? "";
  assert.doesNotMatch(applyConfig, /cp -a "\$ENV_FILE" "\$BACKUP_DIR\/my-telegram\.env/);
});

test("runner sends a newline-terminated ClamAV PING and uses loopback for S3 health checks", () => {
  assert.match(runner, /printf 'PING\\n' >&3/);
  assert.match(runner, /S3_HEALTH_ENDPOINT="\$\{S3_ENDPOINT_VALUE:-\}"/);
  assert.match(runner, /docker container inspect stargram-seaweedfs[\s\S]*?S3_HEALTH_ENDPOINT=http:\/\/127\.0\.0\.1:8333/);
  assert.match(runner, /env "\$\{ENV_ARGS\[@\]\}" S3_ENDPOINT="\$S3_HEALTH_ENDPOINT" node --input-type=module/);
});


test("manual first-install path rolls back network configuration until app setup succeeds", () => {
  const optionTwoStart = runner.indexOf("  2) ");
  const optionTwoEnd = runner.indexOf("  3) ", optionTwoStart);
  const optionTwo = runner.slice(optionTwoStart, optionTwoEnd);
  assert.ok(optionTwo.indexOf("begin_network_transaction") >= 0, "manual setup must snapshot config before network changes");
  assert.ok(optionTwo.indexOf("begin_network_transaction") < optionTwo.indexOf("setup_network"));
  assert.ok(optionTwo.indexOf("setup_network") < optionTwo.indexOf("apply_config"));
  assert.ok(optionTwo.indexOf("apply_config") < optionTwo.indexOf("NETWORK_TXN_ACTIVE=0"), "transaction commits only after app config succeeds");
  assert.match(runner, /restore_path coturn-default \/etc\/default\/coturn/);
});


// Behavioral regression tests: execute the actual environment parsing helpers in an
// isolated Bash process instead of only asserting that their source text exists.
function extractFunction(source, name, nextName) {
  const start = source.indexOf(`${name}(){`);
  const end = source.indexOf(`\n${nextName}(){`, start);
  assert.ok(start >= 0 && end > start, `could not extract ${name} helper`);
  return source.slice(start, end);
}

test("environment parser preserves shell metacharacters as literal values without executing them", () => {
  const loader = extractFunction(runner, "load_env_file", "build_env_args");
  const builder = extractFunction(runner, "build_env_args", "verify_s3_storage");
  const script = `
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
secretKey=""
TURN_SECRET=""
S3_ENDPOINT_VALUE=""
ENV_FILE="$1"
${loader}
${builder}
load_env_file
build_env_args
printf 'SECRET=%s\nTURN=%s\nS3=%s\n' "$secretKey" "$TURN_SECRET" "$S3_ENDPOINT_VALUE"
printf 'ARGS=%s\n' "\${ENV_ARGS[*]}"
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stargram-env-parser-"));
  const envFile = path.join(dir, "test.env");
  const marker = path.join(dir, "should-not-exist");
  fs.writeFileSync(envFile, [
    "# ordinary comment",
    "secretKey=abcdefghijklmnopqrstuvwxyz123456",
    "TURN_SECRET=turn-secret-abcdefghijklmnopqrstuvwxyz",
    "S3_ENDPOINT=http://127.0.0.1:8333",
    `UNTRUSTED=$(touch ${marker})`,
    "QUOTED=hello; printf hacked",
    ""
  ].join("\n"));
  try {
    const result = spawnSync("bash", ["-c", script, "test", envFile], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(marker), false, "env-file command substitution must never execute");
    assert.match(result.stdout, /SECRET=abcdefghijklmnopqrstuvwxyz123456/);
    assert.match(result.stdout, /TURN=turn-secret-abcdefghijklmnopqrstuvwxyz/);
    assert.match(result.stdout, /S3=http:\/\/127\.0\.0\.1:8333/);
    assert.match(result.stdout, /UNTRUSTED=\$\(touch/);
    assert.match(result.stdout, /QUOTED=hello;/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("environment parser rejects duplicate keys before producing runtime arguments", () => {
  const loader = extractFunction(runner, "load_env_file", "build_env_args");
  const builder = extractFunction(runner, "build_env_args", "verify_s3_storage");
  const script = `
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
secretKey=""
TURN_SECRET=""
S3_ENDPOINT_VALUE=""
ENV_FILE="$1"
${loader}
${builder}
load_env_file
build_env_args
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stargram-env-duplicate-"));
  const envFile = path.join(dir, "duplicate.env");
  fs.writeFileSync(envFile, "NODE_ENV=production\nNODE_ENV=development\n");
  try {
    const result = spawnSync("bash", ["-c", script, "test", envFile], { encoding: "utf8" });
    assert.notEqual(result.status, 0, "duplicate environment keys must fail");
    assert.match(result.stderr, /Duplicate environment key: NODE_ENV/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("environment parser rejects malformed lines and invalid key names", () => {
  const loader = extractFunction(runner, "load_env_file", "build_env_args");
  const cases = [
    { text: "NOT_AN_ASSIGNMENT\n", error: /expected KEY=VALUE/ },
    { text: "BAD-KEY=value\n", error: /Invalid environment key: BAD-KEY/ }
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stargram-env-invalid-"));
  const envFile = path.join(dir, "invalid.env");
  try {
    for (const item of cases) {
      fs.writeFileSync(envFile, item.text);
      const script = `
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
secretKey=""
TURN_SECRET=""
ENV_FILE="$1"
${loader}
load_env_file
`;
      const result = spawnSync("bash", ["-c", script, "test", envFile], { encoding: "utf8" });
      assert.notEqual(result.status, 0, `invalid env line accepted: ${item.text}`);
      assert.match(result.stderr, item.error);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("Runner snapshot helpers restore previous files and remove paths that did not exist", () => {
  const snapshot = runner.split(/\nsnapshot_path\(\)\{/)[1]?.split(/\nbegin_network_transaction\(\)\{/)[0] ?? "";
  const restore = runner.split(/\nrestore_path\(\)\{/)[1]?.split(/\nbegin_network_transaction\(\)\{/)[0] ?? "";
  assert.ok(snapshot.includes("cp -a"));
  assert.ok(restore.includes("rm -f") && restore.includes(".present"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stargram-rollback-"));
  const source = path.join(dir, "config");
  const restored = path.join(dir, "restored");
  const absent = path.join(dir, "new-config");
  const backup = path.join(dir, "backup");
  fs.mkdirSync(backup, { mode: 0o700 });
  fs.writeFileSync(source, "before=original\n");
  const script = `
NETWORK_TXN_DIR="$1"
snapshot_path(){ local name="$1" path="$2"; if [[ -e "$path" || -L "$path" ]]; then cp -a "$path" "$NETWORK_TXN_DIR/$name"; : > "$NETWORK_TXN_DIR/$name.present"; fi; }
restore_path(){ local name="$1" path="$2"; rm -f "$path"; if [[ -f "$NETWORK_TXN_DIR/$name.present" ]]; then cp -a "$NETWORK_TXN_DIR/$name" "$path"; fi; }
snapshot_path config "$2"
snapshot_path absent "$3"
printf 'before=mutated\\n' > "$2"
printf 'created=true\\n' > "$3"
restore_path config "$4"
restore_path absent "$3"
`;
  try {
    const result = spawnSync("bash", ["-c", script, "test", backup, source, absent, restored], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(source, "utf8"), "before=mutated\n");
    assert.equal(fs.readFileSync(restored, "utf8"), "before=original\n");
    assert.equal(fs.existsSync(absent), false, "rollback should remove a path that was absent before the transaction");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
