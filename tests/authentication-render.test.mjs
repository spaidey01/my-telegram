import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("lazy authentication form is rendered inside a Suspense boundary", async () => {
  const source = await readFile(new URL("../src/components/auth/Authentication.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ ReactNode, Suspense, lazy, useEffect, useState \} from "react"/);
  assert.match(source, /<Suspense fallback=\{<LoadingApp \/>\}>\s*<AuthenticationForm \/>\s*<\/Suspense>/);
});
