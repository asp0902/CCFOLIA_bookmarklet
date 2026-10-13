"use strict";
const params = new URLSearchParams(location.hash.slice(1));
const roomId = params.get("room") || "";
const inviteToken = params.get("token") || "";
const consent = document.getElementById("consent");
// Remember the display name on this browser so a returning participant does not retype it.
const NAME_KEY = "capybara-display-name";
const chatName = document.getElementById("chat-name");
chatName.addEventListener("input", () => { chatName.dataset.touched = "1"; });
try { const saved = localStorage.getItem(NAME_KEY); if (saved) { document.getElementById("display-name").value = saved; chatName.value = saved; } } catch (_) {}
const room = document.getElementById("room");
const gateStatus = document.getElementById("gate-status");
const POLL_MS = 1500;
const LIVE_POLL_MS = 10000;
const MAX_MESSAGES = 300;
let mode = "";
let timer = 0;
let socket = null;
let socketOpen = false;
let socketRetries = 0;
let retryTimer = 0;
let pingTimer = 0;
let pushSeq = 0;
let current = { messages: [], handout: {} };
let rendered = false;
const setGate = (message, state = "") => { gateStatus.textContent = message; gateStatus.dataset.state = state; };
const clearTimers = () => {
  clearTimeout(timer); timer = 0;
  clearTimeout(retryTimer); retryTimer = 0;
  clearInterval(pingTimer); pingTimer = 0;
  const old = socket; socket = null; socketOpen = false;
  if (old) { try { old.close(); } catch (_) {} }
};
const stop = message => { clearTimers(); mode = ""; gateStatus.hidden = false; setGate(message, "error"); room.inert = true; room.setAttribute("aria-hidden", "true"); };
const transient = response => response.status === 429 || response.status >= 500;
// GM's YouTube BGM, shown like CCFOLIA's BGM bar (volume, mute, stop, progress). Played with the YouTube IFrame API so volume and progress work.
// It starts from a user gesture (the join click), so autoplay with sound is allowed.
const bgmBar = document.getElementById("bgm-bar");
let bgmKey = "", bgmStopped = false, bgmLast = null, ytPlayer = null, ytReady = false, ytWantId = "", ytApiRequested = false, bgmTimer = 0, bgmVolume = 100, bgmMuted = false;
const fmtTime = seconds => { const s = Math.max(0, Math.floor(seconds || 0)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
const SPK_PATH = "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z", MUTE_PATH = "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z";
function ensureYouTubeApi() {
  if (ytApiRequested) return;
  ytApiRequested = true;
  window.onYouTubeIframeAPIReady = () => { ytReady = true; if (ytWantId) startPlayer(ytWantId); };
  const script = document.createElement("script"); script.src = "https://www.youtube.com/iframe_api"; document.head.append(script);
}
function startPlayer(id) {
  if (!ytReady) return;
  const loop = bgmLast?.loop !== false;
  if (ytPlayer) { try { ytPlayer.destroy(); } catch (_) {} ytPlayer = null; }
  const host = document.createElement("div"); document.getElementById("bgm-frame").replaceChildren(host);
  ytPlayer = new YT.Player(host, {
    width: "200", height: "113", videoId: id,
    playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, ...(loop ? { loop: 1, playlist: id } : {}) },
    events: { onReady: event => { event.target.setVolume(bgmVolume); if (bgmMuted) event.target.mute(); event.target.playVideo(); } }
  });
  clearInterval(bgmTimer);
  bgmTimer = setInterval(() => {
    if (!ytPlayer?.getCurrentTime) return;
    const dur = ytPlayer.getDuration?.() || 0, cur = ytPlayer.getCurrentTime() || 0;
    document.getElementById("bgm-cur").textContent = fmtTime(cur); document.getElementById("bgm-dur").textContent = fmtTime(dur);
    const seek = document.getElementById("bgm-seek");
    if (!seek.dataset.dragging) { seek.value = dur ? String(Math.round((cur / dur) * 1000)) : "0"; seek.style.setProperty("--p", `${dur ? (cur / dur) * 100 : 0}%`); }
  }, 500);
}
function stopPlayer() {
  clearInterval(bgmTimer); bgmTimer = 0;
  if (ytPlayer) { try { ytPlayer.destroy(); } catch (_) {} ytPlayer = null; }
  document.getElementById("bgm-frame").replaceChildren();
}
function playBgm(bgm) {
  bgmLast = bgm || { state: "stopped" };
  const playing = bgmLast.state === "playing" && /^[A-Za-z0-9_-]{11}$/.test(bgmLast.videoId || "");
  refreshBgmBar();
  ytPlaying = playing;
  document.getElementById("bgm-name").textContent = bgmLast.title || "BGM";
  if (bgmStopped && bgmStopped !== bgmLast.startedAt) bgmStopped = false; // a newer GM signal re-enables playback after a local stop
  const key = playing && !bgmStopped ? `${bgmLast.videoId}:${bgmLast.startedAt}` : "";
  if (key === bgmKey) return;
  bgmKey = key;
  stopPlayer();
  if (!key) return;
  ytWantId = bgmLast.videoId; ensureYouTubeApi();
  if (ytReady) startPlayer(ytWantId);
}
const volInput = document.getElementById("bgm-vol");
const syncVol = () => { volInput.style.setProperty("--p", `${volInput.value}%`); };
volInput.addEventListener("input", () => { bgmVolume = Number(volInput.value); syncVol(); applyRoomAudioVolume(); try { ytPlayer?.setVolume(bgmVolume); } catch (_) {} });
syncVol();
document.getElementById("bgm-mute").addEventListener("click", () => {
  bgmMuted = !bgmMuted;
  document.getElementById("bgm-mute-icon").setAttribute("d", bgmMuted ? MUTE_PATH : SPK_PATH);
  applyRoomAudioVolume();
  try { bgmMuted ? ytPlayer?.mute() : ytPlayer?.unMute(); } catch (_) {}
});
document.getElementById("bgm-stop").addEventListener("click", () => {
  bgmStopped = bgmLast?.startedAt || true; bgmKey = ""; stopPlayer();
  for (const slot of Object.values(roomAudio)) if (slot.url) halted.add(slot.url); // the room's own audio stops too, until the GM sets a different file
  syncRoomAudio(sceneData);
});
// Room audio: CCFOLIA's own BGM file (media) and effect / ambient sound (sound), played in two <audio> elements next to the YouTube BGM.
// Volume = the room's volume x this bar's slider; mute and stop apply to both. A changed address starts from the beginning, none stops it.
let ytPlaying = false;
const roomAudio = { media: { el: null, url: "", cfg: null }, sound: { el: null, url: "", cfg: null } };
const halted = new Set();
const roomAudioOn = () => Object.values(roomAudio).some(slot => slot.url);
function refreshBgmBar() {
  bgmBar.hidden = !(ytPlaying || roomAudioOn());
  if (!ytPlaying) document.getElementById("bgm-name").textContent = roomAudio.media.cfg?.name || roomAudio.sound.cfg?.name || "BGM";
  playBtn.hidden = !blockedAudio;
}
let blockedAudio = false;
const playBtn = document.createElement("button"); playBtn.type = "button"; playBtn.id = "bgm-play"; playBtn.hidden = true; playBtn.setAttribute("aria-label", "BGM 재생"); playBtn.title = "BGM 재생";
playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
document.querySelector("#bgm-bar .bgm-row1").append(playBtn);
playBtn.addEventListener("click", () => { blockedAudio = false; refreshBgmBar(); for (const slot of Object.values(roomAudio)) slot.el?.play().catch(() => { blockedAudio = true; refreshBgmBar(); }); });
function applyRoomAudioVolume() {
  for (const slot of Object.values(roomAudio)) if (slot.el && slot.cfg) { slot.el.volume = Math.max(0, Math.min(1, slot.cfg.volume * (bgmVolume / 100))); slot.el.muted = bgmMuted; }
}
function syncRoomAudio(scene) {
  for (const kind of ["media", "sound"]) {
    const slot = roomAudio[kind], cfg = scene?.[kind] || null;
    if (!cfg || halted.has(cfg.url)) {
      if (slot.el) { slot.el.pause(); slot.el.removeAttribute("src"); }
      slot.url = ""; slot.cfg = null; continue;
    }
    slot.cfg = cfg; slot.el ||= new Audio(); slot.el.loop = cfg.repeat; applyRoomAudioVolume();
    if (slot.url !== cfg.url) {
      slot.url = cfg.url; slot.el.src = cfg.url; slot.el.currentTime = 0;
      slot.el.play().catch(() => { blockedAudio = true; refreshBgmBar(); }); // autoplay blocked: the bar shows one play button
    }
  }
  refreshBgmBar();
}
const seekInput = document.getElementById("bgm-seek");
seekInput.addEventListener("pointerdown", () => { seekInput.dataset.dragging = "1"; });
seekInput.addEventListener("input", () => { seekInput.style.setProperty("--p", `${seekInput.value / 10}%`); });
seekInput.addEventListener("change", () => { delete seekInput.dataset.dragging; try { const dur = ytPlayer?.getDuration?.() || 0; ytPlayer?.seekTo((seekInput.value / 1000) * dur, true); } catch (_) {} });
seekInput.addEventListener("pointerup", () => { delete seekInput.dataset.dragging; });
// Handout popup: when the GM shares (or updates) a handout it pops up over the page like a CCFOLIA dialog; "핸드아웃" in the header reopens it.
const handoutEl = document.getElementById("handout");
let handoutSeen = "", handoutClosed = "";
// The time the GM let this person in (the relay's /status): a handout pops up by itself only when it was shared or changed after that; what was already there when they came in is only in their list
// (with the dot for unread). Without a time (people let in before the relay kept it) every new one pops up as before.
let approvedAt = "";
const arrivedAfterApproval = updatedAt => !approvedAt || Date.parse(updatedAt) > Date.parse(approvedAt);
{
  const backdrop = document.createElement("div"); backdrop.id = "handout-backdrop"; backdrop.hidden = true;
  const close = document.createElement("button"); close.type = "button"; close.id = "handout-close"; close.textContent = "닫기";
  handoutEl.append(close);
  document.body.append(backdrop);
  const hide = () => { handoutEl.classList.remove("open"); backdrop.hidden = true; handoutClosed = handoutSeen; };
  close.addEventListener("click", hide); backdrop.addEventListener("click", hide);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && handoutEl.classList.contains("open")) hide(); });
  document.getElementById("handout-open").addEventListener("click", () => { if (myHandouts.length) { openHandoutList(); return; } handoutEl.hidden = false; handoutEl.classList.add("open"); backdrop.hidden = false; });
  window.syncHandoutPopup = handout => {
    const has = !!handout.id;
    legacyHandout = has; refreshHandoutButton();
    if (!has) { handoutEl.hidden = true; handoutEl.classList.remove("open"); backdrop.hidden = true; handoutSeen = ""; return; }
    const key = `${handout.id}:${handout.updatedAt || ""}`;
    handoutEl.hidden = false;
    // it pops up when it is new or changed, not again on every reload: what was shown is remembered in the browser
    const shownBefore = (() => { try { const stored = localStorage.getItem("capybara-handout-legacy-shown") || ""; return stored === key || (!handout.updatedAt && stored.startsWith(`${handout.id}:`)); } catch (_) { return false; } })(); // a state without its time stamp (before the full one arrives) is the same handout
    if (key !== handoutSeen && !(!handout.updatedAt && handoutSeen.startsWith(`${handout.id}:`))) { handoutSeen = key; try { if (handout.updatedAt || !shownBefore) localStorage.setItem("capybara-handout-legacy-shown", key); } catch (_) {} if (!shownBefore && arrivedAfterApproval(handout.updatedAt)) { handoutEl.classList.add("open"); backdrop.hidden = false; } }
  };
}
// ---- My handouts: the GM's handout tool works out what each person may read (title, body with its formatting, the secret part only for those who may read it) and the relay gives a participant only their own list.
// New or changed ones pop up once; the header button opens the list; a dot shows what has not been opened. Bodies are cleaned again here (same code as the relay) and drawn without inline styles in the markup (CSP): style goes through the CSSOM.
let myHandouts = [], legacyHandout = false;
const handoutSeenKey = "capybara-handout-seen";
const readSeen = () => { try { return JSON.parse(localStorage.getItem(handoutSeenKey) || "{}") || {}; } catch (_) { return {}; } };
const writeSeen = seen => { try { localStorage.setItem(handoutSeenKey, JSON.stringify(seen)); } catch (_) {} };
const handoutStamp = item => `${item.updatedAt || ""}|${item.html.length}|${item.secretHtml.length}`;
const handoutIsNew = item => readSeen()[item.id] !== handoutStamp(item);
function refreshHandoutButton() {
  const button = document.getElementById("handout-open");
  button.hidden = !(legacyHandout || myHandouts.length);
  button.classList.toggle("has-new", myHandouts.some(handoutIsNew));
  syncTopBar?.();
}
async function handoutNodes(html) {
  const { cleanHandoutHtml } = await import("/handout-sanitize.mjs");
  const markup = cleanHandoutHtml(html).replace(/<[^<>]*>/g, tag => tag.replace(/ style="/g, ' data-cm-style="'));
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${markup}`, "text/html");
  const root = document.importNode(doc.body, true);
  for (const element of root.querySelectorAll("[data-cm-style]")) { element.style.cssText = element.getAttribute("data-cm-style"); element.removeAttribute("data-cm-style"); }
  return [...root.childNodes];
}
async function openHandoutDetail(id) {
  const item = myHandouts.find(h => h.id === id); if (!item) return;
  const seen = readSeen(); seen[item.id] = handoutStamp(item); writeSeen(seen); refreshHandoutButton();
  const body = await handoutNodes(item.html), secret = item.secretHtml ? await handoutNodes(item.secretHtml) : null;
  openDialog(item.title || "핸드아웃", (box, foot, close) => {
    box.classList.add("handout-detail"); box.id = "handout-detail";
    const main = el("div", "handout-body"); main.append(...body); box.append(main);
    if (secret) { const part = el("section", "handout-secret"); part.append(el("h3", "", "비밀 (읽을 권한이 있는 사람에게만 보입니다)")); const inner = el("div", "handout-body"); inner.append(...secret); part.append(inner); box.append(part); }
    if (myHandouts.length > 1) { const back = el("button", "", "목록"); back.type = "button"; back.addEventListener("click", () => { close(); openHandoutList(); }); foot.prepend(back); }
  });
}
function openHandoutList() {
  openDialog("핸드아웃", (box, foot, close) => {
    box.classList.add("handout-list");
    const groups = new Map();
    for (const item of [...myHandouts].sort((a, b) => a.order - b.order)) { const key = item.folder || ""; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
    for (const [folder, items] of groups) {
      if (folder) box.append(el("h3", "handout-folder", folder));
      for (const item of items) {
        const row = el("button", "handout-row"); row.type = "button";
        row.append(el("span", "handout-title", item.title || "(제목 없음)")); if (handoutIsNew(item)) row.append(el("i", "handout-dot"));
        if (item.secretHtml) row.append(el("small", "", "비밀 포함"));
        row.addEventListener("click", () => { close(); openHandoutDetail(item.id); }); box.append(row);
      }
    }
    if (!myHandouts.length) box.append(el("p", "", "받은 핸드아웃이 없습니다."));
  });
}
// the list arrived (loaded, or pushed by the relay): what is new pops up once, the newest first
function applyMyHandouts(items, announce) {
  const before = new Map(myHandouts.map(h => [h.id, handoutStamp(h)]));
  myHandouts = Array.isArray(items) ? items : [];
  refreshHandoutButton();
  if (!announce) return;
  const fresh = myHandouts.filter(h => handoutIsNew(h) && before.get(h.id) !== handoutStamp(h) && arrivedAfterApproval(h.updatedAt));
  if (fresh.length) openHandoutDetail([...fresh].sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)))[0].id); // the most recently changed one (the first listed on a tie)
}
async function loadMyHandouts(announce = false) {
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/my-handouts`);
    if (response.ok) applyMyHandouts((await response.json()).items, announce);
  } catch (_) { /* the legacy single handout keeps working */ }
}
// Floating window: Document Picture-in-Picture (Chrome/Edge 116+) keeps the chat panel in an always-on-top window next to CCFOLIA, no install needed.
{
  const button = document.getElementById("pip-open");
  if ("documentPictureInPicture" in window) {
    button.hidden = false;
    button.addEventListener("click", async () => {
      if (window.documentPictureInPicture.window) { window.documentPictureInPicture.window.close(); return; }
      const chat = document.querySelector(".chat"), parent = chat.parentElement, next = chat.nextSibling;
      const pip = await window.documentPictureInPicture.requestWindow({ width: 380, height: 640 });
      for (const link of document.querySelectorAll('link[rel="stylesheet"]')) pip.document.head.append(link.cloneNode(true));
      pip.document.documentElement.className = "pip"; pip.document.body.className = "pip"; pip.document.body.append(chat);
      button.textContent = "플로팅 창 닫기";
      pip.addEventListener("pagehide", () => { parent.insertBefore(chat, next); button.textContent = "플로팅 창"; });
    });
  }
}
// Chat tabs mirror the GM's CCFOLIA tabs (메인 / 정보 / 잡담 / custom); each shows only its own messages and sends into itself.
// The room as the GM sees it: blurred background, field image, pieces and characters. One unit = 24px at zoom 1 (measured on ccfolia.com);
// the whole field is scaled to fit the window. Positions are top-left offsets from the field centre, in units.
let sceneData = null;
const moved = new Map(); // id -> { x, y, at }: a piece the participant just dropped, shown there until the GM's scene catches up
// CCFOLIA keeps the screen scale of the last visit in the browser (its stored app state; the position is not kept, measured: after a reload the scale stays and the position is 0,0): same here, per browser.
const SCALE_KEY = "capybara-screen-scale";
const savedScale = (() => { try { const value = Number(localStorage.getItem(SCALE_KEY)); return value >= 0.2 && value <= 2 ? value : 1; } catch (_) { return 1; } })();
const view = { zoom: savedScale, x: 0, y: 0, unit: 24 }; // camera: zoom multiplier on the fitted size, pan in px — each viewer has their own, like CCFOLIA
function renderScene(scene) {
  if (scene !== undefined) { sceneData = scene; syncRoomAudio(scene); }
  const box = document.getElementById("scene"), field = document.getElementById("scene-field"), bg = document.getElementById("scene-bg");
  const stage = box.parentElement;
  if (!sceneData) { box.hidden = true; return; }
  box.hidden = false;
  const s = sceneData;
  bg.style.backgroundColor = s.backgroundColor || "";
  bg.style.backgroundImage = s.backgroundUrl ? `url("${s.backgroundUrl}")` : "none";
  const w = stage.clientWidth, h = stage.clientHeight;
  // CCFOLIA's own view (read from its app code): a cell is 24px times the screen scale (0.2 .. 2, default 1), the field is centred on the stage; there is no fit-to-window. A first view that the GM sent
  // A player entering CCFOLIA starts at scale 1, position 0,0 (measured on a player screen), not at the GM's view.
  const unit = 24 * view.zoom;
  view.unit = unit; view.base = unit / view.zoom;
  const place = (el, x, y, width, height, angle, z) => {
    el.style.position = "absolute";
    el.style.left = `${(w / 2) + view.x + x * unit}px`; el.style.top = `${(h / 2) + view.y + y * unit}px`;
    el.style.width = `${width * unit}px`; el.style.height = `${height * unit}px`;
    el.style.transform = angle ? `rotate(${angle}deg)` : "";
    el.style.zIndex = String(Math.round(z || 0) + 10);
  };
  const nodes = [];
  // The field exactly as CCFOLIA's app code draws it: it starts trunc(size/2) cells left of / above the centre; the room background image fills it, the foreground image lies over that
  // (both with fieldObjectFit); with no image at all the default grid (1px lines, alpha .1) and a 4px dark outline show; with "display grid" on, a grid lies over the images
  // (line width 1 / 1.8 / 2.6px by zoom, alpha .25, every gridSize cells). Pieces are drawn above it.
  {
    const hasImage = !!(s.backgroundUrl || s.foregroundUrl), scale = unit / 24, lineWidth = scale < 0.3 ? 2.6 : scale < 0.6 ? 1.8 : 1;
    const lines = (alpha, width) => `linear-gradient(rgba(255, 255, 255, ${alpha}) ${width}px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, ${alpha}) ${width}px, transparent 1px)`;
    const field = document.createElement("div");
    place(field, -Math.trunc(s.fieldWidth / 2), -Math.trunc(s.fieldHeight / 2), s.fieldWidth, s.fieldHeight, 0, -9);
    field.style.boxSizing = "border-box"; field.style.backgroundSize = `${unit}px ${unit}px`;
    if (!hasImage && !s.displayGrid) field.style.backgroundImage = lines(0.1, 1);
    if (!hasImage) field.style.outline = "4px solid rgba(0, 0, 0, 0.2)";
    const layer = url => { const img = document.createElement("img"); img.src = url; img.alt = ""; img.referrerPolicy = "no-referrer"; img.draggable = false; img.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;object-fit:${s.fieldObjectFit}`; field.append(img); };
    if (s.backgroundUrl) layer(s.backgroundUrl);
    if (s.foregroundUrl) layer(s.foregroundUrl);
    if (s.displayGrid) {
      const grid = document.createElement("div"), step = unit * (s.gridSize || 1);
      grid.style.cssText = `position:absolute;left:-1px;top:-1px;width:${s.fieldWidth * unit + 1}px;height:${s.fieldHeight * unit + 1}px;box-sizing:border-box;background-image:${lines(hasImage ? 0.25 : 0.1, lineWidth)};background-size:${step}px ${step}px`;
      field.append(grid);
    }
    nodes.push(field);
  }
  // Layers measured on ccfolia.com (GM tab): panels z-index = their z (1), decks 1 (the deck's zIndex field, not its z), characters 100 + z, dice symbols 10000 (above everything).
  // Pieces store x/y in grid units, characters in pixels at zoom 1 (24px = 1 unit); sizes are in grid units for both.
  // Markers share the items' layer in CCFOLIA (same container, same grid units, drawn after the items of the same z); they cannot be moved by a participant.
  // Layer (measured on ccfolia.com 1.37.5): an item or marker wrapper has z-index = its stored z, a character wrapper has 100 + its stored z, so characters are above items and markers
  // (a stored z of 100 or more on an item is the only way to get above a character); equal layers keep the DOM order items, markers.
  const layerOf = piece => (piece.kind === "character" ? 100 : 0) + (Number(piece.z) || 0);
  const all = [...(s.decks || []).map(deck => ({ ...deck, z: deck.layer ?? 1, unitsXY: true, kind: "deck", imageUrl: deck.coverUrl.startsWith("/") ? (cmMirror.assets[deck.coverUrl] || "") : deck.coverUrl })).filter(deck => deck.imageUrl), ...(s.diceSymbols || []).map(die => ({ ...die, unitsXY: true, kind: "dice", z: 10000 })), ...(s.items || []).map(item => ({ ...item, unitsXY: true, kind: "item" })), ...(s.markers || []).map(marker => ({ ...marker, unitsXY: true, kind: "marker" })), ...(s.characters || []).map(c => ({ ...c, kind: "character" }))];
  for (const item of all.sort((a, b) => layerOf(a) - layerOf(b))) {
    if (window.__goneIds?.has(item.id)) continue; // deleted a moment ago: gone at once, before the GM page confirms
    // a dice symbol is drawn as a die face with its value ("?" while hidden); a card deck shows its back with the number of cards left in the middle
    if (item.kind === "dice") {
      // CCFOLIA draws a die as the picture /images/{faces}_dice/{faces}_dice[{value}].png ([0] while hidden); the GM page sends those pictures as assets. Without the picture: a plain face.
      const mine = ownedIds.has(item.id); // a participant's own dice symbol can be dragged like a piece
      const picture = cmMirror.assets[`/images/${item.faces}_dice/${item.faces}_dice[${item.closed ? 0 : item.value}].png`];
      if (picture) {
        const face = document.createElement("img"); face.src = picture; face.alt = ""; face.draggable = false; face.dataset.dieId = item.id; face.className = "scene-die-img";
        if (mine) { face.classList.add("mine"); if (window.__selectedDie === item.id) face.classList.add("selected"); face.dataset.kind = "dice"; face.dataset.id = item.id; face.dataset.x = item.x; face.dataset.y = item.y; const drop = moved.get(item.id); if (drop && Date.now() - drop.at < 5000) { item.x = drop.x; item.y = drop.y; } else moved.delete(item.id); }
        place(face, item.x, item.y, item.width, item.height, 0, layerOf(item)); face.style.objectFit = "fill"; nodes.push(face); continue;
      }
      const die = document.createElement("div"); die.className = "scene-die"; die.dataset.dieId = item.id; die.textContent = item.closed ? "?" : String(item.value);
      if (mine) { die.classList.add("mine"); if (window.__selectedDie === item.id) die.classList.add("selected"); die.dataset.kind = "dice"; die.dataset.id = item.id; die.dataset.x = item.x; die.dataset.y = item.y; const drop = moved.get(item.id); if (drop && Date.now() - drop.at < 5000) { item.x = drop.x; item.y = drop.y; } else moved.delete(item.id); }
      place(die, item.x, item.y, item.width, item.height, 0, layerOf(item)); die.style.fontSize = `${Math.round(item.height * unit * 0.5)}px`; nodes.push(die); continue;
    }
    const img = document.createElement("img"); img.src = item.imageUrl || item.iconUrl; img.alt = item.name || ""; img.referrerPolicy = "no-referrer"; img.draggable = false;
    const drop = moved.get(item.id);
    if (drop && Date.now() - drop.at < 5000) { item.x = drop.x; item.y = drop.y; } else moved.delete(item.id);
    if (item.kind === "deck") img.dataset.kind = "deck"; // a deck is not a piece the participant moves: no id, so a press on it pans like on the background
    else if (item.id && item.kind !== "marker") { img.dataset.kind = item.kind; img.dataset.id = item.id; img.dataset.x = item.x; img.dataset.y = item.y; if (item.locked) img.dataset.locked = "1"; if (window.__selectedDie === item.id) img.classList.add("selected"); }
    place(img, item.unitsXY ? item.x : item.x / 24, item.unitsXY ? item.y : item.y / 24, item.width, item.height, item.angle, layerOf(item));
    img.style.objectFit = "fill"; nodes.push(img);
    if (item.kind === "deck") {
      const badge = document.createElement("span"); badge.className = "deck-count"; badge.textContent = `${item.count} 장`;
      place(badge, item.x + item.width / 2, item.y + item.height / 2, 0, 0, 0, layerOf(item)); // CCFOLIA draws the field inside a container scaled by the screen scale (measured: matrix(0.6, ...)), so the chip grows and shrinks with it: 32px high, 13px text, 12px side padding and 16px corners at scale 1
      const k = unit / 24; badge.style.width = "auto"; badge.style.height = `${32 * k}px`; badge.style.fontSize = `${13 * k}px`; badge.style.lineHeight = `${32 * k}px`; badge.style.padding = `0 ${12 * k}px`; badge.style.borderRadius = `${16 * k}px`; nodes.push(badge);
    }
    // A character token carries its name under it (measured on ccfolia.com: bottom -11.9px of the 96px token, centred, 12px bold, black, 1px #f5f5f5 outline in eight directions, ellipsis within the token width).
    if (item.kind === "character" && item.name) {
      const scale = unit / 24, label = document.createElement("span"), px = value => `${Math.round(value * scale * 100) / 100}px`;
      label.textContent = item.name;
      place(label, item.x / 24 + item.width / 2, item.y / 24 + item.height, 0, 0, 0, layerOf(item));
      label.style.cssText += `;width:auto;height:${px(19.92)};max-width:${px(item.width * 24)};transform:translate(-50%,${px(-8)});font:700 ${px(12)}/${px(19.92)} Roboto,Helvetica,Arial,sans-serif;letter-spacing:${px(0.4)};color:#000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;text-shadow:${[[1, 1], [-1, -1], [-1, 1], [1, -1], [0, 1], [0, -1], [-1, 0], [1, 0]].map(([x, y]) => `${px(x)} ${px(y)} 0 #f5f5f5`).join(",")}`;
      label.dataset.label = item.id; nodes.push(label);
    }
  }
  field.replaceChildren(...nodes);
  renderStatusPanel(s.characters || []);
  renderSpeakers(s.characters || []);
  window.syncZoomBar?.();
}
// Top-left status panel, like CCFOLIA's: avatar (+ initiative badge) and a 2-column grid of 96x16 bars (label left, value/max right).
function renderStatusPanel(characters) {
  const box = document.getElementById("scene-status");
  const rows = characters.filter(c => !c.hideStatus && c.status && c.status.length).sort((a, b) => (a.initiative || 0) - (b.initiative || 0)).reverse();
  box.replaceChildren(...rows.map(c => {
    const row = document.createElement("div"); row.className = "st-char";
    const avatar = document.createElement("div"); avatar.className = "st-avatar";
    const img = document.createElement("img"); img.src = c.iconUrl; img.alt = c.name || ""; img.referrerPolicy = "no-referrer"; avatar.append(img);
    if (c.initiative) { const badge = document.createElement("span"); badge.className = "st-badge"; badge.textContent = String(c.initiative); avatar.append(badge); }
    const bars = document.createElement("div"); bars.className = "st-bars";
    for (const st of c.status) {
      const bar = document.createElement("div"); bar.className = "st-bar";
      const track = document.createElement("i"); track.className = "st-track";
      const fill = document.createElement("i"); fill.className = "st-fill";
      fill.style.width = `${st.max > 0 ? Math.max(0, Math.min(100, (st.value / st.max) * 100)) : 0}%`; // CCFOLIA: 0 wide without a maximum (measured: HP 0/0 shows only the dim track)
      const label = document.createElement("b"); label.textContent = st.label;
      const value = document.createElement("b"); value.className = "st-value";
      const cur = document.createElement("span"); cur.textContent = String(st.value);
      if (st.max > 0 && st.value / st.max <= 0.7) cur.style.color = "#9a0036";
      value.append(cur); if (st.max > 0) value.append(`/${st.max}`);
      bar.dataset.char = c.id; bar.dataset.index = String(c.status.indexOf(st)); bar.dataset.value = String(st.value); bar.title = "클릭해서 값 바꾸기";
      bar.append(track, fill, label, value); bars.append(bar);
    }
    row.append(avatar, bars); return row;
  }));
}
// Speaker: the participant's own name, or any visible character (the GM side checks again before sending).
const SPEAKER_KEY = "capybara-speaker";
const speaker = document.createElement("select"); speaker.id = "speaker"; speaker.setAttribute("aria-label", "화자"); speaker.title = "화자";
speaker.hidden = true; document.getElementById("chat-form").append(speaker);
function renderSpeakers(characters) {
  let want = speaker.value; try { want ||= localStorage.getItem(SPEAKER_KEY) || ""; } catch (_) {}
  speaker.replaceChildren(new Option("내 이름", ""), ...characters.map(c => new Option(c.name || "(이름 없음)", c.id)));
  speaker.value = characters.some(c => c.id === want) ? want : "";
  refreshSpeakerUi();
}
speaker.addEventListener("change", () => { try { localStorage.setItem(SPEAKER_KEY, speaker.value); } catch (_) {} refreshSpeakerUi(); });
// Click a status bar to set its value; one command, the GM side applies it.
document.getElementById("scene-status").addEventListener("click", async event => {
  const bar = event.target.closest(".st-bar"); if (!bar) return;
  const answer = prompt("새 값", bar.dataset.value); if (answer === null || answer.trim() === "" || !Number.isFinite(Number(answer))) return;
  try { const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/status/set`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterId: bar.dataset.char, index: Number(bar.dataset.index), value: Number(answer) }) }); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "상태값을 바꾸지 못했습니다."); const result = await waitForCommand((await response.json().catch(() => ({}))).commandId); if (!result.ok) throw new Error(result.error); } catch (error) { showSendStatus(error.message || "상태값을 바꾸지 못했습니다.", 6000); }
});
window.addEventListener("resize", () => renderScene());
// Zoom (wheel or +/- buttons) and pan (drag) of the stage.
{
  const stage = document.querySelector(".stage");
  stage.addEventListener("dragstart", event => event.preventDefault()); // an image is never dragged by the browser (CCFOLIA: draggable false, user-drag none)
  let raf = 0;
  const redraw = () => { try { localStorage.setItem(SCALE_KEY, String(Math.round(view.zoom * 100) / 100)); } catch (_) {} if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderScene(); }); };
  const zoomAt = (factor, cx, cy) => {
    view.touched = true;
    const next = Math.max(0.2, Math.min(2, view.zoom * factor));
    const k = next / view.zoom;
    view.x = cx - (cx - view.x) * k; view.y = cy - (cy - view.y) * k; view.zoom = next;
    redraw();
  };
  // CCFOLIA's wheel zoom (measured by sending wheel events to its page): one wheel event is one step of 0.1 in the screen scale whatever the delta, up = larger, kept within 0.2..2, around the middle of the field
  // (the position scales with the scale, the pointer is not the anchor).
  const stepScale = step => { const now = view.base * view.zoom / 24; zoomAt(Math.max(0.2, Math.min(2, Math.round((now + step) * 10) / 10)) / now, 0, 0); };
  const interactive = target => target.closest("#scene-status, #bgm-bar, #zoom-ctl, #zoom-host, .scene-tool, .pen-menu, #handout, #room > header");
  stage.addEventListener("wheel", event => {
    if (interactive(event.target)) return;
    event.preventDefault();
    stepScale(event.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });
  let drag = null;
  let piece = null; // a movable piece being dragged (drawn only until drop; one command is sent on release)
  stage.addEventListener("pointerdown", event => {
    if (event.button !== 0 || interactive(event.target)) return;
    if (event.target.dataset?.id) { piece = { el: event.target, x: event.clientX, y: event.clientY, dx: 0, dy: 0, locked: event.target.dataset.locked === "1" }; stage.setPointerCapture?.(event.pointerId); return; }
    view.touched = true;
    drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    stage.setPointerCapture?.(event.pointerId); stage.classList.add("panning");
  });
  stage.addEventListener("pointermove", event => {
    if (piece) { if (piece.locked) return; piece.dx = event.clientX - piece.x; piece.dy = event.clientY - piece.y; piece.el.style.translate = `${piece.dx}px ${piece.dy}px`; return; }
    if (!drag) return;
    view.x = drag.vx + event.clientX - drag.x; view.y = drag.vy + event.clientY - drag.y; redraw();
  });
  const dropPiece = async () => {
    const { el, dx, dy } = piece; piece = null;
    if (Math.abs(dx) + Math.abs(dy) < 4 || el.dataset.locked === "1") { el.style.translate = ""; if (el.dataset.kind === "character") openSheet(el.dataset.id); return; } // a click (or a locked piece): the character sheet
    const { kind, id } = el.dataset, isChar = kind === "character";
    const k = (isChar ? 24 : 1) / view.unit; // screen px -> the piece's own unit (characters: px at zoom 1, items: grid cells)
    const round = v => isChar ? Math.round(v) : Math.round(v * 100) / 100;
    const x = round(Number(el.dataset.x) + dx * k), y = round(Number(el.dataset.y) + dy * k);
    moved.set(id, { x, y, at: Date.now() });
    // the piece stays where it was dropped while the GM's page does the move; if the relay or the GM's page refuses, it goes back and says why (it used to snap back after a few seconds without a word)
    renderScene();
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/pieces/move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, x, y }) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "이동 요청 실패");
      const answer = await waitForCommand((await response.json().catch(() => ({}))).commandId);
      if (!answer.ok) throw new Error(answer.error);
    } catch (error) { moved.delete(id); showSendStatus(error.message || "옮기지 못했습니다.", 6000); renderScene(); }
  };
  const endDrag = () => { if (piece) { dropPiece(); return; } drag = null; stage.classList.remove("panning"); };
  stage.addEventListener("pointerup", endDrag); stage.addEventListener("pointercancel", endDrag);
  // Own dice symbols (a CCFOLIA player moves, rolls and deletes only the ones they made): a click or right click selects (blue outline) and the right click opens the menu.
  // optimistic delete: the piece leaves the screen at once; if the request fails it comes back
  const removeNow = async (id, request) => { (window.__goneIds ||= new Set()).add(id); renderScene(); const answer = await request(); if (!answer.ok) { window.__goneIds.delete(id); renderScene(); } else setTimeout(() => window.__goneIds?.delete(id), 8000); return answer; };
  const pieceNode = target => target.closest?.(".scene-die.mine,.scene-die-img.mine,img[data-kind=character]") || null;
  const selectDie = node => { document.querySelectorAll(".stage .selected").forEach(n => n.classList.remove("selected")); window.__selectedDie = node ? node.dataset.id : null; node?.classList.add("selected"); };
  stage.addEventListener("pointerdown", event => { if (interactive(event.target)) return; selectDie(pieceNode(event.target)); }, true);
  stage.addEventListener("contextmenu", event => {
    if (interactive(event.target)) return;
    if (event.target.closest?.("#scene-field")) event.preventDefault(); // never the browser's image menu on the scene
    const node = pieceNode(event.target);
    if (!node) return;
    selectDie(node);
    const id = node.dataset.id, fail = answer => { if (!answer.ok) showSendStatus(answer.error || "처리하지 못했습니다.", 6000); };
    const anchor = { setAttribute() {}, getBoundingClientRect: () => ({ left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY - 4 }) };
    if (node.dataset.kind === "dice") {
      const die = (sceneData?.diceSymbols || []).find(d => d.id === id) || {};
      const change = fields => dieRequest(id, fields);
      const field = (labelText, options, current, onChange) => {
        const wrap = el("label", "dm-field"), select = el("select", "dm-select");
        for (const [value, text] of options) { const option = el("option", "", text); option.value = String(value); select.append(option); }
        select.value = String(current); select.addEventListener("change", () => onChange(Number(select.value)));
        wrap.append(el("span", "dm-label", labelText), select); return wrap;
      };
      const faces = Number(die.faces) || 6, hidden = die.closed === true;
      const box = el("div", "dm-box");
      const toggle = Object.assign(el("input", "dm-switch"), { type: "checkbox", checked: hidden }); toggle.addEventListener("change", () => change({ closed: toggle.checked }));
      const hideRow = el("label", "dm-row"); hideRow.append(el("span", "", "숨기기"), toggle);
      box.append(
        field("다이스", [4, 6, 8, 10, 12, 20].map(n => [n, `D${n}`]), faces, n => { change({ faces: n }); closeMenu(); }),
        field("값", Array.from({ length: faces }, (_, i) => [i + 1, String(i + 1)]), Number(die.value) || 1, n => change({ value: n })),
        hideRow);
      openMenu(anchor, [
        { node: box },
        { label: "roll a dice", run: () => rollDie(id) },
        { label: "삭제", run: async () => { selectDie(null); fail(await removeNow(id, () => characterRequest("delete", { kind: "dice", id }))); } }
      ], "ctx-menu dice-menu");
      return;
    }
    // A character, as CCFOLIA's player menu lists it. What this page can do for the person: look at (or, for their own, edit) the sheet, put away, duplicate, delete, copy the id and
    // pick a palette line; rotate, take ownership and copy are shown but off until their native behaviour is measured.
    const mine = ownedIds.has(id), scene = (sceneData?.characters || []).find(c => c.id === id);
    const palette = String(scene?.commands || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    openMenu(anchor, [
      { label: "편집", run: () => editCharacter(id) },
      { label: "회전", key: "R or Shift+R", run: () => charAction("rotate", id) },
      { divider: true },
      { label: "집어넣기", key: "S", run: () => charAction("stow", id) },
      { label: "소유 권한 갖기", key: "T", disabled: mine, run: () => charAction("claim", id) },
      { label: "복제", key: "Ctrl+D", run: () => charAction("duplicate", id) },
      { label: "복사", key: "Ctrl+C", disabled: true },
      { divider: true },
      { label: "채팅 팔레트", key: "▸", disabled: !palette.length, run: () => openMenu(anchor, palette.map(line => ({ label: line.length > 40 ? `${line.slice(0, 40)}…` : line, run: () => insertAtCursor(line) })), "ctx-menu") },
      { divider: true },
      { label: "삭제", key: "Ctrl+⌫", run: () => charAction("delete", id) },
      { divider: true },
      { label: "ID 복사(개발자용)", run: () => navigator.clipboard?.writeText(id).catch(() => {}) }
    ], "ctx-menu");
  });
  // CCFOLIA: a double click rolls one's own die and opens the editor of a character (measured on the GM screen); it must not also reset the view
  stage.addEventListener("dblclick", event => {
    if (interactive(event.target)) return;
    const own = event.target.closest?.(".scene-die.mine,.scene-die-img.mine"), token = event.target.closest?.("img[data-kind=character]");
    if (own) { event.stopImmediatePropagation(); rollDie(own.dataset.id); }
    else if (token) { event.stopImmediatePropagation(); editCharacter(token.dataset.id); }
  });
  stage.addEventListener("dblclick", event => { if (!interactive(event.target)) { view.touched = true; view.zoom = 1; view.x = 0; view.y = 0; redraw(); } });
  const ctl = document.createElement("div"); ctl.id = "zoom-ctl";
  const mk = (label, title, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title); b.addEventListener("click", fn); return b; };
  ctl.append(
    mk("+", "확대", () => stepScale(0.1)),
    mk("−", "축소", () => stepScale(-0.1)),
    mk("⌂", "화면 맞춤", () => { view.zoom = 1; view.x = 0; view.y = 0; redraw(); }));
  stage.append(ctl);
  // Native mirroring: CCFOLIA's own zoom bar (magnifier buttons around a vertical slider), working like its code (read from the app): the scale is cell px / 24 (0.2 .. 2); the buttons add or
  // subtract 0.1 (min((10n+1)/10, 2), max((10n-1)/10, 0.2)); the slider has min 0.2, max 2, step 0.1 and its position scales with it. The play room's fit-to-window size is scale 1 x its base.
  let zoomUi = null;
  const scaleNow = () => view.base * view.zoom / 24;
  const setScale = target => zoomAt(target / scaleNow(), 0, 0);
  const zoomFraction = () => (Math.max(0.2, Math.min(2, scaleNow())) - 0.2) / 1.8;
  // MUI's value label (measured on CCFOLIA): the thumb's own span.MuiSlider-valueLabel shows the scale ("1", "0.6") while the thumb is hovered or dragged (class MuiSlider-valueLabelOpen, the mirrored CSS does the rest)
  window.syncZoomBar = () => { if (!zoomUi) return; const percent = `${Math.round(zoomFraction() * 1000) / 10}%`; zoomUi.track.style.height = percent; zoomUi.thumb.style.bottom = percent; if (zoomUi.label) zoomUi.label.textContent = String(Math.round(scaleNow() * 10) / 10); };
  window.renderMirroredZoom = () => {
    const on = cmMirror.has("zoomBar");
    ctl.hidden = on;
    if (!on) { document.getElementById("zoom-host")?.remove(); zoomUi = null; return; }
    cmMirror.shadow("zoom-host", node => { node.style.cssText = "position:absolute;inset:0;z-index:100000;color:#000;pointer-events:none"; stage.append(node); }); // the host covers the stage like CCFOLIA's container (the bar's own mirrored CSS puts it right 32px / bottom 96px); CCFOLIA's scene text colour is black: the white buttons carry black icons
    const bar = cmMirror.make("zoomBar"), slot = name => cmMirror.slot(bar, name);
    bar.style.pointerEvents = "auto";
    slot("zoomIn").addEventListener("click", () => setScale(Math.min((10 * scaleNow() + 1) / 10, 2)));
    slot("zoomOut").addEventListener("click", () => setScale(Math.max((10 * scaleNow() - 1) / 10, 0.2)));
    const slider = slot("slider");
    const setFromPointer = event => { const r = slider.getBoundingClientRect(); const p = Math.max(0, Math.min(1, 1 - (event.clientY - r.top) / (r.height || 1))); setScale(Math.round((0.2 + p * 1.8) * 10) / 10); };
    slider.addEventListener("pointerdown", event => { try { slider.setPointerCapture(event.pointerId); } catch (_) { /* a synthetic event has no active pointer */ } setFromPointer(event); slider.onpointermove = setFromPointer; });
    slider.addEventListener("pointerup", () => { slider.onpointermove = null; });
    zoomUi = { track: slot("track"), thumb: slot("thumb"), label: slot("thumb")?.querySelector(".MuiSlider-valueLabel") };
    if (zoomUi.label) {
      let hover = false, drag = false;
      const show = () => zoomUi.label.classList.toggle("MuiSlider-valueLabelOpen", hover || drag);
      slot("thumb").addEventListener("mouseover", () => { hover = true; show(); }); slot("thumb").addEventListener("mouseout", () => { hover = false; show(); });
      slider.addEventListener("pointerdown", () => { drag = true; show(); }); for (const target of [window, slider]) for (const type of ["pointerup", "pointercancel"]) target.addEventListener(type, () => { drag = false; show(); });
    }
    cmMirror.show("zoom-host", [bar]);
    // CCFOLIA's own CSS makes the bar absolute (right 32px, bottom 96px of the stage, measured); when the mirrored CSS does not, the same place is set here
    if (getComputedStyle(bar).position !== "absolute") { bar.style.position = "absolute"; bar.style.right = "32px"; bar.style.bottom = "96px"; }
    window.syncZoomBar();
  };
}
let activeChannel = "main";
const seenCount = {}, unread = new Set(); // per-channel message counts, to mark tabs that received something while another tab was open
const DEFAULT_CHANNELS = [{ id: "main", label: "메인" }, { id: "info", label: "정보" }, { id: "other", label: "잡담" }];
function trackUnread(data) {
  const counts = {};
  for (const message of data.messages || []) { const channel = message.channel || "main"; counts[channel] = (counts[channel] || 0) + 1; }
  for (const channel of Object.keys(counts)) {
    if (channel in seenCount && counts[channel] > seenCount[channel] && channel !== activeChannel) unread.add(channel);
    seenCount[channel] = counts[channel];
  }
  unread.delete(activeChannel);
}
function renderTabs(data) {
  if ("scene" in data) renderScene(data.scene);
  trackUnread(data);
  if (data.dicebot) document.getElementById("dicebot-version").textContent = data.dicebot;
  const channels = data.channels?.length ? data.channels : DEFAULT_CHANNELS;
  if (!channels.some(item => item.id === activeChannel)) activeChannel = channels[0].id;
  const bar = document.getElementById("chat-tabs");
  // Native mirroring: the tab strip is CCFOLIA's own (one template per state); the built-in buttons below are the fallback.
  const tabStates = cmMirror.has("chatTabsShell") && cmMirror.has("chatTabOn") && cmMirror.has("chatTabIdle");
  bar.hidden = tabStates;
  if (tabStates) {
    const { host } = cmMirror.shadow("chat-tabs-host", node => bar.after(node));
    const shell = cmMirror.make("chatTabsShell"), tabs = cmMirror.slot(shell, "tabs");
    for (const item of channels) {
      const selected = item.id === activeChannel, hasUnread = unread.has(item.id);
      const tab = cmMirror.make(selected ? "chatTabOn" : hasUnread && cmMirror.has("chatTabUnread") ? "chatTabUnread" : "chatTabIdle");
      const label = cmMirror.slot(tab, "label");
      if (label) label.insertBefore(document.createTextNode(item.label || item.id), label.firstChild);
      if (!selected && hasUnread && !cmMirror.has("chatTabUnread")) { const dot = document.createElement("i"); dot.style.cssText = "position:absolute;top:10px;right:6px;width:6px;height:6px;border-radius:50%;background:#f50057"; tab.append(dot); }
      tab.addEventListener("click", () => { if (activeChannel === item.id) return; activeChannel = item.id; rendered = false; renderState(current); });
      tabs.append(tab);
    }
    // the add-tab "+" a player also sees on CCFOLIA: same look, disabled (a player cannot add tabs)
    if (cmMirror.has("chatTabAdd")) { const add = cmMirror.make("chatTabAdd"); add.title = add.getAttribute("aria-label") || ""; add.disabled = true; add.classList.add("Mui-disabled"); tabs.append(add); }
    // the strip's own scroll arrows (left disabled, right shown, no action: nothing to scroll in this strip); without them the 40px slot is kept
    const stripRoot = tabs.closest(".MuiTabs-root"), arrowL = cmMirror.has("chatTabScrollL") && cmMirror.has("chatTabScrollR") && stripRoot;
    if (arrowL) { const left = cmMirror.make("chatTabScrollL"), right = cmMirror.make("chatTabScrollR"); stripRoot.prepend(left); stripRoot.append(right); }
    host.style.paddingLeft = arrowL ? "" : "40px";
    cmMirror.show("chat-tabs-host", [shell]);
    return;
  }
  document.getElementById("chat-tabs-host")?.remove();
  bar.replaceChildren(...channels.map(item => {
    const tab = document.createElement("button");
    tab.type = "button"; tab.className = "chat-tab"; tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(item.id === activeChannel));
    tab.textContent = item.label || item.id;
    if (unread.has(item.id)) { const dot = document.createElement("i"); dot.className = "unread-dot"; tab.append(dot); }
    tab.addEventListener("click", () => { if (activeChannel === item.id) return; activeChannel = item.id; rendered = false; renderState(current); });
    return tab;
  }));
}
// Thin notice at the top when the GM side found that a CCFOLIA update changed what the share reads.
const healthNote = document.createElement("div"); healthNote.id = "health-note"; healthNote.hidden = true; healthNote.textContent = "GM 쪽 코코포리아 업데이트로 일부 기능 점검 중";
document.body.append(healthNote);
function showHealth(health) { healthNote.hidden = !(health && health.ok === false); }
// The dice result after the text, coloured as CCFOLIA's chat row does (read from the app code): the secret-dice placeholder and failures are the secondary colour (#dc004e), successes the primary
// (#2196f3), and with no flags the Japanese words decide (成功 / スペシャル primary, 失敗 secondary); everything else is the dimmer text colour.
function rollResultSpan(roll) {
  const result = document.createElement("span"), text = String(roll.result || "");
  result.className = "roll-result"; result.textContent = ` ${text}`;
  const tone = roll.secret ? "secondary" : roll.success ? "primary" : roll.failure ? "secondary" : /成功|スペシャル/.test(text) ? "primary" : /失敗/.test(text) ? "secondary" : "";
  if (tone) result.style.color = tone === "primary" ? "#2196f3" : "#dc004e";
  return result;
}
// The toolkit's "prose mode" groups consecutive messages of the same speaker: the row gets data-ccf-prose-cont (leader / last) and its wrapper the -wrap variants, and the toolkit CSS hides the avatar and
// the name of the continued rows. Same rule as its scan (the displayed name, only ASCII edge spaces trimmed; narration rows are a separate group); only the attributes are set here.
function markSpeakerRuns(wrappers) {
  const keys = wrappers.map(wrapper => {
    const item = wrapper.querySelector(".MuiListItem-root"), head = wrapper.querySelector('[data-cm-slot="name"]');
    const name = head && [...head.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim());
    if (!item || !name) return null;
    const author = name.nodeValue.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "");
    return item.getAttribute("data-ccf-narration") === "1" || item.querySelector('.ccf-render-root[data-ccf-narration="1"]') ? `${author}\0nr` : author;
  });
  const set = (el, name, on) => { if (on) el.setAttribute(name, "1"); else el.removeAttribute(name); };
  wrappers.forEach((wrapper, i) => {
    const item = wrapper.querySelector(".MuiListItem-root");
    if (!item) return;
    const key = keys[i], cont = !!(key && key === keys[i - 1]), leader = !cont && !!(key && key === keys[i + 1]), last = cont && keys[i + 1] !== key;
    set(item, "data-ccf-prose-cont", cont); set(item, "data-ccf-prose-cont-leader", leader); set(item, "data-ccf-prose-cont-last", last);
    set(wrapper, "data-ccf-prose-cont-wrap", cont); set(wrapper, "data-ccf-prose-cont-wrap-last", last); set(wrapper, "data-ccf-prose-cont-leader-wrap", leader);
  });
}
const BLANK_ICON = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="; // a message without an icon (CCFOLIA uses its own blank image): no broken-image frame
// One message's data into a copy of the mirrored CCFOLIA row (slots: icon, name, time, body). Text is only ever set as text; the icon only from the CCFOLIA CDN.
function fillMirrorRow(row, message) {
  const icon = cmMirror.slot(row, "icon"), name = cmMirror.slot(row, "name"), time = cmMirror.slot(row, "time"), body = cmMirror.slot(row, "body");
  if (icon) { if (/^https:\/\/storage\.ccfolia-cdn\.net\//.test(message.icon || "")) { icon.referrerPolicy = "no-referrer"; icon.src = message.icon; } else icon.src = BLANK_ICON; }
  if (name) { name.insertBefore(document.createTextNode(!message.author || message.author === "이름 없음" ? "noname" : message.author), name.firstChild); if (/^#[0-9a-f]{3,8}$/i.test(message.color || "")) name.style.color = message.color; }
  if (time) time.textContent = ` - ${messageTime(message.createdAt)}`;
  if (body) {
    let info = { narration: false };
    if (cmMirror.toolkit()) info = renderRich(body, message.text || "", true);
    else body.textContent = decodeEnvelope(message.text || "").visible;
    if (info.narration) row.querySelector(".MuiListItem-root")?.setAttribute("data-ccf-narration", "1");
    if (info.bubble) row.querySelector(".MuiListItemText-root")?.classList.add("ccr20-roll20-bubble-container");
    const tail = () => body.lastElementChild || body;
    if (message.roll?.result) (tail()).append(rollResultSpan(message.roll));
    if (message.edited === true) { const edited = document.createElement("span"); edited.className = "msg-edited"; edited.textContent = " [편집 완료]"; tail().append(edited); }
  }
}
const isSameSpeakerRun = (previousName, message) => previousName !== null && previousName === (message.author || "noname");
const renderState = data => {
  showHealth(data.health);
  renderTabs(data);
  if (data.bgm) playBgm(data.bgm);
  document.getElementById("room-title").textContent = data.roomTitle || "플레이룸";
  const gm = document.getElementById("gm-state"); gm.dataset.online = data.gmOnline ? "1" : "0"; gm.title = data.gmOnline ? "GM 연결됨" : "GM 연결 지연";
  document.getElementById("status").textContent = data.gmOnline ? "동기화 중" : "새 메시지 전송을 기다리는 중";
  // Native mirroring: when the GM's CCFOLIA shapes and CSS have arrived, the list is drawn from them (mirror.js); otherwise the built-in rows below are used.
  if (data.mirror) cmMirror.sync(data.mirror, roomId).then(refreshHelpBtn);
  if (!window.__handoutsLoaded) { window.__handoutsLoaded = true; loadMyHandouts(true); refreshMyCharacters(); }
  const mirrored = cmMirror.has("chatShell") && cmMirror.has("chatRow");
  const list = mirrored ? cmMirror.shadow("messages-host", node => document.getElementById("messages").after(node)).host : document.getElementById("messages");
  document.getElementById("messages").hidden = mirrored;
  // The scrolling element: the page's #messages list, or (mirrored) the list element inside the shadow root, which CCFOLIA's CSS makes the one scroller (overflow-y: scroll) - the host does not scroll.
  const scroller = () => (mirrored ? list.shadowRoot?.querySelector("ul") : list) || list;
  const before = scroller(), previousTop = before.scrollTop;
  const stickToBottom = !rendered || before.scrollHeight - before.scrollTop - before.clientHeight < 40;
  const shown = (data.messages || []).filter(message => (message.channel || "main") === activeChannel);
  let previousName = null;
  if (mirrored) {
    const shell = cmMirror.make("chatShell"), rows = cmMirror.slot(shell, "rows");
    for (const message of shown) { const row = cmMirror.make("chatRow"); fillMirrorRow(row, message); rows.append(row); }
    markSpeakerRuns([...rows.children]);
    cmMirror.show("messages-host", [shell]);
  } else list.replaceChildren(...shown.map(message => {
    // Same layout as CCFOLIA's chat rows: 40px square avatar, bold name + caption time, 14px body.
    const item = document.createElement("li");
    // Measured on ccfolia.com: a message from the same speaker as the one right above (same name, any time gap) drops the avatar, the header and the top padding.
    if (isSameSpeakerRun(previousName, message)) item.classList.add("merged");
    previousName = message.author || "noname";
    for (const [flag, on] of Object.entries(message.roll || {})) if (on === true) item.classList.add(`roll-${flag}`);
    const name = message.author || "noname";
    const avatar = document.createElement("div"); avatar.className = "avatar";
    if (message.icon) { const img = document.createElement("img"); img.src = message.icon; img.alt = ""; img.referrerPolicy = "no-referrer"; img.addEventListener("error", () => { img.remove(); avatar.textContent = [...name][0] || "?"; }); avatar.append(img); }
    else avatar.textContent = [...name][0] || "?";
    const text = document.createElement("div"); text.className = "msg-text";
    const head = document.createElement("h6");
    const author = document.createElement("strong"); author.textContent = name;
    author.style.color = /^#[0-9a-f]{3,8}$/i.test(message.color || "") ? message.color : "#888";
    const time = document.createElement("span"); time.className = "msg-time"; time.textContent = messageTime(message.createdAt);
    head.append(author, " - ", time);
    const body = document.createElement("p"); renderRich(body, message.text || "");
    // Native rows show the typed text, then the dice result in a dimmer colour (measured: rgba(255,255,255,.7)).
    if (message.roll?.result) ((body.lastElementChild || body)).append(rollResultSpan(message.roll));
    // A message edited in CCFOLIA ends with " [편집 완료]" (measured: inline span, 12px, #757575, the same as the time).
    if (message.edited === true) { const edited = document.createElement("span"); edited.className = "msg-edited"; edited.textContent = " [편집 완료]"; (body.lastElementChild || body).append(edited); }
    text.append(head, body); item.append(avatar, text); return item;
  }));
  { const now = scroller(); now.scrollTop = stickToBottom ? now.scrollHeight : previousTop; }
  rendered = true;
  const handout = data.handout || {};
  syncHandoutPopup(handout);
  syncTopBar();
  document.getElementById("title").textContent = handout.title || "";
  document.getElementById("body").textContent = handout.bodyText || "";
  document.getElementById("updated").textContent = handout.updatedAt ? `갱신 ${new Date(handout.updatedAt).toLocaleString()}` : "";
};
// Next tick: fast polling until the push socket is up, then only a slow safety-net poll.
const schedule = () => {
  clearTimeout(timer); timer = 0;
  if (!mode) return;
  timer = setTimeout(async () => {
    try { await (mode === "live" ? refresh() : checkStatus()); } catch (_) { if (mode === "pending") setGate("상태 확인 지연", "error"); }
    schedule();
  }, mode === "live" && socketOpen ? LIVE_POLL_MS : POLL_MS);
};
async function refresh() {
  const seen = pushSeq;
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/state`);
  if (response.status === 403) return verifyAccess();
  if (transient(response)) return;
  if (!response.ok) return stop("접근이 취소되었거나 룸이 종료되었습니다.");
  const next = await response.json();
  if (pushSeq !== seen) {
    // Something was pushed while this request was in flight: never drop it.
    const known = new Set((next.messages || []).map(message => message.id));
    next.messages = [...(next.messages || []), ...current.messages.filter(message => !known.has(message.id))].slice(-MAX_MESSAGES);
    if ((current.handout?.updatedAt || "") > (next.handout?.updatedAt || "")) next.handout = current.handout;
  }
  current = next;
  renderState(current);
}
async function verifyAccess() {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/status`);
  if (transient(response)) return;
  if (!response.ok) return stop("접근이 취소되었습니다.");
  const data = await response.json();
  if (data.status !== "approved") stop(data.status === "rejected" ? "GM이 참가 요청을 거절했습니다." : "접근이 취소되었습니다.");
}
// Messages written with the toolkit's format tools carry an invisible envelope (formatRuns / alignRuns / blockStyle) after the visible text.
// This decodes it and renders bold/italic/underline/strike, colour, background, size, blur, code, ruby, tooltip, alignment and narration.
const INVIS_START = "\u2063\u2063\u2063", INVIS_END = "\u2062\u2062\u2062", INVIS_MAP = ["\u200B", "\u200C", "\u200D", "\u2060"];
function decodeEnvelope(full) {
  const a = full.indexOf(INVIS_START);
  if (a < 0) return { text: full, env: null, visible: full };
  const b = full.indexOf(INVIS_END, a + INVIS_START.length);
  if (b < 0) return { text: full, env: null, visible: full };
  try {
    let bits = "";
    for (const ch of full.slice(a + INVIS_START.length, b)) { const i = INVIS_MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, "0"); }
    let raw = "";
    for (let i = 0; i + 8 <= bits.length; i += 8) raw += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
    const env = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/\0+$/g, "")))));
    // The visible text is what is outside the envelope (it may stand before or after it, e.g. Roll20 header rows start with the envelope). The envelope's own text is what its runs
    // refer to; if it is not the visible text (the message was edited afterwards) the formatting is stale and the visible text is shown plain.
    const visible = full.slice(0, a) + full.slice(b + INVIS_END.length);
    if (env && typeof env.text === "string" && env.text.trim() !== visible.trim()) return { text: visible, env: null, visible };
    return { text: env && typeof env.text === "string" ? env.text : visible, env, visible };
  } catch (_) { return { text: full.slice(0, a), env: null, visible: full.slice(0, a) }; }
}
const safeColor = value => (typeof value === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value.trim())) ? value.trim() : "";
// Roll20 CSS macros (colour bands etc.) travel as style.extraCss. Same keys as the roll20-css-bridge, minus position/top/left/...
// (a message must not be able to cover the page); values stay short and cannot reference urls or escapes.
const EXTRA_CSS_KEYS = ["fontStyle", "fontFamily", "boxShadow", "backgroundPosition", "backgroundRepeat", "backgroundSize", "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight", "overflow", "textOverflow", "whiteSpace", "wordBreak", "overflowWrap", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "verticalAlign", "textTransform", "borderTop", "borderRight", "borderBottom", "borderLeft", "display"];
const applyExtraCss = (span, extra) => {
  if (!extra || typeof extra !== "object") return;
  for (const key of EXTRA_CSS_KEYS) {
    const value = extra[key];
    if (typeof value !== "string" || value.length > 240 || /url\(|expression|[\\@<>{}]/i.test(value)) continue;
    if (key === "display" && !/^(inline|block|inline-block)$/.test(value)) continue;
    span.style[key] = value;
  }
};
function styleSegment(span, style) {
  if (style.bold) span.style.fontWeight = "700";
  if (style.italic) span.style.fontStyle = "italic";
  const deco = []; if (style.underline) deco.push("underline"); if (style.strike) deco.push("line-through");
  if (deco.length) span.style.textDecoration = deco.join(" ");
  const color = safeColor(style.color); if (color) span.style.color = color;
  const bg = safeColor(style.backgroundColor); if (bg) span.style.backgroundColor = bg;
  const size = Math.round(Number(style.fontSize)); if (size >= 6 && size <= 120) span.style.fontSize = `${size}px`;
  if (style.blur) { span.style.webkitTextFillColor = "transparent"; span.style.textShadow = "0 0 6px #fff"; span.title = "클릭하면 보입니다"; span.addEventListener("click", () => { span.style.webkitTextFillColor = ""; span.style.textShadow = ""; }, { once: true }); }
  if (style.codeMode) { span.style.fontFamily = "monospace"; span.style.background = "rgba(255,255,255,.12)"; span.style.padding = "0 4px"; span.style.borderRadius = "3px"; }
  applyExtraCss(span, style.extraCss);
  if (style.tooltipText) { span.title = String(style.tooltipText).slice(0, 200); span.style.borderBottom = "1px dotted currentColor"; }
}
// Roll20 macro messages (envelope.roll20Macro) are drawn by the GM's roll20-css-bridge with its own names: p.ccr20-render-root.ccr20-roll20-bubble[data-ccr20-macro-background] > span.ccr20-line > span.ccr20-frag,
// the text container of the row gets .ccr20-roll20-bubble-container. Top-level run styles (display, padding, text-align, ...) are applied like its applyInlineStyle (values checked), then its layout safeguards
// and the colour-band centring (a "0 8px 0 15px" shadow becomes a clipped full-width band, data-ccr20-band) so that the toolkit CSS in mirror.css lays it out the same way.
const STYLE_VALUE = /^[#%.,\s\w()-]{1,60}$/;
const okValue = value => typeof value === "string" && STYLE_VALUE.test(value) && !/url|expression|javascript/i.test(value);
function applyToolkitStyle(span, style) {
  styleSegment(span, style);
  if (style.code) span.style.whiteSpace = "break-spaces";
  if (/^(inline|block|inline-block)$/.test(style.display || "")) span.style.display = style.display;
  for (const key of ["padding", "margin", "borderRadius", "letterSpacing", "lineHeight", "textShadow"]) if (okValue(style[key])) span.style[key] = style[key];
  if (/^(left|center|right)$/.test(style.textAlign || "")) span.style.textAlign = style.textAlign;
  if (okValue(style.border) && !/^none$/i.test(style.border)) span.style.border = style.border;
  const display = (span.style.display || "").toLowerCase();
  if (display === "block" || display === "inline-block") {
    // a block with its own height is sized like Roll20: padding and border on top of it
    span.style.boxSizing = span.style.height && span.style.height !== "auto" ? "content-box" : "border-box"; span.style.maxWidth = "100%"; span.style.minWidth = "0px"; span.style.wordBreak = span.style.wordBreak || "break-word"; span.style.overflowWrap = span.style.overflowWrap || "anywhere";
    // negative margins pull a block over its neighbours (Roll20 handout macros): allowed within a bound, like the toolkit (up to 400px / 100% up and down, 24px sideways)
    const side = (value, horizontal) => {
      const raw = (value || "").trim().toLowerCase();
      if (!raw) return "0px";
      if (raw === "auto") return horizontal ? "auto" : "0px";
      if (raw.startsWith("-")) { const m = raw.match(/^-(\d+(?:\.\d+)?)(px|%)$/); if (!m) return "0px"; const n = Number(m[1]); return horizontal ? (m[2] === "px" && n <= 24 ? raw : "0px") : (m[2] === "px" ? n <= 400 : n <= 100) ? raw : "0px"; }
      return raw.endsWith("%") ? "0px" : raw;
    };
    span.style.marginTop = side(span.style.marginTop, false); span.style.marginRight = side(span.style.marginRight, true); span.style.marginBottom = side(span.style.marginBottom, false); span.style.marginLeft = side(span.style.marginLeft, true);
    if (display === "block") {
      const width = (span.style.width || "").trim(); if (!width || /^100(?:\.0+)?%$/.test(width)) span.style.width = "auto";
      if (!span.style.marginLeft.startsWith("-")) span.style.marginLeft = "0px"; if (!span.style.marginRight.startsWith("-")) span.style.marginRight = "0px";
      if (span.style.marginLeft.startsWith("-") || span.style.marginRight.startsWith("-")) span.style.maxWidth = "calc(100% + 48px)";
      span.style.overflow = span.style.overflow || "hidden";
    }
  }
  centerBandShadow(span);
}
function centerBandShadow(span) {
  const match = /^(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]+|[a-z]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px$/i.exec(span.style.boxShadow || "");
  if (!match) return;
  const [, color, dx, , blur, spread] = match, reach = Number(spread);
  if (Number(dx) !== 0 || Number(blur) !== 0 || reach <= 0 || /^inset$/i.test(color)) return;
  const top = span.style.marginTop === "" ? 0 : parseFloat(span.style.marginTop), bottom = span.style.marginBottom === "" ? 0 : parseFloat(span.style.marginBottom);
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;
  const vertical = reach / 2;
  span.style.boxShadow = `${color} 0px 0px 0px ${reach}px`; span.style.clipPath = `inset(${-vertical}px ${-reach}px)`;
  span.style.marginTop = `${top + vertical}px`; span.style.marginBottom = `${bottom + vertical}px`; span.setAttribute("data-ccr20-band", "1");
}
function renderRoll20(container, text, env) {
  container.classList.add("ccr20-render-root", "ccr20-roll20-bubble");
  container.dataset.ccr20MacroBackground = env.roll20Background === "black" || env.roll20Background === "white" ? env.roll20Background : "transparent";
  container.dataset.ccr20Rendered = "1";
  const runs = (Array.isArray(env.formatRuns) ? env.formatRuns : []).map(r => ({ start: Math.max(0, Number(r.start) || 0), end: Math.min(text.length, Number(r.end) || 0), style: r.style && typeof r.style === "object" ? r.style : {} })).filter(r => r.end > r.start);
  const align = Array.isArray(env.alignRuns) ? env.alignRuns : [];
  let offset = 0;
  text.split("\n").forEach((line, index) => {
    const lineEl = document.createElement("span"); lineEl.className = "ccr20-line";
    const run = align.find(a => a.start <= index && a.end > index);
    lineEl.style.textAlign = run && ["left", "center", "right"].includes(run.align) ? run.align : "";
    const end = offset + line.length, cuts = new Set([offset, end]);
    for (const r of runs) { if (r.start > offset && r.start < end) cuts.add(r.start); if (r.end > offset && r.end < end) cuts.add(r.end); }
    const points = [...cuts].sort((a, b) => a - b);
    if (!line.length) lineEl.append(document.createElement("br"));
    for (let i = 0; i + 1 < points.length && line.length; i += 1) {
      const piece = text.slice(points[i], points[i + 1]), active = runs.filter(r => r.start <= points[i] && r.end >= points[i + 1]);
      if (!active.length) { lineEl.append(piece); continue; }
      // a picture link of the macro (Roll20 draws it as the picture): only the hosts the page's CSP allows
      const picture = active.map(r => r.style && r.style.imageUrl).find(url => typeof url === "string" && /^https:\/\/(i\.imgur\.com|storage\.ccfolia-cdn\.net)\/[\w./%~+-]+$/.test(url));
      if (picture) {
        const wrap = document.createElement("span"); wrap.className = "ccr20-image-frag";
        const img = document.createElement("img"); img.className = "ccr20-image"; img.src = picture; img.alt = piece; img.referrerPolicy = "no-referrer"; img.loading = "lazy"; img.decoding = "async";
        wrap.append(img); lineEl.append(wrap); continue;
      }
      const span = document.createElement("span"); span.className = "ccr20-frag"; span.textContent = piece;
      for (const r of active) applyToolkitStyle(span, r.style);
      lineEl.append(span);
    }
    // a line whose blocks pull themselves over the neighbours with negative margins sits in the padding Roll20 gives a /desc line, filled with the blocks' own colour (see the toolkit's .ccr20-line-flush)
    const frags = [...lineEl.querySelectorAll(".ccr20-frag")];
    const flush = frags.some(f => /^-/.test(f.style.marginTop) || /^-/.test(f.style.marginLeft));
    lineEl.classList.toggle("ccr20-line-flush", flush);
    const colours = new Set(frags.filter(f => f.style.display === "block").map(f => f.style.backgroundColor));
    if (flush && colours.size === 1 && [...colours][0]) lineEl.style.backgroundColor = [...colours][0];
    if (flush) container.dataset.ccfMacroFlush = "1";
    container.append(lineEl); offset = end + 1;
  });
}
// toolkit: draw it the way the GM's toolkit scripts do (the same class and attribute names: .ccf-render-root > .ccf-render-overlay > .ccf-line > .ccf-frag, data-ccf-narration / data-ccf-macro),
// so the toolkit's own CSS that came over in mirror.css lays it out (narration centred without avatar, Roll20 bars, ...). Returns what the row needs to know.
function renderRich(container, full, toolkit = false) {
  const { text, env } = decodeEnvelope(full);
  const info = { narration: false, macro: false, bubble: false };
  if (!env || typeof env !== "object") { container.textContent = text; return info; }
  if (toolkit && env.roll20Macro === true) {
    info.macro = true; info.bubble = true; info.narration = env.blockStyle?.narration === true;
    container.dataset.ccfMacro = "1"; // format-sync marks a Roll20 macro so that its narration look (centred, italic) does not apply to it
    // the bridge also marks a narration macro as a narration root (applyNarrationRenderMarker): same class and attribute, and the row gets the attribute
    if (info.narration) { container.classList.add("ccf-render-root"); container.dataset.ccfNarration = "1"; }
    renderRoll20(container, text, env); return info;
  }
  const runs = (Array.isArray(env.formatRuns) ? env.formatRuns : []).map(r => ({ start: Math.max(0, Number(r.start) || 0), end: Math.min(text.length, Number(r.end) || 0), style: r.style && typeof r.style === "object" ? r.style : {} })).filter(r => r.end > r.start);
  const align = Array.isArray(env.alignRuns) ? env.alignRuns : [];
  const narration = !!env.blockStyle?.narration;
  info.narration = narration; info.macro = env.roll20Macro === true;
  // formatting-free envelopes are not drawn over (the toolkit does the same): plain text
  if (toolkit && !runs.length && !align.length && !narration && !info.macro) { container.textContent = text; info.narration = false; return info; }
  const target = toolkit ? document.createElement("div") : container;
  if (toolkit) {
    target.className = "ccf-render-overlay";
    container.classList.add("ccf-render-root"); container.dataset.ccfRendered = "1";
    if (narration) container.dataset.ccfNarration = "1";
    if (info.macro) container.dataset.ccfMacro = "1";
    container.append(target);
  }
  const lines = text.split("\n");
  let offset = 0;
  lines.forEach((line, index) => {
    const lineEl = document.createElement("div");
    if (toolkit) lineEl.className = "ccf-line"; else lineEl.style.minHeight = "1.43em";
    const run = align.find(a => a.start <= index && a.end > index);
    const alignment = narration ? (toolkit ? "" : "center") : (run && ["left", "center", "right"].includes(run.align) ? run.align : "");
    if (alignment) lineEl.style.textAlign = alignment;
    if (narration && !toolkit) lineEl.style.fontStyle = "italic";
    const lineStart = offset, lineEnd = offset + line.length;
    const cuts = new Set([lineStart, lineEnd]);
    for (const r of runs) { if (r.start > lineStart && r.start < lineEnd) cuts.add(r.start); if (r.end > lineStart && r.end < lineEnd) cuts.add(r.end); }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < points.length; i += 1) {
      const from = points[i], to = points[i + 1];
      const piece = text.slice(from, to);
      const active = runs.filter(r => r.start <= from && r.end >= to);
      const ruby = active.find(r => r.style.rubyText);
      if (!active.length) { lineEl.append(piece); continue; }
      const span = document.createElement(ruby ? "ruby" : "span");
      if (toolkit) span.className = "ccf-frag";
      for (const r of active) styleSegment(span, r.style);
      span.append(piece);
      if (ruby) { const rt = document.createElement("rt"); rt.textContent = String(ruby.style.rubyText).slice(0, 60); span.append(rt); }
      lineEl.append(span);
    }
    target.append(lineEl);
    offset = lineEnd + 1;
  });
  return info;
}
// CCFOLIA's chat time is date-fns formatRelative with its Japanese strings (read from the app code): today "今日 p", yesterday "昨日 p", 2-6 days back "先週 eeee p", older: the date only "P" (y/MM/dd);
// p is H:mm (hour not padded). The weekday is the full Japanese name.
const WEEKDAYS = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
function messageTime(value, now = new Date()) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const clock = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return `今日 ${clock}`;
  if (diff === -1) return `昨日 ${clock}`;
  if (diff < -1 && diff >= -6) return `先週 ${WEEKDAYS[d.getDay()]} ${clock}`;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
function onPush(event) {
  let message;
  try { message = JSON.parse(event.data); } catch (_) { return; }
  pushSeq++;
  if (message.type === "message" && message.message?.id) {
    if (current.messages.some(item => item.id === message.message.id)) return;
    current.messages = [...current.messages, message.message].slice(-MAX_MESSAGES);
    renderState(current);
  } else if (message.type === "health") {
    current = { ...current, health: message.health };
    showHealth(message.health);
  } else if (message.type === "message-updated" && message.message?.id) {
    // edited in CCFOLIA: replace the row in place
    current.messages = current.messages.map(item => item.id === message.message.id ? message.message : item);
    renderState(current);
  } else if (message.type === "messages-removed") {
    const gone = new Set(Array.isArray(message.ids) ? message.ids : []);
    current.messages = current.messages.filter(item => !gone.has(item.id));
    renderState(current);
  } else if (message.type === "handouts") {
    applyMyHandouts(message.items, true);
  } else if (message.type === "scene") {
    current = { ...current, scene: message.scene };
    renderScene(message.scene);
    if (document.getElementById("char-window") || ownedIds.size || !mineLoaded) { clearTimeout(window.__mineTimer); window.__mineTimer = setTimeout(() => refreshMyCharacters(), 800); } // the GM page reports the characters with the scene
  } else if (message.type === "channels") {
    current = { ...current, channels: message.channels || [], dicebot: message.dicebot || current.dicebot };
    renderState(current);
  } else if (message.type === "bgm") {
    playBgm(message.bgm);
  } else if (message.type === "handout") {
    current.handout = message.handout || {};
    renderState(current);
  } else if (message.type === "meta") {
    current = { ...current, roomTitle: message.roomTitle ?? current.roomTitle, gmOnline: message.gmOnline ?? current.gmOnline };
    renderState(current);
  } else if (message.type === "closed") {
    stop(message.reason === "stopped" ? "요청이 만료되었거나 룸이 종료되었습니다." : "접근이 취소되었습니다.");
  }
}
function dropSocket(own) {
  if (socket !== own) return; // replaced or stopped on purpose
  socket = null; socketOpen = false;
  clearInterval(pingTimer); pingTimer = 0;
  try { own.close(); } catch (_) {}
  schedule(); // back to fast polling until the socket is re-established
  if (mode === "live") { socketRetries = Math.min(socketRetries + 1, 6); retryTimer = setTimeout(connectSocket, Math.min(1000 * 2 ** (socketRetries - 1), 15000)); }
}
function connectSocket() {
  if (socket || mode !== "live" || typeof WebSocket !== "function") return;
  const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/rooms/${encodeURIComponent(roomId)}/ws`;
  let own;
  try { own = socket = new WebSocket(url); } catch (_) { socket = null; return; }
  let lastSeen = Date.now();
  own.onopen = () => {
    if (socket !== own) return;
    socketOpen = true; socketRetries = 0; lastSeen = Date.now();
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (Date.now() - lastSeen > 55000) return dropSocket(own); // no pong: the connection is dead
      try { own.send("ping"); } catch (_) {}
    }, 20000);
    refresh().catch(() => {}); // catch up on anything missed while the socket was down
    schedule();
  };
  own.onmessage = event => { if (socket !== own) return; lastSeen = Date.now(); onPush(event); };
  own.onclose = () => dropSocket(own);
  own.onerror = () => {};
}
const wake = () => { if (mode !== "live") return; refresh().catch(() => {}); if (!socket) { clearTimeout(retryTimer); connectSocket(); } };
window.addEventListener("online", wake);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") wake(); });
async function checkStatus() {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/status`);
  if (transient(response)) return;
  if (!response.ok) return stop("요청이 만료되었거나 룸이 종료되었습니다.");
  const data = await response.json();
  if (data.approvedAt) approvedAt = data.approvedAt;
  if (data.displayName && !chatName.dataset.touched) chatName.value = data.displayName;
  if (data.status === "approved") {
    consent.hidden = true; gateStatus.hidden = true; room.inert = false; room.removeAttribute("aria-hidden");
    if (mode !== "live") { mode = "live"; await refresh(); connectSocket(); }
  } else if (data.status === "pending") setGate("GM 승인 대기 중", "pending");
  else stop(data.status === "rejected" ? "GM이 참가 요청을 거절했습니다." : "접근이 취소되었습니다.");
}
async function join() {
  const displayName = document.getElementById("display-name").value.trim();
  if (!roomId || !inviteToken) return setGate("초대 링크가 올바르지 않습니다.", "error");
  if (!displayName) return setGate("희망자 이름을 입력해주세요.", "error");
  const response = await fetch("/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, token: inviteToken, displayName }) });
  if (!response.ok) return setGate("승인되지 않았거나 종료된 초대입니다.", "error");
  try { localStorage.setItem(NAME_KEY, displayName); } catch (_) {}
  history.replaceState(null, "", `${location.pathname}#room=${encodeURIComponent(roomId)}`);
  consent.hidden = true; setGate("GM 승인 대기 중", "pending");
  mode = "pending"; schedule();
}
document.getElementById("cancel").addEventListener("click", () => { consent.hidden = true; setGate("입장을 취소했습니다. 초대 링크를 다시 열면 입장할 수 있습니다.", ""); });
document.getElementById("join").addEventListener("click", () => join().catch(() => setGate("연결할 수 없습니다.", "error")));
// Dice row (measured on ccfolia.com): D4..D100 as 30x30 round buttons with the native 24px icons; each button puts its roll at the cursor of the message box.
const DICE = [
  [4, ["M30.5851 28.4169L16.5342 4.30479C16.4238 4.11637 16.2195 4.00006 16 4.00006C15.7805 4.00006 15.5762 4.11753 15.4659 4.30479L1.41611 28.4169C1.30693 28.6053 1.30693 28.8391 1.41611 29.0275C1.52646 29.2159 1.73073 29.3322 1.95026 29.3322H30.0509C30.2705 29.3322 30.4747 29.2148 30.5851 29.0275C30.6954 28.8391 30.6954 28.6053 30.5851 28.4169Z", "M30.5851 28.4169L16.5342 4.30479C16.4238 4.11637 16.2195 4.00006 16 4.00006C15.7805 4.00006 15.5762 4.11753 15.4659 4.30479L1.41611 28.4169C1.30693 28.6053 1.30693 28.8391 1.41611 29.0275C1.52646 29.2159 1.73073 29.3322 1.95026 29.3322H30.0509C30.2705 29.3322 30.4747 29.2148 30.5851 29.0275C30.6954 28.8391 30.6954 28.6053 30.5851 28.4169ZM16 21.2569L28.3029 28.3436H3.69826L16.0012 21.2569H16ZM16.4989 20.4008V6.2239L28.9345 27.5643L16.4989 20.4008ZM15.5011 6.2239V20.4008L3.06668 27.5643L15.5011 6.2239Z"]],
  [6, ["M25.5126 4.47534H6.48639C5.36163 4.47534 4.44983 5.43779 4.44983 6.62504V26.7083C4.44983 27.8955 5.36163 28.858 6.48639 28.858H25.5126C26.6374 28.858 27.5492 27.8955 27.5492 26.7083V6.62504C27.5492 5.43779 26.6374 4.47534 25.5126 4.47534Z", "M25.5142 29.3333H6.48689C5.11576 29.3333 4 28.1556 4 26.7083V6.62505C4 5.17775 5.11576 4 6.48689 4H25.5142C26.8853 4 28.0011 5.17775 28.0011 6.62505V26.7094C28.0011 28.1567 26.8853 29.3344 25.5142 29.3344V29.3333ZM6.48689 4.9507C5.61272 4.9507 4.90172 5.70119 4.90172 6.62393V26.7083C4.90172 27.631 5.61272 28.3815 6.48689 28.3815H25.5142C26.3883 28.3815 27.0993 27.631 27.0993 26.7083V6.62505C27.0993 5.70231 26.3883 4.95182 25.5142 4.95182H6.48689V4.9507Z"]],
  [8, ["M15.999 2.66669L3.99902 9.33277V22.6661L15.999 29.3334L27.999 22.6661V9.33277L15.999 2.66669Z", "M15.999 2.66669L3.99902 9.33277V22.6661L15.999 29.3334L27.999 22.6661V9.33277L15.999 2.66669ZM26.9651 21.1655L16.8323 4.27966L26.9638 9.90866V21.1667L26.9651 21.1655ZM26.06 21.6478H5.93922L15.999 4.88013L26.0588 21.6466L26.06 21.6478ZM15.1658 4.27966L5.03298 21.1655V9.90749L15.1658 4.27966ZM6.02558 22.6427H25.9725L15.999 28.1839L6.02558 22.6427Z"]],
  [10, ["M17.7437 2.66669L4.66699 11.1315V19.2819L17.7426 29.3334L31.3337 19.2875V11.1259L17.7437 2.66669Z", "M17.7437 2.66669L4.66699 11.1315V19.2819L17.7426 29.3334L31.3337 19.2875V11.1259L17.7437 2.66669ZM10.2844 20.2889L17.278 25.642V27.7814L6.87502 19.7843L10.2844 20.2889ZM17.8045 5.04892L24.7748 19.7451L17.7437 24.8039L10.999 19.6422L17.8045 5.04892ZM18.2194 25.6297L25.62 20.3046L29.0515 19.7966L18.2194 27.8026V25.6297ZM30.3945 18.6363L25.6277 19.3423L18.4583 4.22873L30.3934 11.6574V18.6351L30.3945 18.6363ZM17.1773 4.16271L10.1174 19.302L5.60839 18.634V11.6518L17.1773 4.16271Z"]],
  [12, ["M26.2524 5.22471L18.0194 2.66669L9.77878 5.20205L4.679 11.8618L4.66602 20.1022L9.74631 26.7764L17.9793 29.3344L26.2199 26.799L31.3208 20.1393L31.3338 11.8988L26.2535 5.22471H26.2524Z", "M26.2524 5.22471L18.0194 2.66669L9.77878 5.20205L4.679 11.8618L4.66602 20.1022L9.74631 26.7764L17.9793 29.3344L26.2199 26.799L31.3208 20.1393L31.3338 11.8988L26.2535 5.22471H26.2524ZM30.1465 11.8329L25.6885 13.4374L18.4793 8.45313V3.73047L25.6831 5.96823L30.1476 11.8319L30.1465 11.8329ZM22.394 22.0753H13.6036L10.887 14.1201L17.9988 9.20386L25.1106 14.1201L22.394 22.0753ZM10.347 5.94763L17.5583 3.72841V8.42636L10.2983 13.4456L5.86195 11.8031L10.347 5.94763ZM5.59787 12.6444L9.96926 14.2633L12.754 22.4182L10.0483 25.6786L5.58813 19.819L5.59895 12.6444H5.59787ZM10.8015 26.1822L13.4835 22.9507H22.4763L25.1658 26.2017L17.9804 28.4117L10.8015 26.1811V26.1822ZM25.9223 25.7002L23.235 22.4512L26.0359 14.2488L30.4127 12.6743L30.4019 19.853L25.9234 25.7002H25.9223Z"]],
  [20, ["M16.0003 2.66669L2.66699 9.33279V22.6661L16.0003 29.3334L29.3337 22.6661V9.33279L16.0003 2.66669Z", "M16.0003 2.66669L2.66699 9.33279V22.6661L16.0003 29.3334L29.3337 22.6661V9.33279L16.0003 2.66669ZM24.2725 11.0573L17.7236 4.63008L27.6272 9.58172L24.2725 11.0573ZM8.66168 11.7088L16.0651 4.44282L23.4684 11.7088L16.0651 22.8904L8.66168 11.7088ZM7.85376 11.0607L4.38383 9.57611L14.5398 4.49776L7.85376 11.0607ZM7.3022 11.8882L3.76753 20.3148V10.3767L7.3022 11.8882ZM8.09976 12.7785L15.6378 24.1642L4.23752 21.9877L8.09976 12.7785ZM24.0213 12.7897L27.767 21.9866L16.5092 24.1361L24.0213 12.7897ZM24.8215 11.886L28.2318 10.3868V20.2598L24.8215 11.8871V11.886ZM6.21849 23.3411L16.0003 25.2092L25.7822 23.3423L16.0003 28.2334L6.21849 23.3423V23.3411Z"]],
  [100, ["M21.1431 4.00006L15.9002 7.82282L10.4487 4.00006L0.000976562 11.6184V18.9537L10.4479 28.0001L15.9002 23.4603L21.1422 28.0001L32.001 18.9588V11.6134L21.1431 4.00006Z", "M21.1431 4.00006L15.9011 7.82282L10.4487 4.00006L0.000976562 11.6184V18.9537L10.4479 28.0001L15.9002 23.4603L21.1422 28.0001L32.001 18.9588V11.6134L21.1431 4.00006ZM20.6906 5.34649L18.8186 9.86814L16.6117 8.3203L20.6906 5.34548V5.34649ZM20.5554 12.0917V18.3717L16.7469 19.0071L11.0197 5.4059L20.5554 12.0917ZM0.752233 12.0867L9.99623 5.34649L4.35561 18.9719L0.753117 18.3707V12.0867H0.752233ZM10.0767 26.6023L1.7651 19.4059L4.48907 19.8601L10.0767 24.6778V26.6033V26.6023ZM5.05914 19.277L10.4974 6.14407L16.0664 19.3707L10.4487 23.9235L5.06003 19.278L5.05914 19.277ZM10.8279 24.6657L16.7407 19.8732L19.4815 19.416L10.827 26.6214V24.6657H10.8279ZM20.771 26.6023L16.533 22.9326L17.6599 21.994L20.771 24.6758V26.6013V26.6023ZM18.2936 21.4673L21.3066 18.9588V11.6134L19.4621 10.3203L21.1908 6.14407L26.7599 19.3707L21.1422 23.9235L18.2936 21.4673ZM21.5223 26.6224V24.6667L27.4351 19.8742L30.1759 19.417L21.5214 26.6224H21.5223ZM31.2497 18.3717L27.4413 19.0071L21.7141 5.4059L31.2497 12.0917V18.3717Z"]]
];
{
  const NS = "http://www.w3.org/2000/svg";
  const row = document.createElement("div"); row.className = "dice-row";
  for (const [faces, [silhouette, outline]] of DICE) {
    const b = document.createElement("button"); b.type = "button"; b.title = `1d${faces}`; b.setAttribute("aria-label", `D${faces}`);
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 32 32"); svg.setAttribute("width", "24"); svg.setAttribute("height", "24"); svg.setAttribute("aria-hidden", "true");
    [[silhouette, "#202020"], [outline, "#ACACAC"]].forEach(([d, fill]) => { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); p.setAttribute("fill", fill); svg.append(p); });
    b.append(svg);
    b.addEventListener("click", () => insertAtCursor(`1d${faces}`));
    row.append(b);
  }
  row.append(document.querySelector("#chat-form button[type=submit]"));
  document.querySelector("#chat-form .name-row").after(row);
  document.querySelector("#chat-form button[type=submit]").hidden = false;
}
const nameColor0 = (() => { try { return localStorage.getItem("capybara-name-color") || ""; } catch (_) { return ""; } })();
let nameColor = /^#[0-9a-f]{6}$/i.test(nameColor0) ? nameColor0 : "";
function insertAtCursor(text, cursorBack = 0) {
  const input = document.getElementById("chat-input"); const a = input.selectionStart ?? input.value.length, z = input.selectionEnd ?? a;
  input.value = input.value.slice(0, a) + text + input.value.slice(z); input.focus();
  const at = a + text.length - cursorBack; input.setSelectionRange(at, at);
}
// Wrap the selection in a format marker (the GM side turns the markers into a format envelope when it sends); nothing selected: insert the pair and stand between.
function wrapSelection(open, close) {
  const input = document.getElementById("chat-input"); const a = input.selectionStart ?? 0, z = input.selectionEnd ?? a;
  const middle = input.value.slice(a, z);
  input.value = input.value.slice(0, a) + open + middle + close + input.value.slice(z); input.focus();
  const at = middle ? a + open.length + middle.length + close.length : a + open.length; input.setSelectionRange(at, at);
}
const speakerBtn = document.getElementById("speaker-btn"), speakerImg = document.getElementById("speaker-img"), palBtn = document.getElementById("pal-btn"), colorBtn = document.getElementById("color-btn"), colorInput = document.getElementById("color-input");
function chosenCharacter() { return (sceneData?.characters || []).find(c => c.id === speaker.value) || null; }
function refreshSpeakerUi() {
  const c = chosenCharacter();
  speakerImg.hidden = !c; speakerBtn.querySelector("svg").style.display = c ? "none" : "";
  if (c) speakerImg.src = c.iconUrl;
  palBtn.disabled = !(c && String(c.commands || "").trim());
  colorBtn.style.color = (c && /^#[0-9a-f]{3,8}$/i.test(c.color || "") ? c.color : "") || nameColor || "#cce5df"; // the palette icon takes the speaker's colour, like CCFOLIA's
}
function openSpeakerMenu() {
  const items = [{ label: "내 이름", current: !speaker.value, run: () => useSpeaker("") }, ...(sceneData?.characters || []).map(c => ({ label: c.name || "(이름 없음)", current: c.id === speaker.value, run: () => useSpeaker(c.id) }))];
  openMenu(speakerBtn, items);
}
speakerBtn.addEventListener("click", openSpeakerMenu);
palBtn.addEventListener("click", () => {
  const lines = String(chosenCharacter()?.commands || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length) openMenu(palBtn, lines.map(line => ({ label: line.length > 40 ? `${line.slice(0, 40)}…` : line, run: () => insertAtCursor(line) })));
});
// "?" next to the chat palette: CCFOLIA's chat-command dialog. Its text comes from the GM's page (cmMirror.help), so it follows the room's dice system; the button shows once that text has arrived.
const helpBtn = document.getElementById("help-btn");
function refreshHelpBtn() { helpBtn.hidden = !cmMirror.help; }
helpBtn.addEventListener("click", () => {
  const help = cmMirror.help; if (!help) return;
  openDialog(help.title || "채팅 커맨드", body => {
    body.classList.add("help-body");
    for (const section of help.sections) {
      body.append(el("h3", "help-h", section.title));
      const p = el("p", "help-p");
      let rest = section.text;
      for (const link of section.links) {
        const at = rest.indexOf(link.text); if (at < 0) continue;
        p.append(rest.slice(0, at));
        const a = el("a", "", link.text); a.href = link.href; a.target = "_blank"; a.rel = "noopener noreferrer"; p.append(a);
        rest = rest.slice(at + link.text.length);
      }
      p.append(rest); body.append(p, el("hr", "help-hr"));
    }
  });
});
colorBtn.addEventListener("click", () => { colorInput.value = nameColor || "#cce5df"; colorInput.showPicker?.(); });
colorInput.addEventListener("input", () => { nameColor = colorInput.value; try { localStorage.setItem("capybara-name-color", nameColor); } catch (_) {} refreshSpeakerUi(); });
refreshSpeakerUi();
// Format rows: the same markers the GM panel understands (**bold**, *italic*, __underline__, ~~strike~~, ||blur||, `code`, [base|ruby], [base^tooltip], {a:center|text|}).
{
  const mk = (label, title, run) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title); b.addEventListener("click", run); return b; };
  const row1 = document.createElement("div"); row1.className = "fmt-row";
  row1.append(mk("B", "Bold", () => wrapSelection("**", "**")), mk("I", "Italic", () => wrapSelection("*", "*")), mk("U", "Underline", () => wrapSelection("__", "__")), mk("S", "Strike", () => wrapSelection("~~", "~~")),
    mk("Rb", "Ruby", () => wrapSelection("[", "|]")), mk("Tip", "Tooltip", () => wrapSelection("[", "^]")), mk("Bl", "Blur", () => wrapSelection("||", "||")), mk("</>", "Code block", () => wrapSelection("`", "`")));
  // The toolkit's own toolbar also has Nr (narration for the whole message), text / background colour, a size box and "()" (grey parentheses). The GM side understands {n:1|..|}, {c:#hex|..|}, {b:#hex|..|},
  // {s:N|..|}; Nr and "()" are toggles applied when the message is sent.
  const toggle = (label, title, key) => { const b = mk(label, title, () => { fmtState[key] = !fmtState[key]; b.setAttribute("aria-pressed", String(fmtState[key])); }); b.setAttribute("aria-pressed", "false"); return b; };
  row1.append(toggle("Nr", "Narration", "narration"));
  const row2 = document.createElement("div"); row2.className = "fmt-row";
  const align = (name, d) => { const b = mk("", `Align ${name}`, () => wrapSelection(`{a:${name}|`, "|}")); const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "15"); svg.setAttribute("height", "15"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); p.setAttribute("fill", "currentColor"); svg.append(p); b.append(svg); return b; };
  row2.append(align("left", "M2 3h12v1H2zm0 6h8v1H2zm0 6h12v1H2z"), align("center", "M2 3h12v1H2zm4 6h4v1H6zM3 15h10v-1H3z"), align("right", "M2 3h12v1H2zm6 6h6v1H8zM2 15h12v-1H2z"));
  // alignment buttons: one is active, like the toolkit's toolbar (left by default)
  const aligns = [...row2.querySelectorAll("button")].slice(0, 3);
  aligns.forEach((button, index) => { button.setAttribute("aria-pressed", String(index === 0)); button.addEventListener("click", () => aligns.forEach(other => other.setAttribute("aria-pressed", String(other === button)))); });
  const colorTool = (title, initial, marker) => {
    const label = document.createElement("label"); label.className = "fmt-color"; label.title = title;
    const input = document.createElement("input"); input.type = "color"; input.value = initial; input.setAttribute("aria-label", title);
    input.addEventListener("change", () => wrapSelection(`{${marker}:${input.value}|`, "|}"));
    label.append(input); return label;
  };
  const size = document.createElement("input"); size.className = "fmt-size"; size.type = "text"; size.inputMode = "numeric"; size.placeholder = "16"; size.title = "Font size"; size.setAttribute("aria-label", "Font size");
  size.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); const n = Math.round(Number(size.value)); if (n >= 8 && n <= 72) wrapSelection(`{s:${n}|`, "|}"); } });
  row2.append(colorTool("Text color", "#ffffff", "c"), colorTool("Background color", "#010101", "b"), size, toggle("()", "Parentheses gray", "parenGray"));
  document.querySelector("#chat-form .dice-row").after(row1, row2);
}
// What the toggles do to a message when it is sent (the GM side turns the markers into the format envelope).
const fmtState = { narration: false, parenGray: false };
function outgoingText(text) {
  let out = text;
  if (fmtState.parenGray) out = out.replace(/([(（][^()（）\n]*[)）])/g, "{c:#9e9e9e|$1|}");
  if (fmtState.narration) out = `{n:1|${out}|}`;
  return out;
}
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const sendStatus = document.getElementById("send-status");
let sendStatusTimer = 0;
const showSendStatus = (message, ms = 0) => {
  clearTimeout(sendStatusTimer);
  sendStatus.textContent = message;
  if (ms) sendStatusTimer = setTimeout(() => { sendStatus.textContent = ""; }, ms);
};
chatForm.addEventListener("submit", async event => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = ""; // clear right away so a quick second Enter cannot send the same text twice
  const clientMessageId = crypto.randomUUID();
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientMessageId, text: outgoingText(text), channel: activeChannel, characterId: speaker.value, name: chatName.value.trim(), color: nameColor }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "전송 실패");
    showSendStatus("GM 브리지 전달 대기", 2500);
  } catch (error) {
    chatInput.value = chatInput.value ? `${text}\n${chatInput.value}` : text; // give the text back instead of losing it
    showSendStatus(error?.message || "전송 실패");
  }
});
// Enter sends, Shift+Enter inserts a newline. Enter that confirms an IME composition (Korean/Japanese) must not send.
chatInput.addEventListener("keydown", event => {
  if (event.key === "`" && !event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); openSpeakerMenu(); return; }
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  chatForm.requestSubmit();
});
if (roomId && !inviteToken) { consent.hidden = true; mode = "pending"; checkStatus().catch(() => {}).finally(schedule); }

