// 사이코로픽션 시트 중복 진단(읽기만 함, 아무것도 쓰지 않음). GM 화면의 코코포리아 룸에서 F12 → Console 에 붙여 넣고 Enter.
// 결과는 클립보드에 복사됩니다. 본문·비밀·사명은 담지 않습니다(문서 id, 소유자 uid 앞 6자, 수정 시각, 연결 캐릭터 이름, json 길이, 삭제 표시).
(async () => {
  const fb = window.__CCF_HANDOUT_FB__?.state?.();
  const room = window.__CCF_HANDOUT_FB__?.roomKey?.() || location.pathname.split("/").pop();
  if (!fb?.db) { console.warn("[시트 진단] 핸드아웃 Firebase 연결이 없습니다(룸 동의 후 다시)."); return; }
  const { collection, getDocs } = fb.modules.fs;
  const out = { room: String(room).slice(0, 4) + "…", me: String(fb.uid).slice(0, 6), gm: !!window.__CCF_HANDOUT_FB__?.isGm?.(), docs: [], local: [] };
  try {
    const snap = await getDocs(collection(fb.db, "rooms", room, "sheets"));
    snap.forEach((d) => {
      const data = d.data() || {};
      let player = "";
      try { player = String(JSON.parse(data.json || "{}").player || "").slice(0, 20); } catch (_) { player = "?"; }
      out.docs.push({ id: d.id.slice(0, 8), owner: String(data.ownerUid || "").slice(0, 6), updatedAt: data.updatedAt ? new Date(Number(data.updatedAt)).toISOString() : "", player, len: String(data.json || "").length, deleted: !!data.deleted });
    });
  } catch (error) { out.error = String(error?.code || error?.message || error); }
  try { out.local = (window.__CCF_CHARACTER_SHEET_DEBUG__?.data()?.sheets || []).map((s) => ({ id: String(s.id).slice(0, 8), player: String(s.player || "").slice(0, 20), updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : "" })); } catch (_) { /* 시트 스크립트 없음 */ }
  out.docs.sort((a, b) => a.player.localeCompare(b.player) || a.updatedAt.localeCompare(b.updatedAt));
  console.warn("[시트 진단]", out);
  copy(JSON.stringify(out, null, 1));
})();
