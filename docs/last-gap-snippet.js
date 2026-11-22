// 오리지널 채팅 마지막 메시지 아래 여백 비교(읽기만 함). 채팅을 맨 아래까지 내린 뒤 F12 → Console 에 붙여 넣고 Enter.
// 시크릿 창(확장 없음)과 확장 켠 창에서 각각 돌려 결과를 비교하세요. 결과는 클립보드에 복사됩니다(메시지 글은 담지 않음).
(() => {
  const items = [...document.querySelectorAll(".MuiListItem-root")].filter((li) => li.querySelector("h6.MuiListItemText-primary") && !li.closest(".MuiDialog-root, .MuiPopover-root, .ccf-scp-panel"));
  const last = items[items.length - 1];
  if (!last) { console.warn("[여백 진단] 채팅 줄을 찾지 못함"); return; }
  const ul = last.closest("ul");
  const wraps = [...(last.closest("[data-index]")?.parentElement?.children || [])];
  const hs = wraps.map((w) => w.getBoundingClientRect().height);
  const box = ul.getBoundingClientRect(), lr = last.getBoundingClientRect();
  const hr = last.nextElementSibling;
  const out = {
    lastToListBottom: +(box.top + ul.clientHeight - lr.bottom).toFixed(2), // 마지막 줄 아래 → 목록 바닥
    scrollLeft: +(ul.scrollHeight - ul.scrollTop - ul.clientHeight).toFixed(2), // 0 이면 바닥까지 내린 상태
    listHeight: ul.firstElementChild?.style.height || "", // 가상 목록이 잡은 총높이
    drawn: +hs.reduce((a, h) => a + h, 0).toFixed(2), // 실제 그려진 줄 높이 합
    roundingSum: +hs.reduce((a, h) => a + (Math.round(h) - h), 0).toFixed(2), // 줄 높이 반올림 차이 합(= 순정의 아래 여백 원인)
    rows: hs.length,
    dividerAfterLast: hr ? `${getComputedStyle(hr).display} ${hr.getBoundingClientRect().height.toFixed(2)}px` : "없음",
    hiddenDividers: wraps.filter((w) => { const d = w.querySelector(".MuiDivider-root"); return d && getComputedStyle(d).display === "none"; }).length,
    extension: !!window.__CAPYBARA_TOOLKIT__, dpr: devicePixelRatio
  };
  console.warn("[여백 진단]", out);
  copy(JSON.stringify(out, null, 1));
})();