// ---- Top toolbar and dialogs. Measured on ccfolia.com 1.37.5 (GM view): 64px bar, room-menu button (14px bold name + chevron), 40x40 icon buttons
// with 24px icons, 50x50 account avatar button, menu paper rgba(44,44,44,.87) / 4px radius / 8px 0 padding / items 6px 16px 16px text.
// A participant has the ordinary player's toolbar: no screen-panel / marker / scenario-text / scene / cut-in lists (those are GM only).
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
let menuEl = null;
const closeMenu = () => { if (!menuEl) return; menuEl.remove(); menuEl = null; document.querySelectorAll('[aria-expanded="true"]').forEach(b => b.setAttribute("aria-expanded", "false")); };
function openMenu(anchor, items, extraClass = "") {
  const same = menuEl && menuEl.anchor === anchor;
  closeMenu(); if (same) return;
  const paper = el("div", `menu-paper ${extraClass}`.trim()); paper.setAttribute("role", "menu"); paper.anchor = anchor;
  for (const item of items) {
    if (item.header) { paper.append(Object.assign(el("div", "menu-head"), { textContent: item.header })); continue; }
    if (item.divider) { paper.append(el("hr", "menu-divider")); continue; }
    if (item.node) { paper.append(item.node); continue; }
    // the account menu's top row as CCFOLIA draws it (measured): 40px round avatar, name 16px/24px and a 14px 70% line under it, 72px high, then a divider
    if (item.profile) {
      const row = el("div", "menu-profile"), text = el("div", "menu-profile-text");
      text.append(el("p", "", item.profile.name), el("p", "menu-profile-sub", item.profile.sub));
      const avatar = el("span", "menu-profile-av", item.profile.image ? "" : item.profile.letter);
      if (item.profile.image) { const img = el("img"); img.src = item.profile.image; img.alt = ""; avatar.append(img); }
      row.append(avatar, text);
      paper.append(row); paper.classList.add("has-profile"); continue;
    }
    // a link the menu opens in a new tab (CCFOLIA's help / terms / privacy entries), or an entry shown but not usable here (log in, developer commands)
    if (item.href) { const link = el("a", "menu-item", item.label); link.href = item.href; link.target = "_blank"; link.rel = "noopener noreferrer"; link.setAttribute("role", "menuitem"); link.addEventListener("click", () => closeMenu()); paper.append(link); continue; }
    const row = el("button", "menu-item", item.label); row.type = "button"; row.setAttribute("role", "menuitem");
    if (item.key) { row.classList.add("has-key"); row.append(el("span", "menu-key", item.key)); }
    if (item.disabled) { row.disabled = true; row.setAttribute("aria-disabled", "true"); paper.append(row); continue; }
    if (item.current) row.dataset.current = "1";
    row.addEventListener("click", () => { closeMenu(); item.run(); });
    paper.append(row);
  }
  paper.addEventListener("keydown", event => {
    const rows = [...paper.querySelectorAll(".menu-item")], at = rows.indexOf(document.activeElement);
    if (event.key === "ArrowDown") { event.preventDefault(); rows[(at + 1) % rows.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); rows[(at - 1 + rows.length) % rows.length]?.focus(); }
    else if (event.key === "Home") { event.preventDefault(); rows[0]?.focus(); }
    else if (event.key === "End") { event.preventDefault(); rows[rows.length - 1]?.focus(); }
  });
  document.body.append(paper); menuEl = paper; anchor.setAttribute("aria-expanded", "true");
  (paper.querySelector('[data-current="1"]') || paper.querySelector(".menu-item"))?.focus();
  const r = anchor.getBoundingClientRect();
  paper.style.top = `${r.bottom + 4}px`;
  if (r.left + paper.offsetWidth > innerWidth - 8) paper.style.left = `${Math.max(8, r.right - paper.offsetWidth)}px`; else paper.style.left = `${r.left}px`;
}
document.addEventListener("pointerdown", event => { if (menuEl && !event.composedPath().includes(menuEl) && !event.composedPath().includes(menuEl.anchor)) closeMenu(); }, true);
document.addEventListener("keydown", event => { if (event.key === "Escape") { const anchor = menuEl?.anchor; closeMenu(); anchor?.focus?.(); } });

