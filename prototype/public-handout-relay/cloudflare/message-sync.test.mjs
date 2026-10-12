import assert from "node:assert/strict";
import { applyMessageSync } from "./worker.mjs";

const make = () => ({
  messages: [
    { id: "a", origin: "ccfolia", channel: "main", createdAt: "2026-01-01T00:00:01Z" },
    { id: "b", origin: "ccfolia", channel: "main", createdAt: "2026-01-01T00:00:02Z" },
    { id: "c", origin: "ccfolia", channel: "main", createdAt: "2026-01-01T00:00:03Z" },
    { id: "o", origin: "ccfolia", channel: "other", createdAt: "2026-01-01T00:00:02Z" },
    { id: "x", origin: "external", channel: "main", createdAt: "2026-01-01T00:00:02Z" },
  ],
  seenMessageIds: { a: 1, b: 1, c: 1, o: 1, x: 1 },
});
const ids = room => room.messages.map(message => message.id);

// one message deleted in CCFOLIA: b is missing from the GM's list (since = oldest the GM has)
let room = make();
assert.deepEqual(applyMessageSync(room, { main: { ids: ["a", "c"], since: "2026-01-01T00:00:01Z" } }).sort(), ["b", "x"]);
assert.deepEqual(ids(room), ["a", "c", "o"], "other tab messages stay; an old echo copy (not from CCFOLIA) is dropped");
assert.equal("b" in room.seenMessageIds, false, "a removed id may be received again later");

// messages older than the oldest one the GM has are not touched
room = make();
assert.deepEqual(applyMessageSync(room, { main: { ids: ["c"], since: "2026-01-01T00:00:03Z" } }).sort(), ["x"]);
assert.deepEqual(ids(room), ["a", "b", "c", "o"]);

// the whole tab was cleared in CCFOLIA
room = make();
assert.deepEqual(applyMessageSync(room, { main: { ids: [], since: null } }).sort(), ["a", "b", "c", "x"]);
assert.deepEqual(ids(room), ["o"]);

// tabs the GM did not report are left alone
room = make();
assert.deepEqual(applyMessageSync(room, {}), ["x"]);
assert.equal(room.messages.length, 4);
console.log("message sync: PASS");
