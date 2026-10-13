import assert from "node:assert/strict";
import { cleanCharacterFields, cleanCharacterDoc } from "./character-fields.mjs";
// only the editor's fields pass, bounded
const f = cleanCharacterFields({ name: "a".repeat(80) + "\n", memo: "m".repeat(3000), commands: "c", initiative: 3.6, externalUrl: "javascript:alert(1)", x: 1e9, y: -5.4, size: 500, status: [{ label: "HP", value: "7", max: 10 }, ...Array.from({ length: 20 }, () => ({}))], params: [{ label: "STR", value: 60 }], owner: "someone", secret: true, color: "#fff", order: 9 });
assert.equal(f.name.length, 40); assert.equal(f.memo.length, 2000); assert.equal(f.initiative, 4); assert.equal(f.externalUrl, ""); assert.equal(f.x, 100000); assert.equal(f.y, -5);
assert.deepEqual([f.width, f.height], [100, 100]); assert.equal(f.status.length, 8); assert.deepEqual(f.status[0], { label: "HP", value: 7, max: 10 }); assert.deepEqual(f.params, [{ label: "STR", value: "60" }]);
for (const key of ["owner", "secret", "color", "order"]) assert(!(key in f), `${key} is not editable by a participant`);
assert.equal(cleanCharacterFields({ externalUrl: "https://example.com/sheet" }).externalUrl, "https://example.com/sheet");
assert.deepEqual(cleanCharacterFields(null), {}); assert.deepEqual(cleanCharacterFields({ foo: 1 }), {});
// only given keys are returned (an update changes only what was sent)
assert.deepEqual(Object.keys(cleanCharacterFields({ name: "x" })), ["name"]);
const d = cleanCharacterDoc({ id: "abc", name: "n", width: 4, active: true, owner: "gm", secret: true, iconUrl: "https://x/y.png" });
assert.equal(d.id, "abc"); assert.equal(d.width, 4); assert.equal(d.active, true); assert(!("owner" in d) && !("iconUrl" in d));
console.log("character fields PASS");
