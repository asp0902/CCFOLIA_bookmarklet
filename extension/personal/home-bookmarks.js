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
      rooms[id] = { id, name: info.name, system: info.system, pinned: !!prev?.pinned, lastVisit: lastRecordedPath === path && prev ? prev.lastVisit : Date.now() };
      lastRecordedPath = path;
      prune();
      await save();
    }
    let star = document.getElementById(STAR_ID);
    if (!star) {
      const titleBtn = document.querySelector("header.MuiAppBar-root h6")?.closest("button");
      if (!titleBtn?.parentElement) return;
      star = el("button", { id: STAR_ID, type: "button" });
      star.style.cssText = "background:none;border:0;cursor:pointer;font-size:20px;line-height:1;padding:4px 6px;margin-left:4px;flex:none";
      star.addEventListener("click", async e => { e.stopPropagation(); await togglePin(star.dataset.id); styleStar(star, !!rooms[star.dataset.id]?.pinned); });
      titleBtn.after(star);
    }
    star.dataset.id = id;
    styleStar(star, !!rooms[id]?.pinned);
  };

  // ── 홈 화면: 즐겨찾기 + 최근 방문 패널 ──
  const PANEL_ID = "capybara-home-rooms";
  const PANEL_CSS = `
    #${PANEL_ID} { box-sizing: border-box; max-width: 1200px; margin: 16px auto; padding: 16px 24px; background: #222; color: #fff; border-radius: 4px;
      font-family: "Noto Sans KR", Roboto, "Helvetica Neue", Arial, sans-serif; }
    #${PANEL_ID} h3 { margin: 0 0 8px; font-size: 1rem; font-weight: 700; }
    #${PANEL_ID} h3 + ul { margin-bottom: 16px; }
    #${PANEL_ID} ul { list-style: none; margin: 0; padding: 0; }
    #${PANEL_ID} li { display: flex; align-items: center; gap: 4px; min-height: 44px; border-top: 1px solid rgba(255,255,255,.12); }
    #${PANEL_ID} li a { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 6px 4px; color: inherit; text-decoration: none; }
    #${PANEL_ID} li a:hover { background: rgba(255,255,255,.08); }
    #${PANEL_ID} .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #${PANEL_ID} .sub { color: rgba(255,255,255,.6); font-size: .75rem; }
    #${PANEL_ID} button { background: none; border: 0; color: rgba(255,255,255,.7); cursor: pointer; font-size: 18px; width: 36px; height: 36px; border-radius: 50%; }
    #${PANEL_ID} button:hover { background: rgba(255,255,255,.08); }
    #${PANEL_ID} button.on { color: #ffca28; }
    #${PANEL_ID} .empty { color: rgba(255,255,255,.6); font-size: .875rem; padding: 8px 0; }`;

  const row = (r, withRemove) => {
    const li = el("li");
    const link = el("a", { href: `/rooms/${r.id}` }, el("span", { className: "name", textContent: r.name }),
      el("span", { className: "sub", textContent: [r.system, ago(r.lastVisit)].filter(Boolean).join(" · ") }));
    const star = el("button", { type: "button", textContent: r.pinned ? "★" : "☆", title: r.pinned ? "즐겨찾기 해제" : "즐겨찾기에 고정", className: r.pinned ? "on" : "" });
    star.addEventListener("click", () => togglePin(r.id));
    li.append(link, star);
    if (withRemove) {
      const rm = el("button", { type: "button", textContent: "✕", title: "기록에서 삭제" });
      rm.addEventListener("click", async () => { delete rooms[r.id]; await save(); });
      li.append(rm);
    }
    return li;
  };

  const section = (title, list, withRemove, emptyText) => {
    const frag = document.createDocumentFragment();
    frag.append(el("h3", { textContent: title }));
    frag.append(list.length ? el("ul", {}, ...list.map(r => row(r, withRemove))) : el("div", { className: "empty", textContent: emptyText }));
    return frag;
  };

  const renderHome = () => {
    const header = document.querySelector("header.MuiAppBar-root");
    if (!header) return;
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = el("div", { id: PANEL_ID });
      if (!document.getElementById(`${PANEL_ID}-style`)) document.head.append(el("style", { id: `${PANEL_ID}-style`, textContent: PANEL_CSS }));
      // AppBar 가 fixed 면 패널이 가려지지 않도록 그 높이만큼 내린다.
      const fixed = getComputedStyle(header).position === "fixed";
      panel.style.marginTop = fixed ? `${header.offsetHeight + 16}px` : "16px";
      header.after(panel);
    }
    const all = Object.values(rooms);
    const pinned = all.filter(r => r.pinned).sort((a, b) => b.lastVisit - a.lastVisit);
    const recent = all.filter(r => !r.pinned).sort((a, b) => b.lastVisit - a.lastVisit);
    panel.replaceChildren(
      section("★ 즐겨찾기", pinned, false, "룸 안에서 헤더의 ☆ 를 누르거나 아래 목록의 ☆ 를 눌러 고정하세요."),
      section("최근 방문한 룸", recent, true, "아직 방문 기록이 없습니다. 룸에 접속하면 자동으로 남습니다."));
  };

  const tick = async () => {
    const m = ROOM_RE.exec(location.pathname);
    if (m) { await tickRoom(m[1]); return; }
    lastRecordedPath = "";
    document.getElementById(STAR_ID)?.remove();
    if (/^\/home\/?$/.test(location.pathname)) {
      if (!document.getElementById(PANEL_ID)) renderHome();
    } else document.getElementById(PANEL_ID)?.remove();
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[KEY]) return;
    rooms = changes[KEY].newValue || {};
    if (document.getElementById(PANEL_ID)) renderHome();
    const star = document.getElementById(STAR_ID);
    if (star) styleStar(star, !!rooms[star.dataset.id]?.pinned);
  });

  load().then(() => { tick(); setInterval(tick, 1000); });
})();
