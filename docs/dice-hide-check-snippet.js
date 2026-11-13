// 다이스 결과 줄의 눈(숨기기) 버튼 점검 — GM 계정으로 룸을 연 채 콘솔에 붙여 넣는다. 읽기만 한다(아무것도 쓰지 않음).
// 결과는 콘솔(warn)과 클립보드(copy)에 들어간다. 최근 다이스 줄 6개와 일반 줄 3개를 비교한다.
(() => {
  const root = document.getElementById("root");
  const ck = root && Object.keys(root).find((k) => k.startsWith("__reactContainer"));
  let st = null;
  try { const q = [root[ck].stateNode.current]; while (q.length) { const n = q.shift(); if (n?.memoizedProps?.store?.getState) { st = n.memoizedProps.store.getState(); break; } if (n?.child) q.push(n.child); if (n?.sibling) q.push(n.sibling); } } catch (_) {}
  const ents = st?.entities?.roomMessages?.entities || {};
  const idOf = (li) => { const key = Object.keys(li).find((x) => x.startsWith("__reactFiber$")); for (let f = li[key], d = 0; f && d < 8; f = f.return, d += 1) { const id = f.memoizedProps?.messageId; if (typeof id === "string" && id) return id; } return ""; };
  const rows = [...document.querySelectorAll(".MuiListItem-root")].filter((li) => li.querySelector("h6.MuiListItemText-primary") && !li.closest(".ccf-scp-panel, .MuiPopover-root, .MuiMenu-root, .MuiDialog-root"));
  const look = (li) => {
    const id = idOf(li), m = ents[id];
    const eye = li.querySelector(".ccf-hide-btn"), brk = li.querySelector(".ccf-break-btn");
    return { dice: !!m?.extend?.roll, secret: !!m?.extend?.roll?.secret, mine: m?.from === st?.app?.user?.uid, id: id.slice(0, 6), inStore: !!m, host: li.classList.contains("ccf-hide-host"), eye: !!eye, eyeInline: !!eye?.classList.contains("ccf-hide-inline"), eyeDisplay: eye ? getComputedStyle(eye).display : "", brk: !!brk, buttons: li.querySelectorAll("button").length, textLen: String(m?.text || "").length };
  };
  const all = rows.map(look);
  const out = { gmAttr: document.documentElement.getAttribute("data-ccf-gm"), chatPanel: !!window.__CCF_SECOND_CHAT_PANEL__, rows: rows.length, dice: all.filter((r) => r.dice).slice(-6), normal: all.filter((r) => !r.dice).slice(-3), hideDiag: (() => { try { return window.__CCF_SECOND_CHAT_PANEL__?.hideDiag?.(); } catch (e) { return String(e); } })() };
  const text = JSON.stringify(out, null, 1);
  try { copy(text); } catch (_) {}
  console.warn("[dice-hide-check] 클립보드에 복사했습니다", out);
  return out;
})();
