const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

for (const file of [
  "ccfolia-format-sync.user.js",
  "ccfolia-roll20-css-bridge.user.js",
  "ccfolia-toolkit-presence.user.js"
]) {
  const source = fs.readFileSync(path.join(__dirname, "..", "legacy", file), "utf8");
  const start = source.indexOf("  function looksLikeCcfDiceCommand(");
  const end = source.indexOf("\n  }", start) + 4;
  assert.ok(start >= 0 && end > start, `${file}: command guard not found`);
  const sandbox = {};
  vm.runInNewContext(source.slice(start, end), sandbox);
  for (const command of ["FT", "ST", "BET", "RTT", "RTT6", "TVT", "TET", "TPT", "TST", "TKT", "TMT", "sc(1)", "2D6>=5"]) {
    assert.equal(sandbox.looksLikeCcfDiceCommand(command), true, `${file}: ${command}`);
  }
  assert.equal(sandbox.looksLikeCcfDiceCommand("감정표 FT"), false, `${file}: prose`);
  assert.equal(sandbox.looksLikeCcfDiceCommand("오늘 1D6 정도"), false, `${file}: inline dice prose`);
}

console.log("dice-command guard checks passed");
