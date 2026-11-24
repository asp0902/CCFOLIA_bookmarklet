// 입력 지연 진단 (읽기 전용 — 입력칸에 아무것도 쓰지 않음). 룸 화면 콘솔에 붙여 넣고 Enter → 10초 동안 평소처럼 입력칸에 글을 쳐 보세요(보내지 않아도 됨).
// 결과는 클립보드에 복사됨. 메시지 내용은 싣지 않는다.
(async () => {
  const out = { versions: { loader: window.__CAPYBARA_TOOLKIT__?.version || null, formatSync: window.__CCF_FORMAT_SYNC_RUNTIME__?.version || null }, dpr: devicePixelRatio };
  let longN = 0, longMs = 0, keys = 0, muts = 0;
  const tally = {};
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { longN += 1; longMs += e.duration; } });
  try { po.observe({ type: "longtask", buffered: false }); } catch (_) {}
  const evts = [];
  const eo = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (/key|input/.test(e.name)) evts.push(Math.round(e.duration)); });
  try { eo.observe({ type: "event", durationThreshold: 16, buffered: false }); } catch (_) {}
  const onKey = () => { keys += 1; };
  document.addEventListener("keydown", onKey, true);
  const mo = new MutationObserver((list) => { for (const m of list) { muts += 1; const t = m.target.nodeType === 1 ? m.target : m.target.parentElement; const k = `${m.type}:${m.attributeName || ""} ${t?.id || t?.tagName || ""}.${String(t?.className || "").split(" ").filter((c) => /ccf|ccr/.test(c)).slice(0, 1).join("")}`; tally[k] = (tally[k] || 0) + 1; } });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  console.warn("[입력 지연 진단] 10초 측정 중 — 입력칸에 평소처럼 글을 쳐 보세요");
  await new Promise((r) => setTimeout(r, 10000));
  po.disconnect(); eo.disconnect(); mo.disconnect(); document.removeEventListener("keydown", onKey, true);
  Object.assign(out, {
    keys, longTasks: longN, longTaskMs: Math.round(longMs),
    slowKeyEvents: { count: evts.length, maxMs: evts.length ? Math.max(...evts) : 0, avgMs: evts.length ? Math.round(evts.reduce((a, b) => a + b, 0) / evts.length) : 0 },
    domChanges: muts, topChanges: Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 12),
    rows: { original: document.querySelectorAll('[role="log"] .MuiListItem-root').length, panels: document.querySelectorAll(".ccf-scp-panel").length, panelRows: document.querySelectorAll(".ccf-scp-panel .MuiListItem-root, .ccf-scp-panel li").length },
    nodes: document.getElementsByTagName("*").length
  });
  console.warn("[입력 지연 진단]", out);
  try { copy(JSON.stringify(out, null, 1)); console.warn("결과가 클립보드에 복사되었습니다."); } catch (_) {}
})();
