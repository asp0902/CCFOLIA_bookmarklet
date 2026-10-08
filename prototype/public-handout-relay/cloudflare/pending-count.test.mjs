import assert from "node:assert/strict";
import { RoomRelay, pendingCount } from "./worker.mjs";

const room = statuses => ({ participants: Object.fromEntries(statuses.map((status, i) => [`p${i}`, { id: `p${i}`, status }])) });
assert.equal(pendingCount(room([])), 0);
assert.equal(pendingCount(room(["pending", "approved", "pending", "rejected", "revoked"])), 2, "only waiting requests count");
assert.equal(pendingCount({}), 0);
// the GM sockets are told the current number
const pushes = [];
const relay = { push: (tag, payload) => pushes.push([tag, payload]) };
const r = room(["pending"]);
RoomRelay.prototype.notifyPending.call(relay, r); // after a join
r.participants.p0.status = "approved";
RoomRelay.prototype.notifyPending.call(relay, r); // after the decision
assert.deepEqual(pushes, [["gm", { type: "pending", count: 1 }], ["gm", { type: "pending", count: 0 }]]);
console.log("pending count: PASS");
