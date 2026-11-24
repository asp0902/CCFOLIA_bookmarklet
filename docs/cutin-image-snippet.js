// 컷인 채팅 그림 진단(읽기만 함). 컷인 메시지가 보이는 상태에서 F12 → Console 에 붙여 넣고 Enter. 결과는 클립보드에 복사됩니다.
// 담는 것: 컷인 이름의 길이·앞 3글자·유니코드 형태(NFC/NFD), 그림 주소의 호스트·확장자, 채팅 줄의 그림 유무·로드 크기. 메시지 본문은 담지 않습니다.
(() => {
  const root = document.getElementById("root");
  const key = root && Object.keys(root).find((k) => k.startsWith("__reactContainer"));
  let store = null;
  const seen = new WeakSet();
  const walk = (n, d = 0) => { if (store || !n || d > 60) return; for (const v of [n.memoizedProps?.store, n.memoizedProps?.value, n.memoizedProps]) { if (!store && v && typeof v === "object" && !seen.has(v)) { seen.add(v); if (typeof v.getState === "function" && typeof v.subscribe === "function") store = v; } } walk(n.child, d + 1); walk(n.sibling, d + 1); };
  walk(key ? root[key]?.stateNode?.current : null);
  const slice = store?.getState()?.entities?.roomEffects;
  const effects = Object.values(slice?.entities || {});
  const host = (u) => { try { const x = new URL(u); return x.host + " ." + (x.pathname.split(".").pop() || "").slice(0, 5); } catch (_) { return String(u || "").slice(0, 12); } };
  const form = (t) => (t === t.normalize("NFC") ? "NFC" : "NFD");
  const out = {
    effects: effects.map((e) => ({ name: [String(e?.name || "").length, String(e?.name || "").slice(0, 3), form(String(e?.name || ""))], message: e?.message ? [String(e.message).length, String(e.message).slice(0, 3)] : null, image: host(e?.imageUrl || e?.image || e?.url || ""), fields: Object.keys(e || {}).filter((k) => /url|image|video|movie/i.test(k)) })),
    rows: [...document.querySelectorAll("[data-ccf-cutin-chat], [data-ccf-cutin-hide]")].slice(-10).map((el) => { const img = el.querySelector(".ccf-cutin-chat-image img"); return { textLen: (el.textContent || "").length, hide: el.getAttribute("data-ccf-cutin-hide"), img: !!img, src: img ? host(img.src) : "", natural: img ? `${img.naturalWidth}x${img.naturalHeight}` : "" }; }),
    version: window.__CCF_FORMAT_SYNC_RUNTIME__?.version || "",
    probe: (() => { try { return window.__CCF_FORMAT_SYNC_RUNTIME__.cutinChatProbe(); } catch (e) { return String(e.message || e).slice(0, 80); } })(),
    diag: (() => { try { const d = window.__CCF_FORMAT_SYNC_RUNTIME__.cutinChatDiag(); return { enabled: d.enabled, store: d.store, triggers: d.triggers.length, images: d.images, failed: d.failed, atNames: d.atNames, messageRows: d.messageRows, scanErrors: d.scanErrors }; } catch (e) { return String(e.message || e).slice(0, 80); } })()
  };
  console.warn("[컷인 그림 진단]", out);
  copy(JSON.stringify(out, null, 1));
})();
