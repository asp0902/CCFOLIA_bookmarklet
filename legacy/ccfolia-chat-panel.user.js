// ==UserScript==
// @name         CCFOLIA Second Chat Panel by Capybara_korea
// @namespace    https://greasyfork.org/users/Capybara_korea/ccf-chat-panel
// @version      0.1.82
// @description  Adds a second, independent room chat panel beside the native one.
// @description:ko 룸 채팅 패널을 하나 더 띄워 다른 탭을 동시에 보고 전송합니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  // 이 패널은 코코포리아 패널을 복제하지 않는다. 코코포리아 패널은 React 소유이고
  // 보이는 줄만 만들어 쓰는 가상 스크롤이라, 복제해도 원본과 같은 탭·같은 스크롤만
  // 따라간다(= 두 탭을 동시에 못 봄). 대신 같은 원본 데이터(Redux store)를 읽어
  // 우리 DOM 으로 직접 그린다.
  //
  // ⚠ MUI 클래스명(.MuiListItem-root 등)을 쓰지 않는다. 다른 카피바라 스크립트들이
  //   그 클래스로 채팅 메시지를 찾아 가공하므로, 이 패널까지 건드리면 서로 망가진다.

  const VERSION = "0.1.82";
  const PANEL_ID = "ccf-second-chat-panel";
  const SAFE_ATTR = "data-capybara-toolkit-chat-panel";
  const MENU_ITEM_ATTR = "data-capybara-toolkit-chat-panel-menu";
  const FIRESTORE_PROJECT_ID = "ccfolia-160aa";
  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
  const STORAGE_KEY = "ccf-second-chat-panel:v1";
  // 지금은 패널이 하나뿐이라 항상 1. 여러 개를 지원하게 되면 이 값을 늘려 제목에 쓴다.
  const PANEL_INDEX = 1;
  const MAX_RENDER = 300;

  const CHANNEL_LABELS = Object.freeze({
    main: "메인", info: "정보", other: "잡담"
  });

  let active = true;
  let storeRef = null;
  let unsubscribe = null;
  let panelEl = null;
  let listEl = null;
  let tabsEl = null;
  let inputEl = null;
  let statusEl = null;
  let currentChannel = "main";
  // null = "아직 한 번도 안 그림". 빈 목록의 서명도 "" 이라, 초기값을 "" 로 두면
  // 처음 열었을 때 그릴 게 없다고 판단해 안내문조차 없이 빠져나간다(빈 패널).
  let lastSignature = null;
  let pinnedToBottom = true;
  let selectedChar = null; // 화자로 고른 캐릭터 {name, icon, color, commands} 또는 null
  let speakerPaletteBtn = null; // 팔레트·색상·도움말 아이콘 늦은 복제 재시도용
  let speakerColorBtn = null;
  let speakerHelpBtn = null;
  let onDocClickHandler = null; // 팝업 바깥 클릭 감지
  let onDocDragMove = null; // 팔레트 드래그 이동
  let onDocDragUp = null;
  let colorOverride = ""; // 색상 버튼으로 바꾼 값(비면 캐릭터 색 사용)
  let suppressScrollEval = false;
  let suppressScrollTimer = 0;
  // 바닥으로 내리되, 그로 인한 scroll 이벤트가 고정을 풀지 않게 잠시 평가를 막는다.
  function scrollListToBottom() {
    if (!listEl) return;
    suppressScrollEval = true;
    listEl.scrollTop = listEl.scrollHeight;
    clearTimeout(suppressScrollTimer);
    suppressScrollTimer = setTimeout(() => { suppressScrollEval = false; }, 120);
  }
  let sending = false;
  let layoutTimer = 0;
  // "left"  = 룸 채팅을 그대로 두고 그 왼쪽 옆에 붙는다 (기본값).
  // "right" = 룸 채팅을 왼쪽으로 밀고 오른쪽 끝을 쓴다.
  //   오른쪽으로 두면 밀려난 룸 채팅이 상단바 아이콘을 덮어버려, 사용자 선택으로 왼쪽을 기본으로.
  let panelSide = "left";
  // 배경을 불투명하게 만들지 여부. 기본은 반투명(원본과 동일한 질감). 켜면 |< 가림.
  let opaqueBg = false;
  // 기본값을 오른쪽 → 왼쪽으로 바꾼 뒤, 예전에 저장된 "right" 를 한 번 덮어쓰기 위한 표식.
  const SIDE_PREF_VERSION = 2;

  /* ---------------- Redux store ---------------- */

  function findStore() {
    if (storeRef) return storeRef;
    const root = document.getElementById("root") || document.body?.firstElementChild;
    if (!root) return null;
    const containerKey = Object.keys(root).find((k) => k.startsWith("__reactContainer"));
    if (!containerKey) return null;
    const fiber = root[containerKey]?.stateNode?.current;
    if (!fiber) return null;

    const isStore = (v) => v && typeof v === "object"
      && typeof v.dispatch === "function"
      && typeof v.getState === "function"
      && typeof v.subscribe === "function";

    const seen = new WeakSet();
    let found = null;
    const visit = (v) => {
      if (found || !v || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      if (isStore(v)) found = v;
    };
    const walk = (node, depth = 0) => {
      if (found || !node || depth > 50) return;
      visit(node.memoizedProps);
      visit(node.memoizedState);
      visit(node.stateNode);
      if (node.memoizedProps?.store) visit(node.memoizedProps.store);
      if (node.memoizedProps?.value) visit(node.memoizedProps.value);
      walk(node.child, depth + 1);
      walk(node.sibling, depth + 1);
    };
    walk(fiber);
    if (found) storeRef = found;
    return found;
  }

  function getRoomMessagesSlice() {
    try {
      return findStore()?.getState()?.entities?.roomMessages || null;
    } catch (error) {
      return null;
    }
  }

  // 화자로 쓸 수 있는 캐릭터 목록(entities.roomCharacters). order 순.
  function readCharacters() {
    try {
      const ent = findStore()?.getState()?.entities?.roomCharacters?.entities || {};
      return Object.values(ent)
        .filter((c) => c && !c.archived && String(c.name || "").trim())
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .map((c) => ({
          id: c._id, name: String(c.name || ""), icon: String(c.iconUrl || ""),
          color: String(c.color || ""), commands: String(c.commands || ""),
          active: !!c.active
        }));
    } catch (error) { return []; }
  }

  function getRoomId() {
    const match = location.pathname.match(/\/rooms\/([^/?#]+)/);
    return match ? match[1] : "";
  }

  /* ---------------- 메시지 읽기 ---------------- */

  // 필드 이름은 코코포리아 업데이트로 바뀔 수 있으니 후보를 여러 개 본다.
  function pick(obj, keys) {
    for (const key of keys) {
      const value = key.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
      if (value != null && value !== "") return value;
    }
    return "";
  }

  function readCreatedAt(msg) {
    const raw = msg?.createdAt ?? msg?.timestamp ?? msg?.time;
    if (raw == null) return 0;
    if (typeof raw === "number") return raw;
    if (typeof raw?.toMillis === "function") { try { return raw.toMillis(); } catch (e) { return 0; } }
    if (typeof raw?.seconds === "number") return raw.seconds * 1000;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function listChannels() {
    // 코코포리아 탭 막대가 정답이다(빈 탭 포함, 순서까지 동일).
    const native = readNativeTabs().map((t) => t.channel);
    const slice = getRoomMessagesSlice();
    const groups = slice?.idsGroupBy || {};
    const base = native.length ? native : ["main", "info", "other"];
    // 탭 막대를 못 읽었을 때를 대비해, 메시지가 있는데 빠진 채널은 뒤에 붙인다.
    const rest = Object.keys(groups).filter((key) => !base.includes(key)).sort();
    return [...base, ...rest];
  }

  function readMessages(channel) {
    const slice = getRoomMessagesSlice();
    if (!slice) return null;
    const entities = slice.entities || {};
    const ids = Array.isArray(slice.idsGroupBy?.[channel]) ? slice.idsGroupBy[channel] : [];
    const out = [];
    for (const id of ids) {
      const msg = entities[id];
      if (!msg || msg.removed) continue;
      // 주사위 메시지는 결과가 text 가 아니라 extend.roll.result 에 있다(diceDiag 로 확인).
      // 네이티브 CREE-GRRR 카드는 우리 패널을 처리하지 않으므로, 최소한 결과 문자열을
      // 붙여 굴림이 보이게 한다.
      const rollResult = String(pick(msg, ["extend.roll.result"]) || "");
      out.push({
        id,
        name: String(pick(msg, ["name", "character.name", "sender.name"]) || "이름 없음"),
        text: String(pick(msg, ["text", "message", "body"]) || ""),
        roll: rollResult,
        color: String(pick(msg, ["color", "character.color"]) || ""),
        icon: String(pick(msg, ["iconUrl", "character.iconUrl", "sender.iconUrl"]) || ""),
        at: readCreatedAt(msg)
      });
    }
    out.sort((a, b) => a.at - b.at);
    return out.slice(-MAX_RENDER);
  }

  /* ---------------- 렌더 ---------------- */

  // 코코포리아 표기와 맞춘다: "- 今日 15:02" / 지난 날짜는 "- 05/24 15:02".
  function formatTime(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    const clock = `${p(d.getHours())}:${p(d.getMinutes())}`;
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
    return sameDay ? `今日 ${clock}` : `${p(d.getMonth() + 1)}/${p(d.getDate())} ${clock}`;
  }

  // 서식용 보이지 않는 문자(다른 스크립트가 붙인 봉투)는 표시에서 제거한다.
  function stripInvisible(text) {
    return String(text || "").replace(/[\u200B-\u200F\u2028\u2029\u2060-\u2064\uFEFF]/g, "");
  }

  /* ---------------- 네이티브 메시지 줄 복제 ----------------
     실제 구조(진단으로 확인):
       DIV.MuiListItem-root
        ├ DIV.MuiListItemAvatar-root → 래퍼 → DIV.MuiAvatar-root → IMG.MuiAvatar-img
        ├ DIV.MuiListItemText-root
        │   ├ H6.…MuiListItemText-primary        (이름 = 자체 텍스트 노드)
        │   │   └ SPAN.MuiTypography-caption     ("-" + "今日 23:17")
        │   └ P.…MuiListItemText-secondary       (본문; format-sync 가 여기에 렌더)
        └ DIV(styled) → BUTTON                   (답장 버튼)
     ⚠ 패널 껍데기는 복제하지 않는다. 예전에 서랍째 복제했다가 우리 패널이
        코코포리아용 선택자에 자기도 걸려 두 번이나 겹쳤다. */
  let ccfScpRowTemplate = null;
  let ccfScpListClass = "";
  let ccfScpRowDivider = "";
  let ccfScpRowPadBottom = 0; // 네이티브 줄의 아래 패딩(구분선 위 여백 +1px 계산용)
  let ccfScpInnerUl = null; // 증분 렌더용: 현재 줄들이 담긴 내부 ul

  function captureNativeRowTemplate() {
    const rows = [...document.querySelectorAll(".MuiListItem-root")].filter((li) => {
      return li instanceof HTMLElement
        && li.querySelector("h6.MuiListItemText-primary")
        && li.offsetParent !== null
        && !li.closest(`#${PANEL_ID}`)
        && !li.closest(".MuiPopover-root, .MuiMenu-root, .MuiDialog-root");
    });
    // 나레이션·이어짐 줄을 본보기로 쓰면 그 표식이 모든 복제본에 따라간다.
    const plain = rows.filter((li) => {
      if (li.matches('[data-ccf-narration="1"], [data-ccf-prose-cont="1"]')) return false;
      if (li.querySelector('[data-ccf-narration="1"]')) return false;
      return !!li.querySelector(".MuiListItemAvatar-root img");
    });
    const source = plain[plain.length - 1];
    if (!source) return ccfScpRowTemplate;

    const template = source.cloneNode(true);
    // 다른 스크립트가 남긴 표식과 렌더 결과를 모두 지워 "빈 줄"로 만든다.
    const strip = (el) => {
      [...el.attributes].forEach((attr) => {
        if (/^data-ccf|^data-ccr20/.test(attr.name)) el.removeAttribute(attr.name);
      });
    };
    strip(template);
    template.querySelectorAll("*").forEach((el) => {
      if (el.classList.contains("ccf-render-overlay") || el.classList.contains("ccf-original-hidden")) {
        el.remove();
        return;
      }
      strip(el);
      el.classList.remove("ccf-render-root");
    });
    // 구분선은 줄 자신의 border-bottom 이다(rowDiag 로 확인). 다만 그 규칙은 네이티브
    // 목록 안에서만 걸려서, 클래스를 그대로 복제해도 우리 쪽엔 안 붙는다(0px).
    // 그래서 흉내 내지 말고 살아 있는 원본에서 값을 읽어 변수로 넘긴다.
    const sourceStyle = getComputedStyle(source);
    ccfScpRowPadBottom = parseFloat(sourceStyle.paddingBottom) || 0;
    ccfScpRowDivider = sourceStyle.borderBottomWidth !== "0px"
      ? `${sourceStyle.borderBottomWidth} ${sourceStyle.borderBottomStyle} ${sourceStyle.borderBottomColor}`
      : "";
    if (panelEl && ccfScpRowDivider) panelEl.style.setProperty("--scp-row-divider", ccfScpRowDivider);

    // 줄을 담고 있던 목록의 클래스도 함께 기억한다.
    const parent = source.parentElement;
    if (parent instanceof HTMLElement && typeof parent.className === "string") {
      const cls = parent.className.split(/\s+/)
        .filter((c) => c && !c.startsWith("ccf-") && !c.startsWith("ccr20-"))
        .join(" ");
      if (cls) ccfScpListClass = cls;
    }

    ccfScpRowTemplate = template;
    return ccfScpRowTemplate;
  }

  function buildRowFromNativeTemplate(msg, prevName) {
    const template = ccfScpRowTemplate || captureNativeRowTemplate();
    if (!template) return null;

    const row = template.cloneNode(true);
    // 우리 자체 레이아웃 클래스(.ccf-scp-row)는 붙이지 않는다 — 격자 규칙이 네이티브
    // 배치를 덮어써 오히려 깨진다. 네이티브 클래스만 그대로 두면 서식 스크립트의
    // 나레이션 CSS(.MuiListItem-root:has(...))도 저절로 걸린다.
    row.setAttribute(SAFE_ATTR, "1");

    const img = row.querySelector(".MuiListItemAvatar-root img");
    if (img) {
      if (msg.icon) img.src = msg.icon;
      else img.removeAttribute("src");
    }

    const head = row.querySelector("h6.MuiListItemText-primary");
    if (head) {
      const nameNode = [...head.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
      if (nameNode) nameNode.nodeValue = msg.name;
      else head.insertBefore(document.createTextNode(msg.name), head.firstChild);
      const caption = head.querySelector("span");
      if (caption) caption.textContent = ` - ${formatTime(msg.at)}`;
      if (msg.color) head.style.color = msg.color;
    }

    const body = row.querySelector("p.MuiListItemText-secondary");
    if (body) {
      // 봉투를 남긴 원문을 넣으면 format-sync 가 서식·나레이션·이미지를 그려준다.
      // 주사위 메시지는 굴림 결과 문자열을 대신 보여준다(네이티브 카드는 우리 패널
      // 밖에서 그려지므로 여기선 결과 텍스트로).
      body.textContent = msg.roll
        ? msg.roll
        : (window.__CCF_FORMAT_SYNC_DEBUG__ ? msg.text : stripInvisible(msg.text));
    }

    // 답장 버튼은 우리 패널에서 동작시키지 않는다(모양만 유지).
    row.querySelectorAll("button, [role='button']").forEach((btn) => {
      btn.setAttribute("tabindex", "-1");
      btn.style.pointerEvents = "none";
      btn.style.opacity = "0.35";
    });

    if (msg.name === prevName) {
      // 같은 화자 이어짐 표시를 붙이면 roll20-bridge 의 CSS 가 네이티브와 똑같이
      // 아이콘·이름을 숨기고 간격을 좁혀 준다(그 스크립트의 JS 는 우리 패널을 건너뛰지만
      // CSS 는 전역이라 그대로 적용된다). 직접 숨기면 간격이 원본보다 크게 남는다.
      row.setAttribute("data-ccf-prose-cont", "1");
    }
    return row;
  }

  /* ---------------- 탭 목록 ----------------
     저장소(idsGroupBy)에는 "메시지가 한 번이라도 오간 채널"만 있다. 비밀 탭처럼
     아직 빈 탭은 거기 없어서, 그것만 보면 탭이 3개로 줄어든다. 그래서 코코포리아
     탭 막대를 읽되, 글자만 보지 않고 React 가 각 탭에 붙여 둔 값(채널 키)을 꺼낸다
     — 자리 순서로 맞추면 탭 개수가 다를 때 엉뚱한 이름이 붙는다. */

  function readReactProp(el, key) {
    for (const k of Object.keys(el)) {
      if (k.startsWith("__reactProps")) {
        const v = el[k]?.[key];
        if (v != null) return v;
      }
      if (k.startsWith("__reactFiber")) {
        const v = el[k]?.memoizedProps?.[key];
        if (v != null) return v;
      }
    }
    return undefined;
  }

  // DOM 노드에 붙은 props 는 onClick 같은 것뿐이다(진단으로 확인). 채널 키는 그 위
  // 컴포넌트(MUI Tab)가 들고 있으므로 fiber 를 거슬러 올라가며 찾는다.
  function readFiberValue(el) {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
    let fiber = key ? el[key] : null;
    for (let i = 0; fiber && i < 8; i += 1) {
      const value = fiber.memoizedProps?.value;
      if (typeof value === "string" && value) return value;
      fiber = fiber.return;
    }
    return "";
  }

  // 채널 키가 어디 있는지는 진단으로 확인했다: DOM 의 id 다(id="main" 등).
  // role="tab" 으로는 일부만 잡히므로 자식 요소를 그대로 훑는다.
  // 탭 안에는 안 읽음 배지가 같이 들어 있다. 그대로 읽으면 "메인0" 이 된다.
  function tabLabelOf(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".MuiBadge-badge, .MuiChip-root, .MuiTouchRipple-root, svg")
      .forEach((node) => node.remove());
    return normalizeSpace(clone.textContent || "");
  }

  function tabEntryFrom(el) {
    if (!(el instanceof HTMLElement)) return null;
    // 글자가 없는 것은 탭이 아니라 "+"(탭 추가) 버튼이다.
    const label = tabLabelOf(el);
    if (!label) return null;
    // id 는 선택된 탭에만 붙으므로(진단으로 확인) fiber 를 먼저 본다.
    const id = el.id && !/^mui-|^:r/.test(el.id) ? el.id : "";
    const channel = readFiberValue(el) || id || readReactProp(el, "value");
    if (typeof channel !== "string" || !channel) return null;
    return { channel, label };
  }

  function readNativeTabs() {
    const lists = [...document.querySelectorAll('[role="tablist"], .MuiTabs-flexContainer')]
      .filter((el) => el instanceof HTMLElement && !el.closest(`#${PANEL_ID}`));
    let best = [];
    for (const list of lists) {
      // 자식만으로 부족하면(탭이 한 겹 더 싸여 있는 경우) 후손까지 훑는다.
      for (const scope of [[...list.children], [...list.querySelectorAll("[id]")]]) {
        const out = [];
        const seen = new Set();
        for (const el of scope) {
          const entry = tabEntryFrom(el);
          if (!entry || seen.has(entry.channel)) continue;
          seen.add(entry.channel);
          out.push(entry);
        }
        if (out.length > best.length) best = out;
      }
    }
    if (best.length >= 3) return best;
    // 채널 키를 못 캐냈을 때의 대안: 탭 이름은 언제나 읽히므로, 앞의 셋은 고정 채널에
    // 맞추고 나머지 사용자 탭은 저장소에 있는 나머지 키에 순서대로 짝지운다.
    return readNativeTabsByLabel();
  }

  function readNativeTabsByLabel() {
    const lists = [...document.querySelectorAll('[role="tablist"], .MuiTabs-flexContainer')]
      .filter((el) => el instanceof HTMLElement && !el.closest(`#${PANEL_ID}`));
    let labels = [];
    for (const list of lists) {
      const texts = [...list.children]
        .map((el) => (el instanceof HTMLElement ? tabLabelOf(el) : ""))
        .filter(Boolean); // 글자 없는 "+" 버튼 제외
      if (texts.length > labels.length) labels = texts;
    }
    if (labels.length < 3) return [];

    const base = ["main", "info", "other"];
    const groups = Object.keys(getRoomMessagesSlice()?.idsGroupBy || {});
    const extras = groups.filter((key) => !base.includes(key));
    const out = [];
    labels.forEach((label, index) => {
      if (index < base.length) { out.push({ channel: base[index], label }); return; }
      // 키를 모르는 탭은 넣지 않는다 — 이름만 맞고 내용이 빈 탭이 생긴다.
      const key = extras[index - base.length];
      if (key) out.push({ channel: key, label });
    });
    return out;
  }

  function channelLabel(channel) {
    const found = readNativeTabs().find((t) => t.channel === channel);
    if (found) return found.label;
    if (CHANNEL_LABELS[channel]) return CHANNEL_LABELS[channel];
    // 그래도 못 찾으면 ID 를 짧게 줄여 보여준다(칸을 잡아먹지 않게).
    return channel.length > 6 ? `${channel.slice(0, 6)}…` : channel;
  }

  function renderTabs() {
    if (!tabsEl) return;
    const channels = listChannels();
    const signature = channels.join("|") + "::" + currentChannel;
    if (tabsEl.dataset.sig === signature) return;
    tabsEl.dataset.sig = signature;
    tabsEl.textContent = "";
    for (const channel of channels) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ccf-scp-tab" + (channel === currentChannel ? " is-active" : "");
      btn.textContent = channelLabel(channel);
      btn.title = channel;
      btn.addEventListener("click", () => {
        currentChannel = channel;
        savePrefs();
        lastSignature = null;
        pinnedToBottom = true;
        renderTabs();
        renderList();
      });
      tabsEl.appendChild(btn);
    }
  }

  // 한 메시지의 줄 요소를 만든다(네이티브 복제 우선, 없으면 자체 li 구성).
  function buildRow(msg, prevName) {
    const cloned = buildRowFromNativeTemplate(msg, prevName);
    if (cloned) return cloned;

    const isCont = msg.name === prevName;
    const row = document.createElement("li");
    row.className = "ccf-scp-row" + (isCont ? " is-cont" : "");
    const avatar = document.createElement("div");
    avatar.className = "ccf-scp-avatar";
    if (!isCont && msg.icon) {
      const img = document.createElement("img");
      img.src = msg.icon; img.alt = ""; img.loading = "lazy";
      avatar.appendChild(img);
    }
    row.appendChild(avatar);
    const bodyWrap = document.createElement("div");
    bodyWrap.className = "ccf-scp-body";
    if (!isCont) {
      const head = document.createElement("div");
      head.className = "ccf-scp-head";
      const nameEl = document.createElement("span");
      nameEl.className = "ccf-scp-name";
      nameEl.textContent = msg.name;
      if (msg.color) nameEl.style.color = msg.color;
      head.appendChild(nameEl);
      const timeEl = document.createElement("span");
      timeEl.className = "ccf-scp-time";
      timeEl.textContent = `- ${formatTime(msg.at)}`;
      head.appendChild(timeEl);
      bodyWrap.appendChild(head);
    }
    const body = document.createElement("p");
    body.className = "ccf-scp-text";
    body.textContent = msg.roll
      ? msg.roll
      : (window.__CCF_FORMAT_SYNC_DEBUG__ ? msg.text : stripInvisible(msg.text));
    bodyWrap.appendChild(body);
    row.appendChild(bodyWrap);
    return row;
  }

  // 화자가 바뀌는 줄에만 구분선을 긋고, 이어짐 앞 줄엔 leader 표식(간격 축소)을 준다.
  // CSS 규칙은 어딘가에 눌려 0px 가 되므로 줄에 직접·강제로 넣는다.
  function applyRowMarkers(rows) {
    const divider = ccfScpRowDivider || "1px solid rgba(128,128,128,.24)";
    rows.forEach((row, i) => {
      if (!(row instanceof HTMLElement)) return;
      const next = rows[i + 1];
      const nextIsCont = next instanceof HTMLElement && next.getAttribute("data-ccf-prose-cont") === "1";
      if (nextIsCont) {
        row.setAttribute("data-ccf-prose-cont-leader", "1");
        row.style.removeProperty("border-bottom");
      } else {
        row.removeAttribute("data-ccf-prose-cont-leader");
        row.style.setProperty("border-bottom", divider, "important");
        // 네이티브 박스모델과 동일한 아래 패딩(8px)으로 고정 — 구분선 위 여백을 맞춘다.
        row.style.setProperty("padding-bottom", `${ccfScpRowPadBottom}px`, "important");
      }
    });
  }

  function renderList() {
    if (!listEl) return;
    const messages = readMessages(currentChannel);
    if (messages == null) {
      listEl.textContent = "";
      ccfScpInnerUl = null;
      const empty = document.createElement("div");
      empty.className = "ccf-scp-empty";
      empty.textContent = "코코포리아 룸 데이터를 아직 찾지 못했습니다. 잠시 후 자동으로 표시됩니다.";
      listEl.appendChild(empty);
      return;
    }

    const signature = messages.map((m) => m.id).join(",");
    if (signature === lastSignature) return;

    const wasPinned = pinnedToBottom;
    const prevTop = listEl.scrollTop;
    const restoreScroll = () => {
      if (wasPinned) {
        scrollListToBottom();
        // 아바타가 늦게 로드돼 높이가 늘면 바닥이 밀리므로 한 번 더 맞춘다.
        requestAnimationFrame(() => { if (pinnedToBottom) scrollListToBottom(); });
      } else {
        listEl.scrollTop = prevTop;
      }
    };

    // 증분 렌더: 기존 목록 뒤에 메시지가 추가만 됐고 내부 ul 이 살아 있으면, 전체를
    // 다시 그리지 않고 새 줄만 붙인다. 전체 재생성이 아바타 리로드(깜박임)와 스크롤
    // 소실(중간으로 튐)의 원인이었다.
    if (lastSignature && ccfScpInnerUl && ccfScpInnerUl.isConnected
        && signature.startsWith(lastSignature + ",")) {
      const oldCount = lastSignature.split(",").length;
      const oldLast = ccfScpInnerUl.lastElementChild;
      let prevName = messages[oldCount - 1]?.name ?? null;
      const appended = [];
      for (const msg of messages.slice(oldCount)) {
        const row = buildRow(msg, prevName);
        prevName = msg.name;
        ccfScpInnerUl.appendChild(row);
        appended.push(row);
      }
      applyRowMarkers([oldLast, ...appended].filter(Boolean));
      lastSignature = signature;
      restoreScroll();
      return;
    }

    lastSignature = signature;
    listEl.textContent = "";
    ccfScpInnerUl = null;
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "ccf-scp-empty";
      empty.textContent = "이 탭에는 아직 메시지가 없습니다.";
      listEl.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    let prevName = null;
    for (const msg of messages) {
      frag.appendChild(buildRow(msg, prevName));
      prevName = msg.name;
    }
    applyRowMarkers([...frag.children]);

    // 네이티브 목록 클래스를 쓴 래퍼 안에 줄을 넣는다(간격·여백이 따라온다). 우리 스크롤
    // 컨테이너에 직접 붙이면 목록 CSS 의 overflow 가 스크롤을 깬다.
    if (ccfScpListClass) {
      const inner = document.createElement("ul");
      inner.className = ccfScpListClass;
      inner.setAttribute(SAFE_ATTR, "1");
      inner.style.padding = "0";
      inner.style.margin = "0";
      inner.appendChild(frag);
      listEl.appendChild(inner);
      ccfScpInnerUl = inner;
      restoreScroll();
      return;
    }
    listEl.appendChild(frag);
    restoreScroll();
  }

  /* ---------------- 전송 ---------------- */

  function readFirebaseAuthRecord() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open("firebaseLocalStorageDb"); }
      catch (error) { reject(error); return; }
      req.onerror = () => reject(new Error("firebaseLocalStorageDb 열기 실패"));
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction("firebaseLocalStorage", "readonly");
          const all = tx.objectStore("firebaseLocalStorage").getAll();
          all.onsuccess = () => {
            const row = (all.result || []).find((r) => r?.value?.stsTokenManager?.accessToken);
            resolve(row?.value || null);
          };
          all.onerror = () => reject(new Error("인증 레코드 읽기 실패"));
        } catch (error) { reject(error); }
      };
    });
  }

  async function getAuthContext() {
    const roomId = getRoomId();
    if (!roomId) throw new Error("룸 페이지가 아닙니다.");
    const record = await readFirebaseAuthRecord();
    const token = record?.stsTokenManager?.accessToken;
    if (!token) throw new Error("로그인 정보를 찾지 못했습니다. 새로고침 후 다시 시도해 주세요.");
    const expiresAt = record?.stsTokenManager?.expirationTime || 0;
    if (expiresAt && expiresAt < Date.now()) {
      throw new Error("로그인 정보가 만료되었습니다. 새로고침해 주세요.");
    }
    return { roomId, token, uid: record?.uid || "" };
  }

  // 보낼 메시지의 형식은 추측하지 않는다. 룸에 실제로 저장된 최근 메시지를
  // 그대로 본떠서(같은 필드·같은 타입) 본문과 탭만 바꿔 넣는다.
  // 이러면 코코포리아가 형식을 바꾸더라도 따라간다.
  async function fetchTemplateFields(ctx) {
    const url = `${FIRESTORE_BASE}/rooms/${encodeURIComponent(ctx.roomId)}:runQuery`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "messages" }],
          orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
          limit: 30
        }
      })
    });
    if (!response.ok) throw new Error(`최근 메시지를 읽지 못했습니다 (${response.status})`);
    const rows = await response.json();
    const docs = (Array.isArray(rows) ? rows : [])
      .map((row) => row?.document?.fields)
      .filter((fields) => fields && fields.text);
    if (!docs.length) throw new Error("본뜰 메시지가 없습니다. 이 룸에서 채팅을 한 번 보낸 뒤 다시 시도해 주세요.");
    // 내가 보낸 메시지를 우선 — 이름/아이콘/색이 내 것으로 유지된다.
    const mine = ctx.uid ? docs.find((f) => f.from?.stringValue === ctx.uid) : null;
    return mine || docs[0];
  }

  function makeTimestampLike(templateField) {
    if (templateField?.timestampValue !== undefined) {
      return { timestampValue: new Date().toISOString() };
    }
    if (templateField?.integerValue !== undefined) {
      return { integerValue: String(Date.now()) };
    }
    return { timestampValue: new Date().toISOString() };
  }

  // 자바스크립트 값을 Firestore REST 의 타입 있는 값으로 바꾼다(extend.roll 중첩용).
  function toFirestoreValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === "boolean") return { booleanValue: v };
    if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === "string") return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
    if (typeof v === "object") {
      const fields = {};
      for (const [k, val] of Object.entries(v)) fields[k] = toFirestoreValue(val);
      return { mapValue: { fields } };
    }
    return { stringValue: String(v) };
  }

  const DICE_SKIN = Object.freeze({
    d4: "basic", d6: "basic", d8: "basic", d10: "basic", d12: "basic", d20: "basic", d100: "basic"
  });

  // 순수 산술 주사위(NdM±K)만 직접 굴린다. 코코포리아는 네이티브 전송 때 미리 굴려
  // 결과를 extend.roll 에 넣으므로(diceDiag 로 확인), 같은 구조를 만들어 넣는다.
  // 게임 시스템 판정(CC<=, 특수룰)은 BCDice 엔진이 필요해 여기선 다루지 않는다(글자로 감).
  function evaluateDiceCommand(text) {
    const raw = String(text || "").trim();
    // 맨 앞이 정확히 주사위 식이어야 한다. 뒤의 코멘트(" 피해(…)")는 허용.
    const m = raw.match(/^(\d*)[dD](\d+)\s*([+\-]\s*\d+)?(?:\s|$)/);
    if (!m) return null;
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const faces = parseInt(m[2], 10);
    const modStr = m[3] ? m[3].replace(/\s+/g, "") : "";
    const mod = modStr ? parseInt(modStr, 10) : 0;
    if (count < 1 || count > 100 || faces < 2 || faces > 1000) return null;

    const values = [];
    let sum = 0;
    for (let i = 0; i < count; i += 1) {
      const v = Math.floor(Math.random() * faces) + 1;
      values.push(v);
      sum += v;
    }
    const total = sum + mod;
    const commandNorm = `${count}D${faces}${modStr}`;
    const core = count > 1 ? `${sum}[${values.join(",")}]${modStr}` : `${values[0]}${modStr}`;
    const result = `(${commandNorm}) ＞ ${core} ＞ ${total}`;
    return {
      roll: {
        result,
        success: false, fumble: false, critical: false, failure: false, secret: false,
        dices: values.map((value) => ({ faces, value, kind: "normal" })),
        skin: { ...DICE_SKIN }
      }
    };
  }

  async function sendMessage(text) {
    const ctx = await getAuthContext();
    const template = await fetchTemplateFields(ctx);
    const fields = {};
    // 템플릿의 필드 구조를 그대로 유지하되, 우리가 정하는 값만 덮어쓴다.
    for (const [key, value] of Object.entries(template)) {
      if (key === "removed") continue;
      fields[key] = value;
    }
    fields.text = { stringValue: text };
    fields.channel = { stringValue: currentChannel };
    // 화자를 골랐으면 이름·아이콘·색을 그 캐릭터로 바꾼다(from 은 내 uid 유지).
    if (selectedChar) {
      fields.name = { stringValue: selectedChar.name };
      fields.iconUrl = { stringValue: selectedChar.icon };
      fields.imageUrl = { stringValue: selectedChar.icon };
      fields.color = { stringValue: colorOverride || selectedChar.color || "#888888" };
    } else if (colorOverride) {
      fields.color = { stringValue: colorOverride };
    }
    // 순수 주사위면 결과를 계산해 extend.roll 로 넣는다 → 굴려진 카드로 렌더된다.
    // 아니면 템플릿의 빈 extend 를 그대로 둔다(일반 메시지).
    // 템플릿이 다이스 메시지면 extend.roll 이 딸려온다. 다이스가 아니면 반드시 비운다
    // (안 그러면 직전 판정이 그대로 반복돼 나간다).
    const rolled = evaluateDiceCommand(text);
    fields.extend = toFirestoreValue(rolled || {});
    if ("createdAt" in template) fields.createdAt = makeTimestampLike(template.createdAt);
    if ("updatedAt" in template) fields.updatedAt = makeTimestampLike(template.updatedAt);
    if (ctx.uid && "from" in template) fields.from = { stringValue: ctx.uid };

    const url = `${FIRESTORE_BASE}/rooms/${encodeURIComponent(ctx.roomId)}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`전송 실패 (${response.status}) ${detail.slice(0, 120)}`);
    }
  }

  function setStatus(message, kind = "") {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.className = "ccf-scp-status" + (kind ? ` is-${kind}` : "");
  }

  // 네이티브 주사위 버튼의 아이콘(svg)을 면 수(faces)별로 복제해 둔다. 접근 이름
  // (aria-label·title·글자)에서 d숫자를 읽어 매칭한다. 못 읽으면 텍스트로 대체된다.
  function captureNativeDiceIcons() {
    const map = new Map();
    for (const b of document.querySelectorAll("button")) {
      if (!(b instanceof HTMLElement) || b.closest(`#${PANEL_ID}`)) continue;
      const svg = b.querySelector("svg");
      if (!svg) continue;
      const label = (b.getAttribute("aria-label") || b.title || b.textContent || "").trim();
      const m = label.match(/(\d+)\s*[dD]\s*(\d+)/) || label.match(/[dD]\s*(\d+)/) || label.match(/(\d+)\s*면/);
      const faces = m ? parseInt(m[2] || m[1], 10) : 0;
      if (![4, 6, 8, 10, 12, 20, 100].includes(faces)) continue;
      if (!map.has(faces)) map.set(faces, svg);
    }
    return map;
  }

  // 네이티브 캐릭터 이름 바(form 의 해당 div) 안의 아이콘: 3번째=채팅 팔레트, 4번째=색상.
  // aria 가 없어 위치로 복제한다(사용자 제공 셀렉터 기준).
  function captureNativeSpeakerIcons() {
    const form = [...document.querySelectorAll("form")].find((f) =>
      f instanceof HTMLElement && !f.closest(`#${PANEL_ID}`) && f.querySelector("button svg"));
    if (!form) return {};
    // 이름 바 = 아바타·이름 input·팔레트·색상 버튼을 담은 div. name input(MuiInputBase)이
    // 있는 자식으로 찾는다(nth-child 하드코딩보다 견고).
    const bar = [...form.children].find((c) =>
      c instanceof HTMLElement && c.querySelector(".MuiInputBase-root, input") && c.querySelector("button svg"));
    if (!bar) return {};
    const iconButtons = [...bar.querySelectorAll("button")].filter((b) => b.querySelector("svg"));
    return {
      palette: iconButtons[0]?.querySelector("svg") || null,
      color: iconButtons[1]?.querySelector("svg") || null,
      help: iconButtons[2]?.querySelector("svg") || null,
      paletteBtnEl: iconButtons[0] || null,
      helpBtn: iconButtons[2] || null
    };
  }

  // 입력창 커서 위치에 텍스트를 넣는다(선택 영역이 있으면 대체). 주사위·서식 버튼 공용.
  function insertAtCursor(text) {
    if (!inputEl) return;
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const end = inputEl.selectionEnd ?? inputEl.value.length;
    const before = inputEl.value.slice(0, start);
    const after = inputEl.value.slice(end);
    // 앞 글자가 공백·줄바꿈이 아니면 한 칸 띄워 명령이 붙지 않게 한다.
    const sep = before && !/\s$/.test(before) ? " " : "";
    inputEl.value = before + sep + text + after;
    const caret = (before + sep + text).length;
    inputEl.focus();
    inputEl.setSelectionRange(caret, caret);
  }

  async function handleSend() {
    if (sending || !inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;
    sending = true;
    setStatus("전송 중…");
    try {
      await sendMessage(text);
      inputEl.value = "";
      setStatus("");
      pinnedToBottom = true;
    } catch (error) {
      console.error("[ccf-chat-panel] send failed", error);
      setStatus(error?.message || "전송에 실패했습니다.", "error");
    } finally {
      sending = false;
    }
  }

  /* ---------------- 설정 저장 ---------------- */

  function savePrefs() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        channel: currentChannel, open: !!panelEl, side: panelSide, sideV: SIDE_PREF_VERSION, opaqueBg,
        selectedCharId: selectedChar?.id || ""
      }));
    } catch (error) { /* 저장 실패는 무시 */ }
  }

  function readPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (error) { return {}; }
  }

  /* ---------------- 패널 ---------------- */

  function injectStyle() {
    if (document.getElementById("ccf-scp-style")) return;
    const style = document.createElement("style");
    style.id = "ccf-scp-style";
    style.setAttribute(SAFE_ATTR, "1");
    style.textContent = `
      /* 본문 컨테이너를 우리 폭만큼 좁혀 화면을 밀어낸다. 클래스가 아니라 우리가
         붙인 표식으로만 거는다 — 코코포리아 클래스명은 빌드마다 바뀐다.
         !important 인 이유: 대상이 styled-components 로 폭을 직접 지정한다. */
      [${SQUEEZE_ATTR}] {
        width: var(--ccf-scp-content-width) !important;
        max-width: var(--ccf-scp-content-width) !important;
      }
      /* 상단바처럼 화면 전체를 가로지르는 막대는 폭이 아니라 오른쪽 여백으로 비운다.
         폭을 줄이면 왼쪽 정렬인 룸 제목까지 오른쪽으로 딸려 간다(v0.1.23 에서 그랬다). */
      [${INSET_ATTR}] {
        box-sizing: border-box !important;
        padding-right: var(--ccf-scp-inset, 0px) !important;
      }

      /* 구분선은 여기서 긋지 않는다. CSS 규칙으로는 무엇엔가 눌려 값이 0px 로 남았다
         (v0.1.27). 어느 화자 묶음의 마지막 줄인지는 그릴 때만 알 수 있기도 해서,
         renderList 에서 해당 줄에 직접 넣는다. */

      /* 색·글꼴·테두리는 네이티브 패널에서 읽어와 변수로 주입한다(syncTheme).
         하드코딩하면 테마 커스텀 기능을 쓸 때 혼자 다른 색이 된다. */
      #${PANEL_ID} {
        position: fixed; top: 0; height: 100%; width: 340px;
        display: flex; flex-direction: column; z-index: 1200;
        background: var(--scp-bg-image, none), var(--scp-bg, rgba(24,24,26,.96));
        -webkit-backdrop-filter: var(--scp-backdrop, none);
        backdrop-filter: var(--scp-backdrop, none);
        color: var(--scp-fg, #f0f0f0);
        border-left: 1px solid var(--scp-line, rgba(128,128,128,.32));
        box-shadow: var(--scp-shadow, none);
        font-family: var(--scp-font, system-ui, -apple-system, "Segoe UI", sans-serif);
        font-size: var(--scp-fontsize, 13px);
        line-height: 1.5;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      /* 아래 색들은 밝은 테마에서도 깨지지 않도록 글자색(currentColor) 기준으로만 만든다. */
      /* 헤더는 불투명하게 — 뒤에 있는 네이티브 접기(|<) 버튼이 딱 이 위치(패널 맨 위)에
         걸린다. 여기만 막으면 아래 메시지 영역은 반투명 질감을 그대로 유지한다.
         높이·글꼴·정렬은 네이티브 헤더에서 읽어 맞춘다(가운데 정렬 제목). */
      .ccf-scp-bar { display: flex; align-items: center; gap: 6px;
        padding: 0 var(--scp-header-padx, 12px);
        height: var(--scp-header-h, 48px); flex: 0 0 auto;
        background: var(--scp-header-bg, var(--scp-bg-opaque, rgba(24,24,26,1)));
        border-bottom: 1px solid var(--scp-line, rgba(128,128,128,.32)); }
      /* 제목은 네이티브처럼 막대 정중앙. 닫기 버튼이 오른쪽에 있어도 가운데를 유지하도록
         양옆에 같은 폭의 여백(스페이서)을 둔다. */
      .ccf-scp-title { flex: 1 1 auto; text-align: center;
        font-size: var(--scp-header-size, 15px); font-weight: var(--scp-header-weight, 500);
        color: var(--scp-header-color, inherit); letter-spacing: var(--scp-header-spacing, normal);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ccf-scp-spacer { flex: 0 0 32px; }
      .ccf-scp-close { flex: 0 0 32px; height: 32px; display: flex; align-items: center;
        justify-content: center; background: transparent; border: 0;
        color: var(--scp-close-color, #fff); cursor: pointer; padding: 0; border-radius: 50%; }
      .ccf-scp-close:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
      .ccf-scp-close svg { display: block; }
      /* 코코포리아 탭: 알약이 아니라 밑줄 표시 */
      /* 탭 바 — 네이티브처럼 위아래 구분선 없이 배경색만. */
      .ccf-scp-tabs { display: flex; gap: 0; padding: 0 8px; flex: 0 0 auto;
        background: var(--scp-tabs-bg, var(--scp-bg-opaque, #212121)); }
      /* 비활성 탭은 색이 아니라 opacity 로 흐려진다(네이티브 확인). 색·opacity 를
         둘 다 변수로 받아, MUI 가 어느 방식을 쓰든 그대로 재현한다. */
      .ccf-scp-tab { padding: var(--scp-tab-pad, 10px 14px); cursor: pointer; border: 0;
        background: transparent; border-bottom: 2px solid transparent;
        color: var(--scp-tab-idle, inherit); opacity: var(--scp-tab-idle-opacity, .65);
        font-family: inherit;
        font-size: var(--scp-tab-size, 13px); font-weight: var(--scp-tab-weight, 500);
        letter-spacing: var(--scp-tab-spacing, normal); min-width: 0; white-space: nowrap; }
      .ccf-scp-tab:hover { opacity: 1; }
      /* 선택 표시 색은 네이티브 인디케이터에서 읽는다 — 테마마다 다르다. */
      .ccf-scp-tab.is-active { color: var(--scp-tab-active, inherit); opacity: 1;
        border-bottom-color: var(--scp-tab-indicator, currentColor); }
      /* 목록의 좌우 여백을 0 으로 — 구분선이 패널 끝까지 이어져야 한다. 글자 들여쓰기는
         줄(MuiListItem-gutters) 자체의 좌우 패딩이 담당하므로 내용은 그대로 들여쓰인다. */
      .ccf-scp-list { flex: 1 1 auto; overflow-y: auto; padding: 10px 0;
        margin: 0; list-style: none; }
      .ccf-scp-text { margin: 0; }
      /* 네이티브 메시지 줄: 아이콘 열 + 본문 열.
         minmax(0,1fr) 이어야 긴 낱말이 있어도 본문 칸이 밀려나지 않는다. */
      .ccf-scp-row { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 8px;
        padding: 6px 0 2px; align-items: start; width: 100%; box-sizing: border-box; }

      /* 나레이션은 서식 스크립트가 전체 폭 가운데 정렬로 그린다. 아이콘·이름 칸을 그대로
         두면 본문이 좁은 칸으로 밀려 한 글자씩 세로로 찌그러진다(네이티브도 나레이션엔
         아이콘·이름을 안 띄운다) → 한 칸으로 펴고 아이콘·이름줄을 숨긴다. */
      /* 나레이션 표시는 렌더 루트에 붙기도 하고 줄(li) 자체에 붙기도 한다 — 둘 다 처리. */
      .ccf-scp-row:has(.ccf-render-root[data-ccf-narration="1"]),
      .ccf-scp-row[data-ccf-narration="1"],
      .ccf-scp-row:has([data-ccf-narration="1"]) {
        grid-template-columns: minmax(0, 1fr);
      }
      .ccf-scp-row:has(.ccf-render-root[data-ccf-narration="1"]) .ccf-scp-avatar,
      .ccf-scp-row:has(.ccf-render-root[data-ccf-narration="1"]) .ccf-scp-head,
      .ccf-scp-row[data-ccf-narration="1"] .ccf-scp-avatar,
      .ccf-scp-row[data-ccf-narration="1"] .ccf-scp-head,
      .ccf-scp-row:has([data-ccf-narration="1"]) .ccf-scp-avatar,
      .ccf-scp-row:has([data-ccf-narration="1"]) .ccf-scp-head {
        display: none;
      }
      .ccf-scp-row.is-cont { padding-top: 0; }
      .ccf-scp-avatar { width: 40px; height: 40px; }
      .ccf-scp-row.is-cont .ccf-scp-avatar { height: 0; }
      /* 네이티브 아바타는 원형이다 — 모서리만 살짝 둥근 형태면 잘린 사진처럼 보인다. */
      .ccf-scp-avatar img { width: 40px; height: 40px; border-radius: 50%;
        object-fit: cover; display: block; }
      .ccf-scp-body { min-width: 0; width: 100%; }
      .ccf-scp-head { display: flex; align-items: baseline; gap: 6px; margin-bottom: 2px; }
      .ccf-scp-name { font-weight: var(--scp-name-weight, 700); font-size: var(--scp-name-size, 12px);
        color: var(--scp-name-color, inherit); }
      .ccf-scp-time { font-size: 10px; opacity: .5; }
      .ccf-scp-text { white-space: pre-wrap; word-break: break-word;
        font-size: var(--scp-text-size, inherit); line-height: var(--scp-text-line, 1.5);
        color: var(--scp-text-color, inherit); }
      .ccf-scp-empty { opacity: .55; padding: 16px 4px; text-align: center; }
      /* 하단은 헤더처럼 불투명. 패딩 0 — 각 섹션(이름 바/주사위/입력)이 네이티브처럼
         패널 폭을 꽉 채우고 자체 좌우 인셋(8px)을 가진다. */
      .ccf-scp-compose { flex: 0 0 auto; padding: 0 0 10px;
        background: var(--scp-bg-opaque, rgba(24,24,26,1)); }
      .ccf-scp-dice { padding-left: 8px; padding-right: 8px; }
      .ccf-scp-input { width: calc(100% - 16px); margin: 0 8px; }
      .ccf-scp-actions { padding-left: 8px; padding-right: 8px; }
      .ccf-scp-status { padding-left: 8px; padding-right: 8px; }
      /* 화자 선택 바 */
      /* 네이티브 캐릭터 이름 바: padding 8, 내용 359×40, 패널 폭 꽉 참(compose 패딩 0). */
      .ccf-scp-speaker { position: relative; display: flex; align-items: center; gap: 8px;
        padding: 8px; margin: 0; background: transparent; }
      /* 아바타+이름 필드 — 네이티브 입력칸처럼 어두운 바탕(#202020). ponytail: 색 고정,
         테마 달라지면 네이티브 입력칸에서 읽어 var 로 뺄 것. */
      /* 아바타(분리, 배경 없음) + 이름칸(#202020, 각짐, 높이 32/패딩 4). */
      .ccf-scp-sp-group { position: relative; display: flex; align-items: center; gap: 0;
        flex: 1 1 auto; min-width: 0; cursor: pointer; }
      .ccf-scp-sp-avatar { width: 40px; height: 40px; border-radius: 0; object-fit: cover;
        background: transparent; flex: 0 0 auto; }
      .ccf-scp-sp-field { display: flex; align-items: center; flex: 1 1 auto; min-width: 0;
        height: 40px; padding: 4px; box-sizing: border-box; background: #202020; }
      .ccf-scp-sp-name { font-size: 16px; opacity: .95; flex: 1 1 auto;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ccf-scp-sp-tools { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
      /* 툴 버튼 — 호버 원형 #393939(흰 8%), 툴팁은 아래. */
      .ccf-scp-sp-tool { position: relative; width: 32px; height: 32px; border: 0; cursor: pointer;
        background: transparent; color: inherit; opacity: .8; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; padding: 4px; line-height: 1; }
      .ccf-scp-sp-tool:hover { opacity: 1; background: color-mix(in srgb, currentColor 8%, transparent); }
      .ccf-scp-sp-tool svg { width: 24px; height: 24px; display: block; }
      /* 툴팁 — 좁게, 더 아래로, 호버 후 약간의 지연 뒤 부드럽게 나타남. */
      .ccf-scp-sp-tool[data-tip]::after { content: attr(data-tip); position: absolute;
        top: 100%; left: 50%; transform: translateX(-50%); margin-top: 14px;
        background: #000; color: #fff; font-size: 12px; padding: 5px 8px; border-radius: 4px;
        white-space: nowrap; pointer-events: none; z-index: 20;
        opacity: 0; transition: opacity .18s ease; }
      .ccf-scp-sp-tool[data-tip]:hover::after { opacity: 1; transition-delay: .1s; }
      /* 색상 피커 — 화면(룸) 정중앙. 배경은 네이티브 고정색(테마 무관). */
      .ccf-scp-colorpop { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
        z-index: 2147483000; background: rgba(44, 44, 44, 0.87);
        border-radius: 8px; box-shadow: 0 8px 40px rgba(0,0,0,.5); padding: 15px 9px 9px 15px; }
      .ccf-scp-colorpop[hidden] { display: none; }
      .ccf-scp-swatch-grid { display: grid; grid-template-columns: repeat(7, 30px); gap: 6px; }
      .ccf-scp-swatch { width: 30px; height: 30px; border: 0; border-radius: 4px; cursor: pointer;
        padding: 0; }
      .ccf-scp-swatch:hover { outline: 2px solid #fff; outline-offset: 1px; }
      .ccf-scp-hexrow { display: flex; align-items: stretch; margin-top: 6px; width: 246px;
        border-radius: 4px; overflow: hidden; }
      .ccf-scp-hexrow span { display: flex; align-items: center; justify-content: center;
        width: 30px; background: #f0f0f0; color: #98a1a4; font-size: 14px; }
      .ccf-scp-hexinput { flex: 1 1 auto; border: 0; outline: none; height: 30px;
        box-shadow: #f0f0f0 0 0 0 1px inset; color: #666; font-size: 14px; min-width: 0;
        padding-left: 8px; }
      /* 채팅 팔레트 — 네이티브처럼 페이지 정중앙 플로팅 다이얼로그(반투명 어두운 배경). */
      .ccf-scp-palette { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
        width: 320px; z-index: 2147483000; display: flex; flex-direction: column;
        background: rgba(44,44,44,.87); border-radius: 0;
        box-shadow: 0 8px 40px rgba(0,0,0,.5); overflow: hidden; }
      /* display:flex 가 [hidden] 의 display:none 을 덮어써 항상 뜨는 문제 방지. */
      .ccf-scp-palette[hidden] { display: none; }
      /* 헤더는 드래그 손잡이 — 마우스로 팝업을 옮긴다. 제목 좌측 여백 24, 높이 48. */
      .ccf-scp-palette-head { display: flex; align-items: center; gap: 4px;
        min-height: 48px; padding: 0 12px 0 24px; font-size: 14px; font-weight: 700;
        flex: 0 0 auto; cursor: move; user-select: none; }
      .ccf-scp-palette-head > span { flex: 1 1 auto; }
      .ccf-scp-palette-edit, .ccf-scp-palette-close { display: flex; align-items: center;
        justify-content: center; width: 30px; height: 30px; border: 0; background: transparent;
        color: inherit; cursor: pointer; border-radius: 50%; opacity: .8; }
      .ccf-scp-palette-edit:hover, .ccf-scp-palette-close:hover { opacity: 1;
        background: color-mix(in srgb, currentColor 14%, transparent); }
      /* 네이티브 DialogContent 320×232 + 리스트 상하 8px 패딩. */
      .ccf-scp-palette-body { height: 232px; overflow-y: auto; padding: 8px 0; box-sizing: border-box; }
      /* 커맨드 한 줄 — 박스모델: 내용 272×48, 좌우 패딩 24, 상하 0. */
      .ccf-scp-cmditem { min-height: 48px; padding: 0 24px; border-radius: 0; }
      .ccf-scp-cmditem { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      /* 스크롤 없이 캐릭터 수만큼 높이가 늘어난다(위로 자라남). */
      .ccf-scp-charlist { position: absolute; left: 0; bottom: 100%; margin-bottom: 4px;
        z-index: 5; overflow: hidden; min-width: 200px;
        background: rgba(44,44,44,.87); border: 0; border-radius: 6px; padding: 0;
        box-shadow: 0 4px 16px rgba(0,0,0,.5); }
      .ccf-scp-charitem { display: flex; align-items: center; gap: 12px; width: 100%;
        padding: 8px 12px; border: 0; background: transparent; color: inherit; cursor: pointer;
        border-radius: 0; font: inherit; text-align: left; }
      .ccf-scp-charitem:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
      .ccf-scp-charitem img, .ccf-scp-charitem-noicon { width: 40px; height: 40px;
        border-radius: 50%; object-fit: cover; flex: 0 0 auto;
        background: color-mix(in srgb, currentColor 12%, transparent); }
      .ccf-scp-charitem-col { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
      .ccf-scp-charitem-name { font-size: 14px; font-weight: 400;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ccf-scp-charitem-status { font-size: 14px; color: rgba(255,255,255,.7); }
      .ccf-scp-charlist-empty { padding: 8px; opacity: .6; font-size: 12px; }
      /* 주사위 버튼 줄 — 아이콘 사이 간격 좁게, 전송 버튼은 오른쪽 끝. */
      .ccf-scp-dice { display: flex; flex-wrap: nowrap; align-items: center; gap: 0;
        margin-bottom: 8px; }
      .ccf-scp-dice .ccf-scp-send { margin-left: auto; }
      .ccf-scp-die { padding: 3px 8px; border-radius: 5px; cursor: pointer; font: inherit;
        font-size: 12px; color: inherit;
        border: 1px solid var(--scp-line, rgba(128,128,128,.32));
        background: color-mix(in srgb, currentColor 6%, transparent); }
      .ccf-scp-die:hover { background: color-mix(in srgb, currentColor 16%, transparent); }
      /* 아이콘 버튼: 네이티브처럼 배경·테두리 없이 아이콘만, 호버는 원형(#393939≈흰 8%). */
      .ccf-scp-die-icon { padding: 4px; width: 34px; height: 34px; display: flex;
        align-items: center; justify-content: center;
        background: transparent; border: 0; border-radius: 50%; opacity: .85; }
      .ccf-scp-die-icon:hover { opacity: 1;
        background: color-mix(in srgb, currentColor 8%, transparent); }
      .ccf-scp-die-icon svg { width: 24px; height: 24px; display: block; }
      .ccf-scp-input { width: 100%; min-height: 60px; resize: vertical; border-radius: 6px;
        border: 1px solid var(--scp-line, rgba(128,128,128,.32));
        background: color-mix(in srgb, currentColor 6%, transparent); color: inherit;
        padding: 8px 10px; font: inherit; line-height: 1.5; }
      .ccf-scp-input:focus { outline: none;
        border-color: var(--scp-send-bg, #2196f3); }
      .ccf-scp-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
      .ccf-scp-hint { font-size: 11px; opacity: .5; margin-right: auto; }
      .ccf-scp-send { padding: 6px 18px; border-radius: var(--scp-send-radius, 6px); border: 0;
        cursor: pointer; background: var(--scp-send-bg, #2196f3);
        color: var(--scp-send-color, #fff); font-weight: 700; font-size: 13px; }
      .ccf-scp-send:hover { filter: brightness(1.08); }
      .ccf-scp-status { font-size: 11px; margin-top: 4px; min-height: 14px; opacity: .7; }
      .ccf-scp-status.is-error { color: #ff8a8a; opacity: 1; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function openPanel() {
    if (panelEl) return;
    injectStyle();
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.setAttribute(SAFE_ATTR, "1");

    const bar = document.createElement("div");
    bar.className = "ccf-scp-bar";
    // 왼쪽 스페이서 — 오른쪽 닫기 버튼과 폭을 맞춰 제목이 정중앙에 오게 한다.
    const spacer = document.createElement("span");
    spacer.className = "ccf-scp-spacer";
    bar.appendChild(spacer);
    const title = document.createElement("span");
    title.className = "ccf-scp-title";
    // 추후 패널을 더 띄우면 #2, #3… 이 되도록 번호를 붙인다(지금은 1개라 #1).
    title.textContent = `룸 채팅 #${PANEL_INDEX}`;
    bar.appendChild(title);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ccf-scp-close";
    close.setAttribute("aria-label", "닫기");
    // 코코포리아 설정 버튼과 비슷한 크기의 굵은 X 아이콘(선 두께 2.6).
    close.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/></svg>';
    close.title = "닫기";
    close.addEventListener("click", closePanel);
    bar.appendChild(close);
    panel.appendChild(bar);

    listEl = document.createElement("ul");
    listEl.className = "ccf-scp-list";
    listEl.addEventListener("scroll", () => {
      // 우리가 프로그램적으로 내린 스크롤은 무시한다. 안 그러면 높이가 아직 안 찬
      // 순간의 스크롤 이벤트가 "바닥 아님"으로 오판해 고정을 풀어 버린다(시작 시 튐).
      if (suppressScrollEval) return;
      const gap = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
      pinnedToBottom = gap < 40;
    });
    panel.appendChild(listEl);

    // 탭은 코코포리아처럼 메시지 목록과 입력창 사이에 둔다.
    tabsEl = document.createElement("div");
    tabsEl.className = "ccf-scp-tabs";
    panel.appendChild(tabsEl);

    const compose = document.createElement("div");
    compose.className = "ccf-scp-compose";

    // 화자 선택 바 — 아바타 + 이름. 클릭하면 캐릭터 목록. 고르면 전송이 그 화자로 나감.
    const speaker = document.createElement("div");
    speaker.className = "ccf-scp-speaker";
    const spAvatar = document.createElement("img");
    spAvatar.className = "ccf-scp-sp-avatar";
    spAvatar.alt = "";
    const spName = document.createElement("span");
    spName.className = "ccf-scp-sp-name";
    const charList = document.createElement("div");
    charList.className = "ccf-scp-charlist";
    charList.hidden = true;

    // 오른쪽 컨트롤: 채팅 팔레트(커맨드) + 색상.
    const spTools = document.createElement("div");
    spTools.className = "ccf-scp-sp-tools";
    const paletteBtn = document.createElement("button");
    paletteBtn.type = "button";
    paletteBtn.className = "ccf-scp-sp-tool";
    paletteBtn.dataset.tip = "채팅 팔레트";
    // 아이콘은 네이티브에서 복제(이름 바의 1번째 아이콘 = 채팅 팔레트). MUI Palette 는
    // 사실 색상 버튼 아이콘이라, 이전엔 팔레트에 잘못 썼다. 늦게 준비되면 tick 에서 재시도.
    const spIcons = captureNativeSpeakerIcons();
    if (spIcons.palette) { paletteBtn.appendChild(spIcons.palette.cloneNode(true)); paletteBtn.dataset.cloned = "1"; }
    else paletteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><circle cx="4" cy="6" r="1.6"/><circle cx="4" cy="12" r="1.6"/><circle cx="4" cy="18" r="1.6"/><rect x="8" y="5" width="12" height="2"/><rect x="8" y="11" width="12" height="2"/><rect x="8" y="17" width="12" height="2"/></svg>';
    speakerPaletteBtn = paletteBtn;
    const paletteList = document.createElement("div");
    paletteList.className = "ccf-scp-palette";
    paletteList.hidden = true;
    let palDrag = null; // 드래그 중이면 {dx,dy}

    // 색상: 네이티브 색상 아이콘(이름 바의 2번째 = MUI Palette) + 스와치 그리드 팝업.
    // 아이콘은 현재 색으로 tint 해서 지금 색을 보여준다.
    const colorBtn = document.createElement("button");
    colorBtn.type = "button";
    colorBtn.className = "ccf-scp-sp-tool ccf-scp-color-btn";
    colorBtn.dataset.tip = "캐릭터 색상 변경";
    if (spIcons.color) { colorBtn.appendChild(spIcons.color.cloneNode(true)); colorBtn.dataset.cloned = "1"; }
    else colorBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>';
    speakerColorBtn = colorBtn;
    const colorPop = document.createElement("div");
    colorPop.className = "ccf-scp-colorpop";
    colorPop.hidden = true;
    // colorPop 은 패널에 붙인다 — colorBtn(<button>) 안에 넣으면 스와치 <button> 들이
    // 버튼 중첩(잘못된 HTML)이 돼 렌더/클릭이 깨진다.

    const setColor = (hex) => {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
      colorOverride = hex;
      colorBtn.style.color = hex; // 아이콘을 현재 색으로 물들여 지금 색을 표시
    };
    const SWATCHES = [
      "#222222", "#f44336", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5", "#2196f3",
      "#03a9f4", "#00bcd4", "#009688", "#4caf50", "#8bc34a", "#cddc39", "#ffeb3b",
      "#ffc107", "#ff9800", "#ff5722", "#795548", "#607d8b", "#9e9e9e", "#e0e0e0"
    ];
    const grid = document.createElement("div");
    grid.className = "ccf-scp-swatch-grid";
    for (const hex of SWATCHES) {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "ccf-scp-swatch";
      sw.style.background = hex;
      sw.title = hex;
      sw.addEventListener("click", (e) => { e.stopPropagation(); setColor(hex); colorPop.hidden = true; });
      grid.appendChild(sw);
    }
    const hexRow = document.createElement("div");
    hexRow.className = "ccf-scp-hexrow";
    const hexHash = document.createElement("span");
    hexHash.textContent = "#";
    const hexInput = document.createElement("input");
    hexInput.type = "text";
    hexInput.maxLength = 6;
    hexInput.className = "ccf-scp-hexinput";
    hexInput.addEventListener("click", (e) => e.stopPropagation());
    hexInput.addEventListener("input", () => { const v = "#" + hexInput.value.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) setColor(v); });
    hexRow.appendChild(hexHash);
    hexRow.appendChild(hexInput);
    colorPop.appendChild(grid);
    colorPop.appendChild(hexRow);
    colorBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (colorPop.hidden) { hexInput.value = (colorOverride || selectedChar?.color || "#888888").replace("#", ""); colorPop.hidden = false; }
      else colorPop.hidden = true;
    });

    // 도움말("채팅 커맨드에 대해") — 아이콘 복제 + 클릭 시 네이티브 도움말 버튼을 눌러
    // 코코포리아가 여는 안내를 그대로 띄운다(기능 재구현 대신 원본 재사용).
    const helpBtn = document.createElement("button");
    helpBtn.type = "button";
    helpBtn.className = "ccf-scp-sp-tool";
    helpBtn.dataset.tip = "채팅 커맨드에 대해";
    if (spIcons.help) { helpBtn.appendChild(spIcons.help.cloneNode(true)); helpBtn.dataset.cloned = "1"; }
    else helpBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>';
    speakerHelpBtn = helpBtn;
    helpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nb = captureNativeSpeakerIcons().helpBtn;
      if (nb) nb.click();
    });

    spTools.appendChild(paletteBtn);
    spTools.appendChild(colorBtn);
    spTools.appendChild(helpBtn);

    const buildPalette = () => {
      paletteList.textContent = "";
      const head = document.createElement("div");
      head.className = "ccf-scp-palette-head";
      const htitle = document.createElement("span");
      htitle.textContent = "채팅 팔레트";
      // 편집(✏) — 네이티브 팔레트 편집을 위해 네이티브 팔레트 버튼을 연다.
      const hedit = document.createElement("button");
      hedit.type = "button";
      hedit.className = "ccf-scp-palette-edit";
      hedit.title = "편집";
      hedit.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
      hedit.addEventListener("click", (e) => { e.stopPropagation(); paletteList.hidden = true; captureNativeSpeakerIcons().paletteBtnEl?.click(); });
      const hclose = document.createElement("button");
      hclose.type = "button";
      hclose.className = "ccf-scp-palette-close";
      hclose.setAttribute("aria-label", "닫기");
      hclose.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
      hclose.addEventListener("click", (e) => { e.stopPropagation(); paletteList.hidden = true; });
      // 헤더를 잡고 드래그하면 팝업이 따라온다(버튼 위는 제외).
      head.addEventListener("mousedown", (e) => {
        if (e.target.closest("button")) return;
        const r = paletteList.getBoundingClientRect();
        paletteList.style.transform = "none";
        paletteList.style.left = `${r.left}px`;
        paletteList.style.top = `${r.top}px`;
        palDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        e.preventDefault();
      });
      head.appendChild(htitle);
      head.appendChild(hedit);
      head.appendChild(hclose);
      paletteList.appendChild(head);
      const body = document.createElement("div");
      body.className = "ccf-scp-palette-body";
      paletteList.appendChild(body);
      const cmds = String(selectedChar?.commands || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!cmds.length) {
        const e = document.createElement("div");
        e.className = "ccf-scp-charlist-empty";
        e.textContent = selectedChar ? "커맨드가 없습니다." : "먼저 화자를 고르세요.";
        body.appendChild(e);
        return;
      }
      for (const cmd of cmds) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "ccf-scp-charitem ccf-scp-cmditem";
        item.textContent = cmd;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          // 커맨드를 입력창에 넣되 팝업은 그대로 둔다(연속으로 고를 수 있게).
          if (inputEl) { inputEl.value = cmd; inputEl.focus(); }
        });
        body.appendChild(item);
      }
    };
    paletteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (paletteList.hidden) { buildPalette(); paletteList.hidden = false; }
      else paletteList.hidden = true;
    });

    const renderSpeaker = () => {
      spName.textContent = selectedChar ? selectedChar.name : "캐릭터 선택";
      if (selectedChar && selectedChar.icon) { spAvatar.src = selectedChar.icon; spAvatar.style.visibility = ""; }
      else spAvatar.style.visibility = "hidden";
      colorOverride = "";
      colorBtn.style.color = /^#[0-9a-f]{6}$/i.test(selectedChar?.color || "") ? selectedChar.color : "";
    };
    let charListSig = ""; // 열린 목록의 캐릭터 구성 서명(변화 감지용)
    const buildCharList = () => {
      charList.textContent = "";
      const chars = readCharacters();
      charListSig = chars.map((c) => c.id + (c.active ? "1" : "0")).join(",");
      if (!chars.length) {
        const e = document.createElement("div");
        e.className = "ccf-scp-charlist-empty";
        e.textContent = "이 룸에 캐릭터가 없습니다.";
        charList.appendChild(e);
        return;
      }
      for (const c of chars) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "ccf-scp-charitem";
        if (c.icon) {
          const img = document.createElement("img");
          img.src = c.icon; img.alt = "";
          item.appendChild(img);
        } else {
          const sp = document.createElement("span");
          sp.className = "ccf-scp-charitem-noicon";
          item.appendChild(sp);
        }
        // 네이티브처럼 이름(굵게) + 상태 부제.
        const col = document.createElement("span");
        col.className = "ccf-scp-charitem-col";
        const nm = document.createElement("span");
        nm.className = "ccf-scp-charitem-name";
        nm.textContent = c.name;
        const st = document.createElement("span");
        st.className = "ccf-scp-charitem-status";
        st.textContent = c.active ? "활성화 상태" : "비활성화 상태";
        col.appendChild(nm);
        col.appendChild(st);
        item.appendChild(col);
        item.addEventListener("click", () => {
          selectedChar = c;
          charList.hidden = true;
          renderSpeaker();
          savePrefs(); // 마지막 화자를 기억한다(재열기·새로고침 시 복원).
          inputEl?.focus();
        });
        charList.appendChild(item);
      }
    };
    // 아바타(분리, 배경 없음) + 이름칸(#202020). 묶어서 클릭하면 캐릭터 목록.
    const field = document.createElement("div");
    field.className = "ccf-scp-sp-field";
    field.appendChild(spName);
    const nameGroup = document.createElement("div");
    nameGroup.className = "ccf-scp-sp-group";
    nameGroup.appendChild(spAvatar);
    nameGroup.appendChild(field);
    nameGroup.appendChild(charList);
    nameGroup.addEventListener("click", (e) => {
      if (e.target.closest(".ccf-scp-charlist")) return;
      if (charList.hidden) { buildCharList(); charList.hidden = false; }
      else charList.hidden = true;
    });
    speaker.appendChild(nameGroup);
    speaker.appendChild(spTools);
    renderSpeaker();
    // 마지막으로 골랐던 화자를 복원한다(id 로 이 룸에서 다시 찾는다 — 없으면 그대로 기본).
    // 저장소가 늦게 로드될 수 있어 몇 차례 재시도.
    const restoreSpeaker = () => {
      if (selectedChar) return;
      const savedId = readPrefs().selectedCharId;
      if (!savedId) return;
      const c = readCharacters().find((x) => x.id === savedId);
      if (c) { selectedChar = c; renderSpeaker(); }
    };
    restoreSpeaker();
    [300, 800, 1500].forEach((ms) => window.setTimeout(() => { if (panelEl) restoreSpeaker(); }, ms));
    compose.appendChild(speaker);
    // 팔레트·색상 팝업은 패널 최상위에 붙인다(버튼 중첩 방지 + 겹침 관리).
    panel.appendChild(paletteList);
    panel.appendChild(colorPop);

    // 주사위 버튼 줄 — 누르면 커서 위치에 해당 명령을 넣는다. 아이콘은 네이티브
    // 주사위 버튼에서 복제해 쓰고, 못 찾으면 텍스트로 대체한다.
    const diceRow = document.createElement("div");
    diceRow.className = "ccf-scp-dice";
    const nativeIcons = captureNativeDiceIcons();
    const dice = [4, 6, 8, 10, 12, 20, 100];
    for (const faces of dice) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ccf-scp-die";
      const icon = nativeIcons.get(faces);
      if (icon) {
        b.classList.add("ccf-scp-die-icon");
        b.appendChild(icon.cloneNode(true));
        b.title = `1d${faces}`;
        b.setAttribute("aria-label", `1d${faces}`);
      } else {
        b.textContent = `1d${faces}`;
      }
      b.addEventListener("click", () => insertAtCursor(`1d${faces}`));
      diceRow.appendChild(b);
    }
    // 전송 버튼 — 네이티브처럼 주사위 바 오른쪽 끝에 둔다.
    const send = document.createElement("button");
    send.type = "button";
    send.className = "ccf-scp-send";
    send.textContent = "전송";
    send.addEventListener("click", handleSend);
    diceRow.appendChild(send);
    compose.appendChild(diceRow);

    inputEl = document.createElement("textarea");
    inputEl.className = "ccf-scp-input";
    inputEl.placeholder = "메시지 입력 (Enter 전송 / Shift+Enter 줄바꿈)";
    // 다른 스크립트가 이 입력창을 채팅 입력창으로 오인해 가공하지 않도록 표시.
    inputEl.setAttribute(SAFE_ATTR, "1");
    inputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      handleSend();
    });
    compose.appendChild(inputEl);

    const actions = document.createElement("div");
    actions.className = "ccf-scp-actions";
    const hint = document.createElement("span");
    hint.className = "ccf-scp-hint";
    hint.textContent = "선택한 탭으로 전송됩니다";
    actions.appendChild(hint);
    compose.appendChild(actions);

    statusEl = document.createElement("div");
    statusEl.className = "ccf-scp-status";
    compose.appendChild(statusEl);
    panel.appendChild(compose);

    document.body.appendChild(panel);
    panelEl = panel;

    // 팝업(캐릭터 목록·팔레트·색상) 바깥을 클릭하면 닫는다. 각 팝업의 여는 버튼은
    // stopPropagation 하거나 자기 영역 안이라 이 검사에서 제외된다.
    // 팔레트는 X 로만 닫는다(바깥 클릭으로 안 닫음). 목록·색상만 바깥 클릭 닫기.
    onDocClickHandler = (e) => {
      if (!charList.hidden && !e.target.closest(".ccf-scp-sp-group") && !e.target.closest(".ccf-scp-charlist")) charList.hidden = true;
      if (!colorPop.hidden && !e.target.closest(".ccf-scp-colorpop") && !colorBtn.contains(e.target)) colorPop.hidden = true;
    };
    document.addEventListener("click", onDocClickHandler);

    // 팔레트 드래그 이동(헤더 mousedown 에서 palDrag 설정).
    onDocDragMove = (e) => {
      if (!palDrag) return;
      paletteList.style.left = `${e.clientX - palDrag.dx}px`;
      paletteList.style.top = `${e.clientY - palDrag.dy}px`;
    };
    onDocDragUp = () => { palDrag = null; };
    document.addEventListener("mousemove", onDocDragMove);
    document.addEventListener("mouseup", onDocDragUp);

    lastSignature = null;
    // 배치가 실패해도 메시지는 보여야 한다 — 예전에 layoutPanel 의 예외가
    // 뒤따르는 renderTabs/renderList 까지 통째로 막아 빈 패널이 떴다.
    safeLayout();
    renderTabs();
    renderList();
    subscribeStore();
    // 처음 열 때는 바닥에서 시작해야 한다. 초기 렌더 직후엔 아바타·본보기가 아직
    // 안 잡혀 높이가 확정 안 되므로, 몇 차례 더 바닥으로 맞춘다(그 사이 위로 올리면 멈춤).
    pinnedToBottom = true;
    [80, 250, 500, 900].forEach((ms) => window.setTimeout(() => {
      if (panelEl && listEl && pinnedToBottom) scrollListToBottom();
    }, ms));
    // 네이티브 패널이 열리고 닫히거나 창 크기가 바뀌면 위치를 다시 맞춘다.
    window.addEventListener("resize", safeLayout);
    // 저장소 변화가 없어도 주기적으로 다시 그린다. 구독만 믿으면, 패널을 연 시점에
    // 아직 메시지가 안 실렸고 그 뒤로 방이 조용하면 영영 빈 화면으로 남는다.
    layoutTimer = window.setInterval(() => {
      safeLayout();
      // 본보기를 아직 못 잡았으면(룸 채팅이 닫혀 있었다 등) 계속 시도한다.
      if (!ccfScpRowTemplate) {
        captureNativeRowTemplate();
        if (ccfScpRowTemplate) lastSignature = null;   // 잡히면 그 모양으로 다시 그린다
      }
      // 팔레트·색상 아이콘을 아직 못 복제했으면(컴포저가 늦게 준비됨) 다시 시도.
      if ((speakerPaletteBtn && !speakerPaletteBtn.dataset.cloned)
          || (speakerColorBtn && !speakerColorBtn.dataset.cloned)
          || (speakerHelpBtn && !speakerHelpBtn.dataset.cloned)) {
        const ic = captureNativeSpeakerIcons();
        const put = (btn, svg) => {
          if (svg && btn && !btn.dataset.cloned) {
            btn.textContent = ""; btn.appendChild(svg.cloneNode(true)); btn.dataset.cloned = "1";
          }
        };
        put(speakerPaletteBtn, ic.palette);
        put(speakerColorBtn, ic.color);
        put(speakerHelpBtn, ic.help);
      }
      // 캐릭터 목록이 열려 있는 동안 캐릭터가 추가·삭제·활성변경되면 즉시 다시 그린다.
      if (charList && !charList.hidden) {
        const sig = readCharacters().map((c) => c.id + (c.active ? "1" : "0")).join(",");
        if (sig !== charListSig) { charListSig = sig; buildCharList(); }
      }
      renderTabs();
      renderList();
    }, 500);
    savePrefs();
  }

  function closePanel() {
    unsubscribeStore();
    window.removeEventListener("resize", safeLayout);
    if (onDocClickHandler) { document.removeEventListener("click", onDocClickHandler); onDocClickHandler = null; }
    if (onDocDragMove) { document.removeEventListener("mousemove", onDocDragMove); onDocDragMove = null; }
    if (onDocDragUp) { document.removeEventListener("mouseup", onDocDragUp); onDocDragUp = null; }
    if (layoutTimer) { window.clearInterval(layoutTimer); layoutTimer = 0; }
    clearNativeShift();
    // 밀어낸 화면은 반드시 되돌린다. 남으면 패널이 없는데 지도만 좁아진 채로 남는다.
    clearSqueeze();
    try { window.dispatchEvent(new Event("resize")); } catch (e) { /* noop */ }
    ccfScpRowTemplate = null;
    ccfScpListClass = "";
    ccfScpRowDivider = "";
    ccfScpInnerUl = null;
    // selectedChar 는 닫아도 유지한다(같은 룸 재열기 시 화자 유지). 여기서 null 로
    // 지운 뒤 savePrefs 가 돌면 저장된 화자 id 까지 빈값으로 덮여 복원이 깨진다.
    speakerPaletteBtn = null;
    speakerColorBtn = null;
    speakerHelpBtn = null;
    panelEl?.remove();
    panelEl = null; listEl = null; tabsEl = null; inputEl = null; statusEl = null;
    savePrefs();
  }

  function togglePanel() {
    if (panelEl) closePanel(); else openPanel();
  }

  /* ---------------- 갱신 ---------------- */

  let renderQueued = false;
  function queueRender() {
    if (renderQueued || !panelEl) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      if (!panelEl) return;
      renderTabs();
      renderList();
    });
  }

  function subscribeStore() {
    unsubscribeStore();
    const store = findStore();
    if (!store) {
      // 아직 준비 전이면 잠시 후 다시 시도.
      window.setTimeout(() => { if (panelEl) subscribeStore(); }, 800);
      return;
    }
    unsubscribe = store.subscribe(queueRender);
  }

  function unsubscribeStore() {
    if (typeof unsubscribe === "function") {
      try { unsubscribe(); } catch (error) { /* 해제 실패 무시 */ }
    }
    unsubscribe = null;
  }

  /* ---------------- 실행 ---------------- */

  /* ---------------- 네이티브 패널에 맞추기 ---------------- */

  // 룸 채팅 패널(드로어)을 찾는다. 채팅 메시지가 들어 있는 목록의 조상 중
  // 드로어/페이퍼가 곧 패널이다. 우리 패널은 당연히 제외한다.
  function findChatAnchor() {
    const item = [...document.querySelectorAll(".MuiListItem-root")]
      .find((li) => li instanceof HTMLElement
        && li.querySelector("h6.MuiListItemText-primary")
        && li.offsetParent !== null
        && !li.closest(".MuiPopover-root, .MuiMenu-root, .MuiDialog-root")
        && !li.closest(`#${PANEL_ID}`));
    if (item) return item;
    return [...document.querySelectorAll('[role="log"]')]
      .find((el) => el instanceof HTMLElement && isVisible(el) && !el.closest(`#${PANEL_ID}`)) || null;
  }

  function findNativeChatPanel() {
    const anchor = findChatAnchor();
    if (!anchor) return null;

    const drawer = anchor.closest(".MuiDrawer-paper");
    if (drawer instanceof HTMLElement && isVisible(drawer)) return drawer;

    // 드로어가 없으면 조상을 훑어 "사이드 패널 크기"인 가장 바깥 요소를 고른다.
    // .MuiPaper-root 를 그냥 closest 로 잡으면 화면 전체를 덮는 컨테이너가 걸려
    // 위치(우측 여백 0)와 색을 둘 다 엉뚱하게 가져온다.
    let best = null;
    for (let el = anchor; el && el !== document.body; el = el.parentElement) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 200) continue;
      if (rect.width > window.innerWidth * 0.7) break; // 여기부턴 패널이 아니라 컨테이너
      best = el;
    }
    return best;
  }

  // 반투명한 배경을 그대로 쓰면 뒤에 있는 코코포리아 UI(패널 접기 "|<" 버튼 등)가
  // 비쳐 보인다. 페이지 바탕색 위에 미리 겹쳐 같은 색의 불투명한 값으로 만든다.
  function toOpaqueColor(color, backdrop) {
    const nums = (value) => {
      const found = String(value || "").match(/[\d.]+/g);
      return found ? found.map(Number) : null;
    };
    const front = nums(color);
    if (!front || front.length < 3) return color;
    const alpha = front.length > 3 ? front[3] : 1;
    if (alpha >= 1) return color;
    const back = nums(backdrop) || [24, 24, 26];
    const mix = (i) => Math.round(front[i] * alpha + (back[i] ?? 24) * (1 - alpha));
    return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
  }

  // 네이티브 채팅 패널의 헤더 막대와 제목을 찾는다. 제목 텍스트는 로케일마다 다르므로
  // 글자가 아니라 "패널 맨 위에 있는, 폭이 거의 꽉 찬 낮은 막대"로 찾는다.
  function findNativeChatHeader(native) {
    if (!native) return null;
    const panelRect = native.getBoundingClientRect();
    let bar = null;
    let level = [...native.children];
    for (let depth = 0; depth <= 3 && level.length && !bar; depth += 1) {
      const next = [];
      for (const el of level) {
        if (!(el instanceof HTMLElement)) continue;
        const r = el.getBoundingClientRect();
        const atTop = Math.abs(r.top - panelRect.top) <= 6;
        const wide = r.width >= panelRect.width * 0.8;
        if (atTop && wide && r.height >= 36 && r.height <= 96) { bar = el; break; }
        next.push(...el.children);
      }
      level = next;
    }
    if (!bar) return null;
    // 제목: 막대 안에서 글자가 있는 가장 큰 글씨(보통 h6). 아이콘 버튼은 글자가 없다.
    let title = null;
    let best = 0;
    for (const el of bar.querySelectorAll("*")) {
      const text = normalizeSpace(el.textContent || "");
      if (!text || text.length > 24 || el.children.length > 1) continue;
      const size = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (size > best) { best = size; title = el; }
    }
    return { bar, title };
  }

  // 색·글꼴을 네이티브에서 그대로 읽어온다. 하드코딩하면 테마 커스텀 기능과 어긋난다.
  function syncTheme(native) {
    if (!panelEl) return;
    const cs = native ? getComputedStyle(native) : null;
    const set = (key, value) => { if (value) panelEl.style.setProperty(key, value); };
    if (!cs) return;
    // 배경이 투명이면 조상에서 실제 색을 찾아 올라간다.
    let bg = cs.backgroundColor;
    for (let el = native.parentElement; el && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg); el = el.parentElement) {
      bg = getComputedStyle(el).backgroundColor;
    }
    const pageBg = getComputedStyle(document.body).backgroundColor;
    // 원본의 "질감"은 이 반투명(alpha<1) 자체다 — 배경 이미지도 블러도 없다(bgDiag 확인).
    // 반투명을 그대로 쓰면 원본처럼 보이지만 뒤의 |< 가 살짝 비친다. opaqueBg 를 켜면
    // 페이지 바탕색 위에 겹쳐 불투명하게 만들어 |< 를 가린다(질감은 평평해진다).
    const opaque = toOpaqueColor(bg, pageBg);
    set("--scp-bg", opaqueBg ? opaque : bg);
    // 헤더는 토글과 무관하게 항상 불투명(|< 가림). 나머지는 opaqueBg 를 따른다.
    set("--scp-bg-opaque", opaque);
    // 원본 패널의 질감(그라데이션·블러)까지 얹는다(있을 때만). 반투명 배경 위에 겹친다.
    set("--scp-bg-image", cs.backgroundImage && cs.backgroundImage !== "none" ? cs.backgroundImage : "");
    const blur = cs.backdropFilter && cs.backdropFilter !== "none"
      ? cs.backdropFilter
      : (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== "none" ? cs.webkitBackdropFilter : "");
    set("--scp-backdrop", blur);
    set("--scp-fg", cs.color);
    set("--scp-font", cs.fontFamily);
    set("--scp-fontsize", cs.fontSize);
    const line = cs.borderLeftColor && cs.borderLeftWidth !== "0px" ? cs.borderLeftColor : "";
    set("--scp-line", line || "rgba(128,128,128,.32)");
    set("--scp-shadow", cs.boxShadow && cs.boxShadow !== "none" ? cs.boxShadow : "");
    // 탭 모양도 네이티브에서 읽는다 — 선택 표시 색은 테마마다 다르다.
    const nativeTabBar = [...document.querySelectorAll(".MuiTabs-flexContainer, [role='tablist']")]
      .find((el) => el instanceof HTMLElement && !el.closest(`#${PANEL_ID}`));
    if (nativeTabBar) {
      const kids = [...nativeTabBar.children].filter((el) => el instanceof HTMLElement);
      const selected = kids.find((el) => el.classList.contains("Mui-selected")) || kids[0];
      const idle = kids.find((el) => el !== selected && tabLabelOf(el));
      if (selected) {
        const ts = getComputedStyle(selected);
        set("--scp-tab-active", ts.color);
        set("--scp-tab-size", ts.fontSize);
        set("--scp-tab-weight", ts.fontWeight);
        set("--scp-tab-spacing", ts.letterSpacing);
        set("--scp-tab-pad", `${ts.paddingTop} ${ts.paddingRight} ${ts.paddingBottom} ${ts.paddingLeft}`);
      }
      if (idle) {
        const is = getComputedStyle(idle);
        set("--scp-tab-idle", is.color);
        // MUI 는 비활성 탭을 opacity 로 흐린다(#A6A6A6 ≈ 흰색 0.65). 색이 이미 회색이면
        // opacity 는 1 일 테니, 둘을 그대로 넘기면 어느 쪽이든 맞는다.
        set("--scp-tab-idle-opacity", is.opacity);
      }
      const indicator = nativeTabBar.parentElement?.querySelector(".MuiTabs-indicator");
      if (indicator) set("--scp-tab-indicator", getComputedStyle(indicator).backgroundColor);
      // 탭 바 배경색 — 투명이면 조상으로 올라가며 실제 색을 찾는다(원본 #212121).
      let tabsBg = getComputedStyle(nativeTabBar).backgroundColor;
      for (let el = nativeTabBar.parentElement; el && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(tabsBg); el = el.parentElement) {
        tabsBg = getComputedStyle(el).backgroundColor;
      }
      set("--scp-tabs-bg", toOpaqueColor(tabsBg, pageBg));
    }

    // 헤더도 네이티브에서 읽어 높이·글꼴·정렬을 맞춘다.
    const header = findNativeChatHeader(native);
    if (header) {
      const hs = getComputedStyle(header.bar);
      const barRect = header.bar.getBoundingClientRect();
      set("--scp-header-h", `${Math.round(barRect.height)}px`);
      set("--scp-header-bg", toOpaqueColor(hs.backgroundColor, pageBg));
      // 우측 여백·아이콘 색: 네이티브 헤더의 맨 오른쪽 아이콘 버튼(설정 톱니)을 찾아
      // 그것과 오른쪽 끝 사이 간격을 그대로 쓰고, 색도 그 아이콘에서 읽는다.
      const icons = [...header.bar.querySelectorAll("button, svg")]
        .filter((el) => el instanceof HTMLElement || el instanceof SVGElement);
      let rightIcon = null;
      for (const el of icons) {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.width > 60) continue;
        if (!rightIcon || r.right > rightIcon.getBoundingClientRect().right) rightIcon = el;
      }
      if (rightIcon) {
        const ir = rightIcon.getBoundingClientRect();
        const gap = Math.max(8, Math.round(barRect.right - ir.right));
        set("--scp-header-padx", `${gap}px`);
        const iconColor = getComputedStyle(rightIcon).color;
        set("--scp-close-color", iconColor);
      } else {
        set("--scp-header-padx", hs.paddingRight !== "0px" ? hs.paddingRight : "12px");
      }
      if (header.title) {
        const ttl = getComputedStyle(header.title);
        set("--scp-header-size", ttl.fontSize);
        set("--scp-header-weight", ttl.fontWeight);
        set("--scp-header-color", ttl.color);
        set("--scp-header-spacing", ttl.letterSpacing);
      }
    }

    // 하단 전송 버튼 색을 네이티브에서 읽어 맞춘다("전송" 글자를 가진 버튼).
    const sendBtn = [...document.querySelectorAll("button")].find((b) =>
      b instanceof HTMLElement && !b.closest(`#${PANEL_ID}`)
      && normalizeSpace(b.textContent || "") === "전송");
    if (sendBtn) {
      const ss = getComputedStyle(sendBtn);
      set("--scp-send-bg", ss.backgroundColor);
      set("--scp-send-color", ss.color);
      set("--scp-send-radius", ss.borderRadius);
      // 컴포저 실제 표시색 = 패널 불투명색(#121212 종이는 뒤에 있어 안 보임). 네이티브가
      // 밝아 보이는 건 반투명이 게임 화면 위라서고, 우리는 어두운 페이지 위라 그대로 쓴다.
    }

    // 메시지 글꼴/크기/색도 네이티브 메시지에서 그대로 읽어야 같아 보인다.
    const nameEl = document.querySelector(`h6.MuiListItemText-primary`);
    if (nameEl && !nameEl.closest(`#${PANEL_ID}`)) {
      const ns = getComputedStyle(nameEl);
      set("--scp-name-size", ns.fontSize);
      set("--scp-name-weight", ns.fontWeight);
      set("--scp-name-color", ns.color);
    }
    const textEl = document.querySelector(`p.MuiListItemText-secondary`);
    if (textEl && !textEl.closest(`#${PANEL_ID}`)) {
      const ts = getComputedStyle(textEl);
      set("--scp-text-size", ts.fontSize);
      set("--scp-text-line", ts.lineHeight);
      set("--scp-text-color", ts.color);
    }
  }

  // 화면 오른쪽 위에는 룸 상단바 아이콘들이 떠 있다. 우리 패널이 오른쪽 끝을 차지하면
  // 그 아이콘들을 덮어 누를 수 없게 된다 → 상단바 아래에서 시작하도록 여백을 잰다.
  // 네이티브 채팅 패널 안의 버튼은 제외한다(그건 패널 헤더라 기준이 아니다).
  function measureTopBarOffset(native) {
    let bottom = 0;
    const nodes = document.querySelectorAll('button, [role="button"], [role="toolbar"]');
    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.closest(`#${PANEL_ID}`)) continue;
      if (native instanceof HTMLElement && native.contains(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.top > 72) continue;                              // 상단 영역만
      if (rect.right < window.innerWidth - 240) continue;        // 오른쪽 끝 근처만
      bottom = Math.max(bottom, rect.bottom);
    }
    // 너무 크게 잡히면(전체 화면 요소 등) 무시한다.
    return bottom > 0 && bottom <= 96 ? Math.round(bottom + 4) : 0;
  }

  // 룸 채팅 패널은 화면 오른쪽 끝에 붙어 있어(right = 창 너비) 그 오른쪽에는 공간이 없다.
  // 우리 패널을 오른쪽에 두려면 네이티브를 우리 폭만큼 왼쪽으로 밀어야 한다.
  // transform 만 건드리므로 레이아웃 계산에는 영향이 없고, 닫을 때 원래대로 되돌린다.
  function applyNativeShift(native, px) {
    if (!(native instanceof HTMLElement)) return;
    if (native.dataset.ccfScpShift === String(px)) return;
    if (native.dataset.ccfScpPrevTransform === undefined) {
      native.dataset.ccfScpPrevTransform = native.style.transform || "";
    }
    native.style.transform = px ? `translateX(${-px}px)` : (native.dataset.ccfScpPrevTransform || "");
    native.dataset.ccfScpShift = String(px);
  }

  function clearNativeShift() {
    document.querySelectorAll("[data-ccf-scp-shift]").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.transform = el.dataset.ccfScpPrevTransform || "";
      delete el.dataset.ccfScpShift;
      delete el.dataset.ccfScpPrevTransform;
    });
  }

  /* ---------------- 화면 밀어내기 ----------------
     코코포리아는 이미 네이티브 패널 자리를 비워 둔다: 본문 전체를 감싼 컨테이너
     하나가 패널 왼쪽에서 딱 끝난다(진단으로 확인 — 깊이 2, 폭 = 패널 left).
     상단바·지도·BGM 이 모두 그 안에 있으므로, 그 컨테이너만 우리 폭만큼 더
     좁히면 전부 함께 왼쪽으로 따라온다.

     ⚠ 클래스명(sc-jcsPWJ 등)은 빌드마다 바뀌므로 쓰지 않는다. "패널 왼쪽에서
       끝나는 가장 바깥 컨테이너"라는 위치 조건으로만 찾는다. */

  const SQUEEZE_ATTR = "data-ccf-scp-squeeze";
  // 화면 전체 폭 막대(상단바)는 폭을 줄이면 안 된다 — 안쪽이 오른쪽 정렬이라
  // 왼쪽 내용(룸 제목)까지 딸려 움직인다. 오른쪽 여백만 주면 오른쪽 것만 밀린다.
  const INSET_ATTR = "data-ccf-scp-inset";
  let squeezeEl = null;
  let pushEnabled = true;

  function findContentContainer(edge) {
    const root = document.getElementById("root") || document.body;
    // 본문 컨테이너 하나만으로는 부족하다. 상단바는 그 바깥에 따로 떠 있어서,
    // 본문만 좁히면 상단바 아이콘이 우리 패널 뒤로 들어간다. 그래서 "패널 왼쪽에서
    // 끝나는" 최상위 요소를 전부 모은다(찾은 요소 안쪽은 따라오므로 더 안 판다).
    // 여백 때문에 몇 px 어긋나는 요소가 있어 오차를 넉넉히 준다.
    const found = [];
    let level = [root];
    for (let depth = 0; depth <= 4 && level.length; depth += 1) {
      const next = [];
      for (const el of level) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.closest(`#${PANEL_ID}`)) continue;
        // ⚠ 여백을 준 막대(상단바)와 그 안쪽은 건드리지 않는다. 여백을 주면 안쪽 툴바의
        //   오른쪽 끝이 패널 경계와 같아져 다음 순번에 "좁힐 대상"으로 걸리고,
        //   여백 + 폭축소가 이중으로 먹어 아이콘이 왼쪽으로 몰린다(v0.1.24 에서 그랬다).
        if (el.closest(`[${INSET_ATTR}]`)) continue;
        const r = el.getBoundingClientRect();
        // 이미 좁혀 둔 요소는 오른쪽 끝이 우리 패널 왼쪽에 있으니 표식으로도 인정한다.
        const rightOk = Math.abs(r.right - edge) <= 28 || el.hasAttribute(SQUEEZE_ATTR);
        if (r.width > 200 && r.height > 24 && rightOk) {
          found.push(el);
          // 자식은 보통 부모를 따라오지만, position:fixed 인 자식은 부모 폭을
          // 아예 무시한다(상단바가 그래서 안 밀렸다). 그런 것만 따로 찾아 둔다.
          found.push(...findFixedStragglers(el, edge));
          continue;
        }
        next.push(...el.children);
      }
      level = next;
    }
    return { squeeze: [...new Set(found)], inset: [...new Set(findTopBars())] };
  }

  /* 상단바는 위 조건에 걸리지 않는다: 진단으로 확인한 실제 모습은
       HEADER  position:fixed  left:0 right:0  width = 창 전체
     즉 네이티브 패널 경계가 아니라 화면 끝까지 뻗어 있고, 코코포리아는 그 오른쪽을
     패널로 덮어버린다. 그래서 "화면 위쪽에 가로로 꽉 찬 고정 막대"로 따로 찾는다. */
  function findTopBars() {
    const out = [];
    const root = document.getElementById("root") || document.body;
    let level = [root, ...document.body.children];
    for (let depth = 0; depth <= 5 && level.length; depth += 1) {
      const next = [];
      for (const el of level) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.closest(`#${PANEL_ID}`)) continue;
        if (el.hasAttribute(INSET_ATTR)) { out.push(el); continue; }
        const cs = getComputedStyle(el);
        if (cs.position === "fixed") {
          const r = el.getBoundingClientRect();
          const fullWidth = r.width >= window.innerWidth * 0.9;
          if (fullWidth && r.top <= 4 && r.height > 20 && r.height <= 160) {
            out.push(el);
            continue; // 안쪽 툴바는 부모를 따라 좁아진다.
          }
        }
        next.push(...el.children);
      }
      level = next;
    }
    return out;
  }

  // 좁힌 컨테이너 안에 있으면서도 부모를 안 따라오는 요소(position:fixed)를 모은다.
  // 폭 조건을 두는 이유: BGM 컨트롤처럼 오른쪽 끝만 같고 좁은 요소를 늘리면 안 된다.
  function findFixedStragglers(root, edge) {
    const out = [];
    let level = [...root.children];
    for (let depth = 0; depth <= 5 && level.length; depth += 1) {
      const next = [];
      for (const el of level) {
        if (!(el instanceof HTMLElement)) continue;
        if (el.closest(`#${PANEL_ID}`)) continue;
        // 위와 같은 이유로, 이미 좁힌 것은 조건을 다시 재지 않고 계속 대상으로 둔다.
        if (el.hasAttribute(SQUEEZE_ATTR)) { out.push(el); continue; }
        const cs = getComputedStyle(el);
        if (cs.position === "fixed") {
          const r = el.getBoundingClientRect();
          if (r.width > 200 && Math.abs(r.right - edge) <= 28) {
            out.push(el);
            continue;
          }
        }
        next.push(...el.children);
      }
      level = next;
    }
    return out;
  }

  function clearSqueeze() {
    document.documentElement.style.removeProperty("--ccf-scp-content-width");
    document.documentElement.style.removeProperty("--ccf-scp-inset");
    document.querySelectorAll(`[${SQUEEZE_ATTR}]`).forEach((el) => el.removeAttribute(SQUEEZE_ATTR));
    document.querySelectorAll(`[${INSET_ATTR}]`).forEach((el) => el.removeAttribute(INSET_ATTR));
    squeezeEl = null;
    lastSqueezeWidth = 0;
  }

  let squeezeResizeTimer = 0;
  let lastSqueezeWidth = 0;
  function applySqueeze(groups, width, inset) {
    const targets = (groups?.squeeze || []).filter((el) => el instanceof HTMLElement);
    const insets = (groups?.inset || []).filter((el) => el instanceof HTMLElement);
    if (!targets.length || !(width > 200)) return false;
    const px = Math.round(width);
    // 배치는 0.5초마다 다시 도는데, 그때마다 아래 resize 를 쏘면 지도가 끊임없이
    // 다시 그려진다. 폭이 실제로 달라졌을 때만 손댄다.
    const missing = targets.some((el) => !el.hasAttribute(SQUEEZE_ATTR))
      || insets.some((el) => !el.hasAttribute(INSET_ATTR));
    if (px === lastSqueezeWidth && !missing) return true;

    document.documentElement.style.setProperty("--ccf-scp-content-width", `${px}px`);
    document.documentElement.style.setProperty("--ccf-scp-inset", `${Math.round(inset)}px`);
    // 대상에서 빠진 옛 요소의 표식은 거둬들인다(패널 폭이 바뀔 때 찌꺼기 방지).
    document.querySelectorAll(`[${SQUEEZE_ATTR}]`).forEach((el) => {
      if (!targets.includes(el)) el.removeAttribute(SQUEEZE_ATTR);
    });
    document.querySelectorAll(`[${INSET_ATTR}]`).forEach((el) => {
      if (!insets.includes(el)) el.removeAttribute(INSET_ATTR);
    });
    targets.forEach((el) => { if (!el.hasAttribute(SQUEEZE_ATTR)) el.setAttribute(SQUEEZE_ATTR, "1"); });
    insets.forEach((el) => { if (!el.hasAttribute(INSET_ATTR)) el.setAttribute(INSET_ATTR, "1"); });
    squeezeEl = targets[0];
    lastSqueezeWidth = px;

    // 지도 캔버스는 창 크기가 바뀔 때만 다시 그려진다. 알려주지 않으면 옛 폭 그대로
    // 남아 가로 스크롤이 생긴다(예전 실패 원인 중 하나).
    clearTimeout(squeezeResizeTimer);
    squeezeResizeTimer = setTimeout(() => {
      try { window.dispatchEvent(new Event("resize")); } catch (e) { /* noop */ }
    }, 60);

    // 안전장치: 밀었는데 오히려 화면 밖으로 넘치면 즉시 되돌린다.
    if (document.documentElement.scrollWidth > window.innerWidth + 4) {
      clearSqueeze();
      console.warn("[ccf-chat-panel] 화면 밀기 취소 — 가로 넘침");
      return false;
    }
    return true;
  }

  // 위에 겹치지 않고 네이티브 패널 옆에 나란히 붙인다.
  function layoutPanel() {
    if (!panelEl) return;
    const native = findNativeChatPanel();
    syncTheme(native);

    if (!native) {
      // 패널을 못 찾으면(닫혀 있음 등) 화면 우측에 기본 배치.
      Object.assign(panelEl.style, {
        top: "0px", bottom: "0px", height: "", right: "0px", left: "", width: "340px"
      });
      return;
    }

    const MIN_WIDTH = 220;
    // 밀기 전 기준 위치 (transform 은 rect 에 반영되므로 먼저 해제하고 잰다).
    applyNativeShift(native, 0);
    const base = native.getBoundingClientRect();
    const width = Math.max(260, Math.min(base.width || 340, 460));
    const gapRight = window.innerWidth - base.right;

    // 화면 밀기: 본문 컨테이너를 우리 폭만큼 좁히고 그 자리에 들어간다.
    // 상단바·BGM 이 함께 왼쪽으로 오므로 가릴 것이 없어 위아래를 꽉 채운다.
    if (pushEnabled) {
      const edge = Math.round(base.left);
      const containers = findContentContainer(edge);
      if (containers.squeeze.length && applySqueeze(containers, edge - width, width)) {
        Object.assign(panelEl.style, {
          top: `${Math.round(base.top)}px`,
          height: `${Math.round(base.height)}px`,
          bottom: "",
          right: "",
          left: `${Math.round(edge - width)}px`,
          width: `${Math.round(width)}px`
        });
        return;
      }
      clearSqueeze();
    }

    let left;
    if (gapRight >= MIN_WIDTH) {
      // 오른쪽에 이미 자리가 있으면 밀 필요 없이 그 옆에.
      left = base.right;
    } else if (panelSide === "right" && base.left >= width) {
      // 오른쪽 끝에 붙어 있으면 네이티브를 왼쪽으로 밀고 그 자리를 쓴다.
      applyNativeShift(native, width);
      left = base.right - width;
    } else if (base.left >= MIN_WIDTH) {
      left = base.left - Math.min(width, base.left);
    } else {
      left = Math.max(0, window.innerWidth - width);
    }

    // 상단바 아이콘을 덮지 않도록 그 아래에서 시작한다(가릴 게 없으면 그대로).
    const topBar = measureTopBarOffset(native);
    const top = Math.max(Math.round(base.top), topBar);
    const bottom = Math.round(base.top + base.height);
    // 화면 밖으로 1px 이라도 새면 가로 스크롤이 생긴다.
    const maxWidth = Math.max(120, window.innerWidth - Math.round(left));

    Object.assign(panelEl.style, {
      top: `${top}px`,
      height: `${Math.max(120, bottom - top)}px`,
      bottom: "",
      right: "",
      left: `${Math.round(left)}px`,
      width: `${Math.min(Math.round(width), maxWidth)}px`
    });
  }

  // 배치 오류가 메시지 렌더까지 막지 않도록 격리한다.
  let layoutErrorLogged = false;
  function safeLayout() {
    try {
      layoutPanel();
    } catch (error) {
      if (!layoutErrorLogged) {
        layoutErrorLogged = true;
        console.error("[ccf-chat-panel] layout failed", error);
      }
    }
  }

  /* ---------------- 메뉴 항목 ---------------- */
  // 룸 채팅 패널 환경설정 메뉴의 "다른 창으로 보기(beta)" 바로 아래에 끼워 넣는다.

  function normalizeSpace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isOtherWindowMenuItem(item) {
    const text = normalizeSpace(item.textContent || "").toLowerCase();
    if (!text) return false;
    return /다른\s*창/.test(text)
      || /別\s*ウ[ィイ]ンドウ/.test(text)
      || /(another|separate|new)\s*window/.test(text);
  }

  function menuItemLabel() {
    return panelEl ? "채팅 패널 닫기" : "채팅 패널 추가";
  }

  function createMenuItem(reference) {
    const item = document.createElement("li");
    // 네이티브 항목의 클래스를 그대로 빌려 생김새를 맞춘다.
    item.className = reference?.className || "MuiButtonBase-root MuiMenuItem-root MuiMenuItem-gutters";
    item.setAttribute(MENU_ITEM_ATTR, "1");
    item.setAttribute(SAFE_ATTR, "1");
    item.setAttribute("role", "menuitem");
    item.setAttribute("tabindex", "-1");
    item.textContent = menuItemLabel();

    const ripple = reference?.querySelector?.(".MuiTouchRipple-root");
    if (ripple instanceof HTMLElement) item.appendChild(ripple.cloneNode(false));

    item.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
      closeOpenMenus();
    });
    return item;
  }

  function closeOpenMenus() {
    const init = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent("keydown", init));
    document.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  function ensureMenuItem() {
    if (!getRoomId()) return;
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (!(menu instanceof HTMLElement) || !isVisible(menu)) continue;

      const existing = menu.querySelector(`[${MENU_ITEM_ATTR}="1"]`);
      if (existing) {
        // 패널 상태에 맞춰 라벨만 갱신 (ripple 자식은 건드리지 않는다).
        if (existing.firstChild?.nodeType === Node.TEXT_NODE) {
          existing.firstChild.nodeValue = menuItemLabel();
        }
        continue;
      }

      const items = [...menu.querySelectorAll('[role="menuitem"]')]
        .filter((el) => el instanceof HTMLElement && el.closest('[role="menu"]') === menu);
      const anchor = items.find(isOtherWindowMenuItem);
      if (!anchor || !anchor.parentElement) continue;

      injectStyle();
      anchor.parentElement.insertBefore(createMenuItem(anchor), anchor.nextSibling);
    }
  }

  function init() {
    const prefs = readPrefs();
    if (prefs.channel) currentChannel = prefs.channel;
    // 기본값이 바뀌기 전에 저장된 값은 무시하고 새 기본값(왼쪽)으로 시작한다.
    if (prefs.sideV === SIDE_PREF_VERSION && (prefs.side === "left" || prefs.side === "right")) {
      panelSide = prefs.side;
    }
    if (typeof prefs.opaqueBg === "boolean") opaqueBg = prefs.opaqueBg;
    if (prefs.open) openPanel();

    // 메뉴는 열 때마다 새로 만들어지므로 DOM 변화를 보고 그때그때 항목을 끼운다.
    const observer = new MutationObserver(() => { if (active) ensureMenuItem(); });
    observer.observe(document.body, { childList: true, subtree: true });
    // 애니메이션 중 삽입이 밀리는 경우를 대비한 보조 폴링.
    const timer = window.setInterval(() => { if (active) ensureMenuItem(); }, 1000);
    ensureMenuItem();

    window.__CCF_SECOND_CHAT_PANEL__ = {
      version: VERSION,
      open: openPanel,
      close: closePanel,
      toggle: togglePanel,
      channels: listChannels,
      peek: () => readMessages(currentChannel)?.slice(-3),
      // 메시지를 못 읽을 때: 저장소가 실제로 어떤 모양인지 확인용.
      storeDiag() {
        const slice = getRoomMessagesSlice();
        if (!slice) return { 슬라이스: null, 저장소: !!findStore() };
        const groups = slice.idsGroupBy || {};
        const entities = slice.entities || {};
        const ids = Object.keys(entities);
        const sampleId = ids[0];
        const sample = sampleId ? entities[sampleId] : null;
        return {
          엔티티수: ids.length,
          그룹: Object.fromEntries(Object.entries(groups)
            .map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v])),
          슬라이스키: Object.keys(slice),
          샘플필드: sample ? Object.keys(sample) : null,
          샘플: sample ? {
            channel: sample.channel, name: sample.name,
            text: String(sample.text || "").slice(0, 20), removed: sample.removed
          } : null
        };
      },
      // 배경 반투명(원본 질감) ↔ 불투명(|< 가림) 전환. 저장되어 다음에도 유지된다.
      setOpaqueBg(on) {
        opaqueBg = !!on;
        savePrefs();
        const native = findNativeChatPanel();
        if (native) syncTheme(native);
        return opaqueBg;
      },
      // 화면 밀기가 문제를 일으키면 즉시 끄는 비상구(새로고침 없이 원상복구).
      setPush(on) {
        pushEnabled = !!on;
        clearSqueeze();
        layoutPanel();
        try { window.dispatchEvent(new Event("resize")); } catch (e) { /* noop */ }
        return pushEnabled;
      },
      // 네이티브를 미는 게 불편하면 "left" 로 바꾸면 밀지 않고 왼쪽 옆에 붙는다.
      setSide(side) {
        if (side !== "left" && side !== "right") return panelSide;
        panelSide = side;
        clearNativeShift();
        layoutPanel();
        savePrefs();
        return panelSide;
      },
      // 위치/디자인이 안 맞을 때: 어떤 요소를 네이티브 패널로 잡았는지 확인용.
      layoutDiag() {
        const native = findNativeChatPanel();
        const rect = native?.getBoundingClientRect();
        const cs = native ? getComputedStyle(native) : null;
        const round = (n) => Math.round(n);
        return {
          찾음: !!native,
          요소: native ? `${native.tagName}.${String(native.className).slice(0, 90)}` : null,
          위치: rect ? { left: round(rect.left), right: round(rect.right), top: round(rect.top), 폭: round(rect.width), 높이: round(rect.height) } : null,
          창너비: window.innerWidth,
          오른쪽여백: rect ? round(window.innerWidth - rect.right) : null,
          왼쪽여백: rect ? round(rect.left) : null,
          배경: cs?.backgroundColor,
          글자색: cs?.color,
          글꼴: cs?.fontFamily?.slice(0, 60),
          내패널: panelEl ? { left: panelEl.style.left, 폭: panelEl.style.width } : null
        };
      },
      // "화면을 밀어내기" 전 확인용: 코코포리아가 네이티브 패널 자리를 어떻게 비워
      // 두는지(어느 요소가 그만큼 좁아져 있는지) 찾는다. 그 방식을 그대로 늘려야
      // 상단바·BGM 이 함께 왼쪽으로 따라온다 — 추측해서 밀면 예전처럼 겹친다.
      pushDiag() {
        const native = findNativeChatPanel();
        if (!native) return "no panel";
        const edge = native.getBoundingClientRect().left;
        const round = (n) => Math.round(n);
        const out = [];
        const walk = (el, depth) => {
          if (!(el instanceof HTMLElement) || depth > 7 || out.length > 24) return;
          const r = el.getBoundingClientRect();
          // 화면 끝이 아니라 패널 왼쪽에서 끝나는 = 자리를 비워 준 요소.
          if (r.width > 200 && Math.abs(r.right - edge) <= 14 && window.innerWidth - edge > 40) {
            const cs = getComputedStyle(el);
            out.push({
              깊이: depth,
              요소: `${el.tagName}.${String(el.className).slice(0, 60)}`,
              폭: round(r.width),
              오른쪽: round(r.right),
              position: cs.position,
              width: cs.width,
              marginRight: cs.marginRight,
              paddingRight: cs.paddingRight,
              transform: cs.transform === "none" ? "none" : cs.transform.slice(0, 40)
            });
          }
          for (const child of el.children) walk(child, depth + 1);
        };
        walk(document.getElementById("root") || document.body, 0);
        // 우리 패널 위에 남아 있는 요소를 직접 지목한다("왜 안 밀렸나"의 답).
        const panelRect = panelEl?.getBoundingClientRect();
        const overlap = [];
        if (panelRect) {
          const seen = new Set();
          for (const el of document.querySelectorAll("div, header, nav")) {
            if (!(el instanceof HTMLElement)) continue;
            if (el.closest(`#${PANEL_ID}`)) continue;
            const r = el.getBoundingClientRect();
            // 화면 위쪽에서 우리 패널 영역을 침범하는 것만.
            if (r.top > 90 || r.height < 20 || r.width < 60) continue;
            if (r.right <= panelRect.left + 4 || r.left >= panelRect.right) continue;
            const cs = getComputedStyle(el);
            const key = `${Math.round(r.left)}:${Math.round(r.right)}:${cs.position}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (overlap.length < 12) {
              overlap.push({
                요소: `${el.tagName}.${String(el.className).slice(0, 40)}`,
                left: round(r.left), right: round(r.right), 폭: round(r.width),
                position: cs.position, cssLeft: cs.left, cssRight: cs.right, cssWidth: cs.width,
                밀림대상: el.hasAttribute(SQUEEZE_ATTR)
              });
            }
          }
        }
        const bgm = document.querySelector("[data-ccf-bgm-controls], .ccf-bgm-controls, #ccf-bgm-controls");
        const bgmRect = bgm?.getBoundingClientRect();
        return {
          패널왼쪽: round(edge),
          창너비: window.innerWidth,
          자리비운요소: out,
          // 무엇을 실제로 건드렸는지 — "왜 저렇게 움직였나"의 답.
          좁힌것: [...document.querySelectorAll(`[${SQUEEZE_ATTR}]`)].map((el) => {
            const r = el.getBoundingClientRect();
            return { 요소: `${el.tagName}.${String(el.className).slice(0, 40)}`, left: round(r.left), right: round(r.right), 폭: round(r.width) };
          }),
          여백준것: [...document.querySelectorAll(`[${INSET_ATTR}]`)].map((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
              요소: `${el.tagName}.${String(el.className).slice(0, 40)}`,
              left: round(r.left), right: round(r.right), 폭: round(r.width),
              paddingRight: cs.paddingRight
            };
          }),
          아직겹치는것: overlap,
          BGM: bgm
            ? { 요소: `${bgm.tagName}.${String(bgm.className).slice(0, 50)}`, left: round(bgmRect.left), right: round(bgmRect.right), position: getComputedStyle(bgm).position }
            : "BGM 컨트롤 못 찾음"
        };
      },
      // 탭이 네이티브보다 적게 나올 때: 탭 막대를 찾았는지, 채널 키를 어디서
      // 꺼낼 수 있는지 확인용(React 가 붙여 둔 속성 이름은 버전마다 다르다).
      tabDiag() {
        const lists = [...document.querySelectorAll('[role="tablist"]')]
          .filter((el) => !el.closest(`#${PANEL_ID}`));
        return {
          탭막대수: lists.length,
          우리가읽은것: readNativeTabs(),
          최종채널목록: listChannels(),
          // 자식을 통째로 본다 — role="tab" 으로는 일부만 잡혔다.
          막대: lists.map((list) => ({
            요소: `${list.tagName}.${String(list.className).slice(0, 40)}`,
            자식수: list.children.length,
            자식: [...list.children].map((el) => ({
              태그: el.tagName,
              id: el.id || null,
              role: el.getAttribute("role"),
              클래스: String(el.className).slice(0, 40),
              글자: normalizeSpace(el.textContent).slice(0, 16),
              fiber값: readFiberValue(el) || null,
              보임: el instanceof HTMLElement ? el.offsetParent !== null : null
            }))
          })),
          이름순대안: readNativeTabsByLabel(),
          // 탭 막대 밖에 흩어져 있을 가능성까지 확인한다.
          id있는탭후보: [...document.querySelectorAll('[role="tab"], .MuiTab-root')]
            .filter((el) => !el.closest(`#${PANEL_ID}`))
            .map((el) => ({
              id: el.id || null,
              글자: normalizeSpace(el.textContent).slice(0, 16),
              부모: `${el.parentElement?.tagName}.${String(el.parentElement?.className || "").slice(0, 30)}`
            }))
        };
      },
      // 캐릭터 바 만들기 전: store 안 캐릭터 데이터 구조를 확인한다(이름·아이콘·색·id).
      charDiag() {
        const store = findStore();
        const state = store ? store.getState() : null;
        if (!state) return "no store";
        const ent = state.entities || {};
        const safe = (o) => { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return String(o); } };
        // 캐릭터로 보이는 슬라이스 찾기: entities 안에 name+iconUrl 가진 엔티티 모음.
        const slices = {};
        for (const [k, v] of Object.entries(ent)) {
          if (v && typeof v === "object" && v.entities) {
            const first = Object.values(v.entities)[0];
            slices[k] = { 개수: Object.keys(v.entities).length, 첫샘플키: first ? Object.keys(first) : [] };
          }
        }
        // characters 슬라이스가 있으면 첫 엔티티 통째로.
        let sampleChar = null;
        const charSlice = ent.characters || ent.character || null;
        if (charSlice?.entities) {
          const first = Object.values(charSlice.entities)[0];
          if (first) sampleChar = safe(first);
        }
        return {
          state키: Object.keys(state),
          entities슬라이스: slices,
          data: state.data ? { myCharacter: state.data.myCharacter, 키: Object.keys(state.data) } : null,
          캐릭터샘플: sampleChar
        };
      },
      // 팔레트·색상 아이콘 복제 실패 시: 네이티브 컴포저 아이콘 버튼들의 라벨을 본다.
      toolIconsDiag() {
        const out = [];
        for (const b of document.querySelectorAll("button")) {
          if (!(b instanceof HTMLElement) || b.closest(`#${PANEL_ID}`)) continue;
          const svg = b.querySelector("svg");
          if (!svg) continue;
          const r = b.getBoundingClientRect();
          if (r.width < 8 || r.width > 60 || b.offsetParent === null || r.top < 200) continue;
          out.push({
            aria: (b.getAttribute("aria-label") || "").slice(0, 24),
            title: (b.title || "").slice(0, 24),
            svg뷰박스: svg.getAttribute("viewBox"),
            위치: `${Math.round(r.left)},${Math.round(r.top)}`
          });
          if (out.length > 24) break;
        }
        return out;
      },
      // 하단 배경색이 안 맞을 때: 네이티브 주사위 버튼의 조상들 배경색을 훑어 #282828 이
      // 어느 요소인지 찾는다(첫 불투명 조상이 #1D1D1D 라 그걸 잡고 있었다).
      composerBgDiag() {
        const die = [...document.querySelectorAll("button")].find((b) =>
          b instanceof HTMLElement && !b.closest(`#${PANEL_ID}`) && b.querySelector("svg")
          && /[dD]\s*\d+|\d+\s*면/.test(b.getAttribute("aria-label") || b.title || b.textContent || ""));
        if (!die) return "네이티브 주사위 버튼 못 찾음";
        const chain = [];
        for (let el = die; el && el !== document.body && chain.length < 10; el = el.parentElement) {
          const cs = getComputedStyle(el);
          chain.push({
            요소: `${el.tagName}.${String(el.className).slice(0, 30)}`,
            bg: cs.backgroundColor,
            폭: Math.round(el.getBoundingClientRect().width)
          });
        }
        return { 주사위버튼조상: chain };
      },
      // 주사위 아이콘이 텍스트로 대체될 때: 네이티브 주사위 버튼이 어떤 라벨을 갖는지 본다.
      diceButtonsDiag() {
        const out = [];
        for (const b of document.querySelectorAll("button")) {
          if (!(b instanceof HTMLElement) || b.closest(`#${PANEL_ID}`)) continue;
          const svg = b.querySelector("svg");
          if (!svg) continue;
          const label = (b.getAttribute("aria-label") || b.title || b.textContent || "").trim();
          const r = b.getBoundingClientRect();
          // 화면에 보이는, 크기가 작은(아이콘) 버튼만.
          if (r.width < 8 || r.width > 60 || r.height < 8 || b.offsetParent === null) continue;
          out.push({
            라벨: label.slice(0, 20) || "(없음)",
            제목: (b.title || "").slice(0, 20),
            aria: (b.getAttribute("aria-label") || "").slice(0, 20),
            svg뷰박스: svg.getAttribute("viewBox"),
            위치: `${Math.round(r.left)},${Math.round(r.top)}`,
            부모: `${b.parentElement?.tagName}.${String(b.parentElement?.className || "").slice(0, 24)}`
          });
          if (out.length > 20) break;
        }
        return { 잡힌아이콘: [...captureNativeDiceIcons().keys()], 버튼목록: out };
      },
      // 주사위가 안 굴려질 때: 진짜 주사위 메시지가 어떤 필드로 저장돼 있는지 본다.
      // 우리가 보낼 때 그 필드를 재현하면 굴려지는지 판단하는 근거.
      diceDiag() {
        const slice = getRoomMessagesSlice();
        if (!slice) return "no store";
        const entities = slice.entities || {};
        const dieRe = /(^|\s)s?\d*d\d+/i;
        const dump = (msg) => {
          const out = {};
          for (const [k, v] of Object.entries(msg || {})) {
            if (v == null) continue;
            if (typeof v === "object") out[k] = Array.isArray(v) ? `[배열 ${v.length}]` : `{객체 ${Object.keys(v).join(",")}}`;
            else out[k] = String(v).slice(0, 60);
          }
          return out;
        };
        let dice = null;
        let plain = null;
        for (const id of Object.keys(entities)) {
          const m = entities[id];
          if (!m || m.removed) continue;
          const text = String(m.text || m.message || "");
          if (!dice && dieRe.test(text)) dice = m;
          else if (!plain && text && !dieRe.test(text)) plain = m;
          if (dice && plain) break;
        }
        // extend 안이 굴림의 핵심이라 통째로 펼친다(순환참조 대비 안전 복제).
        const safe = (obj) => {
          try { return JSON.parse(JSON.stringify(obj)); }
          catch (e) { return String(obj); }
        };
        return {
          주사위메시지: dice ? dump(dice) : "못 찾음(이 룸에서 주사위 한 번 굴려주세요)",
          주사위_extend: dice ? safe(dice.extend) : null,
          일반_extend: plain ? safe(plain.extend) : null,
          주사위필드전체: dice ? Object.keys(dice) : []
        };
      },
      // |< 가 헤더 밖까지 비치면: 그 버튼이 세로로 어디까지 걸치는지 확인해 불투명
      // 영역을 얼마나 넓혀야 하는지 정한다.
      seamDiag() {
        const panelRect = panelEl?.getBoundingClientRect();
        if (!panelRect) return "no panel";
        const round = (n) => Math.round(n);
        const out = [];
        for (const el of document.querySelectorAll("button, [role='button'], svg, a")) {
          if (!(el instanceof Element)) continue;
          if (el.closest(`#${PANEL_ID}`)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.width > 80 || r.height < 8) continue;
          // 우리 패널 오른쪽 경계 ±40px 안에 있는 것(= 이음새에 걸친 것).
          if (r.left > panelRect.right + 40 || r.right < panelRect.right - 40) continue;
          out.push({
            요소: `${el.tagName}.${String(el.getAttribute("class") || "").slice(0, 30)}`,
            글자: normalizeSpace(el.textContent || "").slice(0, 8),
            left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom)
          });
          if (out.length > 10) break;
        }
        return { 패널: { left: round(panelRect.left), right: round(panelRect.right), top: round(panelRect.top) }, 이음새요소: out };
      },
      // 배경이 원본과 다르게 보일 때: 네이티브 패널이 실제로 쓰는 배경 스택을 뽑는다.
      bgDiag() {
        const native = findNativeChatPanel();
        if (!native) return "no panel";
        const cs = getComputedStyle(native);
        const mine = panelEl ? getComputedStyle(panelEl) : null;
        return {
          네이티브: {
            backgroundColor: cs.backgroundColor,
            backgroundImage: cs.backgroundImage.slice(0, 120),
            backdropFilter: cs.backdropFilter,
            webkitBackdropFilter: cs.webkitBackdropFilter
          },
          내패널: mine ? {
            backgroundColor: mine.backgroundColor,
            backgroundImage: mine.backgroundImage.slice(0, 120),
            backdropFilter: mine.backdropFilter
          } : null,
          페이지바탕: getComputedStyle(document.body).backgroundColor
        };
      },
      // 구분선이 우리 패널에만 없을 때: 그 선이 어느 요소의 무슨 속성인지 찾는다.
      // (목록 컨테이너 클래스를 물려주는 방법은 효과가 없었다.)
      rowDiag() {
        const describe = (el, depth) => {
          if (!(el instanceof HTMLElement)) return null;
          const cs = getComputedStyle(el);
          const after = getComputedStyle(el, "::after");
          return {
            깊이: depth,
            요소: `${el.tagName}.${String(el.className).slice(0, 50)}`,
            자식수: el.childElementCount,
            borderBottom: cs.borderBottomWidth === "0px" ? null : `${cs.borderBottomWidth} ${cs.borderBottomStyle} ${cs.borderBottomColor}`,
            borderTop: cs.borderTopWidth === "0px" ? null : `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
            boxShadow: cs.boxShadow === "none" ? null : cs.boxShadow.slice(0, 60),
            background: cs.backgroundColor,
            afterContent: after.content === "none" ? null : after.content,
            afterHeight: after.content === "none" ? null : after.height,
            afterBg: after.content === "none" ? null : after.backgroundColor
          };
        };
        const chainOf = (row) => {
          const out = [];
          let el = row;
          for (let i = 0; el && i < 4; i += 1) { out.push(describe(el, i)); el = el.parentElement; }
          return out;
        };
        const native = [...document.querySelectorAll(".MuiListItem-root")]
          .filter((li) => li instanceof HTMLElement
            && li.querySelector("h6.MuiListItemText-primary")
            && li.offsetParent !== null
            && !li.closest(`#${PANEL_ID}`)
            && !li.closest(".MuiPopover-root, .MuiMenu-root, .MuiDialog-root"));
        const mine = panelEl?.querySelectorAll(".MuiListItem-root") || [];
        return {
          네이티브줄수: native.length,
          네이티브: native.length ? chainOf(native[native.length - 1]) : null,
          내줄수: mine.length,
          내줄: mine.length ? chainOf(mine[mine.length - 1]) : null,
          내목록클래스: ccfScpListClass || null
        };
      },
      // 메뉴 항목을 못 찾을 때 원인 확인용.
      menuDiag() {
        return [...document.querySelectorAll('[role="menu"]')]
          .filter(isVisible)
          .map((menu) => ({
            항목: [...menu.querySelectorAll('[role="menuitem"]')].map((i) => normalizeSpace(i.textContent)),
            앵커발견: [...menu.querySelectorAll('[role="menuitem"]')].some(isOtherWindowMenuItem)
          }));
      },
      disable() {
        active = false;
        observer.disconnect();
        window.clearInterval(timer);
        closePanel();
        document.querySelectorAll(`[${MENU_ITEM_ATTR}="1"]`).forEach((el) => el.remove());
        document.getElementById("ccf-scp-style")?.remove();
        return true;
      }
    };
    console.info(`[CCF SCP] second chat panel loaded (v${VERSION})`);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
