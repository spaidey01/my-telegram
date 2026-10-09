const required = [
  "PRODUCTION_APP_URL",
  "PRODUCTION_SOCKET_URL",
  "PRODUCTION_TURN_URL",
  "PRODUCTION_TURN_SECRET",
  "PRODUCTION_TURN_REALM",
  "PRODUCTION_TURN_MIN_PORT",
  "PRODUCTION_TURN_MAX_PORT",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error("Production network validation is not configured. Missing: " + missing.join(", "));
  process.exit(2);
}

const appUrl = new URL(process.env.PRODUCTION_APP_URL);
const socketUrl = new URL(process.env.PRODUCTION_SOCKET_URL);
if (appUrl.protocol !== "https:" || socketUrl.protocol !== "https:") {
  console.error("Production app/socket URLs must use HTTPS.");
  process.exit(1);
}

const turnUrls = process.env.PRODUCTION_TURN_URL.split(",").map((value) => value.trim()).filter(Boolean);
if (!turnUrls.length || turnUrls.some((url) => !/^turns?:/i.test(url))) {
  console.error("PRODUCTION_TURN_URL must contain public turn:/turns: URLs.");
  process.exit(1);
}
if (!turnUrls.some((url) => /^turns:/i.test(url))) {
  console.warn("WARNING: no turns: TLS TURN endpoint configured; TCP fallback should be verified separately.");
}

const minPort = Number(process.env.PRODUCTION_TURN_MIN_PORT);
const maxPort = Number(process.env.PRODUCTION_TURN_MAX_PORT);
if (!Number.isInteger(minPort) || !Number.isInteger(maxPort) || minPort < 1 || maxPort < minPort) {
  console.error("Invalid production TURN relay port range.");
  process.exit(1);
}

console.log("Production network validation inputs are present.");
console.log("App:", appUrl.origin);
console.log("Socket:", socketUrl.origin);
console.log("TURN endpoints:", turnUrls.length);
console.log("TURN relay range:", minPort + "-" + maxPort);
console.log("Two independent networks are still required for the final E2E verdict.");
