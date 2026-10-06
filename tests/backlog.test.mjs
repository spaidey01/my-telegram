import test from "node:test";
import assert from "node:assert/strict";
import { parseMentions, parseHashtags } from "../src/utils/messageParsing.js";

test("mentions parser extracts unique usernames",()=>assert.deepEqual(parseMentions("hi @Alice @alice @bob_1"),["alice","bob_1"]));
test("hashtags parser extracts unique tags",()=>assert.deepEqual(parseHashtags("hello #Stargram #stargram #گروه"),["stargram","گروه"]));
