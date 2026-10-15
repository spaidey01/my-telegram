import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("lazy authentication form is rendered inside a Suspense boundary", async () => {
  const source = await readFile(new URL("../src/components/auth/Authentication.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ ReactNode, Suspense, lazy, useEffect, useState \} from "react"/);
  assert.match(source, /<Suspense fallback=\{<LoadingApp \/>\}>\s*<AuthenticationForm \/>\s*<\/Suspense>/);
});

test("Iranian phone input accepts Persian digits without an extra leading zero", async () => {
  const signIn = await readFile(new URL("../src/components/auth/SignInForm.tsx", import.meta.url), "utf8");
  const signUp = await readFile(new URL("../src/components/auth/SignUpForm.tsx", import.meta.url), "utf8");
  const expected = '(^9[0-9]{9}$)|(^\\u06F9[\\u06F0-\\u06F9]{9})$';
  const incorrect = '(^\\u06F0\\u06F9';
  for (const source of [signIn, signUp]) {
    assert.ok(source.includes(expected), "both forms should accept a 10-digit Persian mobile number");
    assert.ok(!source.includes(incorrect), "the Persian-digit pattern must not require an extra leading zero");
  }
});
