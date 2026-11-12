// 핸드아웃 GM 점검: 방장(GM) 계정으로 룸에 들어간 상태에서 콘솔(F12)에 붙여넣고 Enter.
// 결과는 잠시 뒤 클립보드에 복사됨("복사됨" 로그가 뜨면 붙여넣기). 비밀 본문 내용은 넣지 않고 개수만 셈.
(() => {
  const d = window.__CCF_HANDOUT_DEBUG__;
  const out = { at: new Date().toISOString(), room: location.pathname, hasDebug: !!d };
  const safe = (f) => { try { return f(); } catch (e) { return "오류: " + e.message; } };
  if (!d) { copy(JSON.stringify(out, null, 1)); console.log("복사됨(핸드아웃 스크립트 없음)"); return; }
  out.version = safe(() => window.__CCF_TOOLKIT_VERSIONS__?.().registry?.["ccf-handout"]?.version);
  out.seat = safe(() => d.seat());
  out.gmInfo = safe(() => d.gmInfo?.());
  out.state = safe(() => { const s = d.state?.(); return s && typeof s === "object" ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Array.isArray(v) ? `배열 ${v.length}` : (v && typeof v === "object" ? "객체" : v)])) : s; });
  let done = false;
  const finish = () => { if (done) return; done = true; const t = JSON.stringify(out, null, 1); window.__HO_CHECK__ = t; try { copy(t); } catch (_) {} console.log("복사됨 — 안 붙여지면 콘솔에 copy(__HO_CHECK__) 입력\n" + t); };
  setTimeout(() => { if (!out.remote) out.remote = "fetchAll 10초 안에 응답 없음"; finish(); }, 10000);
  d.fetchAll().then((docs) => {
    out.remote = {
      total: docs.length,
      gmNotesFilled: docs.filter((h) => String(h.gmNotes || "").trim()).length,
      withFolder: docs.filter((h) => h.folderId).length,
      // 원격에만 있는 것(로컬 목록에 없는 것): id·제목·소유자 uid 앞 6자·갱신 시각·폴더·권한표 키 수 (본문은 넣지 않는다)
      onlyRemote: (() => { const local = new Set((d.localHandouts?.() || []).map((h) => h.id)); return docs.filter((h) => !local.has(h.id)).map((h) => ({ id: h.id, title: String(h.title || "").slice(0, 30), owner: String(h.ownerUid || "").slice(0, 6), updatedAt: h.updatedAt || "", folder: h.folderId || "", permissionKeys: Object.keys(h.permissions || {}).length })); })(),
      onlyLocal: (() => { const remote = new Set(docs.map((h) => h.id)); return (d.localHandouts?.() || []).filter((h) => !remote.has(h.id)).map((h) => ({ id: h.id, title: h.title, owner: h.owner })); })(),
      withImage: docs.filter((h) => h.imageId || h.image || (h.images && h.images.length)).length,
    };
  }, (e) => { out.remote = "fetchAll 실패: " + (e.code || "") + " " + e.message; })
    .then(finish);
})();
