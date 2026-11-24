// 사이코로픽션 시트 소유·공유 진단(읽기만 함, 아무것도 쓰지 않음). GM·플레이어 모두 같은 스니펫, 북마클릿에서도 동작.
// 툴킷(확장 또는 북마클릿)을 켠 룸에서 F12 → Console 에 붙여 넣고 Enter. 결과는 클립보드에 복사됩니다.
// 담는 것: 스크립트 버전·받은 경로, Firebase 연결·내 uid 앞 6자, 시트 문서(id 앞 8자·소유자 앞 6자·deleted·수정 시각·json 길이·연결 캐릭터 이름),
// 이 브라우저의 로컬 시트(같은 항목), 구성원(members: 툴킷 uid 앞 6자 ↔ 코코포리아 uid 앞 6자), 연결 캐릭터의 코코포리아 주인 앞 6자. 시트 본문·비밀·사명은 담지 않습니다.
(async () => {
  const _copy = typeof copy === "function" ? copy : null; // 크롬 콘솔의 copy()는 기다린(await) 뒤에는 동작하지 않아 여기서 잡아 둔다
  const p6 = (v) => String(v || "").slice(0, 6), p8 = (v) => String(v || "").slice(0, 8);
  const iso = (v) => { const n = Number(v); return n ? new Date(n).toISOString() : ""; };
  const sheetApi = window.__CCF_CHARACTER_SHEET_DEBUG__;
  const fbApi = window.__CCF_HANDOUT_FB__;
  const fb = fbApi?.state?.();
  const room = fbApi?.roomKey?.() || (location.pathname.match(/^\/rooms\/([^/?#]+)/) || [])[1] || "";
  // 코코포리아 저장소(캐릭터 주인, 내 코코포리아 uid)
  const root = document.getElementById("root"), key = root && Object.keys(root).find((k) => k.startsWith("__reactContainer"));
  let store = null; const seen = new WeakSet();
  const walk = (n, d = 0) => { if (store || !n || d > 60) return; for (const v of [n.memoizedProps?.store, n.memoizedProps?.value]) { if (!store && v && typeof v === "object" && !seen.has(v)) { seen.add(v); if (typeof v.getState === "function") store = v; } } walk(n.child, d + 1); walk(n.sibling, d + 1); };
  walk(key ? root[key]?.stateNode?.current : null);
  const st = store?.getState?.();
  const chars = Object.values(st?.entities?.roomCharacters?.entities || {});
  const ownerOf = (name) => p6(chars.find((c) => String(c?.name || "").trim() === String(name || "").trim())?.owner);
  const out = {
    versions: {
      loader: window.__CAPYBARA_TOOLKIT__?.version || window.__CAPYBARA_TOOLKIT__?.loader?.version || "",
      sheet: sheetApi?.version || "(시트 스크립트 없음)",
      loadLog: (window.__CAPYBARA_LOAD_LOG__ || []).filter((e) => /character-sheet|handout/.test(e.path || "")).map((e) => `${e.path?.split("/").pop()} ${e.via}`).slice(-4)
    },
    firebase: { connected: !!fb?.db, myToolkitUid: p6(fb?.uid), gm: (() => { try { return !!fbApi?.isGm?.(); } catch (_) { return null; } })(), shared: sheetApi?.shared?.() ? { ...sheetApi.shared(), secretOk: (sheetApi.shared().secretOk || []).length } : null },
    myCcfoliaUid: p6(st?.app?.user?.uid),
    local: (sheetApi?.data?.()?.sheets || []).map((s) => ({ id: p8(s.id), player: String(s.player || "").slice(0, 20), updatedAt: iso(s.updatedAt), len: JSON.stringify(s).length, owner: ownerOf(s.player) })),
    docs: [], members: [], errors: []
  };
  if (fb?.db && room) {
    const { collection, getDocs, query, where } = fb.modules.fs;
    const readDocs = async (label, ref) => { try { const snap = await getDocs(ref); return snap.docs; } catch (e) { out.errors.push(`${label}: ${e.code || e.message}`); return []; } };
    // 모든 시트(지금 규칙에서 읽을 수 있으면) + 내 소유 시트(쿼리) — 둘 다 읽기
    const all = await readDocs("sheets(all)", collection(fb.db, "rooms", room, "sheets"));
    const mine = await readDocs("sheets(mine)", query(collection(fb.db, "rooms", room, "sheets"), where("ownerUid", "==", fb.uid)));
    const seenIds = new Set();
    for (const d of [...all, ...mine]) {
      if (seenIds.has(d.id)) continue; seenIds.add(d.id);
      const v = d.data() || {}; let player = "";
      try { player = String(JSON.parse(v.json || "{}").player || "").slice(0, 20); } catch (_) { player = "?"; }
      out.docs.push({ id: p8(d.id), owner: p6(v.ownerUid), mine: v.ownerUid === fb.uid, deleted: !!v.deleted, updatedAt: iso(v.updatedAt), len: String(v.json || "").length, player, charOwner: ownerOf(player), inMyQuery: mine.some((m) => m.id === d.id) });
    }
    out.docs.sort((a, b) => a.player.localeCompare(b.player) || a.updatedAt.localeCompare(b.updatedAt));
    for (const d of await readDocs("members", collection(fb.db, "rooms", room, "members"))) {
      const v = d.data() || {};
      out.members.push({ toolkitUid: p6(d.id), ccfoliaUid: p6(v.ccfoliaUid), updatedAt: v.updatedAt?.toDate ? v.updatedAt.toDate().toISOString() : "", me: d.id === fb.uid });
    }
  }
  console.warn("[시트 소유 진단]", out);
  { const _t = JSON.stringify(out, null, 1); window.__CCF_DIAG_RESULT__ = _t; try { _copy?.(_t); } catch (_) {} console.warn("끝났습니다. 클립보드에 안 들어갔으면 콘솔에 copy(__CCF_DIAG_RESULT__) 를 입력하고 Enter 하세요."); }
})();
