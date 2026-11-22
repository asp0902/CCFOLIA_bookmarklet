// 나레이션 + 서식 프리셋 진단(읽기만 함). 나레이션을 켜고 프리셋을 적용해 보낸 직후, 그 룸에서 F12 → Console 에 붙여 넣고 Enter.
// 결과는 클립보드에 복사됩니다. 메시지 글은 담지 않습니다(길이·서식 종류만).
(() => {
  const room = (location.pathname.match(/^\/rooms\/([^/?#]+)/) || [])[1] || "";
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (_) { return null; } };
  const presets = [...(read("ccf-format-style-presets-v1") || []), ...(read(`ccf-format-style-presets-v1:${room}`) || [])];
  const narrators = read(`ccf-format-narrators-v1:${room}`) || [];
  const MAP = ["​", "‌", "‍", "⁠"];
  const decode = (text) => {
    const a = text.indexOf("⁣⁣⁣"), b = text.indexOf("⁢⁢⁢", a + 3);
    if (a < 0 || b < 0) return null;
    let bits = ""; for (const ch of text.slice(a + 3, b)) { const i = MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, "0"); }
    let b64 = ""; for (let i = 0; i + 8 <= bits.length; i += 8) b64 += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
    try { return JSON.parse(decodeURIComponent(escape(atob(b64)))); } catch (_) { return "decode-failed"; }
  };
  const root = document.getElementById("root");
  const key = root && Object.keys(root).find((k) => k.startsWith("__reactContainer"));
  let store = null; const seen = new WeakSet();
  const walk = (n, d = 0) => { if (store || !n || d > 60) return; for (const v of [n.memoizedProps?.store, n.memoizedProps?.value]) { if (!store && v && typeof v === "object" && !seen.has(v)) { seen.add(v); if (typeof v.getState === "function") store = v; } } walk(n.child, d + 1); walk(n.sibling, d + 1); };
  walk(key ? root[key]?.stateNode?.current : null);
  const msgs = Object.values(store?.getState()?.entities?.roomMessages?.entities || {}).filter((m) => m && !m.removed).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)).slice(-5);
  const out = {
    presets: presets.map((p) => ({ nameLen: String(p?.name || "").length, auto: p?.auto !== false, room: !!p?.room, styleKeys: Object.keys(p?.style || {}), align: p?.align || "" })),
    narrators: narrators.length,
    autoSwitch: localStorage.getItem(`ccf-format-style-presets-auto-v1:${room}`) ?? localStorage.getItem("ccf-format-style-presets-auto-v1"),
    lastMessages: msgs.map((m) => { const env = decode(String(m.text || "")); return { textLen: String(m.text || "").length, envelope: env && typeof env === "object" ? { blockStyle: env.blockStyle, runs: (env.formatRuns || []).map((r) => [r.start, r.end, Object.keys(r.style || {})]), align: env.alignRuns, source: env.source || "" } : env }; }),
    scripts: Object.keys(window).filter((k) => /^__CCF_|^__CAPYBARA/.test(k)).slice(0, 30)
  };
  console.warn("[나레이션+프리셋 진단]", out);
  copy(JSON.stringify(out, null, 1));
})();
