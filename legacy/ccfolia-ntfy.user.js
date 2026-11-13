// ==UserScript==
// @name         CCFOLIA Phone Push (ntfy) by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-ntfy
// @version      0.1.3
// @description  Sends a phone push (ntfy) for new room messages when you are away — the bookmarklet path of the extension's ntfy feature.
// @description:ko 룸에 새 메시지가 오면(자리를 비운 동안) 스마트폰 ntfy 앱으로 알림을 보냅니다. 확장의 스마트폰 알림과 같은 기능의 북마클릿용 경로입니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

// 확장(카피바라 4세)이 켜져 있으면 확장의 ntfy-page.js/background.js 가 이 일을 하므로 여기서는 아무것도 하지 않는다.
// 북마클릿 경로: 판단은 확장과 같은 규칙(내 메시지 제외, 룸이 앞에 없거나 N분 조작이 없을 때만, 묶음 10초·분당 6건), 전송은 페이지에서 ntfy 서버로 직접 fetch(코코포리아는 CSP 가 없고 ntfy 는 CORS 를 허용한다).
// 설정은 localStorage("ccf-ntfy-v1")에 저장하고, 설정 창은 툴킷 펭귄 메뉴의 "스마트폰 알림" 항목에서 연다. 보내는 것은 제목·짧은 본문·룸 주소뿐이다(계정 정보 없음).
(() => {
  "use strict";
  if (window.__CAPYBARA_PERSONAL_EXTENSION_START__ || window.__CCF_NTFY_HOOK__) return;
  const KEY = "ccf-ntfy-v1";
  const DEFAULT_SERVER = "https://ntfy.sh";
  const BATCH_MS = 10_000, MAX_PER_MINUTE = 6;
  const SAFE = "data-ccf-safe-markup";
  const state = { windowEnd: 0, pending: [], flushTimer: 0, sent: [], lastSkip: "", total: 0, lastInputAt: Date.now(), lastError: "" };
  window.__CCF_NTFY_STATE__ = state;

  const defaults = () => ({ enabled: false, topic: "", server: DEFAULT_SERVER, scope: "all", keywords: [], onlyAway: true, awayMinutes: 2, includeText: false });
  const readConfig = () => { try { return { ...defaults(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (_) { return defaults(); } };
  const writeConfig = (config) => { try { localStorage.setItem(KEY, JSON.stringify(config)); return true; } catch (_) { return false; } };
  const topicOk = (topic) => /^[A-Za-z0-9_-]{1,64}$/.test(topic);
  const serverOf = (value) => { try { const url = new URL(String(value || "").trim() || DEFAULT_SERVER); return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "127.0.0.1") ? url.origin : ""; } catch (_) { return ""; } };
  const randomTopic = () => { const alphabet = "abcdefghijklmnopqrstuvwxyz234567"; return "capy-" + Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => alphabet[b % 32]).join(""); };

  // ---- 판단 (ntfy-page.js 와 같은 규칙)
  const roomName = () => {
    const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
    const heading = [...document.querySelectorAll('h6.MuiTypography-subtitle2, h6[class*="MuiTypography-subtitle2"]')].find((el) => el.offsetParent !== null && ownText(el));
    if (heading) return ownText(heading).slice(0, 40);
    const title = String(document.title || "").replace(/^\s*\(\d+\)\s*/, "").trim();
    if (/^(?:CCFOLIA|ココフォリア|코코포리아)(?:\s|$)/i.test(title)) return "코코포리아";
    return title.replace(/\s*[-|–—]\s*(?:CCFOLIA|ココフォリア|코코포리아).*$/i, "").trim().slice(0, 40) || "코코포리아";
  };
  const roomUrl = () => (/^\/rooms\//.test(location.pathname) ? `${location.origin}${location.pathname}` : location.origin);
  const mySpeakerName = () => String(document.querySelector('input[name="name"]')?.value || "").trim();
  const markInput = () => { state.lastInputAt = Date.now(); };
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) window.addEventListener(type, markInput, { capture: true, passive: true });
  const watching = (config) => {
    if (document.visibilityState !== "visible" || !document.hasFocus()) return "";
    const idle = Date.now() - state.lastInputAt;
    return idle >= Math.min(60, Math.max(1, Math.round(Number(config.awayMinutes) || 2))) * 60_000 ? "" : `룸 화면을 보고 있음(최근 조작 ${Math.round(idle / 1000)}초 전)`;
  };

  // ---- 전송: 페이지에서 ntfy 서버로 직접(JSON, 서버 루트에 POST)
  async function publish(config, { title, message, click }) {
    const server = serverOf(config.server);
    if (!server || !topicOk(config.topic)) throw new Error("topic·서버 주소를 확인하세요");
    const response = await fetch(`${server}/`, {
      method: "POST", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: config.topic, title: String(title).slice(0, 100), message: String(message).slice(0, 200), tags: ["speech_balloon"], ...(click && click.startsWith("https://ccfolia.com") ? { click } : {}) })
    });
    if (!response.ok) throw new Error(`ntfy 응답 ${response.status}`);
  }
  const send = (config, payload) => {
    const now = Date.now();
    state.sent = state.sent.filter((t) => now - t < 60_000);
    if (state.sent.length >= MAX_PER_MINUTE) { state.lastSkip = "분당 상한"; return false; }
    state.sent.push(now);
    publish(config, payload).then(() => { state.lastError = ""; }).catch((error) => { state.lastError = String(error.message || error); });
    return true;
  };
  const buildPayload = (config, items) => {
    const [first] = items, extra = items.length - 1;
    const title = extra > 0 ? `${first.name} 외 ${extra}건 · ${roomName()}` : `${first.name}님 메시지 · ${roomName()}`;
    let message = "새 메시지가 도착했습니다.";
    if (config.includeText) message = items.slice(0, 3).map((item) => `${item.name}: ${item.text}`).join("\n").slice(0, 200) || message;
    return { title: title.slice(0, 100), message, click: roomUrl() };
  };
  const flush = () => {
    state.flushTimer = 0;
    const config = readConfig();
    const items = state.pending.splice(0);
    if (items.length && config.enabled) send(config, buildPayload(config, items));
    state.windowEnd = items.length ? Date.now() + BATCH_MS : 0;
  };

  // chat-notifier 가 새 메시지를 등록할 때 부른다. info = { name, text }
  window.__CCF_NTFY_HOOK__ = (info) => {
    const config = readConfig();
    if (!config.enabled || !topicOk(config.topic)) return false;
    const name = String(info?.name || "").trim() || "누군가";
    const text = String(info?.text || "").trim().slice(0, 60);
    if (config.onlyAway !== false) { const seen = watching(config); if (seen) { state.lastSkip = seen; return false; } }
    if (name && name === mySpeakerName()) { state.lastSkip = "내 메시지"; return false; }
    if (config.scope === "keywords") {
      const keywords = (config.keywords || []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
      const hay = `${name} ${info?.text || ""}`.toLowerCase();
      if (!keywords.length || !keywords.some((k) => hay.includes(k))) { state.lastSkip = "키워드 없음"; return false; }
    }
    state.total += 1;
    const now = Date.now();
    if (now >= state.windowEnd && !state.pending.length) {
      if (!send(config, buildPayload(config, [{ name, text }]))) return false;
      state.windowEnd = now + BATCH_MS;
      if (!state.flushTimer) state.flushTimer = window.setTimeout(flush, BATCH_MS);
      return true;
    }
    state.pending.push({ name, text });
    if (!state.flushTimer) state.flushTimer = window.setTimeout(flush, Math.max(200, state.windowEnd - now));
    return true;
  };

  // ---- 설정 창 (펭귄 메뉴 → 스마트폰 알림)
  // container 가 있으면 "GM 도구" 창의 탭 본문에 그린다(따로 뜨는 창 아님).
  function openSettings(container) {
    if (!(container instanceof Element)) container = null;
    document.getElementById("ccf-ntfy-dialog")?.remove();
    const config = readConfig();
    const box = document.createElement("div");
    box.id = "ccf-ntfy-dialog";
    box.setAttribute(SAFE, "1");
    box.style.cssText = container ? "font:14px/1.5 'Noto Sans KR',Roboto,sans-serif" : "position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;background:rgba(0,0,0,.5);font:14px/1.5 'Noto Sans KR',Roboto,sans-serif";
    const dismiss = () => { if (container) window.__CCF_TOOLKIT_MENU__?.closeTool?.(); else box.remove(); };
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    box.innerHTML = `<form style="width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:20px 24px;background:#222;color:#fff;border-radius:4px;box-shadow:0 11px 15px -7px rgba(0,0,0,.2),0 24px 38px 3px rgba(0,0,0,.14)">
      <h3 style="margin:0 0 8px;font-size:1.25rem;font-weight:500">스마트폰 알림</h3>
      <p style="margin:0 0 12px;color:rgba(255,255,255,.7);font-size:13px">코코포리아 새 메시지를 안드로이드 ntfy 앱으로 알려 줍니다. 이 룸 탭이 PC에서 열려 있어야 알림이 갑니다. 켜면 내용이 공개 서버(ntfy.sh)를 거칩니다(기본은 보낸 사람과 룸 이름만).</p>
      <label style="display:flex;gap:8px;margin:8px 0"><input type="checkbox" name="enabled"${config.enabled ? " checked" : ""}> 스마트폰 알림 사용</label>
      <label style="display:block;margin:8px 0">topic 이름 (추측하기 어려운 이름 — 아는 사람은 누구나 알림을 볼 수 있으니 남에게 알리지 마세요)
        <span style="display:flex;gap:6px;margin-top:4px"><input name="topic" value="${esc(config.topic)}" autocomplete="off" spellcheck="false" style="flex:1;padding:6px 8px;background:#1b1b1b;color:#fff;border:1px solid rgba(255,255,255,.23)"><button type="button" data-a="new">새로 만들기</button><button type="button" data-a="copy">복사</button></span></label>
      <label style="display:block;margin:8px 0">알릴 메시지 <select name="scope" style="padding:6px;background:#1b1b1b;color:#fff"><option value="all"${config.scope === "all" ? " selected" : ""}>다른 사람의 모든 메시지</option><option value="keywords"${config.scope === "keywords" ? " selected" : ""}>키워드가 들어간 메시지만</option></select>
        <input name="keywords" value="${esc((config.keywords || []).join(", "))}" placeholder="키워드(쉼표로 구분)" style="display:block;width:100%;margin-top:4px;padding:6px 8px;background:#1b1b1b;color:#fff;border:1px solid rgba(255,255,255,.23)"></label>
      <label style="display:block;margin:8px 0"><input type="checkbox" name="onlyAway"${config.onlyAway !== false ? " checked" : ""}> 이 룸을 보고 있지 않을 때만 알림 (다른 탭·창이거나 조작이 없을 때 — 조작 없는 시간: <input type="number" name="awayMinutes" min="1" max="60" value="${Math.min(60, Math.max(1, Number(config.awayMinutes) || 2))}" style="width:56px;padding:2px 4px;background:#1b1b1b;color:#fff"> 분)</label>
      <label style="display:block;margin:8px 0"><input type="checkbox" name="includeText"${config.includeText ? " checked" : ""}> 알림에 메시지 앞부분(60자)도 넣기</label>
      <label style="display:block;margin:8px 0">서버 주소 (비우면 ${DEFAULT_SERVER})<input name="server" value="${config.server === DEFAULT_SERVER ? "" : esc(config.server)}" placeholder="${DEFAULT_SERVER}" style="display:block;width:100%;margin-top:4px;padding:6px 8px;background:#1b1b1b;color:#fff;border:1px solid rgba(255,255,255,.23)"></label>
      <ol style="margin:8px 0 0 18px;padding:0;color:rgba(255,255,255,.7);font-size:13px"><li>Play 스토어에서 ntfy 앱(무료)을 설치합니다.</li><li>앱의 + 로 위 topic 이름을 구독합니다.</li><li>‘테스트 알림 보내기’로 확인합니다.</li></ol>
      <p data-role="note" role="status" style="min-height:20px;margin:8px 0 0;font-size:13px"></p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button type="button" data-a="test">테스트 알림 보내기</button><button type="submit" data-a="save">저장</button><button type="button" data-a="close">닫기</button></div></form>`;
    const form = box.querySelector("form");
    if (container) { form.style.cssText = "width:100%;max-width:520px;padding:0;background:transparent;color:#fff"; form.querySelector("h3")?.remove(); form.querySelector('[data-a="close"]')?.remove(); } // 공용 설정 탭 안: 소제목은 탭이 단다, 창은 탭 바깥의 닫기로 닫는다
    for (const button of form.querySelectorAll("button")) button.style.cssText = "padding:6px 12px;border:0;background:transparent;color:#64b5f6;font:inherit;cursor:pointer";
    const note = (text, error = false) => { const el = form.querySelector('[data-role="note"]'); el.textContent = text; el.style.color = error ? "#f44336" : "#bdbdbd"; };
    const read = () => ({
      enabled: form.enabled.checked, topic: form.topic.value.trim(), server: serverOf(form.server.value) || DEFAULT_SERVER, scope: form.scope.value,
      keywords: form.keywords.value.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 10), onlyAway: form.onlyAway.checked,
      awayMinutes: Math.min(60, Math.max(1, Math.round(Number(form.awayMinutes.value) || 2))), includeText: form.includeText.checked
    });
    const save = () => {
      if (!form.topic.value.trim()) form.topic.value = randomTopic();
      const next = read();
      if (!topicOk(next.topic)) { note("topic 이름은 영문·숫자·-·_ 만 쓸 수 있습니다.", true); return null; }
      if (form.server.value.trim() && !serverOf(form.server.value)) { note("서버 주소는 https 여야 합니다.", true); return null; }
      if (!writeConfig(next)) { note("저장하지 못했습니다(브라우저 저장소를 확인하세요).", true); return null; }
      note("저장했습니다. 켜져 있으면 바로 적용됩니다.");
      return next;
    };
    form.addEventListener("submit", (event) => { event.preventDefault(); save(); });
    form.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-a]")?.dataset.a;
      if (action === "close") dismiss();
      else if (action === "new") { form.topic.value = randomTopic(); note("새 topic 입니다. 저장한 뒤 핸드폰 앱에서 다시 구독하세요."); }
      else if (action === "copy") { try { await navigator.clipboard.writeText(form.topic.value.trim()); note("topic 이름을 복사했습니다."); } catch (_) { form.topic.select(); note("복사하지 못했습니다. 선택된 이름을 직접 복사하세요.", true); } }
      else if (action === "test") {
        const next = save();
        if (!next) return;
        note("보내는 중…");
        try { await publish(next, { title: "카피바라 테스트 알림", message: "스마트폰에 이 알림이 보이면 연결된 것입니다.", click: location.origin + "/" }); note("테스트 알림을 보냈습니다. 스마트폰 ntfy 앱에서 확인하세요."); }
        catch (error) { note(`보내지 못했습니다: ${error.message || error}`, true); }
      }
    });
    box.addEventListener("mousedown", (event) => { if (event.target === box && !container) box.remove(); });
    box.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); } event.stopPropagation(); });
    (container || document.documentElement).appendChild(box);
    form.topic.focus();
  }

  // 스마트폰 알림 설정은 확장 팝업에서만 한다: GM 도구 설정 탭에 구역을 등록하지 않는다(사용자 결정).
  window.__CCF_NTFY_DIAG__ = () => ({ config: { ...readConfig(), topic: readConfig().topic ? "(설정됨)" : "" }, state: { ...state, sent: state.sent.length } });
})();
