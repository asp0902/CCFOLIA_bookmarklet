// extension drive-core.js (handout Google Drive sync, 1단계): against a mock Drive v3 (files / upload multipart / revisions):
// visible folders (카피바라IV 핸드아웃 / 룸제목 (룸id) / {id}.json + rooms.json), upload only what changed, delete = trash, an update = a new revision,
// download merges (missing added, newer wins), a two-sided change is a conflict (the loser kept as a kept revision), history / read / restore / keep.
const assert = require('node:assert/strict');
const path = require('node:path');
const core = require(path.join(__dirname, '../extension/personal/drive-core.js'));

function mockDrive() {
  const files = new Map(); let seq = 0, revSeq = 0, calls = 0, lastAuth = '';
  const json = (v, status = 200) => ({ ok: status < 400, status, json: async () => v, text: async () => JSON.stringify(v) });
  const text = (t) => ({ ok: true, status: 200, text: async () => t, json: async () => JSON.parse(t) });
  const parseMultipart = (body) => { const parts = body.split(/--capybara\w+/).map((p) => p.trim()).filter((p) => p && p !== '--'); const take = (p) => p.slice(p.indexOf('\r\n\r\n') + 4); return { meta: JSON.parse(take(parts[0])), content: take(parts[1]) }; };
  const matches = (f, q) => {
    if (/trashed=false/.test(q) && f.trashed) return false;
    const ap = q.match(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/); if (ap && (f.appProperties || {})[ap[1]] !== ap[2]) return false;
    const par = q.match(/'([^']+)' in parents/); if (par && !(f.parents || []).includes(par[1])) return false;
    if (/mimeType='application\/vnd.google-apps.folder'/.test(q) && f.mimeType !== 'application/vnd.google-apps.folder') return false;
    return true;
  };
  const addRev = (f) => f.revisions.push({ id: 'r' + (++revSeq), modifiedTime: new Date(Date.now() + revSeq).toISOString(), keepForever: false, content: f.content });
  async function fetchFn(url, init = {}) {
    calls += 1; lastAuth = init.headers?.Authorization || '';
    const u = new URL(url), m = init.method || 'GET', p = u.pathname;
    let mm;
    if (m === 'GET' && p === '/drive/v3/files') return json({ files: [...files.values()].filter((f) => matches(f, u.searchParams.get('q') || '')).map(({ id, name, appProperties, modifiedTime }) => ({ id, name, appProperties, modifiedTime })) });
    if (m === 'POST' && p === '/drive/v3/files') { const meta = JSON.parse(init.body); const id = 'f' + (++seq); files.set(id, { id, ...meta, revisions: [], trashed: false }); return json({ id }); }
    if (m === 'POST' && p === '/upload/drive/v3/files') { const { meta, content } = parseMultipart(init.body); const id = 'f' + (++seq); const f = { id, ...meta, content, revisions: [], trashed: false }; addRev(f); files.set(id, f); return json({ id }); }
    if (m === 'PATCH' && (mm = p.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/))) { const f = files.get(mm[1]); const { meta, content } = parseMultipart(init.body); Object.assign(f, meta); f.content = content; addRev(f); return json({ id: f.id }); }
    if (m === 'PATCH' && (mm = p.match(/^\/drive\/v3\/files\/([^/]+)$/))) { Object.assign(files.get(mm[1]), JSON.parse(init.body)); return json({}); }
    if (m === 'GET' && (mm = p.match(/^\/drive\/v3\/files\/([^/]+)$/)) && u.searchParams.get('alt') === 'media') return text(files.get(mm[1]).content);
    if (m === 'GET' && (mm = p.match(/^\/drive\/v3\/files\/([^/]+)\/revisions$/))) return json({ revisions: files.get(mm[1]).revisions.map(({ id, modifiedTime, keepForever }) => ({ id, modifiedTime, keepForever })) });
    if (m === 'GET' && (mm = p.match(/^\/drive\/v3\/files\/([^/]+)\/revisions\/([^/]+)$/))) return text(files.get(mm[1]).revisions.find((r) => r.id === mm[2]).content);
    if (m === 'PATCH' && (mm = p.match(/^\/drive\/v3\/files\/([^/]+)\/revisions\/([^/]+)$/))) { Object.assign(files.get(mm[1]).revisions.find((r) => r.id === mm[2]), JSON.parse(init.body)); return json({}); }
    return json({ error: 'unhandled ' + m + ' ' + p }, 404);
  }
  return { fetchFn, files, get calls() { return calls; }, get lastAuth() { return lastAuth; } };
}

