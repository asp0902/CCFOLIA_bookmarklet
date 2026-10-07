// 코코포리아 홈(/home)의 즐겨찾기(상단 고정) + 방문 기록. 예전 홈 화면에 있다가 사라진 기능을 확장이 대신한다.
// ISOLATED world 콘텐츠 스크립트: chrome.storage.local 에 룸 목록을 저장한다(내가 만든 방이 아니어도 접속하면 기록).
(() => {
  "use strict";
  if (location.origin !== "https://ccfolia.com" || window.top !== window) return;
  if (window.__CAPYBARA_HOME_BOOKMARKS__) return;
  window.__CAPYBARA_HOME_BOOKMARKS__ = true;

  const KEY = "capybaraRooms";
  const MAX_RECENT = 30;
  const ROOM_RE = /^\/rooms\/([A-Za-z0-9_-]+)/;
  let rooms = {};
  let lastRecordedPath = "";

  const load = () => chrome.storage.local.get(KEY).then(r => { rooms = r[KEY] || {}; });
  const save = () => chrome.storage.local.set({ [KEY]: rooms });
  const prune = () => {
    // 즐겨찾기가 아닌 기록은 최근 MAX_RECENT 개만 남긴다.
    const recent = Object.values(rooms).filter(r => !r.pinned).sort((a, b) => b.lastVisit - a.lastVisit);
    recent.slice(MAX_RECENT).forEach(r => { delete rooms[r.id]; });
  };

  // 룸 헤더(h6)의 첫 텍스트 노드가 방 이름, 뒤의 span.caption 이 시스템 이름이다.
  const readRoomHeader = () => {
    const h6 = document.querySelector("header.MuiAppBar-root h6");
    if (!h6) return null;
    const name = [...h6.childNodes].find(n => n.nodeType === 3 && n.textContent.trim())?.textContent.trim();
    if (!name) return null;
    return { name, system: h6.querySelector(".MuiTypography-caption")?.textContent.trim() || "" };
  };

  const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  };

  const ago = ts => {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return "방금 전";
    if (m < 60) return `${m}분 전`;
    if (m < 1440) return `${Math.floor(m / 60)}시간 전`;
    const d = Math.floor(m / 1440);
    return d < 30 ? `${d}일 전` : new Date(ts).toLocaleDateString("ko-KR");
  };

  const togglePin = async id => {
    if (!rooms[id]) return;
    rooms[id].pinned = !rooms[id].pinned;
    prune();
    await save();
  };

  // ── 룸 화면: 방문 기록 + 헤더의 ★ 버튼 ──
  const STAR_ID = "capybara-pin-star";
  const styleStar = (btn, pinned) => {
    btn.textContent = pinned ? "★" : "☆";
    btn.title = pinned ? "즐겨찾기 해제" : "즐겨찾기에 고정";
    btn.style.color = pinned ? "#ffca28" : "rgba(255,255,255,.7)";
  };
  const tickRoom = async id => {
    const info = readRoomHeader();
    if (!info) return;
    const path = location.pathname;
    const prev = rooms[id];
    if (lastRecordedPath !== path || !prev || prev.name !== info.name || prev.system !== info.system) {
      rooms[id] = { id, name: info.name, system: info.system, pinned: !!prev?.pinned, thumb: prev?.thumb, lastVisit: lastRecordedPath === path && prev ? prev.lastVisit : Date.now() };
      lastRecordedPath = path;
      prune();
      await save();
    }
    document.getElementById(STAR_ID)?.remove(); // the room-header star was removed; clear it from tabs that still have the old one
  };

  // ── 홈 화면: 코코포리아 네이티브 룸 카드를 복제해 즐겨찾기/최근 방문 룸을 같은 모양으로 보여 준다 ──
  const PANEL_ID = "capybara-home-rooms";
  const STAR_PATH = "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";
  const STAR_BORDER_PATH = "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.33 2.88 1 4.28L12 15.4z";
  const PANEL_CSS = `
    #${PANEL_ID} h3 { margin: 16px 16px 0; font-size: 1rem; font-weight: 700; color: #fff; font-family: "Noto Sans KR", Roboto, "Helvetica Neue", Arial, sans-serif; }
    #${PANEL_ID} .capybara-empty { margin: 4px 16px 0; color: rgba(255,255,255,.6); font-size: .875rem; }
    .capybara-star-btn.on { color: #ffca28 !important; }`;

  const nativeCards = () => [...document.querySelectorAll(".MuiCard-root")].filter(c => !c.closest(`#${PANEL_ID}`) && c.querySelector("a[href^='/rooms/']"));
  const cardId = card => card.querySelector("a[href^='/rooms/']")?.getAttribute("href").match(/\/rooms\/([A-Za-z0-9_-]+)/)?.[1];
  const cardTitle = card => {
    const h6 = card.querySelector("h6");
    if (!h6) return "";
    const clone = h6.cloneNode(true);
    clone.querySelectorAll(".MuiTypography-caption").forEach(n => n.remove());
    return clone.textContent.trim();
  };
  const cardThumb = card => card.querySelector(".MuiCardMedia-root")?.style.backgroundImage || "";
  const dateLabel = ts => {
    const d = new Date(ts), now = new Date(), pad = n => String(n).padStart(2, "0");
    return d.toDateString() === now.toDateString() ? `今日 ${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  };
  const setStarIcon = (btn, pinned) => {
    btn.classList.toggle("on", pinned);
    btn.title = btn.ariaLabel = pinned ? "즐겨찾기 해제" : "즐겨찾기에 고정";
    const path = btn.querySelector("svg path");
    if (path) path.setAttribute("d", pinned ? STAR_PATH : STAR_BORDER_PATH);
  };
  // 휴지통 버튼(span>button)을 복제해 바로 앞에 즐겨찾기 버튼을 둔다.
  const makeStar = (trashSpan, pinned, onClick) => {
    const span = trashSpan.cloneNode(true);
    const btn = span.querySelector("button");
    btn.classList.add("capybara-star-btn");
    btn.removeAttribute("aria-label");
    setStarIcon(btn, pinned);
    btn.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); onClick(); });
    span.dataset.capybaraStar = "1";
    return span;
  };

  // 코코포리아 카드(내 방)의 휴지통 옆에 ★ 버튼을 붙인다.
  const decorateNativeCards = async () => {
    let dirty = false;
    for (const card of nativeCards()) {
      const id = cardId(card);
      const trash = card.querySelector(".MuiCardActions-root > span:not([data-capybara-star])");
      if (!id || !trash) continue;
      const known = rooms[id];
      if (known && (known.name !== cardTitle(card) || known.thumb !== cardThumb(card))) { known.name = cardTitle(card) || known.name; known.thumb = cardThumb(card); dirty = true; }
      const existing = card.querySelector("[data-capybara-star] button");
      if (existing) { setStarIcon(existing, !!known?.pinned); continue; }
      trash.before(makeStar(trash, !!known?.pinned, async () => {
        if (!rooms[id]) rooms[id] = { id, name: cardTitle(card), system: "", pinned: false, lastVisit: Date.now(), thumb: cardThumb(card) };
        await togglePin(id);
      }));
    }
    if (dirty) await save();
  };

  const makeCard = (template, r) => {
    const cell = template.parentElement.cloneNode(true);
    const card = cell.querySelector(".MuiCard-root");
    card.querySelectorAll("[data-capybara-star]").forEach(n => n.remove());
    const a = card.querySelector("a");
    a.setAttribute("href", `/rooms/${r.id}`);
    const media = card.querySelector(".MuiCardMedia-root");
    media.style.backgroundImage = r.thumb || "none";
    if (!r.thumb) media.style.backgroundColor = "#111";
    const h6 = card.querySelector("h6");
    const caption = h6.querySelector(".MuiTypography-caption")?.cloneNode(true);
    h6.textContent = r.name;
    h6.title = [r.name, r.system].filter(Boolean).join(" · ");
    if (caption) { caption.textContent = dateLabel(r.lastVisit); h6.append(" ", caption); }
    const trash = card.querySelector(".MuiCardActions-root > span");
    const del = trash.querySelector("button");
    del.title = del.ariaLabel = "목록에서 삭제";
    del.addEventListener("click", async e => { e.preventDefault(); e.stopPropagation(); delete rooms[r.id]; await save(); });
    trash.before(makeStar(trash, !!r.pinned, () => togglePin(r.id)));
    return cell;
  };

  const section = (template, title, list, emptyText) => {
    const frag = document.createDocumentFragment();
    frag.append(el("h3", { textContent: title }));
    if (!list.length) { frag.append(el("div", { className: "capybara-empty", textContent: emptyText })); return frag; }
    const grid = template.parentElement.parentElement.cloneNode(false);
    grid.style.paddingBottom = "8px";
    grid.append(...list.map(r => makeCard(template, r)));
    frag.append(grid);
    return frag;
  };

  const renderHome = () => {
    const template = nativeCards()[0];
    if (!template) return false;
    const nativeGrid = template.parentElement.parentElement;
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = el("div", { id: PANEL_ID });
      if (!document.getElementById(`${PANEL_ID}-style`)) document.head.append(el("style", { id: `${PANEL_ID}-style`, textContent: PANEL_CSS }));
      nativeGrid.before(panel);
    }
    const all = Object.values(rooms);
    const pinned = all.filter(r => r.pinned).sort((a, b) => b.lastVisit - a.lastVisit);
    const recent = all.filter(r => !r.pinned).sort((a, b) => b.lastVisit - a.lastVisit);
    panel.replaceChildren(
      section(template, "★ 즐겨찾기", pinned, "룸 카드의 ☆ 버튼으로 즐겨찾기에 고정하세요."),
      section(template, "최근 방문한 룸", recent, "아직 방문 기록이 없습니다. 룸에 접속하면 자동으로 남습니다."));
    return true;
  };

  const tick = async () => {
    const m = ROOM_RE.exec(location.pathname);
    if (m) { await tickRoom(m[1]); return; }
    lastRecordedPath = "";
    document.getElementById(STAR_ID)?.remove();
    if (/^\/home\/?$/.test(location.pathname)) {
      await decorateNativeCards();
      if (!document.getElementById(PANEL_ID)) renderHome();
    } else document.getElementById(PANEL_ID)?.remove();
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[KEY]) return;
    rooms = changes[KEY].newValue || {};
    if (document.getElementById(PANEL_ID)) { renderHome(); decorateNativeCards(); }
    const star = document.getElementById(STAR_ID);
    if (star) styleStar(star, !!rooms[star.dataset.id]?.pinned);
  });

  // After the extension is reloaded/updated, this orphaned script must go quiet instead of throwing "Extension context invalidated" every second.
  load().then(() => {
    const timer = setInterval(() => {
      if (!chrome.runtime?.id) { clearInterval(timer); return; }
      tick().catch(() => {});
    }, 1000);
    tick().catch(() => {});
  }).catch(() => {});
})();
