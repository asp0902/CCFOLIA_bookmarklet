// 매크로만 있는 내 메시지에 수정(연필) 단추가 안 뜨는 원인 진단 — 코코포리아 룸 콘솔에 붙여 넣고 실행. 결과는 콘솔(경고)과 클립보드에 들어갑니다.
// 보는 것: 오리지널 채팅의 최근 줄마다 (1) 코코포리아가 수정 단추 묶음을 그렸는지(내 메시지인지), (2) 단추 위를 다른 요소가 덮는지, (3) 줄의 서식/매크로 표식.
(() => {
  const rows = [...document.querySelectorAll(".MuiListItem-root")].filter((li) => li.querySelector("h6.MuiListItemText-primary") && !li.closest(".ccf-scp-panel"));
  const invis = /[​-‍⁠-⁣]/g;
  const out = rows.slice(-12).map((li) => {
    const group = [...li.children].find((c) => c.querySelector(":scope > button"));
    const buttons = group ? [...group.children].filter((b) => b.tagName === "BUTTON").map((b) => {
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      const hit = r.width ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return { label: b.getAttribute("aria-label"), display: cs.display, visibility: cs.visibility, pointer: cs.pointerEvents, size: [Math.round(r.width), Math.round(r.height)], hit: !hit ? "화면 밖" : hit.closest("button") === b ? "단추 자신" : `${hit.tagName}.${String(hit.className).slice(0, 40)}` };
    }) : [];
    const p = li.querySelector("p.MuiListItemText-secondary");
    return {
      name: (li.querySelector("h6")?.firstChild?.textContent || "").slice(0, 12),
      visibleText: (p?.textContent || "").replace(invis, "").slice(0, 24),
      invisibleChars: ((p?.textContent || "").match(invis) || []).length,
      rowMarks: [...li.attributes].map((a) => a.name).filter((n) => n.startsWith("data-")).join(" "),
      macro: !!li.querySelector("[data-ccr20-rendered], .ccr20-line, [data-ccr20-raw]"),
      formatted: !!li.querySelector(".ccf-render-root"),
      groupOpacity: group ? getComputedStyle(group).opacity : null,
      groupZ: group ? getComputedStyle(group).zIndex : null,
      buttons
    };
  });
  const text = JSON.stringify(out, null, 1);
  console.warn(text);
  try { copy(text); console.warn("클립보드에 복사했습니다."); } catch (_) { /* copy 없음 */ }
})();
