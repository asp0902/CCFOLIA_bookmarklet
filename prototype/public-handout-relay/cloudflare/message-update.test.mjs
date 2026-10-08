import assert from "node:assert/strict";
import { RoomRelay } from "./worker.mjs";

const append = (room, message) => RoomRelay.prototype.appendMessage.call({}, room, message);
const room = () => ({ messages: [], seenMessageIds: {} });
const msg = (extra = {}) => ({ id: "m1", author: "A", text: "처음", origin: "ccfolia", channel: "main", color: "#fff", icon: "", createdAt: "2026-01-01T00:00:00Z", ...extra });

const r = room();
assert.equal(append(r, msg()), "added");
assert.equal(append(r, msg()), "", "same content is ignored");
assert.equal(append(r, msg({ text: "수정됨", edited: true })), "updated", "same id, different body: replaced in place");
assert.equal(r.messages.length, 1);
assert.deepEqual([r.messages[0].text, r.messages[0].edited], ["수정됨", true]);
assert.equal(append(r, msg({ text: "수정됨", edited: true })), "", "the edit sent again is ignored");
assert.equal(append(r, msg({ text: "수정됨", edited: true, color: "#000" })), "updated", "colour change counts");
// a roll result change counts too, and a stored message without the edited flag is not "changed" by edited:false
const old = room(); old.messages.push({ id: "o", origin: "ccfolia", text: "x", color: "", icon: "" }); old.seenMessageIds.o = 1;
assert.equal(append(old, { id: "o", origin: "ccfolia", text: "x", color: "", icon: "", edited: false }), "", "no spurious update for messages stored before the flag");
// a participant's own (external) message is never replaced by a GM snapshot with the same id
const ext = room(); ext.messages.push({ id: "e", origin: "external", text: "mine" }); ext.seenMessageIds.e = 1;
assert.equal(append(ext, { id: "e", origin: "ccfolia", text: "changed" }), "");
assert.equal(append(room(), { text: "no id" }), "");
console.log("message update: PASS");