function openDialog(title, build) {
  const back = el("div", "dlg-backdrop"), paper = el("div", "dlg"), head = el("h2", "", title);
  paper.setAttribute("role", "dialog"); paper.setAttribute("aria-modal", "true");
  const closeX = el("button", "dlg-x", "×"); closeX.type = "button"; closeX.setAttribute("aria-label", "닫기");
  const header = el("div", "dlg-head"); header.append(head, closeX); paper.append(header);
  const hooks = {}; // a dialog may ask to be told before it closes (the editor saves what is typed)
  const close = () => { try { hooks.beforeClose?.(); } catch (_) {} back.remove(); document.removeEventListener("keydown", onKey, true); };
  closeX.addEventListener("click", () => close());
  const onKey = event => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
  const body = el("div", "dlg-body"); const foot = el("div", "dlg-foot");
  const done = el("button", "", "닫기"); done.type = "button"; done.addEventListener("click", close); foot.append(done);
  build(body, foot, close, hooks); paper.append(body, foot); back.append(paper);
  back.addEventListener("click", event => { if (event.target === back) close(); });
  document.addEventListener("keydown", onKey, true); document.body.append(back);
  return close;
}
const statusSummary = c => (c.status || []).map(s => `${s.label} ${s.value}${s.max ? `/${s.max}` : ""}`).join(" · ");
function useSpeaker(id) { speaker.value = id; speaker.dispatchEvent(new Event("change")); }
// Character sheet (view only): icon, name, status, parameters, memo, reference link. The chat command palette is not shown.
function openSheet(id) {
  const c = (sceneData?.characters || []).find(item => item.id === id); if (!c) return;
  openDialog(c.name || "캐릭터", (body, foot, close) => {
    const top = el("div", "sheet-top"); const img = el("img"); img.src = c.iconUrl; img.alt = ""; img.referrerPolicy = "no-referrer"; top.append(img, el("span", "", statusSummary(c) || "상태 없음")); body.append(top);
    if (c.params?.length) { const table = el("dl", "sheet-params"); for (const p of c.params) table.append(el("dt", "", p.label), el("dd", "", p.value)); body.append(table); }
    if (c.memo) body.append(el("div", "sheet-memo", c.memo));
    if (/^https:\/\//.test(c.externalUrl || "")) { const a = el("a", "", "참고 URL"); a.href = c.externalUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; body.append(a); }
    const speak = el("button", "", "이 캐릭터로 발언"); speak.type = "button"; speak.addEventListener("click", () => { useSpeaker(c.id); close(); }); foot.prepend(speak);
  });
}
document.getElementById("char-list-open").addEventListener("click", openCharacterWindow);
// ---- Scene tools a CCFOLIA player also sees (measured on a player screen and on the GM tab): multi-select toggle above the zoom bar, the pencil button with its menu, and the movable "my characters" window.
// The menu items and "+" do nothing yet (creating room objects needs GM-side commands that have not been built); they are shown disabled, "timer [PRO]" stays disabled like on CCFOLIA.
const SVG_NS = "http://www.w3.org/2000/svg";
function svgIcon(path, size = 24) {
  const svg = document.createElementNS(SVG_NS, "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", size); svg.setAttribute("height", size); svg.setAttribute("fill", "currentColor"); svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path"); p.setAttribute("d", path); svg.append(p); return svg;
}
const ICON_SELECT = "M17 5h-2V3h2v2zm-2 16h2v-2.59L19.59 21 21 19.59 18.41 17H21v-2h-6v6zm4-12h2V7h-2v2zm0 4h2v-2h-2v2zm-8 8h2v-2h-2v2zM7 5h2V3H7v2zM3 17h2v-2H3v2zm2 4v-2H3c0 1.1.9 2 2 2zM19 3v2h2c0-1.1-.9-2-2-2zm-8 2h2V3h-2v2zM3 9h2V7H3v2zm4 12h2v-2H7v2zm-4-8h2v-2H3v2zm0-8h2V3c-1.1 0-2 .9-2 2z";
const PEN_ITEMS = [
  ["M4 4h7V2H4c-1.1 0-2 .9-2 2v7h2V4zm6 9-4 5h12l-3-4-2.03 2.71L10 13zm7-4.5c0-.83-.67-1.5-1.5-1.5S14 7.67 14 8.5s.67 1.5 1.5 1.5S17 9.33 17 8.5zM20 2h-7v2h7v7h2V4c0-1.1-.9-2-2-2zm0 18h-7v2h7c1.1 0 2-.9 2-2v-7h-2v7zM4 13H2v7c0 1.1.9 2 2 2h7v-2H4v-7z", "전경, 배경을 변경", "메인 필드의 이미지를 설정합니다"],
  ["M19 7v2.99s-1.99.01-2 0V7h-3s.01-1.99 0-2h3V2h2v3h3v2h-3zm-3 4V8h-3V5H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-8h-3zM5 19l3-4 2 3 3-4 4 5H5z", "스크린 패널을 추가", "항상 표시하는 이미지 오브젝트를 배치합니다"],
  ["M12 2C8.14 2 5 5.14 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.86-3.14-7-7-7zm4 8h-3v3h-2v-3H8V8h3V5h2v3h3v2z", "마커 패널을 추가", "장면 내에서만 표시할 이미지 오브젝트를 배치합니다"],
  ["M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM6 7h5v1.5H6V7zm13 12H5L19 5v14zm-4.5-3v2H16v-2h2v-1.5h-2v-2h-1.5v2h-2V16z", "다이스 심볼을 추가", "화면에 다이스 심볼을 추가합니다"],
  ["M2 7h4v10H2V7zm5 12h10V5H7v14zM18 7h4v10h-4V7z", "카드 덱을 추가", "패널을 쌓을 수 있는 덱을 추가합니다"],
  ["m22 5.7-4.6-3.9-1.3 1.5 4.6 3.9L22 5.7zM7.9 3.4 6.6 1.9 2 5.7l1.3 1.5 4.6-3.8zM12.5 8H11v6l4.7 2.9.8-1.2-4-2.4V8zM12 4c-5 0-9 4-9 9s4 9 9 9 9-4 9-9-4-9-9-9zm0 16c-3.9 0-7-3.1-7-7s3.1-7 7-7 7 3.1 7 7-3.1 7-7 7z", "타이머를 표시", "남은 시간을 표시하는 타이머를 배치합니다", true]
];
{
  const stageEl = document.querySelector(".stage");
  const select = el("button", "scene-tool select-tool"); select.type = "button"; select.title = "Ctrl + ドラッグ"; select.setAttribute("aria-label", "Ctrl + ドラッグ"); select.setAttribute("aria-pressed", "false"); select.append(svgIcon(ICON_SELECT));
  select.addEventListener("click", () => select.setAttribute("aria-pressed", String(select.getAttribute("aria-pressed") !== "true")));
  const fab = el("button", "scene-tool pen-fab"); fab.type = "button"; fab.title = "맵 메뉴"; fab.setAttribute("aria-label", "맵 메뉴"); fab.setAttribute("aria-haspopup", "menu"); fab.setAttribute("aria-expanded", "false");
  fab.append(svgIcon("M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"));
  const menu = el("div", "pen-menu"); menu.hidden = true; menu.setAttribute("role", "menu");
  for (const [path, title, desc, pro] of PEN_ITEMS) {
    const row = el("div", "pen-item"); row.setAttribute("role", "menuitem");
    // only the dice symbol can be made so far (the others need images or have not been built); the rest stay disabled
    if (title === "다이스 심볼을 추가") { row.tabIndex = 0; row.addEventListener("click", () => { close(); createObject({ kind: "dice" }); }); } else row.setAttribute("aria-disabled", "true");
    const av = el("span", "pen-av"); av.append(svgIcon(path));
    const text = el("span", "pen-text"), head = el("span", "pen-title", title);
    if (pro) head.append(" ", el("em", "pen-pro", "PRO"));
    text.append(head, el("span", "pen-desc", desc)); row.append(av, text); menu.append(row);
  }
  const close = () => { menu.hidden = true; fab.setAttribute("aria-expanded", "false"); };
  fab.addEventListener("click", () => { menu.hidden = !menu.hidden; fab.setAttribute("aria-expanded", String(!menu.hidden)); });
  document.addEventListener("pointerdown", event => { if (!menu.hidden && !event.composedPath().includes(menu) && !event.composedPath().includes(fab)) close(); }, true);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !menu.hidden) close(); });
  stageEl.append(select, menu, fab);
}
// Ask the relay to make an object in the GM's room (the GM's page does the writing). The result shows up through the next scene update.
async function createObject(request) {
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/objects/create`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "만들 수 없습니다.");
    showSendStatus("다이스 심볼을 만들어 달라고 요청했습니다.", 3000);
    const answer = await waitForCommand((await response.clone().json().catch(() => ({}))).commandId);
    if (!answer.ok) throw new Error(answer.error);
    setTimeout(refreshMyCharacters, 1200); setTimeout(refreshMyCharacters, 3500); // the new die is the participant's: movable once the relay lists it
  } catch (error) { showSendStatus(error.message, 4000); }
}
// "My characters": a window that floats over the scene and moves by its title bar (measured: 320x280, translucent grey, title 14px bold, + and x on the right).
// The characters a participant made (kept by the relay in a ledger, reported by the GM's page) are listed first; a row opens CCFOLIA's "캐릭터 편집" dialog. The characters on the field follow (a row opens the sheet).
let myCharacters = [], ownedIds = new Set(); // ownedIds: everything this participant made (the relay's ledger), e.g. dice symbols they can move
// The first answer decides what the person owns after a reload: until one has arrived the list is asked for again (a failed or early request used to leave it empty for good).
let mineLoaded = false, mineRetry = 0;
window.__mineInfo = { tries: 0 };
async function refreshMyCharacters() {
  try {
    window.__mineInfo.tries += 1; window.__mineInfo.lastAt = new Date().toISOString();
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/mine`);
    window.__mineInfo.status = response.status;
    if (!response.ok) { if (!mineLoaded && mineRetry < 8) { mineRetry += 1; setTimeout(refreshMyCharacters, 1500 * mineRetry); } return myCharacters; }
    const data = await response.json();
    mineLoaded = true; window.__mineInfo.member = data.member || ""; window.__mineInfo.owned = Array.isArray(data.owned) ? data.owned.length : 0; window.__mineInfo.build = response.headers.get("X-Relay-Build") || "";
    myCharacters = data.characters || [];
    const before = ownedIds.size; ownedIds = new Set(Array.isArray(data.owned) ? data.owned : []);
    if (ownedIds.size !== before && sceneData) renderScene(); // newly known own dice symbols become movable
  } catch (error) { window.__mineInfo.error = String(error); if (!mineLoaded && mineRetry < 8) { mineRetry += 1; setTimeout(refreshMyCharacters, 1500 * mineRetry); } }
  document.getElementById("char-window")?.dispatchEvent(new Event("cm-refresh"));
  return myCharacters;
}
// one request to the relay about a character; resolves to { ok, error }
async function characterRequest(op, body) {
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/objects/${op}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "character", ...body }) });
    if (!response.ok) return { ok: false, error: (await response.json().catch(() => ({}))).error || "요청하지 못했습니다." };
    return await waitForCommand((await response.json().catch(() => ({}))).commandId);
  } catch (_) { return { ok: false, error: "요청하지 못했습니다." }; }
}
// The GM's page answers every request (delivered / failed with a reason): wait for it so a failure is shown instead of silence.
async function waitForCommand(commandId, ms = 15000) {
  if (!commandId) return { ok: true };
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/commands/${encodeURIComponent(commandId)}/result`);
      if (response.ok) { const { status, error } = await response.json(); if (status === "delivered") return { ok: true }; if (status === "failed") return { ok: false, error: error || "GM 화면에서 처리하지 못했습니다." }; }
    } catch (_) { /* try again */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return { ok: false, error: "GM 화면이 응답하지 않습니다. GM의 코코포리아 탭이 열려 있고 확장이 켜져 있는지 확인해 주세요." };
}
// after a request the GM's page needs a moment to write and report: look again a few times
async function refreshUntil(changed) {
  for (let i = 0; i < 10; i += 1) { await new Promise(r => setTimeout(r, 700)); const before = JSON.stringify(myCharacters); await refreshMyCharacters(); if (changed(JSON.parse(before), myCharacters)) return true; }
  return false;
}
async function createCharacter(window_) {
  const known = new Set(myCharacters.map(c => c.id));
  showSendStatus("캐릭터를 만드는 중입니다.", 15000);
  const result = await characterRequest("create", { fields: {} });
  if (!result.ok) { showSendStatus(result.error, 8000); return; }
  showSendStatus("", 1);
  await refreshUntil((_, now) => now.some(c => !known.has(c.id)));
  const created = myCharacters.find(c => !known.has(c.id));
  if (created) openCharacterEditor(created.id);
}
function openCharacterWindow() {
  const old = document.getElementById("char-window"); if (old) { old.remove(); return; }
  const win = el("div", "char-window"); win.id = "char-window"; win.setAttribute("role", "dialog"); win.setAttribute("aria-label", "내 캐릭터 목록");
  const head = el("div", "cw-head"); head.append(el("h6", "", "내 캐릭터 목록"));
  const add = el("button", "cw-btn", "+"); add.type = "button"; add.title = "캐릭터 만들기"; add.setAttribute("aria-label", "캐릭터 만들기");
  add.addEventListener("click", () => createCharacter(win));
  const x = el("button", "cw-btn", "×"); x.type = "button"; x.setAttribute("aria-label", "닫기"); x.addEventListener("click", () => win.remove());
  head.append(add, x);
  const body = el("div", "cw-body");
  const fill = () => {
    body.replaceChildren();
    // a row as CCFOLIA draws it (measured on a player's screen): avatar circle, name ("NO NAME" while empty), memo line ("NO TEXT" while empty), put-on-the-screen icon on the right
    for (const c of myCharacters) {
      const line = el("div", "cw-row"), row = el("button", "char-row"); row.type = "button";
      const avatar = el("span", "cw-avatar"); avatar.append(svgIcon("M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z", 24));
      const text = el("span", "char-text"); text.append(el("b", "", c.name || "NO NAME"), el("small", "", String(c.memo || "").split("\n")[0] || "NO TEXT"));
      row.append(avatar, text); row.addEventListener("click", () => openCharacterEditor(c.id));
      const place = el("button", "cw-place"); place.type = "button"; place.title = c.active ? "화면에 있음" : "화면에 추가"; place.setAttribute("aria-label", place.title); place.disabled = !!c.active;
      place.append(svgIcon("M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z", 24));
      place.addEventListener("click", async () => { const result = await characterRequest("place", { id: c.id, x: Number(c.x) || 0, y: Number(c.y) || 0 }); if (!result.ok) showSendStatus(result.error, 6000); else setTimeout(refreshMyCharacters, 900); });
      line.append(row, place); body.append(line);
    }
    if (!myCharacters.length) body.append(el("p", "", "아직 만든 캐릭터가 없습니다. + 로 만들 수 있습니다."));
  };
  win.addEventListener("cm-refresh", fill);
  fill(); win.append(head, body); document.body.append(win);
  refreshMyCharacters();
  let drag = null;
  head.addEventListener("pointerdown", event => { if (event.target.closest("button")) return; const r = win.getBoundingClientRect(); drag = { dx: event.clientX - r.left, dy: event.clientY - r.top }; try { head.setPointerCapture(event.pointerId); } catch (_) {} });
  head.addEventListener("pointermove", event => { if (!drag) return; win.style.left = `${Math.max(0, Math.min(innerWidth - 80, event.clientX - drag.dx))}px`; win.style.top = `${Math.max(0, Math.min(innerHeight - 48, event.clientY - drag.dy))}px`; });
  head.addEventListener("pointerup", () => { drag = null; });
}
// CCFOLIA's "캐릭터 편집" (measured from a native player's screen): name + initiative, memo, token size / x / y, reference URL, standing (image: later), status rows (label, current, max) with - and +,
// parameter rows (label, value) with - and +, chat palette; delete / duplicate / put on the screen at the bottom. Changes are saved a moment after typing stops.
// What the character menu and its keys do (CCFOLIA's player menu, measured): R / Shift+R turn the token by 45 degrees, S puts it away, T takes ownership, Ctrl+D duplicates, Ctrl+Backspace deletes.
async function charAction(name, id) {
  const fail = answer => { if (!answer.ok) showSendStatus(answer.error || "처리하지 못했습니다.", 6000); };
  const scene = (sceneData?.characters || []).find(c => c.id === id);
  if (name === "rotate" || name === "rotateBack") {
    // the token turns at once; if the request is refused it turns back
    if (!scene) return;
    const turn = name === "rotate" ? 45 : -45, before = Number(scene.angle) || 0, next = ((before + turn) % 360 + 360) % 360;
    scene.angle = next; renderScene();
    const answer = await characterRequest("update", { id, fields: { angle: next } });
    if (!answer.ok) { scene.angle = before; renderScene(); fail(answer); }
    return;
  }
  if (name === "stow") { document.querySelectorAll(".stage .selected").forEach(n => n.classList.remove("selected")); window.__selectedDie = null; fail(await characterRequest("place", { id, stow: true })); setTimeout(refreshMyCharacters, 900); return; }
  if (name === "claim") { fail(await characterRequest("claim", { id })); refreshMyCharacters(); return; }
  if (name === "duplicate") { fail(await characterRequest("duplicate", { id })); setTimeout(refreshMyCharacters, 900); return; }
  if (name === "delete") {
    if (!confirm("이 캐릭터를 삭제할까요?")) return;
    window.__selectedDie = null; (window.__goneIds ||= new Set()).add(id); renderScene();
    const answer = await characterRequest("delete", { id });
    if (!answer.ok) { window.__goneIds.delete(id); renderScene(); } else setTimeout(() => window.__goneIds?.delete(id), 8000);
    fail(answer); setTimeout(refreshMyCharacters, 900);
  }
}
document.addEventListener("keydown", event => {
  const id = window.__selectedDie; if (!id || event.isComposing || event.target.closest?.("input, textarea, select, [contenteditable=true], .dlg, .char-window")) return;
  if (!(sceneData?.characters || []).some(c => c.id === id)) return; // keys act on a selected character (dice have their own menu)
  const key = event.key.toLowerCase(), plain = !event.altKey && !event.metaKey;
  let name = "";
  if (plain && !event.ctrlKey && key === "r") name = event.shiftKey ? "rotateBack" : "rotate";
  else if (plain && !event.ctrlKey && !event.shiftKey && key === "s") name = "stow";
  else if (plain && !event.ctrlKey && !event.shiftKey && key === "t" && !ownedIds.has(id)) name = "claim";
  else if (plain && event.ctrlKey && key === "d") name = "duplicate";
  else if (plain && event.ctrlKey && event.key === "Backspace") name = "delete";
  if (!name) return;
  event.preventDefault(); charAction(name, id);
});
// A change to one's own die shows at once (the die is redrawn from the local scene) and goes to the GM's page; if it is refused the die goes back.
async function dieRequest(id, fields, extra = {}) {
  const die = (sceneData?.diceSymbols || []).find(d => d.id === id); if (!die) return;
  const before = { faces: die.faces, value: die.value, closed: die.closed };
  Object.assign(die, fields); if ("faces" in fields && !("value" in fields)) die.value = 1; renderScene();
  const answer = await characterRequest("update", { kind: "dice", id, fields, ...extra });
  if (!answer.ok) { Object.assign(die, before); renderScene(); showSendStatus(answer.error || "처리하지 못했습니다.", 6000); }
}
// Rolling (the menu entry and a double click on the die, like CCFOLIA): a random face, shown at once; the GM's page also says it in the chat ("1D6 다이스 심볼 (1D6) > 3").
const rollDie = id => { const faces = Number((sceneData?.diceSymbols || []).find(d => d.id === id)?.faces) || 6; return dieRequest(id, { value: 1 + Math.floor(Math.random() * faces) }, { roll: true }); };
// Any character of the room opens in the full editor (a native player can edit them all): the editor fields of one that is not the person's own come from the relay.
async function editCharacter(id) {
  if (!myCharacters.some(c => c.id === id)) {
    try { const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/character-doc?id=${encodeURIComponent(id)}`); if (!response.ok) throw new Error("no doc"); (window.__otherDocs ||= new Map()).set(id, (await response.json()).character); }
    catch (_) { showSendStatus("캐릭터 정보를 가져오지 못했습니다.", 4000); return; }
  }
  openCharacterEditor(id);
}
function openCharacterEditor(id) {
  const current = () => myCharacters.find(c => c.id === id) || window.__otherDocs?.get(id);
  const doc = current(); if (!doc) return;
  const field = (labelText, input) => { const wrap = el("label", "ce-field"); wrap.append(el("span", "ce-label", labelText), input); return wrap; };
  const input = (value, type = "text", extra = {}) => Object.assign(el("input", "ce-input"), { type, value: value ?? "", ...extra });
  openDialog("캐릭터 편집", (body, foot, close, hooks) => {
    body.classList.add("ce-body");
    const name = input(doc.name, "text", { maxLength: 40, placeholder: "이름" }), initiative = input(doc.initiative ?? 0, "number");
    const avatar = el("span", "ce-avatar", "👤"); avatar.title = "아이콘 (이미지는 준비 중입니다)"; avatar.setAttribute("aria-hidden", "true");
    const top = el("div", "ce-row ce-top"); top.append(avatar, field("이름", name), field("이니셔티브", initiative));
    const memo = Object.assign(el("textarea", "ce-input ce-area"), { value: doc.memo || "", maxLength: 2000, placeholder: "캐릭터 메모", rows: 4 });
    const size = input(doc.width ?? 4, "number", { min: 1, max: 100 }), px = input(doc.x ?? 0, "number"), py = input(doc.y ?? 0, "number");
    const geometry = el("div", "ce-row3"); geometry.append(field("토큰 사이즈", size), field("x", px), field("y", py));
    const url = input(doc.externalUrl || "", "url", { maxLength: 490, placeholder: "참고 URL" });
    const section = (title, note, rowsOf, makeRow, blank, withMinus = true) => {
      const wrap = el("section", "ce-section"), headRow = el("div", "ce-sec-head");
      const rows = el("div", "ce-rows"); const list = [];
      const plus = el("button", "ce-icon", "+"); plus.type = "button"; plus.setAttribute("aria-label", `${title} 추가`);
      const minus = el("button", "ce-icon", "−"); minus.type = "button"; minus.setAttribute("aria-label", `${title} 줄이기`);
      const redraw = () => { rows.replaceChildren(...list.map(item => item.node)); };
      const add = value => { const item = makeRow(value); list.push(item); redraw(); return item; };
      for (const value of rowsOf) add(value);
      plus.addEventListener("click", () => { add(blank); queueSave(); });
      minus.addEventListener("click", () => { list.pop(); redraw(); queueSave(); });
      headRow.append(el("h3", "", title), ...(withMinus ? [minus] : []), plus);
      wrap.append(headRow, el("p", "ce-note", note), rows);
      return { node: wrap, values: () => list.map(item => item.value()) };
    };
    const standing = el("section", "ce-section"); const standingHead = el("div", "ce-sec-head"); const standingPlus = el("button", "ce-icon", "+"); standingPlus.type = "button"; standingPlus.disabled = true; standingPlus.title = "이미지는 준비 중입니다";
    standingHead.append(el("h3", "", "스탠딩"), standingPlus); standing.append(standingHead, el("p", "ce-note", "채팅 시 메시지 박스에 표시되는 이미지를 설정합니다. 예를 들어, \"@미소\"라는 라벨로 설정 한 경우, 채팅 시 \"... @미소\" 처럼 더하는 것으로 스탠딩을 변경합니다."));
    const statusRow = value => { const a = input(value.label, "text", { maxLength: 20, placeholder: "라벨" }), b = input(value.value, "number"), c = input(value.max, "number"), node = el("div", "ce-row3"); node.append(field("라벨", a), field("현재값", b), field("최대값", c)); for (const control of [a, b, c]) control.addEventListener("input", queueSave); return { node, value: () => ({ label: a.value, value: Number(b.value) || 0, max: Number(c.value) || 0 }) }; };
    const paramRow = value => { const a = input(value.label, "text", { maxLength: 20, placeholder: "라벨" }), b = input(value.value, "text", { maxLength: 60, placeholder: "값" }), node = el("div", "ce-row"); node.append(field("라벨", a), field("값", b)); for (const control of [a, b]) control.addEventListener("input", queueSave); return { node, value: () => ({ label: a.value, value: b.value }) }; };
    const statuses = section("스테이터스", "HP나 MP 등 캐릭터에 연동하여 변동하는 스테이터스를 설정합니다. {라벨명}처럼 채팅하면 채팅창에서 현재 값을 불러올 수 있습니다.", doc.status?.length ? doc.status : [{ label: "", value: 0, max: 0 }], statusRow, { label: "", value: 0, max: 0 });
    const params = section("매개변수", "캐릭터의 거의 변하지 않는 매개변수를 설정합니다. {라벨명}처럼 채팅하면 채팅창에서 값을 불러올 수 있습니다.", doc.params?.length ? doc.params : [{ label: "", value: "" }], paramRow, { label: "", value: "" });
    const palette = Object.assign(el("textarea", "ce-input ce-area"), { value: doc.commands || "", maxLength: 4000, placeholder: "채팅 팔레트", rows: 5 });
    const paletteSec = el("section", "ce-section"); paletteSec.append(el("h3", "", "채팅 팔레트"), el("p", "ce-note", "1d100 등의 다이스 커맨드나 캐릭터와 연동 되는 채팅 커맨드를 줄 바꿈으로 구분하여 등록합니다."), palette);
    const status = el("p", "ce-status"); status.setAttribute("role", "status");
    body.append(top, memo, geometry, url, standing, statuses.node, params.node, paletteSec, status);
    let timer = 0, pending = false;
    const collect = () => ({ name: name.value, initiative: Number(initiative.value) || 0, memo: memo.value, size: Number(size.value) || 4, x: Number(px.value) || 0, y: Number(py.value) || 0, externalUrl: url.value, status: statuses.values(), params: params.values(), commands: palette.value });
    const save = async () => { timer = 0; pending = false; status.textContent = "저장 중"; const result = await characterRequest("update", { id, fields: collect() }); status.textContent = result.ok ? "저장했습니다." : result.error; if (result.ok) setTimeout(refreshMyCharacters, 900); };
    function queueSave() { pending = true; clearTimeout(timer); timer = setTimeout(save, 700); }
    for (const control of [name, initiative, memo, size, px, py, url, palette]) control.addEventListener("input", queueSave);
    const flush = () => { if (pending) { clearTimeout(timer); save(); } };
    const remove = el("button", "ce-danger", "삭제"), copy = el("button", "ce-act", "복제"), place = el("button", "ce-act ce-primary", (sceneData?.characters || []).some(c => c.id === id) ? "맵에서 집어넣기" : "화면에 추가");
    for (const button of [remove, copy, place]) button.type = "button";
    remove.addEventListener("click", async () => { if (!confirm("이 캐릭터를 삭제할까요?")) return; clearTimeout(timer); pending = false; const result = await characterRequest("delete", { id }); if (!result.ok) { status.textContent = result.error; return; } close(); await refreshUntil((_, now) => !now.some(c => c.id === id)); });
    copy.addEventListener("click", async () => { flush(); const known = new Set(myCharacters.map(c => c.id)); const result = await characterRequest("duplicate", { id }); if (!result.ok) { status.textContent = result.error; return; } status.textContent = "복제하는 중입니다."; await refreshUntil((_, now) => now.some(c => !known.has(c.id))); status.textContent = "복제했습니다."; });
    place.addEventListener("click", async () => { flush(); const putAway = (sceneData?.characters || []).some(c => c.id === id); const result = await characterRequest("place", putAway ? { id, stow: true } : { id, x: Number(px.value) || 0, y: Number(py.value) || 0 }); status.textContent = result.ok ? (putAway ? "맵에서 집어넣었습니다." : "화면에 추가했습니다.") : result.error; if (result.ok) { place.textContent = putAway ? "화면에 추가" : "맵에서 집어넣기"; setTimeout(refreshMyCharacters, 900); } });
    foot.replaceChildren(remove, copy, place);
    foot.classList.add("ce-foot");
    hooks.beforeClose = flush; // closing (x, Escape, outside click) saves what was typed first
  });
}
function openRoomMenu(anchor) {
  const items = [{ label: "코코포리아에서 열기", run: () => window.open(`https://ccfolia.com/rooms/${encodeURIComponent(roomId)}`, "_blank", "noopener") }];
  if ("documentPictureInPicture" in window) items.push({ label: document.getElementById("pip-open").textContent || "플로팅 창", run: () => document.getElementById("pip-open").click() });
  items.push({ label: "룸에서 나가기", run: () => stop("룸에서 나갔습니다.") });
  openMenu(anchor, items);
}
document.getElementById("room-menu-btn").addEventListener("click", event => openRoomMenu(event.currentTarget));
// CCFOLIA keeps log output in the gear menu of the chat panel header (not in the room menu); the GM-only entries (tab edit, log deletion) are left out.
const openChatMenu = anchor => openMenu(anchor, [{ label: "로그 내보내기 (HTML)", run: () => downloadLog("html") }, { label: "로그 내보내기 (텍스트)", run: () => downloadLog("txt") }]);
document.getElementById("chat-gear").addEventListener("click", event => openChatMenu(event.currentTarget));
// Native mirroring: the panel header is CCFOLIA's own (title + close + chat menu buttons); its two buttons do what the built-in ones do.
function renderMirroredHeader() {
  const title = document.querySelector(".chat > h2");
  const on = cmMirror.has("chatHeader");
  if (title) title.hidden = on;
  if (!on) { document.getElementById("chat-head-host")?.remove(); return; }
  cmMirror.shadow("chat-head-host", node => title.before(node));
  const header = cmMirror.make("chatHeader");
  cmMirror.slot(header, "close")?.addEventListener("click", () => document.getElementById("chat-close").click());
  const menu = cmMirror.slot(header, "menu");
  menu?.addEventListener("click", () => openChatMenu(menu));
  cmMirror.show("chat-head-host", [header]);
}
// What the page holds about the mirror, for checking by hand: window.playroomDiag() in the console (the result is also copied).
window.playroomDiag = () => {
  // what the relay answers to the requests the menus make: asked in the background, shown from the second call on (the call itself stays synchronous so DevTools' copy() works)
  const net = window.__diagNet || { note: "call playroomDiag() once more for the relay checks" };
  (async () => {
    const found = {};
    try { const r = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/mine`); found.mine = [r.status, r.headers.get("X-Relay-Build") || "(no build header: old code)"]; if (r.ok) { const d = await r.json(); found.member = d.member || ""; found.mineCharacters = (d.characters || []).map(c => c.id); found.owned = d.owned || []; } } catch (error) { found.mine = String(error); }
    const first = (sceneData?.characters || [])[0];
    if (first) { try { const r = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/character-doc?id=${encodeURIComponent(first.id)}`); found.characterDoc = [first.id, r.status, r.headers.get("X-Relay-Build") || "(no build header)"]; } catch (error) { found.characterDoc = String(error); } }
    window.__diagNet = found;
  })();
  const text = JSON.stringify({ net, mineInfo: window.__mineInfo, mineLoaded, sceneCharacters: (sceneData?.characters || []).map(c => c.id), assets: Object.keys(cmMirror.assets), help: !!cmMirror.help, decks: (sceneData?.decks || []).map(d => [d.id, d.coverUrl, d.x, d.y]), deckImages: document.querySelectorAll('#scene-field img[data-kind="deck"]').length, dice: (sceneData?.diceSymbols || []).length, diceImages: document.querySelectorAll(".scene-die-img").length, plainDice: document.querySelectorAll(".scene-die").length, owned: [...ownedIds], pieces: [...document.querySelectorAll("#scene-field [data-id]")].map(e => [e.tagName.toLowerCase(), e.dataset.kind || "", e.dataset.id, e.dataset.locked ? "locked" : "free", getComputedStyle(e).cursor, getComputedStyle(e).pointerEvents]), scale: Math.round(view.base * view.zoom / 24 * 1000) / 1000, view: [Math.round(view.x), Math.round(view.y)], touched: !!view.touched, stage: [document.querySelector(".stage").clientWidth, document.querySelector(".stage").clientHeight], window: [innerWidth, innerHeight], dpr: devicePixelRatio, fieldSize: [sceneData?.fieldWidth, sceneData?.fieldHeight] });
  // the result is copied for pasting (DevTools' copy(), then the clipboard API); the same text is returned
  try { if (typeof copy === "function") copy(text); } catch (_) {}
  try { navigator.clipboard?.writeText(text).catch(() => {}); } catch (_) {}
  return text;
};
// Each part is redrawn on its own: one that fails (a template CCFOLIA changed) must not stop the others, least of all the scene with the pictures that arrive with the mirror (card backs, dice faces).
cmMirror.onChange = () => {
  for (const redraw of [() => renderScene(), renderMirroredHeader, renderMirroredTopBar, () => window.renderMirroredZoom?.(), () => { if (typeof current !== "undefined" && current) renderState(current); }]) { try { redraw(); } catch (error) { console.warn("mirror redraw failed", error); } }
};

