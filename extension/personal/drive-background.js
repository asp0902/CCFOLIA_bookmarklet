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
    // 조용한 재발급(브라우저를 다시 켜 세션 토큰이 사라진 뒤): 구글의 prompt=none 흐름은 페이지를 다 그린 뒤 스크립트로 넘어간다.
    // Chrome 은 기본으로 비대화식 흐름을 첫 로드에서 끊어 버려(abortOnLoadForNonInteractive) 늘 실패했다 → 끊지 말고 10초 기다린다(Chrome 113+; 그 전 버전은 무시).
    const redirected = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive, ...(interactive ? {} : { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 10000 }) });
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
    try { return await authorize(false); } catch (error) { throw explain(error, "silent"); }
  }
  // 실패를 사유별 한국어로(상태 줄·토스트에 그대로). needsConnect = [다시 연결]로 풀리는 것. step = 어느 단계에서(진단용, 값·토큰 없음)
  function explain(error, step) {
    if (error?.code) return error; // 이미 풀이한 것(조용한 재발급 실패가 API 호출 안에서 올라온 경우)
    const raw = String(error?.message || error || ""), status = Number(error?.status) || 0, reason = String(error?.reason || "");
    const out = (message, needsConnect, code) => { const e = new Error(message); e.needsConnect = needsConnect; e.code = code; e.step = step; return e; };
    if (/클라이언트 ID/.test(raw)) return out("클라이언트 ID 가 없습니다 — 웹 공유 화면의 Google Drive 설정에서 넣어 주세요", false, "no-client-id");
    if (step === "silent" || step === "connect") {
      if (/access_denied/i.test(raw)) return out("Google 이 연결을 거절했습니다 — 동의 화면이 '테스트' 상태면 테스트 사용자 목록·7일 승인 만료를 확인해 주세요", true, "access-denied");
      if (/consent_required/i.test(raw)) return out("권한 동의가 다시 필요합니다 — [다시 연결]을 눌러 주세요", true, "consent-required");
      if (/did not approve|canceled|cancelled|closed/i.test(raw)) return out("로그인 창이 닫혔습니다 — [다시 연결]을 눌러 주세요", true, "window-closed");
      return out("Google 로그인이 만료되었습니다 — [다시 연결]을 눌러 주세요", true, /interaction|login_required/i.test(raw) ? "login-expired" : "silent-failed");
    }
    if (status === 401) return out("Google 로그인이 만료되었습니다 — [다시 연결]을 눌러 주세요", true, "http-401");
    if (status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(reason)) return out("Drive API 가 꺼져 있습니다 — Google Cloud 콘솔에서 Google Drive API 를 사용 설정해 주세요", false, "api-disabled");
    if (status === 403 && /insufficient|SCOPE/i.test(reason)) return out("권한 범위가 다릅니다 — [다시 연결]을 눌러 주세요", true, "scope");
    if (status === 403 && /rateLimit|userRateLimit|quota/i.test(reason)) return out("Google Drive 요청이 너무 많습니다 — 잠시 뒤 다시 해 주세요", false, "rate-limit");
    if (status === 403) return out(`Google Drive 가 거절했습니다(403${reason ? ` ${reason}` : ""})`, false, "http-403");
    if (status >= 500) return out(`Google Drive 서버 오류(${status}) — 잠시 뒤 다시 해 주세요`, false, `http-${status}`);
    if (error?.needsConnect) return error;
    if (/Failed to fetch|NetworkError|network/i.test(raw)) return out("네트워크에 연결할 수 없습니다", false, "network");
    return out(raw || "알 수 없는 오류", false, "other");
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
  // 마지막 결과(진단용): 성공 여부·요청·사유 코드·단계·시각 — 토큰·클라이언트 ID 는 싣지 않는다
  const note = (ok, op, detail = "", code = "", step = "") => chrome.storage.local.set({ driveLast: { ok, op, detail: String(detail).slice(0, 160), code, step, at: Date.now() } });

  async function handle(message) {
    const { op, room = "", roomTitle = "" } = message;
    if (op === "status") return status();
    // 첫 동기화 창을 띄우기 전: 토큰이 있거나 조용히 다시 받을 수 있는지(없으면 방향 대신 '다시 연결' 안내)
    if (op === "ensure") { try { await getToken(); } catch (error) { const e = explain(error, "silent"); await note(false, op, e.message, e.code, e.step); throw e; } return status(); }
    if (op === "connect") { try { await authorize(true); } catch (error) { const e = explain(error, "connect"); await note(false, op, e.message, e.code, e.step); throw e; } await note(true, op); return status(); }
    if (op === "disconnect") { await disconnect(); return status(); }
    if (op === "rooms") return serial(() => withSync(async (sync) => ({ rooms: await sync.readIndex() })));
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
      } catch (error) {
        const e = explain(error, error?.step || "api");
        if (e.code === "http-401") await chrome.storage.session.remove("driveToken"); // 만료된 토큰은 버려 다음에 다시 받게
        await note(false, op, e.message, e.code, e.step);
        throw e;
      }
    }));
  }
  async function indexRooms(sync, room, roomTitle) {
    const { driveRooms = {} } = await chrome.storage.local.get(["driveRooms"]);
    for (const r of await sync.readIndex().catch(() => [])) if (!(r.room in driveRooms)) driveRooms[r.room] = r.title || ""; // 다른 PC 가 올린 룸도 색인에 남긴다
    driveRooms[room] = roomTitle || driveRooms[room] || "";
    await chrome.storage.local.set({ driveRooms });
    return Object.entries(driveRooms).map(([id, title]) => ({ room: id, title }));
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "drive-sync") return;
    // 웹 공유 화면(확장 탭 안 스크립트)·코코포리아 탭의 브리지만
    if (sender.tab && !String(sender.tab.url || "").startsWith("https://ccfolia.com/")) return;
    handle(message).then((result) => sendResponse({ ok: true, result }), (error) => sendResponse({ ok: false, error: error.message || String(error), needsConnect: !!error.needsConnect, code: error.code || "" }));
    return true;
  });
})();
