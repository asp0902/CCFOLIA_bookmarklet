// Roll20 새 메시지 → 폰 푸시(ntfy): "User JavaScript and CSS" 같은 크롬 확장(사이트별 사용자 JS)용 붙여넣기 파일. app.roll20.net 에 붙여 넣는다.
// ⚠ 이 파일은 "페이지 컨텍스트"에서 ntfy.sh 로 직접 fetch 한다. Roll20 의 보안 정책(CSP, connect-src)이 막으면 전송이 실패한다 — 이 저장소 환경에서는 Roll20 이 봇 차단(Cloudflare)으로
// 응답 헤더를 못 읽어 CSP 를 실측하지 못했다. 막히면 콘솔에 "[roll20-ntfy] 전송 실패"가 뜬다 → 그땐 카피바라 확장(roll20-reader.js 가 같은 일을 확장 권한으로 한다)을 쓴다.
// 설정은 아래 상수를 직접 채운다(비워 둔 값은 동작하지 않는다). topic 은 아는 사람은 누구나 알림을 볼 수 있으니 남에게 알리지 않는다.
(() => {
  "use strict";
  const CONFIG = {
    topic: "",            // ← 직접 입력(영문·숫자·-·_ 만, 추측하기 어려운 이름). 비어 있으면 아무것도 보내지 않는다.
    server: "https://ntfy.sh",
    includeText: false,   // true 면 알림에 이름: 본문 앞 60자를 넣는다(내용이 공개 서버를 지난다).
    onlyAway: true,       // true 면 이 탭을 보고 있고 최근에 조작했을 때는 보내지 않는다.
    awayMinutes: 2,
    keywords: [],         // 비어 있지 않으면 이름·본문에 이 낱말이 있는 메시지만
  };
  if (window.__R20_NTFY_USERJS__) return; window.__R20_NTFY_USERJS__ = true;
  const startedAt = Date.now(), GRACE_MS = 8000, BATCH_MS = 10000, MAX_PER_MINUTE = 6;
  const state = { total: 0, lastSkip: "", lastError: "", sent: [], pending: [], windowEnd: 0, timer: 0, lastInput: Date.now() };
  window.__R20_NTFY_STATE__ = state;
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) window.addEventListener(type, () => { state.lastInput = Date.now(); }, { capture: true, passive: true });
  const clean = (v, n) => String(v || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, n);
  const skip = (why) => { state.lastSkip = why; return false; };
  const topicOk = /^[A-Za-z0-9_-]{1,64}$/.test(CONFIG.topic);
  const send = (title, message) => {
    const now = Date.now(); state.sent = state.sent.filter((t) => now - t < 60000);
    if (state.sent.length >= MAX_PER_MINUTE) return skip("분당 상한");
    state.sent.push(now);
    fetch(String(CONFIG.server || "https://ntfy.sh").replace(/\/+$/, "") + "/", { method: "POST", credentials: "omit", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: CONFIG.topic, title: title.slice(0, 100), message: message.slice(0, 200), tags: ["speech_balloon"] }) })
      .then((r) => { state.lastError = r.ok ? "" : "ntfy 응답 " + r.status; }).catch((e) => { state.lastError = String(e && e.message || e); console.warn("[roll20-ntfy] 전송 실패(CSP 일 수 있음):", state.lastError); });
    return true;
  };
  const payload = (items) => { const [a] = items, extra = items.length - 1, tag = a.whisper ? "Roll20 귓속말" : "Roll20";
    return { title: extra > 0 ? `[${tag}] ${a.name} 외 ${extra}건` : `[${tag}] ${a.name}`, message: CONFIG.includeText ? (items.slice(0, 3).map((i) => `${i.name}: ${i.text}`).join("\n") || "새 메시지가 도착했습니다.") : "새 메시지가 도착했습니다." }; };
  const flush = () => { state.timer = 0; const items = state.pending.splice(0); if (items.length) { const p = payload(items); send(p.title, p.message); } state.windowEnd = items.length ? Date.now() + BATCH_MS : 0; };
  const speaker = () => clean(document.querySelector("#textchat-input #speakingas")?.selectedOptions?.[0]?.textContent, 80);
  const onMessage = (el) => {
    if (!topicOk) return skip("topic 이 비었거나 형식이 맞지 않음");
    if (el.classList.contains("system")) return skip("시스템 줄");
    if (Date.now() - startedAt < GRACE_MS) return skip("접속 직후 이력");
    const name = clean(el.querySelector(".by")?.textContent, 80).replace(/:$/, "").trim() || state.lastName || "누군가";
    state.lastName = name;
    if (el.classList.contains("you") || name === speaker()) return skip("내 메시지");
    if (CONFIG.onlyAway && document.visibilityState === "visible" && document.hasFocus() && Date.now() - state.lastInput < Math.min(60, Math.max(1, CONFIG.awayMinutes)) * 60000) return skip("보고 있음");
    const whisper = el.classList.contains("private") || el.classList.contains("whisper");
    let text;
    if (el.classList.contains("rollresult")) text = `주사위: ${clean(el.querySelector(".rolled")?.textContent, 40) || "굴림"}`;
    else { const body = el.cloneNode(true); body.querySelectorAll(".by, .tstamp, .avatar, img").forEach((n) => n.remove()); text = clean(body.textContent, 60); }
    if (CONFIG.keywords.length && !CONFIG.keywords.some((k) => `${name} ${text}`.toLowerCase().includes(String(k).toLowerCase()))) return skip("키워드 없음");
    state.total += 1; const item = { name, text, whisper }, now = Date.now();
    if (now >= state.windowEnd && !state.pending.length) { const p = payload([item]); if (!send(p.title, p.message)) return false; state.windowEnd = now + BATCH_MS; if (!state.timer) state.timer = setTimeout(flush, BATCH_MS); }
    else { state.pending.push(item); if (!state.timer) state.timer = setTimeout(flush, Math.max(200, state.windowEnd - now)); }
    return true;
  };
  const seen = new Set(); let observed = null;
  const scan = () => { for (const el of document.querySelectorAll("#textchat .content div.message[data-messageid]")) { const id = el.dataset.messageid; if (seen.has(id)) continue; seen.add(id); if (Date.now() - startedAt >= 3000) { try { onMessage(el); } catch (_) {} } } };
  const observe = () => { const content = document.querySelector("#textchat .content"); if (!content || content === observed) return; observed = content; new MutationObserver(scan).observe(content, { childList: true }); };
  setInterval(() => { observe(); scan(); }, 5000); observe(); scan();
})();