// Log export: everything this page holds (the relay keeps the latest messages of every tab), saved as a file on this computer. Whispers to the GM and secret dice results
// never reach a participant, so they are not in it. Built here in the browser; nothing is sent anywhere.
const logTime = value => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const logChannels = () => (current.channels?.length ? current.channels : DEFAULT_CHANNELS);
const logMessages = channel => (current.messages || []).filter(message => (message.channel || "main") === channel.id);
function buildLogText() {
  const lines = [`${current.roomTitle || "플레이룸"} — 로그 (${logTime(Date.now())} 내보냄)`, ""];
  for (const channel of logChannels()) {
    const messages = logMessages(channel);
    if (!messages.length) continue;
    lines.push(`# ${channel.label || channel.id}`);
    for (const message of messages) lines.push(`[${logTime(message.createdAt)}] ${message.author || "noname"}: ${decodeEnvelope(message.text || "").text}${message.roll?.result ? ` ${message.roll.result}` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}
function buildLogHtml() {
  const box = document.createElement("div");
  const title = document.createElement("h1"); title.textContent = `${current.roomTitle || "플레이룸"} — 로그`; box.append(title);
  const note = document.createElement("p"); note.className = "note"; note.textContent = `${logTime(Date.now())} 내보냄`; box.append(note);
  for (const channel of logChannels()) {
    const messages = logMessages(channel);
    if (!messages.length) continue;
    const section = document.createElement("section");
    const heading = document.createElement("h2"); heading.textContent = channel.label || channel.id; section.append(heading);
    for (const message of messages) {
      const row = document.createElement("div"); row.className = "msg";
      if (message.icon) { const img = document.createElement("img"); img.src = message.icon; img.alt = ""; row.append(img); }
      const body = document.createElement("div");
      const head = document.createElement("div");
      const name = document.createElement("span"); name.className = "name"; name.textContent = message.author || "noname";
      if (/^#[0-9a-f]{3,8}$/i.test(message.color || "")) name.style.color = message.color;
      const time = document.createElement("span"); time.className = "time"; time.textContent = ` ${logTime(message.createdAt)}`;
      head.append(name, time);
      const text = document.createElement("p"); renderRich(text, message.text || "");
      if (message.roll?.result) { const result = document.createElement("span"); result.className = "roll"; result.textContent = ` ${message.roll.result}`; (text.lastElementChild || text).append(result); }
      body.append(head, text); row.append(body); section.append(row);
    }
    box.append(section);
  }
  const css = "body{background:#202020;color:#fff;font:14px/1.5 'Noto Sans KR',sans-serif;max-width:760px;margin:0 auto;padding:16px}h1{font-size:20px}h2{font-size:16px;margin:24px 0 4px;border-bottom:1px solid #444}.note,.time{color:#aaa;font-size:12px}.msg{display:flex;gap:12px;padding:8px 0;border-top:1px solid #333}.msg img{width:40px;height:40px;object-fit:cover;flex:none}.name{font-weight:700}.msg p{margin:2px 0 0}.roll{color:rgba(255,255,255,.7)}";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title.textContent.replace(/[<>&]/g, "")}</title><style>${css}</style></head><body>${box.innerHTML}</body></html>`;
}
function downloadLog(kind) {
  const pad = n => String(n).padStart(2, "0"), d = new Date();
  const name = `${(current.roomTitle || "room").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)}-log-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${kind}`;
  const blob = new Blob([kind === "html" ? buildLogHtml() : buildLogText()], { type: kind === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}
// The account menu as a CCFOLIA player sees it (measured): profile row (default picture, name, "SNS 미인증"), log in, divider, help / terms / privacy (new tab), divider, developer commands.
// Log in and developer commands have no meaning here and are shown disabled. BGM mute lives on the BGM bar; leaving the room is in the room menu.
const openAccountMenu = anchor => openMenu(anchor, [{ profile: { letter: document.getElementById("account-av").textContent, image: cmMirror.assets["/ccfolia.png"] || "", name: chatName.value || "참여자", sub: "SNS 미인증" } },
  { label: "로그인", disabled: true }, { divider: true },
  { label: "도움말", href: "https://docs.ccfolia.com/" }, { label: "이용약관", href: "https://ccfolia.com/termsOfService.html" }, { label: "개인 정보 정책", href: "https://ccfolia.com/privacyPolicy.html" }, { divider: true },
  { label: "개발자 명령", disabled: true }]);
document.getElementById("account-btn").addEventListener("click", event => openAccountMenu(event.currentTarget));
// Native mirroring: the top bar is CCFOLIA's own (GM-only buttons were left out on the GM side). Its buttons call the same functions as the built-in ones;
// the built-in header stays in the page (hidden) as the data holder and the fallback. A handout button (not a CCFOLIA feature) is added by copying the character-list button.
let topBar = null;
function renderMirroredTopBar() {
  const legacy = document.querySelector("#room > header");
  const on = cmMirror.has("topBar");
  legacy.hidden = on;
  if (!on) { document.getElementById("top-host")?.remove(); topBar = null; return; }
  cmMirror.shadow("top-host", node => legacy.before(node));
  const bar = cmMirror.make("topBar"), slot = name => cmMirror.slot(bar, name);
  const menu = slot("menu"), chars = slot("chars"), account = slot("account"), chatOpen = slot("chatOpen"), avatar = slot("avatar");
  menu.addEventListener("click", () => openRoomMenu(menu));
  chars.addEventListener("click", () => document.getElementById("char-list-open").click());
  account.addEventListener("click", () => openAccountMenu(account));
  chatOpen.addEventListener("click", () => document.getElementById("chat-open").click());
  const handout = chars.cloneNode(true); handout.removeAttribute("data-cm-slot"); handout.setAttribute("aria-label", "핸드아웃");
  const icon = handout.querySelector("svg"), source = document.querySelector("#handout-open svg");
  if (icon && source) { icon.replaceChildren(...[...source.children].map(child => child.cloneNode(true))); for (const name of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"]) { if (source.hasAttribute(name)) icon.setAttribute(name, source.getAttribute(name)); else icon.removeAttribute(name); } icon.style.fill = source.getAttribute("fill") || ""; icon.style.stroke = source.getAttribute("stroke") || ""; }
  handout.addEventListener("click", () => document.getElementById("handout-open").click());
  chars.after(handout);
  // the avatar is a letter (the participant has no CCFOLIA photo) and a dot shows whether the GM is connected
  const letter = document.createElement("span");
  letter.style.cssText = "width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#555;color:#fff;font-size:20px";
  // CCFOLIA's default account picture (sent by the GM page as a data URI) when it has arrived; otherwise a letter
  if (cmMirror.assets["/ccfolia.png"] && avatar) { avatar.src = cmMirror.assets["/ccfolia.png"]; avatar.alt = ""; letter.hidden = true; avatar.after(letter); } else avatar.replaceWith(letter);
  // buttons a player sees on CCFOLIA (lists of the GM tools, the folded menu): same look and place, disabled like on a player screen (measured: only the character list is active)
  for (const button of bar.querySelectorAll("button[aria-label]")) { const label = button.getAttribute("aria-label"); if (/^\s*\[GM\]/.test(label) || label === "메뉴") { button.title = label; button.disabled = true; button.classList.add("Mui-disabled"); } }
  const dot = document.createElement("i"); dot.style.cssText = "position:absolute;right:3px;bottom:3px;width:12px;height:12px;border-radius:50%;border:2px solid #202020;font-size:0;background:#9e9e9e";
  account.style.position = "relative"; account.append(dot);
  const subtitle = slot("subtitle"); if (subtitle) subtitle.style.display = "none";
  topBar = { title: slot("title"), letter, dot, handout, chatOpen };
  cmMirror.show("top-host", [bar]);
  syncTopBar();
}
function syncTopBar() {
  if (!topBar) return;
  const { title, letter, dot, handout, chatOpen } = topBar;
  title.firstChild?.nodeType === Node.TEXT_NODE ? title.firstChild.nodeValue = document.getElementById("room-title").textContent : title.insertBefore(document.createTextNode(document.getElementById("room-title").textContent), title.firstChild);
  letter.textContent = document.getElementById("account-av").textContent;
  dot.style.background = document.getElementById("gm-state").dataset.online === "1" ? "#4caf50" : "#9e9e9e";
  handout.hidden = document.getElementById("handout-open").hidden;
  chatOpen.hidden = document.getElementById("chat-open").hidden;
}
setInterval(() => { document.getElementById("account-av").textContent = [...(chatName.value || "?")][0] || "?"; syncTopBar(); }, 1000);
// Chat window open/close (same function for the panel's >| button and the edge button); remembered per browser.
{
  const COLLAPSE_KEY = "capybara-chat-collapsed";
  const set = on => {
    document.getElementById("room").classList.toggle("chat-collapsed", on);
    document.getElementById("chat-open").hidden = !on;
    try { localStorage.setItem(COLLAPSE_KEY, on ? "1" : "0"); } catch (_) {}
    renderScene();
  };
  document.getElementById("chat-close").addEventListener("click", () => set(true));
  document.getElementById("chat-open").addEventListener("click", () => set(false));
  let saved = "0"; try { saved = localStorage.getItem(COLLAPSE_KEY) || "0"; } catch (_) {}
  if (saved === "1") { document.getElementById("room").classList.add("chat-collapsed"); document.getElementById("chat-open").hidden = false; }
}
