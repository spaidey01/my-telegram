import test from "node:test";
import assert from "node:assert/strict";
import { isSafeBrowserRequest } from "../src/utils/csrf.js";

process.env.CLIENT_ORIGIN = "http://localhost:3000";

const request = (headers = {}) => new Request("http://localhost:3000/api/auth/2fa", {
  method: "POST",
  headers,
});

test("CSRF guard accepts same-origin browser requests", () => {
  assert.equal(isSafeBrowserRequest(request({
    origin: "http://localhost:3000",
    "sec-fetch-site": "same-origin",
  })), true);
});

test("CSRF guard rejects cross-site Fetch Metadata", () => {
  assert.equal(isSafeBrowserRequest(request({
    origin: "http://localhost:3000",
    "sec-fetch-site": "cross-site",
  })), false);
});

test("CSRF guard rejects an untrusted Origin", () => {
  assert.equal(isSafeBrowserRequest(request({
    origin: "https://evil.example",
    "sec-fetch-site": "cross-site",
  })), false);
});

test("CSRF guard validates Referer when Origin is absent", () => {
  assert.equal(isSafeBrowserRequest(request({
    referer: "http://localhost:3000/settings/security",
  })), true);
  assert.equal(isSafeBrowserRequest(request({
    referer: "https://evil.example/form",
  })), false);
});

test("CSRF guard keeps non-browser clients compatible when no browser metadata exists", () => {
  assert.equal(isSafeBrowserRequest(request()), true);
});

test("CSRF guard rejects same-site requests when Origin and Referer are absent", () => {
  assert.equal(isSafeBrowserRequest(request({
    "sec-fetch-site": "same-site",
  })), false);
});

test("CSRF guard rejects unknown Fetch Metadata values without Origin or Referer", () => {
  assert.equal(isSafeBrowserRequest(request({
    "sec-fetch-site": "unexpected-value",
  })), false);
});

test("CSRF guard permits user-initiated navigation metadata without Origin or Referer", () => {
  assert.equal(isSafeBrowserRequest(request({
    "sec-fetch-site": "none",
  })), true);
});
