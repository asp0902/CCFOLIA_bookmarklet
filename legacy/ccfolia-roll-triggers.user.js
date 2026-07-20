// ==UserScript==
// @name         CCFOLIA Roll Triggers by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-roll-triggers
// @version      0.1.2
// @description  Click rendered /desc judgement macros in chat to auto-roll the matching palette command.
// @description:ko 채팅에 렌더된 판정 매크로(/desc 알약 버튼)를 클릭하면 채팅 팔레트를 자동으로 골라 전송합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  // ----- lifecycle ------------------------------------------------------------

  const CCF_RT_SCRIPT_INFO = Object.freeze({
    id: "ccf-roll-triggers",
    name: "CCFOLIA Roll Triggers",
    version: "0.1.1",
    namespace: "https://greasyfork.org/users/Capybara_korea/ccf-roll-triggers"
  });

  const ccfRtLifecycle = createLegacyLifecycle(CCF_RT_SCRIPT_INFO, {
    debugKey: "__CCF_ROLL_TRIGGERS_DEBUG__",
    onTeardown() {
      document.getElementById(STYLE_ID)?.remove();
      document.querySelectorAll(`[${BOUND_ATTR}="1"]`).forEach((el) => {
        if (el instanceof HTMLElement) {
          el.removeAttribute(BOUND_ATTR);
          el.style.cursor = "";
          el.classList.remove(ACTIVE_CLASS);
        }
      });
    }
  });
  const ccfRtSignal = ccfRtLifecycle.signal;

  function ccfRtRegisterTeardown(fn) {
    ccfRtLifecycle.registerTeardown(fn);
  }

  function ccfRtWithSignal(options) {
    return ccfRtLifecycle.withSignal(options);
  }

  function ccfRtTeardown() {
    return ccfRtLifecycle.disable();
  }

  ccfRtLifecycle.installDebugApi({
    extractSkillName,
    triggerSkillRoll
  });

  function createLegacyLifecycle(scriptInfo, options) {
    const debugKey = options.debugKey;
    const onTeardown = typeof options.onTeardown === "function" ? options.onTeardown : null;

    try { window[debugKey]?.disable?.(); } catch (error) { /* prior instance cleanup failed */ }

    let active = true;
    const disposers = [];
    const abort = new AbortController();
    const signal = abort.signal;

    function registerTeardown(fn) {
      if (typeof fn === "function") disposers.push(fn);
    }

    function withSignal(options) {
      if (options == null) return { signal };
      if (typeof options === "boolean") return { capture: options, signal };
      if (typeof options === "object") {
        if (options.signal && options.signal !== signal) return options;
        return { ...options, signal };
      }
      return { signal };
    }

    function registerWithSuite() {
      try {
        const registryKey = "ccf-suite-registry-v1";
        let registry;
        try {
          const parsed = JSON.parse(window.localStorage.getItem(registryKey) || "{}");
          registry = parsed && typeof parsed.scripts === "object" ? { scripts: parsed.scripts } : { scripts: {} };
        } catch (error) {
          registry = { scripts: {} };
        }
        const previous = registry.scripts[scriptInfo.id] && typeof registry.scripts[scriptInfo.id] === "object"
          ? registry.scripts[scriptInfo.id]
          : {};
        const now = new Date().toISOString();
        const sessionId = typeof window.__CCF_SUITE_MANAGER_SESSION_ID === "string"
          ? window.__CCF_SUITE_MANAGER_SESSION_ID
          : "";
        registry.scripts[scriptInfo.id] = {
          ...previous,
          ...scriptInfo,
          installedAt: previous.installedAt || now,
          lastSeenAt: now,
          lastSeenUrl: location.href,
          lastSeenSessionId: sessionId
        };
        window.localStorage.setItem(registryKey, JSON.stringify(registry));
        window.dispatchEvent(new CustomEvent("ccf-suite:register", { detail: registry.scripts[scriptInfo.id] }));
      } catch (error) { /* suite 등록 실패 무시 */ }
    }

    function disable() {
      if (!active) return false;
      active = false;
      try { abort.abort(); } catch (error) { /* abort failed */ }
      while (disposers.length) {
        const disposer = disposers.pop();
        try { disposer(); } catch (error) { /* disposer failed */ }
      }
      try { onTeardown?.(); } catch (error) { /* dom sweep failed */ }
      try {
        if (window[debugKey] && window[debugKey].__owner === signal) {
          delete window[debugKey];
        }
      } catch (error) { /* debug api cleanup failed */ }
      return true;
    }

    function installDebugApi(extra = {}) {
      window[debugKey] = {
        __owner: signal,
        isActive() { return active; },
        disable,
        ...extra
      };
    }

    registerWithSuite();
    window.addEventListener("ccf-suite:request-register", (event) => {
      const targetId = event?.detail?.targetId;
      if (targetId && targetId !== scriptInfo.id) return;
      registerWithSuite();
    }, withSignal());

    return {
      signal,
      registerTeardown,
      withSignal,
      isActive() { return active; },
      disable,
      installDebugApi
    };
  }

  // ----- constants ------------------------------------------------------------

  const STYLE_ID = "ccf-roll-triggers-style";
  const BOUND_ATTR = "data-ccf-roll-trigger-bound";
  const ACTIVE_CLASS = "ccf-roll-trigger-active";
  const ROOM_PATH_RE = /^\/rooms\/[^/?#]+/i;

  const MESSAGE_SCOPE_SELECTOR = '[role="log"], [aria-live="polite"], [aria-live="assertive"], ul.MuiList-root';
  const TRIGGER_CANDIDATE_SELECTOR = 'a, span, strong, em, p';

  // 판정 단어. 한국어/일본어 모두 매칭.
  const JUDGMENT_WORD_RE = /(?:판정|判定)/;
  // 《기능명》 패턴 (한국어/일본어 모두 동일 기호 사용).
  const SKILL_IN_BRACKETS_RE = /《([^》]+)》/;

  // ----- skill name extraction ------------------------------------------------

  function extractSkillName(text) {
    const raw = String(text || "");
    if (!JUDGMENT_WORD_RE.test(raw)) return null;

    // Type 1: 《기능명》 가 들어있다면 그것이 곧 기능명.
    const m1 = raw.match(SKILL_IN_BRACKETS_RE);
    if (m1 && m1[1]) {
      const name = m1[1].trim();
      if (name) return name;
    }

    // Type 2: "기능 판정" — "판정" 직전 단어.
    // 장식 기호(이모지/전각공백/쉼표/구두점)는 단어 경계로 취급.
    const stripped = raw
      .replace(/[☀-➿⬀-⯿]/g, " ")        // 일부 기호/이모지 범위
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, " ")       // 서로게이트 이모지 페어
      .replace(/[　,，、:;！!?？.…·•◆◇■□●○✷✦✧✩✪★☆⚠️⚡♥♦♣♠]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const judgmentMatch = stripped.match(/(?:판정|判定)/);
    if (!judgmentMatch || judgmentMatch.index === undefined) return null;
    const before = stripped.slice(0, judgmentMatch.index).trim();
    if (!before) return null;
    const lastWord = before.split(" ").pop();
    if (!lastWord) return null;
    return lastWord;
  }

  // ----- DOM detection --------------------------------------------------------

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function looksLikeJudgmentBadge(el) {
    if (!(el instanceof HTMLElement)) return false;
    const text = (el.textContent || "").trim();
    if (!text) return false;
    if (!JUDGMENT_WORD_RE.test(text)) return false;
    // 너무 긴 텍스트는 일반 문장일 가능성이 높다 — 알약 라벨은 보통 짧음.
    if (text.length > 60) return false;
    // 1) Markdown 링크 변환 결과인 <a href="#" style="...">: 가장 강한 신호
    if (el.tagName === "A") {
      const href = el.getAttribute("href") || "";
      if (href === "#" || href.startsWith("#")) return true;
    }
    // 2) inline-block + padding + background(그라데이션) 조합: 알약 스타일
    const inlineStyle = el.getAttribute("style") || "";
    if (
      /display\s*:\s*inline-block/i.test(inlineStyle)
      && /padding\s*:/i.test(inlineStyle)
      && /background(?:-image|-color)?\s*:/i.test(inlineStyle)
    ) return true;
    return false;
  }

  // 채팅 메시지 컨테이너 안에 있는지 확인.
  function isInsideChatLog(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest('[role="dialog"], .MuiDialog-root')) return false;
    if (el.closest('textarea, input, [contenteditable="true"], [role="textbox"]')) return false;
    return !!el.closest(MESSAGE_SCOPE_SELECTOR);
  }

  function scanForTriggers(root) {
    if (!(root instanceof Element)) return;
    const candidates = root.querySelectorAll(TRIGGER_CANDIDATE_SELECTOR);
    candidates.forEach(bindTrigger);
  }

  function bindTrigger(el) {
    if (!(el instanceof HTMLElement)) return;
    if (el.getAttribute(BOUND_ATTR) === "1") return;
    if (!isInsideChatLog(el)) return;
    if (!looksLikeJudgmentBadge(el)) return;
    const skill = extractSkillName(el.textContent || "");
    if (!skill) return;
    el.setAttribute(BOUND_ATTR, "1");
    el.classList.add(ACTIVE_CLASS);
    el.style.cursor = "pointer";
    el.title = `${skill} 판정 자동 실행 (클릭)`;
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void triggerSkillRoll(skill);
    }, ccfRtWithSignal());
  }

  // ----- roll automation ------------------------------------------------------

  // 기능명을 채팅 입력칸에 넣고, downshift 자동완성 팔레트가 뜨면 일치 옵션을 클릭,
  // 그 뒤 컴포저의 submit 버튼을 눌러 전송.
  async function triggerSkillRoll(skill) {
    const editor = findChatEditor();
    if (!editor) {
      console.warn("[CCF Roll] 채팅 입력칸을 찾지 못했습니다.");
      return false;
    }
    setEditorValue(editor, skill);
    editor.focus();

    const option = await waitForPaletteOption(skill, 1500);
    if (!option) {
      // 팔레트가 안 떴거나 매칭 옵션이 없음 — 일단 입력만 채워두고 사용자가 직접 처리.
      console.info("[CCF Roll] 팔레트 옵션을 찾지 못해 입력만 채웠습니다:", skill);
      return false;
    }

    // 옵션 클릭으로 입력값을 전체 명령(예: CCB<=70 민첩성)으로 치환시킴.
    simulateClick(option);
    await delay(40);
    // 명령 입력 후 전송.
    return triggerComposerSubmit(editor);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function simulateClick(el) {
    if (!(el instanceof HTMLElement)) return;
    // downshift 일부 버전은 mousedown까지 봐야 선택이 확정됨.
    const init = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new MouseEvent("mousedown", init));
      el.dispatchEvent(new MouseEvent("mouseup", init));
      el.click();
    } catch (error) {
      try { el.click(); } catch (_) { /* click failed */ }
    }
  }

  function findChatEditor() {
    const editors = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')];
    let best = null;
    let bestScore = -Infinity;
    for (const el of editors) {
      if (!(el instanceof HTMLElement)) continue;
      if (!isVisible(el)) continue;
      if (el.hasAttribute("readonly") || el.hasAttribute("disabled")) continue;
      if (el.closest('[role="dialog"], .MuiDialog-root')) continue;
      // 부모 8단계 내에 D4 다이스 / 채팅 커맨드 안내 / submit 중 하나 있어야.
      let cur = el.parentElement;
      let found = false;
      for (let i = 0; i < 8 && cur; i += 1, cur = cur.parentElement) {
        if (cur.querySelector('button[aria-label="D4"], button[aria-label="채팅 커맨드에 대해"], button[type="submit"]')) {
          found = true;
          break;
        }
      }
      if (!found) continue;
      // textarea 우선
      const rect = el.getBoundingClientRect();
      let score = 0;
      if (el instanceof HTMLTextAreaElement) score += 100;
      score += Math.min(rect.height, 80);
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function setEditorValue(editor, value) {
    if (!(editor instanceof HTMLElement)) return;
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(editor.constructor.prototype, "value")?.set;
      if (setter) setter.call(editor, value);
      else editor.value = value;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      try {
        const end = value.length;
        editor.setSelectionRange?.(end, end);
      } catch (error) { /* selection failed */ }
      return;
    }
    if (editor.isContentEditable || editor.getAttribute("role") === "textbox") {
      editor.textContent = value;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // downshift 팔레트가 나타나면 skill 에 맞는 옵션을 반환. timeoutMs 안에 못 찾으면 null.
  // 단순 부분일치(includes)만 쓰면 "운"이 "자동차 운전"에 걸리는 오매칭이 난다.
  // 우선순위: ① 완전일치 → ② {스킬}/《스킬》 참조 → ③ "스킬 판정" 형태 → ④ 부분일치(최후).
  // "행운 판정"엔 `운 판정`(③)이 있지만 "자동차 운전"엔 `운 전`이라 ③에 안 걸린다.
  function waitForPaletteOption(skill, timeoutMs) {
    return new Promise((resolve) => {
      const lower = skill.toLowerCase();
      const esc = escapeRegExp(lower);
      const refRe = new RegExp("[{《\\[]\\s*" + esc + "\\s*[}》\\]]");
      const judgmentRe = new RegExp(esc + "\\s*(?:판정|判定)");
      const startedAt = Date.now();
      const tick = () => {
        if (!ccfRtLifecycle.isActive()) { resolve(null); return; }
        const options = document.querySelectorAll(
          '[role="option"], [role="listbox"] li, [id^="downshift-"][id$="-item"], [id^="downshift-"][id*="item-"]'
        );
        let bestExact = null;
        let bestRef = null;
        let bestJudgment = null;
        let bestContains = null;
        for (const opt of options) {
          if (!(opt instanceof HTMLElement)) continue;
          if (!isVisible(opt)) continue;
          const text = (opt.textContent || "").trim();
          const lc = text.toLowerCase();
          if (lc === lower) { bestExact = opt; break; }
          if (!bestRef && refRe.test(lc)) bestRef = opt;
          if (!bestJudgment && judgmentRe.test(lc)) bestJudgment = opt;
          if (!bestContains && lc.includes(lower)) bestContains = opt;
        }
        const picked = bestExact || bestRef || bestJudgment || bestContains;
        if (picked) { resolve(picked); return; }
        if (Date.now() - startedAt > timeoutMs) { resolve(null); return; }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function triggerComposerSubmit(editor) {
    if (!(editor instanceof HTMLElement)) return false;
    let cur = editor.parentElement;
    for (let i = 0; i < 10 && cur; i += 1, cur = cur.parentElement) {
      const submit = cur.querySelector('button[type="submit"]:not([disabled])');
      if (submit instanceof HTMLElement && isVisible(submit)) {
        submit.click();
        return true;
      }
      const sendBtn = [...cur.querySelectorAll("button")].find((b) => {
        if (!(b instanceof HTMLElement) || b.disabled) return false;
        const label = (b.getAttribute("aria-label") || b.textContent || "").trim();
        return /^(전송|send|送信)$/i.test(label);
      });
      if (sendBtn instanceof HTMLElement && isVisible(sendBtn)) {
        sendBtn.click();
        return true;
      }
    }
    return false;
  }

  // ----- styles ---------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${ACTIVE_CLASS} {
        transition: filter 120ms ease, transform 120ms ease;
      }
      .${ACTIVE_CLASS}:hover {
        filter: brightness(1.08);
        transform: translateY(-1px);
      }
      .${ACTIVE_CLASS}:active {
        transform: translateY(0);
        filter: brightness(0.95);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    ccfRtRegisterTeardown(() => style.remove());
  }

  // ----- bootstrap ------------------------------------------------------------

  function isRoomPage() {
    return ROOM_PATH_RE.test(location.pathname);
  }

  function start() {
    if (!isRoomPage()) return;
    injectStyle();
    scanForTriggers(document.body);

    let pending = false;
    const obs = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        if (!ccfRtLifecycle.isActive()) return;
        scanForTriggers(document.body);
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
    ccfRtRegisterTeardown(() => obs.disconnect());

    // SPA 라우트 변경 시 다시 스캔
    const fire = () => window.dispatchEvent(new Event("ccf-roll-triggers:locationchange"));
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) { const r = origPush.apply(this, args); fire(); return r; };
    history.replaceState = function (...args) { const r = origReplace.apply(this, args); fire(); return r; };
    window.addEventListener("popstate", fire, ccfRtWithSignal());
    window.addEventListener("ccf-roll-triggers:locationchange", () => {
      if (!isRoomPage()) return;
      setTimeout(() => scanForTriggers(document.body), 80);
    }, ccfRtWithSignal());
  }

  function waitForBody(callback) {
    const tick = () => {
      if (document.body) { callback(); return; }
      window.requestAnimationFrame(tick);
    };
    tick();
  }

  waitForBody(start);
})();
