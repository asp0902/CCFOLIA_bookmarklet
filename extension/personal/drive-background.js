// 핸드아웃 Google Drive 동기화 — 확장 백그라운드 쪽(background.js 가 importScripts 로 싣는다).
// 로그인: chrome.identity.launchWebAuthFlow(사용자가 직접 로그인·동의). 클라이언트 ID 는 사용자가 웹 공유 화면에 붙여 넣은 값(chrome.storage.local.driveClientId).
// 토큰은 chrome.storage.session 에만(브라우저를 닫으면 사라짐) — 저장소·로그·ntfy 어디에도 쓰지 않는다. 범위는 drive.file 하나.
/* global CapybaraDriveCore */
(() => {
  "use strict";
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const STATE_KEY = "driveState"; // Drive 쪽 폴더·파일 id 와 마지막 동기화 시점(비밀값 없음)

  async function readToken() {
    const { driveToken } = await chrome.storage.session.get(["driveToken"]);
    return driveToken && driveToken.exp > Date.now() + 60000 ? driveToken.token : "";
  }
  async function authorize(interactive) {
    const { driveClientId } = await chrome.storage.local.get(["driveClientId"]);
    if (!driveClientId) throw new Error("클라이언트 ID 가 없습니다");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", driveClientId);
    url.searchParams.set("response_type", "token");
    url.searchParams.set("redirect_uri", chrome.identity.getRedirectURL());
    url.searchParams.set("scope", SCOPE);
    if (!interactive) url.searchParams.set("prompt", "none");
    const redirected = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive });
    const params = new URLSearchParams(new URL(redirected).hash.slice(1));
    const token = params.get("access_token");
    if (!token) throw new Error(params.get("error") || "로그인하지 못했습니다");
    await chrome.storage.session.set({ driveToken: { token, exp: Date.now() + (Number(params.get("expires_in")) || 3600) * 1000 } });
    await chrome.storage.local.set({ driveConnected: true });
    return token;
  }
  async function getToken() {
    const cached = await readToken();
    if (cached) return cached;
    try { return await authorize(false); } catch (error) { const e = new Error("다시 연결이 필요합니다"); e.needsConnect = true; throw e; }
  }
  async function disconnect() {
    const token = await readToken();
    await chrome.storage.session.remove("driveToken");
    await chrome.storage.local.set({ driveConnected: false });
    if (token) { try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }); } catch (_) { /* 오프라인이면 만료로 사라진다 */ } }
  }

  // 한 번에 하나씩(같은 상태 기록을 고치므로)
  let queue = Promise.resolve();
  const serial = (fn) => (queue = queue.then(fn, fn));
  async function withSync(fn) {
    const { [STATE_KEY]: state = {} } = await chrome.storage.local.get([STATE_KEY]);
    const sync = CapybaraDriveCore.createSync(CapybaraDriveCore.makeDriveApi(fetch.bind(self), getToken), state);
    try { return await fn(sync); }
    finally { await chrome.storage.local.set({ [STATE_KEY]: sync.state }); }
  }
  async function status(extra = {}) {
    const { driveClientId, driveConnected, driveLast } = await chrome.storage.local.get(["driveClientId", "driveConnected", "driveLast"]);
    return { hasClientId: !!driveClientId, connected: !!driveConnected, tokenNow: !!(await readToken()), last: driveLast || null, ...extra };
  }
  const note = (ok, op, detail = "") => chrome.storage.local.set({ driveLast: { ok, op, detail: String(detail).slice(0, 120), at: Date.now() } });

  async function handle(message) {
    const { op, room = "", roomTitle = "" } = message;
    if (op === "status") return status();
    if (op === "connect") { await authorize(true); return status(); }
    if (op === "disconnect") { await disconnect(); return status(); }
    if (!room || room === "global") throw new Error("룸이 없습니다");
    return serial(() => withSync(async (sync) => {
      try {
        let out;
        if (op === "upload") out = await sync.upload(room, roomTitle, message.handouts || [], { deletedIds: message.deletedIds || [] });
        else if (op === "download") out = await sync.download(room, roomTitle, message.handouts || []);
        else if (op === "history") out = { versions: await sync.history(room, message.handoutId) };
        else if (op === "read") out = { handout: await sync.readVersion(room, message.handoutId, message.revId) };
        else if (op === "restore") out = { handout: await sync.restore(room, roomTitle, message.handoutId, message.revId) };
        else if (op === "keep") { await sync.keep(room, message.handoutId, message.revId, message.on !== false); out = {}; }
        else throw new Error("알 수 없는 요청");
        if (op === "upload" || op === "download") await sync.writeIndex(await indexRooms(sync, room, roomTitle));
        await note(true, op);
        return out;
      } catch (error) { await note(false, op, error.message); throw error; }
    }));
  }
  async function indexRooms(sync, room, roomTitle) {
    const { driveRooms = {} } = await chrome.storage.local.get(["driveRooms"]);
    driveRooms[room] = roomTitle || driveRooms[room] || "";
    await chrome.storage.local.set({ driveRooms });
    return Object.entries(driveRooms).map(([id, title]) => ({ room: id, title }));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "drive-sync") return;
    // 웹 공유 화면(확장 탭 안 스크립트)·코코포리아 탭의 브리지만
    if (sender.tab && !String(sender.tab.url || "").startsWith("https://ccfolia.com/")) return;
    handle(message).then((result) => sendResponse({ ok: true, result }), (error) => sendResponse({ ok: false, error: error.message || String(error), needsConnect: !!error.needsConnect }));
    return true;
  });
})();
