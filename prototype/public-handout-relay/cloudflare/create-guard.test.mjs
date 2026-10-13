import assert from "node:assert/strict";
import { checkCreate, logCreate, recordCreate, ownsObject, forgetObject, pruneCreated, CREATE_LIMITS } from "./create-guard.mjs";
const room = { capabilities: { participantCreate: true } }, a = { id: "a" }, b = { id: "b" };
assert.equal(checkCreate(room, a, 0).ok, true);
for (let i = 0; i < CREATE_LIMITS.perMinute; i += 1) { assert.equal(checkCreate(room, a, i).ok, true); logCreate(room, a, i); recordCreate(room, a, `o${i}`); }
assert.equal(checkCreate(room, a, 1000).status, 429, "per participant per minute");
assert.equal(checkCreate(room, b, 1000).ok, true, "another participant is not limited by a");
assert.equal(checkCreate(room, a, CREATE_LIMITS.windowMs + 100).ok, true, "the window moves on");
assert.equal(ownsObject(room, a, "o1"), true); assert.equal(ownsObject(room, b, "o1"), false, "only the creator owns it"); assert.equal(ownsObject(room, a, ""), false);
forgetObject(room, "o1"); assert.equal(ownsObject(room, a, "o1"), false);
pruneCreated(room, ["o2"]); assert.deepEqual(Object.keys(room.created), ["o2"], "objects gone from the room leave the ledger");
assert.equal(checkCreate({ capabilities: { participantCreate: false } }, a).status, 403, "GM switch off");
assert.equal(checkCreate({ capabilities: {} }, a).ok, true, "on by default");
const full = { created: Object.fromEntries(Array.from({ length: CREATE_LIMITS.perRoom }, (_, i) => [`x${i}`, "a"])) };
assert.equal(checkCreate(full, b).status, 429, "room total");
console.log("create guard PASS");
