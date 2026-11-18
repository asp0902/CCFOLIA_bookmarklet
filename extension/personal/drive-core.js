"use strict";
// 핸드아웃 Google Drive 동기화의 핵심(확장 background 에서 쓴다, 테스트는 모의 Drive 로).
// - 범위 drive.file: 이 앱이 만든 파일만 본다. 폴더는 사용자 Drive 에 보이게 둔다:
//   카피바라IV 핸드아웃/{룸제목 (룸id)}/{핸드아웃id}.json + 루트 rooms.json(색인).
// - 같은 파일을 고치면(files.update) Drive 가 버전(revisions)을 쌓는다 → 변경 이력·되돌리기·보관(keepForever).
// - 비밀값(토큰)은 getToken() 이 그때그때 돌려줄 뿐, 여기서 저장·기록하지 않는다.
(function (root) {
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const ROOT_NAME = "카피바라IV 핸드아웃";
  const FOLDER = "application/vnd.google-apps.folder";

  // Drive v3 REST 어댑터. fetchFn = fetch(모의 서버로 바꿔 끼운다), getToken = () => Promise<access token>
  function makeDriveApi(fetchFn, getToken) {
    const call = async (url, init = {}) => {
      const token = await getToken();
      const res = await fetchFn(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
      if (!res.ok) { const err = new Error(`Drive ${res.status}`); err.status = res.status; throw err; }
      return res;
    };
    const q = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const multipart = (meta, content) => {
      const b = "capybara" + Math.random().toString(36).slice(2);
      return { body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${b}--`, type: `multipart/related; boundary=${b}` };
    };
    return {
      async find({ prop, value, parent = "", folder = null }) {
        const parts = [`appProperties has { key='${q(prop)}' and value='${q(value)}' }`, "trashed=false"];
        if (parent) parts.push(`'${q(parent)}' in parents`);
        if (folder === true) parts.push(`mimeType='${FOLDER}'`);
        const res = await call(`${API}/files?q=${encodeURIComponent(parts.join(" and "))}&fields=${encodeURIComponent("files(id,name,modifiedTime,appProperties)")}&spaces=drive`);
        return (await res.json()).files || [];
      },
      async listChildren(parent) {
        const res = await call(`${API}/files?q=${encodeURIComponent(`'${q(parent)}' in parents and trashed=false`)}&fields=${encodeURIComponent("files(id,name,modifiedTime,appProperties)")}&spaces=drive`);
        return (await res.json()).files || [];
      },
      async createFolder(name, appProperties, parent = "") {
        const res = await call(`${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, appProperties, ...(parent ? { parents: [parent] } : {}) }) });
        return (await res.json()).id;
      },
      async createFile(name, appProperties, parent, content) {
        const m = multipart({ name, mimeType: "application/json", appProperties, parents: [parent] }, content);
        const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": m.type }, body: m.body });
        return (await res.json()).id;
      },
      async updateFile(id, content, meta = {}) {
        const m = multipart(meta, content);
        await call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=multipart`, { method: "PATCH", headers: { "Content-Type": m.type }, body: m.body });
      },
      async rename(id, name) { await call(`${API}/files/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); },
      async trash(id) { await call(`${API}/files/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }); },
      async read(id) { return (await call(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text(); },
      async revisions(id) { const res = await call(`${API}/files/${encodeURIComponent(id)}/revisions?fields=${encodeURIComponent("revisions(id,modifiedTime,keepForever)")}`); return (await res.json()).revisions || []; },
      async readRevision(id, rev) { return (await call(`${API}/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(rev)}?alt=media`)).text(); },
      async keepRevision(id, rev, keep = true) { await call(`${API}/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(rev)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keepForever: !!keep }) }); }
    };
  }

  // 핸드아웃 한 개 → 파일 내용. 받은 사본(_remote)·화면용 값(_canView 등 "_" 로 시작)은 넣지 않는다.
  function serializeHandout(room, roomTitle, handout) {
    const clean = {};
    for (const [k, v] of Object.entries(handout || {})) if (!k.startsWith("_")) clean[k] = v;
    return JSON.stringify({ schema: 1, room, roomTitle: roomTitle || "", handout: clean }, null, 1);
  }
  function parseHandoutFile(text) {
    try { const v = JSON.parse(text); return v && v.schema === 1 && v.handout && typeof v.handout.id === "string" ? v : null; } catch (_) { return null; }
  }
  const roomFolderName = (room, title) => `${String(title || "").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 60) || "룸"} (${room})`;
  const stamp = (h) => String(h?.updatedAt || "");

  // state: { rootId, rooms: { [room]: folderId }, files: { [room]: { [handoutId]: fileId } }, synced: { [room]: { [handoutId]: updatedAt } } }
  // — 브라우저(chrome.storage)에 두는 "Drive 쪽 id 와 마지막 동기화 시점" 기록. 비밀값 없음.
  function createSync(api, state = {}) {
    state.rooms ||= {}; state.files ||= {}; state.synced ||= {};
    const ensureRoot = async () => {
      if (state.rootId) return state.rootId;
      const found = await api.find({ prop: "capybaraRoot", value: "1", folder: true });
      state.rootId = found[0]?.id || await api.createFolder(ROOT_NAME, { capybaraRoot: "1" });
      return state.rootId;
    };
    const ensureRoom = async (room, title) => {
      if (state.rooms[room]) return state.rooms[room];
      const rootId = await ensureRoot();
      const found = await api.find({ prop: "capybaraRoom", value: room, parent: rootId, folder: true });
      state.rooms[room] = found[0]?.id || await api.createFolder(roomFolderName(room, title), { capybaraRoom: room }, rootId);
      return state.rooms[room];
    };
    const writeIndex = async (rooms) => {
      const rootId = await ensureRoot();
      const content = JSON.stringify({ schema: 1, rooms }, null, 1);
      const found = await api.find({ prop: "capybaraIndex", value: "1", parent: rootId });
      if (found[0]) await api.updateFile(found[0].id, content); else await api.createFile("rooms.json", { capybaraIndex: "1" }, rootId, content);
    };
    // 올리기: 이 룸의 원본 핸드아웃들(바뀐 것만) + 지운 것은 휴지통으로. 같은 파일 갱신 = Drive 버전 하나.
    async function upload(room, roomTitle, handouts, { deletedIds = [] } = {}) {
      const folder = await ensureRoom(room, roomTitle);
      const files = (state.files[room] ||= {}), synced = (state.synced[room] ||= {});
      let changed = 0; const skipped = [];
      for (const h of handouts || []) {
        if (!h || !h.id || h._remote) continue;
        if (synced[h.id] && synced[h.id] === stamp(h)) continue;
        const content = serializeHandout(room, roomTitle, h);
        // Drive 멀티파트 업로드는 5MB 까지. 본문 그림은 보통 저장 때 Firebase Storage 주소로 바뀌어 작지만, 업로드에 실패해 data: 로 남은 큰 그림이 있으면 넘을 수 있다.
        if (content.length > 4.8 * 1024 * 1024) { const err = new Error(`"${h.title || h.id}" 이(가) 너무 큽니다(그림 포함 5MB 초과) — 그 핸드아웃만 건너뜀`); err.tooLarge = true; skipped.push(h.id); console.warn("[drive]", err.message); continue; }
        if (!files[h.id]) { const found = await api.find({ prop: "capybaraHandout", value: h.id, parent: folder }); files[h.id] = found[0]?.id || ""; }
        if (files[h.id]) await api.updateFile(files[h.id], content); else files[h.id] = await api.createFile(`${h.id}.json`, { capybaraHandout: h.id }, folder, content);
        synced[h.id] = stamp(h); changed += 1;
      }
      for (const id of deletedIds) { if (files[id]) { await api.trash(files[id]); delete files[id]; delete synced[id]; changed += 1; } }
      return { changed, skipped };
    }
    // 받기: Drive 쪽 파일을 읽어 로컬과 합친다. 없는 것은 추가, 둘 다 있으면 updatedAt 이 새로운 쪽.
    // 둘 다 마지막 동기화 뒤에 바뀌었으면(충돌) 이긴 쪽을 쓰고, 진 쪽은 Drive 버전으로 남겨 conflicts 에 알린다.
    async function download(room, roomTitle, localHandouts) {
      const folder = await ensureRoom(room, roomTitle);
      const files = (state.files[room] ||= {}), synced = (state.synced[room] ||= {});
      const local = new Map((localHandouts || []).filter((h) => h && h.id && !h._remote).map((h) => [h.id, h]));
      const result = new Map(local), conflicts = [], added = [], updated = [], toUpload = [];
      for (const f of await api.listChildren(folder)) {
        const id = f.appProperties?.capybaraHandout;
        if (!id) continue;
        files[id] = f.id;
        const parsed = parseHandoutFile(await api.read(f.id));
        if (!parsed) continue;
        const remote = parsed.handout, mine = local.get(id), base = synced[id] || "";
        if (!mine) { result.set(id, remote); added.push(id); synced[id] = stamp(remote); continue; }
        if (stamp(mine) === stamp(remote)) { synced[id] = stamp(mine); continue; }
        const localChanged = stamp(mine) !== base, remoteChanged = stamp(remote) !== base;
        const remoteWins = stamp(remote) > stamp(mine);
        if (localChanged && remoteChanged && base) {
          conflicts.push({ id, title: (remoteWins ? remote : mine).title || "", kept: remoteWins ? "drive" : "local" });
          // 진 쪽 보존: 로컬이 지면 로컬 내용을 먼저 Drive 버전으로 올리고 보관(keepForever) 표시, 그 뒤 이긴(Drive) 내용으로 되돌려 둔다.
          if (remoteWins) {
            await api.updateFile(f.id, serializeHandout(room, roomTitle, mine));
            const revs = await api.revisions(f.id); const last = revs[revs.length - 1];
            if (last) await api.keepRevision(f.id, last.id, true);
            await api.updateFile(f.id, serializeHandout(room, roomTitle, remote));
          }
          // 로컬이 이기면 아래 올리기에서 Drive 를 갱신한다(이전 Drive 내용은 Drive 버전으로 남는다).
        }
        if (remoteWins) { result.set(id, remote); updated.push(id); synced[id] = stamp(remote); }
        else toUpload.push(mine);
      }
      if (toUpload.length) { for (const h of toUpload) synced[h.id] = ""; await upload(room, roomTitle, toUpload); }
      return { handouts: [...result.values()], added, updated, conflicts };
    }
    // 색인(rooms.json): 다른 PC 에서 올린 룸 목록 — '전체 룸'에서 이 PC 에 없는 룸도 받는다.
    async function readIndex() {
      const rootId = await ensureRoot();
      const found = await api.find({ prop: "capybaraIndex", value: "1", parent: rootId });
      if (!found[0]) return [];
      try { const v = JSON.parse(await api.read(found[0].id)); return Array.isArray(v?.rooms) ? v.rooms.filter((r) => r && typeof r.room === "string") : []; } catch (_) { return []; }
    }
    async function history(room, handoutId) {
      const fileId = state.files[room]?.[handoutId];
      if (!fileId) return [];
      return (await api.revisions(fileId)).map((r) => ({ id: r.id, at: r.modifiedTime || "", kept: !!r.keepForever }));
    }
    async function readVersion(room, handoutId, revId) {
      const fileId = state.files[room]?.[handoutId];
      return fileId ? parseHandoutFile(await api.readRevision(fileId, revId))?.handout || null : null;
    }
    // 되돌리기: 그 버전 내용을 새 버전으로 올린다(지금 내용은 앞 버전으로 남는다). 로컬에 쓸 핸드아웃을 돌려준다(updatedAt 은 지금).
    async function restore(room, roomTitle, handoutId, revId, now = new Date().toISOString()) {
      const old = await readVersion(room, handoutId, revId);
      if (!old) return null;
      const next = { ...old, updatedAt: now };
      await api.updateFile(state.files[room][handoutId], serializeHandout(room, roomTitle, next));
      (state.synced[room] ||= {})[handoutId] = stamp(next);
      return next;
    }
    async function keep(room, handoutId, revId, on = true) { const fileId = state.files[room]?.[handoutId]; if (fileId) await api.keepRevision(fileId, revId, on); }
    return { state, upload, download, history, readVersion, restore, keep, writeIndex, readIndex, ensureRoom };
  }

  const exported = { makeDriveApi, createSync, serializeHandout, parseHandoutFile, roomFolderName, ROOT_NAME };
  if (typeof module !== "undefined" && module.exports) module.exports = exported; else root.CapybaraDriveCore = exported;
})(typeof self !== "undefined" ? self : globalThis);
