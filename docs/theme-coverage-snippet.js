// 테마 적용 범위 실측 — 커스텀 테마를 켠 상태에서, 확인하고 싶은 창(장면 카드·사운드 드로어·설정 화면·말풍선·자동완성·메뉴·스탯 바 등)을 연 채로 콘솔에 붙여넣기.
// 화면에 보이는 큰 바탕 요소 중 배경이 테마 색(패널·상하단 바·입력창·배경)과 다른 것을 골라 클립보드에 복사한다(글자·개인정보 없음: 태그·클래스·크기·색만).
(() => {
  const root = getComputedStyle(document.documentElement);
  const want = ["--ccf-theme-bg", "--ccf-theme-appbar", "--ccf-theme-paper", "--ccf-theme-input-bg"].map((v) => root.getPropertyValue(v).trim()).filter(Boolean);
  if (!want.length) { console.warn("[theme-coverage] 커스텀 테마가 켜져 있지 않습니다"); return "테마를 켠 뒤 다시"; }
  const norm = (c) => { const d = document.createElement("div"); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; };
  const themed = new Set(want.map(norm));
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("#ccf-theme-switcher-panel, .ccf-scp-panel, #ccfolia-handout-root, #ccf-character-sheet-root, [data-ccf-safe-markup]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 40 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    if (!bg || bg === "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none" || themed.has(bg)) continue;
    out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).split(" ").filter((c) => /^Mui|^ccf/.test(c)).slice(0, 4).join("."), role: el.getAttribute("role") || "", size: `${Math.round(r.width)}x${Math.round(r.height)}`, bg, color: cs.color });
    if (out.length >= 40) break;
  }
  const result = { themed: [...themed], unthemed: out };
  console.warn("[theme-coverage]", result);
  try { copy(JSON.stringify(result)); } catch (_) {}
  return `테마 색이 아닌 바탕 ${out.length}개를 복사했습니다(어느 창을 열었는지 함께 알려 주세요).`;
})();