(async () => {
  const drive = mockDrive();
  const api = core.makeDriveApi(drive.fetchFn, async () => 'tok-test');
  // PC A: upload two handouts of the test room
  const a = core.createSync(api, {});
  const h1 = { id: 'h1', title: '지도', description: '<p>본문</p>', gmNotes: '비밀', permissions: { 눈깅: { view: true } }, folderId: '', order: 1, updatedAt: '2026-11-17T10:00:00Z' };
  const h2 = { id: 'h2', title: '편지', description: '', gmNotes: '', permissions: {}, order: 2, updatedAt: '2026-11-17T10:00:00Z', _canView: true };
  const copy = { id: 'x9', title: '받은 사본', _remote: true, updatedAt: '2026-11-17T10:00:00Z' };
  let r = await a.upload('ChW_QP77I', '테스트 룸', [h1, h2, copy]);
  assert.equal(r.changed, 2, 'the received copy (_remote) is not uploaded');
  assert.equal(drive.lastAuth, 'Bearer tok-test');
  const names = [...drive.files.values()].map((f) => f.name).sort();
  assert.deepEqual(names, ['h1.json', 'h2.json', '카피바라IV 핸드아웃', '테스트 룸 (ChW_QP77I)'].sort(), 'visible folders + one file per handout: ' + names);
  const f1 = [...drive.files.values()].find((f) => f.name === 'h1.json');
  assert(!/_canView/.test([...drive.files.values()].find((f) => f.name === 'h2.json').content), 'view-only fields are not stored');
  // unchanged -> nothing uploaded; changed -> the same file updated (a new revision)
  const before = drive.calls;
  r = await a.upload('ChW_QP77I', '테스트 룸', [h1, h2]);
  assert.equal(r.changed, 0); assert.equal(drive.calls, before, 'no call when nothing changed');
  const h1b = { ...h1, title: '지도 2', updatedAt: '2026-11-17T11:00:00Z' };
  await a.upload('ChW_QP77I', '테스트 룸', [h1b, h2]);
  assert.equal(f1.revisions.length, 2, 'an edit = one more revision on the same file');
  // PC B (empty): download gets both
  const b = core.createSync(api, {});
  let d = await b.download('ChW_QP77I', '테스트 룸', []);
  assert.deepEqual(d.handouts.map((h) => h.title).sort(), ['지도 2', '편지']); assert.deepEqual(d.added.sort(), ['h1', 'h2']);
  assert.deepEqual(d.handouts.find((h) => h.id === 'h1').permissions, { 눈깅: { view: true } }, 'the permission table comes along');
  // B edits h2 and uploads; A downloads -> the newer one
  const h2b = { ...h2, title: '편지(B)', updatedAt: '2026-11-17T12:00:00Z' };
  delete h2b._canView;
  await b.upload('ChW_QP77I', '테스트 룸', [d.handouts.find((h) => h.id === 'h1'), h2b]);
  d = await a.download('ChW_QP77I', '테스트 룸', [h1b, h2]);
  assert.deepEqual(d.updated, ['h2']); assert.equal(d.handouts.find((h) => h.id === 'h2').title, '편지(B)');
  // conflict: both changed since the last sync -> the newer wins, the loser kept as a kept revision
  const aLocal = { ...h1b, title: 'A 수정', updatedAt: '2026-11-17T13:00:00Z' };
  const bRemote = { ...h1b, title: 'B 수정', updatedAt: '2026-11-17T14:00:00Z' };
  await b.upload('ChW_QP77I', '테스트 룸', [bRemote]);
  d = await a.download('ChW_QP77I', '테스트 룸', [aLocal, d.handouts.find((h) => h.id === 'h2')]);
  assert.deepEqual(d.conflicts.map((c) => [c.id, c.kept]), [['h1', 'drive']]);
  assert.equal(d.handouts.find((h) => h.id === 'h1').title, 'B 수정', 'the newer (Drive) wins');
  assert(f1.revisions.some((rv) => rv.keepForever && /A 수정/.test(rv.content)), 'the losing local version is kept in the history');
  assert(/B 수정/.test(f1.content), 'the file ends with the winner');
  // history / read / restore / keep
  const hist = await a.history('ChW_QP77I', 'h1');
  assert(hist.length >= 4, 'revisions listed: ' + hist.length);
  const first = await a.readVersion('ChW_QP77I', 'h1', hist[0].id);
  assert.equal(first.title, '지도');
  const restored = await a.restore('ChW_QP77I', '테스트 룸', 'h1', hist[0].id, '2026-11-17T15:00:00Z');
  assert.deepEqual([restored.title, restored.updatedAt], ['지도', '2026-11-17T15:00:00Z']);
  assert(/"title": "지도"/.test(f1.content) && f1.revisions.length === hist.length + 1, 'restoring adds a revision (the current one stays in the history)');
  await a.keep('ChW_QP77I', 'h1', hist[1].id, true);
  assert.equal(f1.revisions.find((rv) => rv.id === hist[1].id).keepForever, true);
  // delete -> trash (not permanent)
  await a.upload('ChW_QP77I', '테스트 룸', [], { deletedIds: ['h2'] });
  const f2 = [...drive.files.values()].find((f) => f.name === 'h2.json');
  assert.equal(f2.trashed, true, 'deleted = in the trash');
  d = await b.download('ChW_QP77I', '테스트 룸', []);
  assert.deepEqual(d.handouts.map((h) => h.id), ['h1'], 'trashed files are not downloaded');
  // the room index
  await a.writeIndex([{ room: 'ChW_QP77I', title: '테스트 룸' }]);
  assert(/"ChW_QP77I"/.test([...drive.files.values()].find((f) => f.name === 'rooms.json').content));
  // a second PC finds the existing root / room folder instead of making new ones
  const c = core.createSync(api, {}); await c.download('ChW_QP77I', '테스트 룸', []);
  assert.equal([...drive.files.values()].filter((f) => f.name === '카피바라IV 핸드아웃').length, 1, 'one root folder');
  // a failing call rejects (the caller keeps local storage untouched)
  const bad = core.createSync(core.makeDriveApi(async () => ({ ok: false, status: 401 }), async () => 'x'), {});
  await assert.rejects(bad.upload('R', 'r', [h1]), /Drive 401/);
  console.log('drive sync core PASS');
})().catch((e) => { console.error(e); process.exit(1); });
