"use strict";
const params = new URLSearchParams(location.hash.slice(1));
const roomId = params.get("room") || "";
const inviteToken = params.get("token") || "";
const consent = document.getElementById("consent");
// Remember the display name on this browser so a returning participant does not retype it.
const NAME_KEY = "capybara-display-name";
const chatName = document.getElementById("chat-name");
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
  bgmBar.hidden = !playing;
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
volInput.addEventListener("input", () => { bgmVolume = Number(volInput.value); syncVol(); try { ytPlayer?.setVolume(bgmVolume); } catch (_) {} });
syncVol();
document.getElementById("bgm-mute").addEventListener("click", () => {
  bgmMuted = !bgmMuted;
  document.getElementById("bgm-mute-icon").setAttribute("d", bgmMuted ? MUTE_PATH : SPK_PATH);
  try { bgmMuted ? ytPlayer?.mute() : ytPlayer?.unMute(); } catch (_) {}
});
document.getElementById("bgm-stop").addEventListener("click", () => { bgmStopped = bgmLast?.startedAt || true; bgmKey = ""; stopPlayer(); });
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
  if (scene !== undefined) sceneData = scene;
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
  const all = [...(s.items || []).map(item => ({ ...item, unitsXY: true, kind: "item" })), ...(s.characters || []).map(c => ({ ...c, kind: "character" }))];
  for (const item of all.sort((a, b) => a.z - b.z)) {
    const img = document.createElement("img"); img.src = item.imageUrl || item.iconUrl; img.alt = item.name || ""; img.referrerPolicy = "no-referrer"; img.draggable = false;
    const drop = moved.get(item.id);
    if (drop && Date.now() - drop.at < 5000) { item.x = drop.x; item.y = drop.y; } else moved.delete(item.id);
    if (item.id && !item.locked) { img.dataset.kind = item.kind; img.dataset.id = item.id; img.dataset.x = item.x; img.dataset.y = item.y; }
    place(img, item.unitsXY ? item.x : item.x / 24, item.unitsXY ? item.y : item.y / 24, item.width, item.height, item.angle, item.z);
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
document.querySelector("#chat-form .name-row button").before(speaker);
function renderSpeakers(characters) {
  let want = speaker.value; try { want ||= localStorage.getItem(SPEAKER_KEY) || ""; } catch (_) {}
  speaker.replaceChildren(new Option("내 이름", ""), ...characters.map(c => new Option(c.name || "(이름 없음)", c.id)));
  speaker.value = characters.some(c => c.id === want) ? want : "";
}
speaker.addEventListener("change", () => { try { localStorage.setItem(SPEAKER_KEY, speaker.value); } catch (_) {} });
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
    if (event.target.dataset?.id) { piece = { el: event.target, x: event.clientX, y: event.clientY, dx: 0, dy: 0 }; stage.setPointerCapture?.(event.pointerId); return; }
    drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    stage.setPointerCapture?.(event.pointerId); stage.classList.add("panning");
  });
  stage.addEventListener("pointermove", event => {
    if (piece) { piece.dx = event.clientX - piece.x; piece.dy = event.clientY - piece.y; piece.el.style.translate = `${piece.dx}px ${piece.dy}px`; return; }
    if (!drag) return;
    view.x = drag.vx + event.clientX - drag.x; view.y = drag.vy + event.clientY - drag.y; redraw();
  });
  const dropPiece = async () => {
    const { el, dx, dy } = piece; piece = null;
    if (Math.abs(dx) + Math.abs(dy) < 4) { el.style.translate = ""; return; } // a click, not a move
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
const renderState = data => {
  renderTabs(data);
  if (data.bgm) playBgm(data.bgm);
  document.getElementById("room-title").textContent = data.roomTitle || "플레이 룸";
  document.getElementById("gm-state").textContent = data.gmOnline ? "GM 연결됨" : "GM 연결 지연";
  document.getElementById("status").textContent = data.gmOnline ? "동기화 중" : "새 메시지 전송을 기다리는 중";
  const list = document.getElementById("messages");
  const stickToBottom = !rendered || list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.replaceChildren(...(data.messages || []).filter(message => (message.channel || "main") === activeChannel).map(message => {
    // Same layout as CCFOLIA's chat rows: 40px square avatar, bold name + caption time, 14px body.
    const item = document.createElement("li");
    for (const [flag, on] of Object.entries(message.roll || {})) if (on) item.classList.add(`roll-${flag}`);
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
  if (data.displayName) chatName.value = data.displayName;
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
// Dice row (like CCFOLIA's): each button puts its roll at the cursor of the message box.
{
  const NS = "http://www.w3.org/2000/svg";
  const SHAPES = [
    [4, ["M12 3 22 20H2z"]], [6, ["M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"]],
    [8, ["M12 2 21 12 12 22 3 12z", "M3 12h18"]], [10, ["M12 2 21 10 12 22 3 10z", "M12 2v20"]],
    [12, ["M12 2 22 9.5 18.2 21H5.8L2 9.5z", "M12 2v5M2 9.5l4.5 2.3M22 9.5l-4.5 2.3M5.8 21l3-6.5M18.2 21l-3-6.5"]],
    [20, ["M12 2 21 7v10l-9 5-9-5V7z", "M12 8l5.5 9h-11z"]],
    [100, ["M9 3 16 7v8l-7 4-7-4V7z", "M15 6l7 4v8l-7 4-4-2.3"]]
  ];
  const row = document.createElement("div"); row.className = "dice-row";
  for (const [faces, paths] of SHAPES) {
    const b = document.createElement("button"); b.type = "button"; b.title = `1d${faces}`; b.setAttribute("aria-label", `D${faces}`);
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "24"); svg.setAttribute("height", "24");
    for (const d of paths) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); p.setAttribute("fill", "none"); p.setAttribute("stroke", "#acacac"); p.setAttribute("stroke-width", "1"); p.setAttribute("stroke-linejoin", "round"); svg.append(p); }
    b.append(svg);
    b.addEventListener("click", () => {
      const input = document.getElementById("chat-input"); const a = input.selectionStart ?? input.value.length, z = input.selectionEnd ?? a;
      const text = `1d${faces}`; input.value = input.value.slice(0, a) + text + input.value.slice(z); input.focus(); input.setSelectionRange(a + text.length, a + text.length);
    });
    row.append(b);
  }
  document.querySelector("#chat-form .name-row").after(row);
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
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientMessageId, text, channel: activeChannel, characterId: speaker.value }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "전송 실패");
    showSendStatus("GM 브리지 전달 대기", 2500);
  } catch (error) {
    chatInput.value = chatInput.value ? `${text}\n${chatInput.value}` : text; // give the text back instead of losing it
    showSendStatus(error?.message || "전송 실패");
  }
});
// Enter sends, Shift+Enter inserts a newline. Enter that confirms an IME composition (Korean/Japanese) must not send.
chatInput.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  chatForm.requestSubmit();
});
if (roomId && !inviteToken) { consent.hidden = true; mode = "pending"; checkStatus().catch(() => {}).finally(schedule); }
