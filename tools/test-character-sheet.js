const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const hook = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "legacy", "ccfolia-character-sheet.user.js"), "utf8"),
  { window: { __CCF_CHARACTER_SHEET_TEST_HOOK__: hook } }
);

assert.equal(hook.isInsaneDicebot(["인세인"], []), true);
assert.equal(hook.isInsaneDicebot(["inSANe"], []), true);
assert.equal(hook.isInsaneDicebot(["크툴루의 부름"], []), false);
assert.equal(hook.isInsaneDicebot([], ["https://docs.bcdice.org/systems/Insane"]), true);
assert.equal(hook.getSkillTarget(["0:0"], "0:0", []), 5);
assert.equal(hook.getSkillTarget(["0:0"], "0:1", []), 6);
assert.equal(hook.getSkillTarget(["0:0"], "1:0", [false]), 7);
assert.equal(hook.getSkillTarget(["0:0"], "1:0", [true]), 6);
assert.equal(hook.getSkillTarget([], "1:0", []), null);

console.log("character-sheet checks passed");
