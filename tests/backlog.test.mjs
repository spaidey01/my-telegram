import test from "node:test";
import assert from "node:assert/strict";
import { parseMentions, parseHashtags } from "../src/utils/messageParsing.js";
import { generateTotpSecret, verifyTotp } from "../src/utils/totp.ts";

test("mentions parser extracts unique usernames",()=>assert.deepEqual(parseMentions("hi @Alice @alice @bob_1"),["alice","bob_1"]));
test("totp secret is valid base32 material",()=>{const secret=generateTotpSecret();assert.equal(secret.length,32);assert.equal(verifyTotp(secret,"000000"),false);});
test("hashtags parser extracts unique tags",()=>assert.deepEqual(parseHashtags("hello #Stargram #stargram #گروه"),["stargram","گروه"]));
