const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "legacy", "ccfolia-character-sheet.user.js"), "utf8");
const hook = {};
vm.runInNewContext(
  source,
  { window: { __CCF_CHARACTER_SHEET_TEST_HOOK__: hook }, TextEncoder }
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
assert.deepEqual(Array.from(hook.getCuriosityGaps("")), [false, false, false, false, false]);
assert.deepEqual(Array.from(hook.getCuriosityGaps(0)), [true, false, false, false, false]);
assert.deepEqual(Array.from(hook.getCuriosityGaps(3)), [false, false, true, true, false]);
assert.deepEqual(Array.from(hook.getCuriosityGaps(5)), [false, false, false, false, true]);
assert.deepEqual(
  JSON.parse(JSON.stringify(hook.clampDialogDrag({ left: 100, right: 500, top: 50, bottom: 450 }, -200, 600, 800, 600))),
  { x: -92, y: 142 }
);
assert.equal(hook.isCharacterEditTitle("캐릭터 편집"), true);
assert.equal(hook.isCharacterEditTitle("BGM 편집"), false);
assert.match(source, /section\("기본"[\s\S]+section\("특기"[\s\S]+section\("어빌리티"[\s\S]+section\("인물"[\s\S]+section\("메모"/);
assert.doesNotMatch(source, /ccf-cs-tabs|state\.tab/);
assert.deepEqual(
  JSON.parse(JSON.stringify(hook.normalizePermissions({ "*": { view: 1 }, 빈값: {}, "": { edit: true } }))),
  { "*": { view: true, secret: false, edit: false } }
);

const imported = hook.parseTransferPayload(JSON.stringify({
  kind: "capybara.insane-sheet",
  version: 1,
  data: {
    name: "테스트", life: 4, lifeMax: 8, sanity: 3, sanityMax: 6,
    curiosity: 0, skills: ["0:0", "0:0:extra", "bad"], fear: "0:0", modifier: -2,
    permissions: { "*": { view: true }, 플레이어: { secret: true } },
    rootLaw: true, abilities: [{ name: "기습", target: "사격" }],
    people: [{ name: "조력자", shelter: true }], extensions: { future: { value: 1 } }, futureTop: { keep: true }
  }
}), () => "imported-id");
assert.equal(imported.id, "imported-id");
assert.deepEqual(Array.from(imported.skills), ["0:0"]);
assert.equal(imported.modifier, -2);
assert.equal(imported.rootLaw, true);
assert.equal(imported.people[0].shelter, true);
assert.equal(imported.permissions["*"].view, true);
assert.equal(imported.permissions.플레이어.secret, true);
assert.equal(imported.extensions.future.value, 1);
assert.equal(imported.futureTop.keep, true);
assert.throws(() => hook.parseTransferPayload('{"kind":"character"}', () => "x"), /형식/);

console.log("character-sheet checks passed");
