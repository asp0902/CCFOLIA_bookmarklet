const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "legacy", "ccfolia-character-sheet.user.js"), "utf8");
const hook = {};
vm.runInNewContext(
  source,
  { window: { __CCF_CHARACTER_SHEET_TEST_HOOK__: hook }, TextEncoder, crypto: { randomUUID: () => "generated-id" } }
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
assert.deepEqual(
  JSON.parse(JSON.stringify(hook.nativeStatusPatch([
    { label: "생명력", value: 4, max: 6 },
    { label: "이성치", value: 3, max: 5 },
    { label: "광기", value: 2, max: 6 }
  ]))),
  { life: 4, lifeMax: 6, sanity: 3, sanityMax: 5 }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(hook.normalizeItems({ 진통제: 2, 무기: "0", 부적: "", 기타: null, 오류: "abc" }))),
  { 진통제: 2, 무기: 0 }
);
const migrated = hook.normalizeData({ selectedId: "sheet-a", sheets: [{ id: "sheet-a", name: "A", permissions: { "*": { view: true } } }] });
assert.equal(migrated.permissions["*"].view, true);
assert.equal("permissions" in migrated.sheets[0], false);
assert.match(source, /button\.innerHTML = diceIcon\(\)/);
assert.match(source, /button\.title = "사이코로픽션"/);
assert.match(source, /button\.addEventListener\("click", openPanel/);
assert.match(source, /M4 10 2 7l7-3 3 3M12 7l3-3 7 2-2 4/);
assert.doesNotMatch(source, /M10 3\.3v3M10 7\.9h\.01/);
assert.match(source, /ccf-cs-dialog>header \{ background:#212121!important;color:#fff \}/);
assert.match(source, /ccf-cs-section-head h3 \{[^}]*font-size:14px;font-weight:bold/);
assert.match(source, /#\$\{ROOT_ID\} label \{[^}]*font-size:13px/);
assert.match(source, /ccf-cs-skill input \{ appearance:none;width:13px/);
assert.match(source, /ccf-cs-skills \{[^}]*min-width:740px/);
assert.match(source, /ccf-cs-gap \{[^}]*width:6px/);
assert.match(source, /select option \{ color:#000 \}/);
assert.match(source, /main label:focus-within \{ color:#2196f3 \}/);
assert.match(source, /background-position:center bottom;background-size:0 2px/);
assert.match(source, /background-size:100% 2px/);
assert.match(source, /function updateSkillsView\(\)/);
assert.match(source, /const scrollTop = root\.querySelector\("\.ccf-cs-dialog>main"\)\?\.scrollTop \|\| 0/);
assert.match(source, /dialog\.querySelector\("main"\)\.scrollTop = scrollTop/);
assert.doesNotMatch(source, /data-action="save">저장/);
assert.match(source, /title\.insertAdjacentElement\("afterend", button\)/);
assert.doesNotMatch(source, /actions\.appendChild\(button\)/);
assert.match(source, /section\("", basic, "ccf-cs-basic-section"\)[\s\S]+section\("특기"[\s\S]+section\("어빌리티 리스트"[\s\S]+section\("인물"/);
assert.doesNotMatch(source, /section\("메모"/);
assert.match(source, /section\("어빌리티 리스트"[\s\S]+\[\["name", "어빌리티"\], \["type", "타입"\], \["target", "지정특기"\]\]/);
assert.match(source, /ccf-cs-gap\.is-active \{ background:#f50057 \}/);
assert.match(source, /ccf-cs-skill\.is-selected button \{ font-weight:bold \}/);
assert.match(source, /ccf-cs-skill\.is-selected \{ background:rgba\(255,255,255,\.14\) \}/);
assert.match(source, /ccf-cs-skill small \{ color:#fff \}/);
assert.match(source, /function renderPanelTabs\(\)/);
assert.match(source, /data-action="panel-list"/);
assert.match(source, /data-action="panel-settings"/);
assert.match(source, /data-action="open-sheet"/);
assert.match(source, /data-action="delete-sheet-list"/);
assert.match(source, /data-action="back-list" aria-label="캐릭터 시트 목록"/);
assert.match(source, /editor \? escapeHtml\(sheet\.name \|\| "이름 없음"\)/);
assert.doesNotMatch(source, /class="ccf-cs-sheetbar"/);
assert.match(source, /data-list="\$\{key\}" data-index="\$\{index\}" data-prop="\$\{fieldName\}"/);
assert.match(source, /item\[target\.dataset\.prop\] = target\.value/);
assert.match(source, /input\._valueTracker\?\.setValue\(previous\)/);
assert.match(source, /async function syncNativeItems\(sheet/);
assert.match(source, /button:has\(svg\[data-testid="AddIcon"\]\)/);
assert.match(source, /known = new Set\(labels\(\)\.map/);
assert.match(source, /syncNativeItems\(sheet\)/);
assert.match(source, /new InputEvent\("input", \{ bubbles: true, inputType: "insertText" \}\)/);
assert.match(source, /ccf-cs-profile-memo textarea \{ width:calc\(100% \+ 32px\)[^}]*resize:none/);
assert.match(source, /공개: 특기·어빌리티·인물 표시<br>비밀: 메모 표시<br>수정: 시트 열람 및 수정/);
assert.match(source, /모든 캐릭터 시트에 공통 적용됩니다/);
assert.doesNotMatch(source, /<h3>플레이어 목록<\/h3>/);
assert.doesNotMatch(source, /data-action="permissions"/);
assert.doesNotMatch(source, /ccf-cs-perm-dialog/);
assert.match(source, /ccf-cs-note-toggle\$\{noteOpen \|\| memo \? " is-active" : ""\}/);
assert.match(source, /ccf-cs-note-toggle \{[^}]*width:13px[^}]*height:13px[^}]*border-radius:0/);
assert.match(source, /ccf-cs-note-toggle\.is-active \{ background:#f50057 \}/);
assert.doesNotMatch(source, /noteOpen \|\| memo \? "◆" : "◇"/);
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
    rootLaw: true, abilities: [{ name: "기습", target: "사격", memo: "능력 메모" }],
    people: [{ name: "조력자", shelter: true, memo: "인물 메모" }], extensions: { future: { value: 1 } }, futureTop: { keep: true }
  }
}), () => "imported-id");
assert.equal(imported.id, "imported-id");
assert.deepEqual(Array.from(imported.skills), ["0:0"]);
assert.equal(imported.modifier, -2);
assert.equal(imported.rootLaw, true);
assert.equal(imported.abilities[0].memo, "능력 메모");
assert.equal(imported.people[0].shelter, true);
assert.equal(imported.people[0].memo, "인물 메모");
assert.equal(imported.permissions["*"].view, true);
assert.equal(imported.permissions.플레이어.secret, true);
assert.equal(imported.extensions.future.value, 1);
assert.equal(imported.futureTop.keep, true);
assert.throws(() => hook.parseTransferPayload('{"kind":"character"}', () => "x"), /형식/);

console.log("character-sheet checks passed");
