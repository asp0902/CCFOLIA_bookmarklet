// 캐릭터 색 코드 칸 진단 (읽기 전용: 저장·전송 없음, 입력한 글자·색 값은 기록하지 않음)
// 1) 색 팔레트 창을 연다  2) 콘솔에 이 코드를 붙여넣고 Enter  3) 8초 안에 왼쪽 # 칸을 한 번, 오른쪽 픽커를 열어 # 칸을 한 번 누른다
// 8초 뒤 결과가 클립보드에 복사된다. 그대로 붙여넣어 보내면 된다.
(() => {
  const name = (el) => !el ? null : `${el.tagName}.${String(el.className?.baseVal ?? el.className ?? "").split(/\s+/).filter((c) => !/^(css|sc)-/.test(c)).slice(0, 3).join(".")}`;
  const isCode = (el) => el instanceof HTMLInputElement && el.matches('.ccf-character-color-proxy-input, .ccf-character-color-popover-hex, input[id^="rc-editable-input"]');
  const log = [], started = performance.now(), add = (...row) => { if (log.length < 80) log.push([Math.round(performance.now() - started), ...row]); };
  const stop = new AbortController(), opt = { capture: true, signal: stop.signal };
  for (const type of ["pointerdown", "mousedown", "click"]) window.addEventListener(type, (event) => {
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    add(type, name(event.target), "hit", name(hit), "code", isCode(event.target));
    setTimeout(() => add(`${type}:after`, "prevented", event.defaultPrevented, "active", name(document.activeElement)), 0);
  }, opt);
  for (const type of ["focusin", "focusout"]) document.addEventListener(type, (event) => add(type, name(event.target), "to", name(event.relatedTarget)), opt);
  const realFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...args) { add("focus()", name(this), String(new Error().stack || "").split("\n").slice(2, 4).map((line) => line.trim().replace(/https?:\/\/[^ )]*\//g, "").slice(0, 70)).join(" < ")); return realFocus.apply(this, args); };
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(), c = getComputedStyle(el); return { size: [Math.round(r.width), Math.round(r.height)], pointer: c.pointerEvents, readOnly: el.readOnly, disabled: el.disabled, inert: !!el.closest("[inert]"), ariaHidden: !!el.closest('[aria-hidden="true"]'), hit: name(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }; };
  console.warn("[색 코드 진단] 8초 동안 왼쪽 # 칸과 오른쪽 픽커 # 칸을 눌러 주세요.");
  setTimeout(() => {
    stop.abort(); HTMLElement.prototype.focus = realFocus;
    const toolkit = window.__CAPYBARA_TOOLKIT__;
    const result = JSON.stringify({ loader: toolkit?.version || null, theme: window.__CCF_THEME_SWITCHER_DEBUG__?.version || null, modals: [...document.querySelectorAll(".MuiModal-root")].map(name), left: box(document.querySelector(".ccf-character-color-proxy-input")), right: box(document.querySelector("#ccf-character-color-popover .ccf-character-color-popover-hex")), log });
    console.warn("[색 코드 진단] 끝 — 결과를 클립보드에 복사했습니다.", result);
    try { copy(result); } catch (_) { navigator.clipboard?.writeText(result); }
  }, 8000);
})();
