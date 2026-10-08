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
{
  const backdrop = document.createElement("div"); backdrop.id = "handout-backdrop"; backdrop.hidden = true;
  const close = document.createElement("button"); close.type = "button"; close.id = "handout-close"; close.textContent = "닫기";
  handoutEl.append(close);
  document.body.append(backdrop);
  const hide = () => { handoutEl.classList.remove("open"); backdrop.hidden = true; handoutClosed = handoutSeen; };
  close.addEventListener("click", hide); backdrop.addEventListener("click", hide);
  document.addEventListener("keydown", event => { if (event.key === "Escape" && handoutEl.classList.contains("open")) hide(); });
  document.getElementById("handout-open").addEventListener("click", () => { handoutEl.hidden = false; handoutEl.classList.add("open"); backdrop.hidden = false; });
  window.syncHandoutPopup = handout => {
    const has = !!handout.id;
    document.getElementById("handout-open").hidden = !has;
    if (!has) { handoutEl.hidden = true; handoutEl.classList.remove("open"); backdrop.hidden = true; handoutSeen = ""; return; }
    const key = `${handout.id}:${handout.updatedAt || ""}`;
    handoutEl.hidden = false;
    if (key !== handoutSeen) { handoutSeen = key; handoutEl.classList.add("open"); backdrop.hidden = false; }
  };
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
const view = { zoom: 1, x: 0, y: 0, unit: 24 }; // camera: zoom multiplier on the fitted size, pan in px — each viewer has their own, like CCFOLIA
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
  const unit = Math.min(24, (w * 0.96) / s.fieldWidth, (h * 0.96) / s.fieldHeight) * view.zoom;
  view.unit = unit;
  const place = (el, x, y, width, height, angle, z) => {
    el.style.position = "absolute";
    el.style.left = `${(w / 2) + view.x + x * unit}px`; el.style.top = `${(h / 2) + view.y + y * unit}px`;
    el.style.width = `${width * unit}px`; el.style.height = `${height * unit}px`;
    el.style.transform = angle ? `rotate(${angle}deg)` : "";
    el.style.zIndex = String(Math.round(z || 0) + 10);
  };
  const nodes = [];
  if (s.foregroundUrl) {
    const img = document.createElement("img"); img.src = s.foregroundUrl; img.alt = ""; img.referrerPolicy = "no-referrer"; img.draggable = false;
    place(img, -s.fieldWidth / 2, -s.fieldHeight / 2, s.fieldWidth, s.fieldHeight, 0, 0);
    img.style.objectFit = s.fieldObjectFit; img.style.zIndex = "1"; nodes.push(img);
  }
  // Pieces store x/y in grid units, characters in pixels at zoom 1 (24px = 1 unit); sizes are in grid units for both.
  // Markers share the items' layer in CCFOLIA (same container, same grid units, drawn after the items of the same z); they cannot be moved by a participant.
  // Layer (measured on ccfolia.com 1.37.5): an item or marker wrapper has z-index = its stored z, a character wrapper has 100 + its stored z, so characters are above items and markers
  // (a stored z of 100 or more on an item is the only way to get above a character); equal layers keep the DOM order items, markers.
  const layerOf = piece => (piece.kind === "character" ? 100 : 0) + (Number(piece.z) || 0);
  const all = [...(s.items || []).map(item => ({ ...item, unitsXY: true, kind: "item" })), ...(s.markers || []).map(marker => ({ ...marker, unitsXY: true, kind: "marker" })), ...(s.characters || []).map(c => ({ ...c, kind: "character" }))];
  for (const item of all.sort((a, b) => layerOf(a) - layerOf(b))) {
    const img = document.createElement("img"); img.src = item.imageUrl || item.iconUrl; img.alt = item.name || ""; img.referrerPolicy = "no-referrer"; img.draggable = false;
    const drop = moved.get(item.id);
    if (drop && Date.now() - drop.at < 5000) { item.x = drop.x; item.y = drop.y; } else moved.delete(item.id);
    if (item.id && item.kind !== "marker") { img.dataset.kind = item.kind; img.dataset.id = item.id; img.dataset.x = item.x; img.dataset.y = item.y; if (item.locked) img.dataset.locked = "1"; }
    place(img, item.unitsXY ? item.x : item.x / 24, item.unitsXY ? item.y : item.y / 24, item.width, item.height, item.angle, layerOf(item));
    img.style.objectFit = "fill"; nodes.push(img);
  }
  field.replaceChildren(...nodes);
  renderStatusPanel(s.characters || []);
  renderSpeakers(s.characters || []);
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
      fill.style.width = `${st.max > 0 ? Math.max(0, Math.min(100, (st.value / st.max) * 100)) : 100}%`;
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
  try { await fetch(`/api/rooms/${encodeURIComponent(roomId)}/status/set`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ characterId: bar.dataset.char, index: Number(bar.dataset.index), value: Number(answer) }) }); } catch (_) {}
});
window.addEventListener("resize", () => renderScene());
// Zoom (wheel or +/- buttons) and pan (drag) of the stage.
{
  const stage = document.querySelector(".stage");
  let raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderScene(); }); };
  const zoomAt = (factor, cx, cy) => {
    const next = Math.max(0.2, Math.min(6, view.zoom * factor));
    const k = next / view.zoom;
    view.x = cx - (cx - view.x) * k; view.y = cy - (cy - view.y) * k; view.zoom = next;
    redraw();
  };
  const centre = () => [stage.clientWidth / 2 - stage.clientWidth / 2, 0];
  const interactive = target => target.closest("#scene-status, #bgm-bar, #zoom-ctl, #handout, #room > header");
  stage.addEventListener("wheel", event => {
    if (interactive(event.target)) return;
    event.preventDefault();
    const rect = stage.getBoundingClientRect();
    zoomAt(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  }, { passive: false });
  let drag = null;
  let piece = null; // a movable piece being dragged (drawn only until drop; one command is sent on release)
  stage.addEventListener("pointerdown", event => {
    if (event.button !== 0 || interactive(event.target)) return;
    if (event.target.dataset?.id) { piece = { el: event.target, x: event.clientX, y: event.clientY, dx: 0, dy: 0, locked: event.target.dataset.locked === "1" }; stage.setPointerCapture?.(event.pointerId); return; }
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
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/pieces/move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, x, y }) });
      if (!response.ok) throw new Error("이동 요청 실패");
    } catch (_) { moved.delete(id); }
    renderScene();
  };
  const endDrag = () => { if (piece) { dropPiece(); return; } drag = null; stage.classList.remove("panning"); };
  stage.addEventListener("pointerup", endDrag); stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", event => { if (!interactive(event.target)) { view.zoom = 1; view.x = 0; view.y = 0; redraw(); } });
  const ctl = document.createElement("div"); ctl.id = "zoom-ctl";
  const mk = (label, title, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title); b.addEventListener("click", fn); return b; };
  ctl.append(
    mk("+", "확대", () => zoomAt(1.25, 0, 0)),
    mk("−", "축소", () => zoomAt(1 / 1.25, 0, 0)),
    mk("⌂", "화면 맞춤", () => { view.zoom = 1; view.x = 0; view.y = 0; redraw(); }));
  stage.append(ctl);
  void centre;
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
const renderState = data => {
  showHealth(data.health);
  renderTabs(data);
  if (data.bgm) playBgm(data.bgm);
  document.getElementById("room-title").textContent = data.roomTitle || "플레이 룸";
  const gm = document.getElementById("gm-state"); gm.dataset.online = data.gmOnline ? "1" : "0"; gm.title = data.gmOnline ? "GM 연결됨" : "GM 연결 지연";
  document.getElementById("status").textContent = data.gmOnline ? "동기화 중" : "새 메시지 전송을 기다리는 중";
  const list = document.getElementById("messages");
  const stickToBottom = !rendered || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.replaceChildren(...(data.messages || []).filter(message => (message.channel || "main") === activeChannel).map(message => {
    // Same layout as CCFOLIA's chat rows: 40px square avatar, bold name + caption time, 14px body.
    const item = document.createElement("li");
    for (const [flag, on] of Object.entries(message.roll || {})) if (on === true) item.classList.add(`roll-${flag}`);
    const name = message.author || "이름 없음";
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
    if (message.roll?.result) { const result = document.createElement("span"); result.className = "roll-result"; result.textContent = ` ${message.roll.result}`; (body.lastElementChild || body).append(result); }
    text.append(head, body); item.append(avatar, text); return item;
  }));
  if (stickToBottom) list.scrollTop = list.scrollHeight;
  rendered = true;
  const handout = data.handout || {};
  syncHandoutPopup(handout);
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
  if (a < 0) return { text: full, env: null };
  const b = full.indexOf(INVIS_END, a + INVIS_START.length);
  if (b < 0) return { text: full, env: null };
  try {
    let bits = "";
    for (const ch of full.slice(a + INVIS_START.length, b)) { const i = INVIS_MAP.indexOf(ch); if (i >= 0) bits += i.toString(2).padStart(2, "0"); }
    let raw = "";
    for (let i = 0; i + 8 <= bits.length; i += 8) raw += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
    const env = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/\0+$/g, "")))));
    return { text: full.slice(0, a), env };
  } catch (_) { return { text: full.slice(0, a), env: null }; }
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
function renderRich(container, full) {
  const { text, env } = decodeEnvelope(full);
  if (!env || typeof env !== "object") { container.textContent = text; return; }
  const runs = (Array.isArray(env.formatRuns) ? env.formatRuns : []).map(r => ({ start: Math.max(0, Number(r.start) || 0), end: Math.min(text.length, Number(r.end) || 0), style: r.style && typeof r.style === "object" ? r.style : {} })).filter(r => r.end > r.start);
  const align = Array.isArray(env.alignRuns) ? env.alignRuns : [];
  const narration = !!env.blockStyle?.narration;
  const lines = text.split("\n");
  let offset = 0;
  lines.forEach((line, index) => {
    const lineEl = document.createElement("div");
    lineEl.style.minHeight = "1.43em";
    const run = align.find(a => a.start <= index && a.end > index);
    const alignment = narration ? "center" : (run && ["left", "center", "right"].includes(run.align) ? run.align : "");
    if (alignment) lineEl.style.textAlign = alignment;
    if (narration) lineEl.style.fontStyle = "italic";
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
      for (const r of active) styleSegment(span, r.style);
      span.append(piece);
      if (ruby) { const rt = document.createElement("rt"); rt.textContent = String(ruby.style.rubyText).slice(0, 60); span.append(rt); }
      lineEl.append(span);
    }
    container.append(lineEl);
    offset = lineEnd + 1;
  });
}
function messageTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return d.toDateString() === new Date().toDateString() ? `今日 ${pad(d.getHours())}:${pad(d.getMinutes())}` : `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  } else if (message.type === "scene") {
    current = { ...current, scene: message.scene };
    renderScene(message.scene);
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
  colorBtn.style.color = nameColor || "#cce5df";
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
colorBtn.addEventListener("click", () => { colorInput.value = nameColor || "#cce5df"; colorInput.showPicker?.(); });
colorInput.addEventListener("input", () => { nameColor = colorInput.value; try { localStorage.setItem("capybara-name-color", nameColor); } catch (_) {} refreshSpeakerUi(); });
refreshSpeakerUi();
// Format rows: the same markers the GM panel understands (**bold**, *italic*, __underline__, ~~strike~~, ||blur||, `code`, [base|ruby], [base^tooltip], {a:center|text|}).
{
  const mk = (label, title, run) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.title = title; b.setAttribute("aria-label", title); b.addEventListener("click", run); return b; };
  const row1 = document.createElement("div"); row1.className = "fmt-row";
  row1.append(mk("B", "Bold", () => wrapSelection("**", "**")), mk("I", "Italic", () => wrapSelection("*", "*")), mk("U", "Underline", () => wrapSelection("__", "__")), mk("S", "Strike", () => wrapSelection("~~", "~~")),
    mk("Rb", "Ruby", () => wrapSelection("[", "|]")), mk("Tip", "Tooltip", () => wrapSelection("[", "^]")), mk("Bl", "Blur", () => wrapSelection("||", "||")), mk("</>", "Code block", () => wrapSelection("`", "`")));
  const row2 = document.createElement("div"); row2.className = "fmt-row";
  const align = (name, d) => { const b = mk("", `Align ${name}`, () => wrapSelection(`{a:${name}|`, "|}")); const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 16 16"); svg.setAttribute("width", "15"); svg.setAttribute("height", "15"); const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", d); p.setAttribute("fill", "currentColor"); svg.append(p); b.append(svg); return b; };
  row2.append(align("left", "M2 3h12v1H2zm0 6h8v1H2zm0 6h12v1H2z"), align("center", "M2 3h12v1H2zm4 6h4v1H6zM3 15h10v-1H3z"), align("right", "M2 3h12v1H2zm6 6h6v1H8zM2 15h12v-1H2z"));
  document.querySelector("#chat-form .dice-row").after(row1, row2);
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
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientMessageId, text, channel: activeChannel, characterId: speaker.value, name: chatName.value.trim(), color: nameColor }) });
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
function openMenu(anchor, items) {
  const same = menuEl && menuEl.anchor === anchor;
  closeMenu(); if (same) return;
  const paper = el("div", "menu-paper"); paper.setAttribute("role", "menu"); paper.anchor = anchor;
  for (const item of items) {
    if (item.header) { paper.append(Object.assign(el("div", "menu-head"), { textContent: item.header })); continue; }
    const row = el("button", "menu-item", item.label); row.type = "button"; row.setAttribute("role", "menuitem");
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
document.addEventListener("pointerdown", event => { if (menuEl && !menuEl.contains(event.target) && !menuEl.anchor.contains(event.target)) closeMenu(); }, true);
document.addEventListener("keydown", event => { if (event.key === "Escape") { const anchor = menuEl?.anchor; closeMenu(); anchor?.focus?.(); } });

function openDialog(title, build) {
  const back = el("div", "dlg-backdrop"), paper = el("div", "dlg"), head = el("h2", "", title);
  paper.setAttribute("role", "dialog"); paper.setAttribute("aria-modal", "true"); paper.append(head);
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = event => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
  const body = el("div", "dlg-body"); const foot = el("div", "dlg-foot");
  const done = el("button", "", "닫기"); done.type = "button"; done.addEventListener("click", close); foot.append(done);
  build(body, foot, close); paper.append(body, foot); back.append(paper);
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
document.getElementById("char-list-open").addEventListener("click", () => {
  openDialog("내 캐릭터 목록", (body, foot, close) => {
    const list = sceneData?.characters || [];
    if (!list.length) body.append(el("p", "", "장면에 보이는 캐릭터가 없습니다."));
    for (const c of list) {
      const row = el("button", "char-row"); row.type = "button";
      const img = el("img"); img.src = c.iconUrl; img.alt = ""; img.referrerPolicy = "no-referrer";
      const text = el("span", "char-text"); text.append(el("b", "", c.name || "(이름 없음)"), el("small", "", statusSummary(c)));
      row.append(img, text); row.addEventListener("click", () => { close(); openSheet(c.id); }); body.append(row);
    }
  });
});
document.getElementById("room-menu-btn").addEventListener("click", event => {
  const items = [{ label: "코코포리아에서 열기", run: () => window.open(`https://ccfolia.com/rooms/${encodeURIComponent(roomId)}`, "_blank", "noopener") }];
  if ("documentPictureInPicture" in window) items.push({ label: document.getElementById("pip-open").textContent || "플로팅 창", run: () => document.getElementById("pip-open").click() });
  items.push({ label: "로그 내보내기 (HTML)", run: () => downloadLog("html") }, { label: "로그 내보내기 (텍스트)", run: () => downloadLog("txt") });
  openMenu(event.currentTarget, items);
});

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
  const lines = [`${current.roomTitle || "플레이 룸"} — 로그 (${logTime(Date.now())} 내보냄)`, ""];
  for (const channel of logChannels()) {
    const messages = logMessages(channel);
    if (!messages.length) continue;
    lines.push(`# ${channel.label || channel.id}`);
    for (const message of messages) lines.push(`[${logTime(message.createdAt)}] ${message.author || "이름 없음"}: ${decodeEnvelope(message.text || "").text}${message.roll?.result ? ` ${message.roll.result}` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}
function buildLogHtml() {
  const box = document.createElement("div");
  const title = document.createElement("h1"); title.textContent = `${current.roomTitle || "플레이 룸"} — 로그`; box.append(title);
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
      const name = document.createElement("span"); name.className = "name"; name.textContent = message.author || "이름 없음";
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
document.getElementById("account-btn").addEventListener("click", event => {
  openMenu(event.currentTarget, [{ header: chatName.value || "참여자" }, { label: bgmMuted ? "BGM 음소거 해제" : "BGM 음소거", run: () => document.getElementById("bgm-mute").click() }, { label: "룸에서 나가기", run: () => stop("룸에서 나갔습니다.") }]);
});
setInterval(() => { document.getElementById("account-av").textContent = [...(chatName.value || "?")][0] || "?"; }, 1000);
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
