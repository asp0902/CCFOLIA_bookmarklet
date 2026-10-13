// What a participant may set on a character they made (the fields of CCFOLIA's "캐릭터 편집" dialog). Everything else (owner, secret, invisible, hideStatus, color, order, ...) stays the GM's.
// Used for the request the participant sends, and again for the character documents the GM's page reports back.
const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const num = (value, min, max, fallback = 0) => { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };

export function cleanCharacterFields(input) {
  const f = input && typeof input === "object" ? input : {};
  const out = {};
  if ("name" in f) out.name = text(f.name, 40).replace(/[\r\n]/g, " ");
  if ("memo" in f) out.memo = text(f.memo, 2000);
  if ("commands" in f) out.commands = text(f.commands, 4000);
  if ("initiative" in f) out.initiative = Math.round(num(f.initiative, -100000, 100000));
  if ("externalUrl" in f) out.externalUrl = /^https:\/\/[^\s<>"]{1,490}$/.test(String(f.externalUrl || "")) ? String(f.externalUrl) : "";
  if ("x" in f) out.x = Math.round(num(f.x, -100000, 100000));
  if ("y" in f) out.y = Math.round(num(f.y, -100000, 100000));
  if ("angle" in f) out.angle = Math.round(num(f.angle, -360, 360)); // R / Shift+R of the menu: +-45 degrees (measured)
  if ("size" in f) { const size = num(f.size, 1, 100, 4); out.width = size; out.height = size; } // "토큰 사이즈": cells, width and height together
  if (Array.isArray(f.status)) out.status = f.status.slice(0, 8).map(s => ({ label: text(s?.label, 20), value: num(s?.value, -1_000_000, 1_000_000), max: num(s?.max, -1_000_000, 1_000_000) }));
  if (Array.isArray(f.params)) out.params = f.params.slice(0, 30).map(p => ({ label: text(p?.label, 20), value: text(String(p?.value ?? ""), 60) }));
  return out;
}

// A character document as the GM's page reports it (only what the editor shows, plus placement).
export function cleanCharacterDoc(doc) {
  const fields = cleanCharacterFields({ name: doc?.name, memo: doc?.memo, commands: doc?.commands, initiative: doc?.initiative, externalUrl: doc?.externalUrl, x: doc?.x, y: doc?.y, size: doc?.width, status: doc?.status, params: doc?.params });
  return { id: text(doc?.id, 100), ...fields, active: doc?.active === true };
}
