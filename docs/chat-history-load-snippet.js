// 과거 메시지가 더 안 불러와질 때 — 플레이어 화면(북마클릿·확장)의 코코포리아 룸 콘솔에 붙여 넣고 실행. 결과는 콘솔(경고)과 클립보드에 들어갑니다.
// 코코포리아는 채팅 목록을 "위로" 스크롤해 맨 위 32px 안에 들어오면 이전 20개를 불러오고, 20개 미만이 오면 그 탭을 '끝'으로 표시합니다.
// 이 스니펫은 지금 탭에서 그 동작을 6번 흉내 내고, 매번 메시지 수·불러오는 중/끝 표시·스크롤 위치·누가 스크롤을 되돌렸는지를 기록합니다(읽기와 스크롤만 합니다).
(async () => {
  const root = document.getElementById("root");
  const key = root && Object.keys(root).find((k) => k.startsWith("__reactContainer"));
  let store = null; const seen = new WeakSet();
  const walk = (n, d = 0) => { if (store || !n || d > 60) return; for (const v of [n.memoizedProps, n.memoizedProps?.store, n.memoizedProps?.value]) if (v && typeof v === "object" && !seen.has(v)) { seen.add(v); if (typeof v.getState === "function" && typeof v.dispatch === "function") { store = v; return; } } walk(n.child, d + 1); walk(n.sibling, d + 1); };
  walk(key ? root[key]?.stateNode?.current : null);
  const log = [...document.querySelectorAll('[role="log"]')].find((el) => !el.closest(".ccf-scp-panel") && el.scrollHeight > el.clientHeight);
  const tabState = () => { const s = store?.getState(); const tab = s?.app?.state?.roomChatTab; return { tab, count: (s?.entities?.roomMessages?.idsGroupBy?.[tab] || []).length, loading: !!s?.app?.state?.roomChatChannelLoading?.[tab], loadedToEnd: !!s?.app?.state?.roomChatChannelLoaded?.[tab] }; };
  const out = { toolkit: { loader: window.__CAPYBARA_TOOLKIT__?.version || null, panel: window.__CCF_SECOND_CHAT_PANEL__?.version || null, gm: document.documentElement.getAttribute("data-ccf-gm") }, store: !!store, list: !!log, before: tabState(), steps: [], hiddenRows: document.querySelectorAll('[role="log"] [data-ccf-hidden-row="1"]').length };
  if (store && log) {
    // who writes scrollTop: wrap the setter on this element while the test runs
    const writes = [];
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    Object.defineProperty(log, "scrollTop", { configurable: true, get() { return desc.get.call(this); }, set(v) { const stack = (new Error().stack || "").split("\n").slice(2, 4).map((l) => l.trim().replace(/https?:\/\/[^\s)]*\//, "").slice(0, 80)).join(" < "); writes.push([Math.round(v), stack]); desc.set.call(this, v); } });
    for (let i = 0; i < 6; i += 1) {
      writes.length = 0;
      desc.set.call(log, 200); log.dispatchEvent(new Event("scroll"));
      await new Promise((r) => setTimeout(r, 120));
      desc.set.call(log, 0); log.dispatchEvent(new Event("scroll"));
      await new Promise((r) => setTimeout(r, 1800));
      out.steps.push({ ...tabState(), scrollTop: Math.round(log.scrollTop), scrollHeight: log.scrollHeight, othersWroteScroll: writes.slice(0, 4) });
    }
    delete log.scrollTop;
  }
  out.reason = !store ? "코코포리아 저장소를 못 찾음" : !log ? "채팅 목록을 못 찾음" : out.steps.some((s, i) => s.count > (i ? out.steps[i - 1].count : out.before.count)) ? "정상: 위로 스크롤하면 더 불러옴" : out.before.loadedToEnd ? "코코포리아가 이 탭을 이미 '끝'으로 표시함(그 아래로 더 없음)" : "위로 스크롤해도 더 안 불러옴 — othersWroteScroll 확인";
  const text = JSON.stringify(out, null, 1);
  console.warn(text);
  try { copy(text); console.warn("클립보드에 복사했습니다."); } catch (_) { /* copy 없음 */ }
})();
