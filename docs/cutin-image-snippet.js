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
    probe: (() => { try { const rows = window.__CCF_FORMAT_SYNC_RUNTIME__.cutinChatProbe(); return rows.length ? rows : "화면에 컷인으로 끝나는 줄이 없습니다. 그림 있는 컷인을 먼저 보내고, 그 줄이 보일 때 다시 실행하세요."; } catch (e) { return String(e.message || e).slice(0, 80); } })(),
    diag: (() => { try { const d = window.__CCF_FORMAT_SYNC_RUNTIME__.cutinChatDiag(); return { enabled: d.enabled, store: d.store, triggers: d.triggers.length, images: d.images, failed: d.failed, atNames: d.atNames, messageRows: d.messageRows, scanErrors: d.scanErrors }; } catch (e) { return String(e.message || e).slice(0, 80); } })(),
    // 저장소의 최근 메시지 8개와 화면 줄 대조(본문 없음: 길이·봉투 유무·컷인으로 끝나는지·탭만). 메시지가 저장됐는데 줄이 안 보이는지, 아예 저장이 안 됐는지 가린다.
    recent: (() => {
      try {
        const state = store.getState(), msgs = state.entities?.roomMessages, app = state.app?.state || {};
        const list = (msgs?.ids || Object.keys(msgs?.entities || {})).map((id) => msgs.entities[id]).filter(Boolean).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)).slice(-8);
        const bare = (t) => String(t || "").replace(/[⁠-⁣​-‍]/g, "").normalize("NFC");
        const names = effects.map((e) => String(e?.name || "").normalize("NFC").trim()).filter(Boolean).sort((a, b) => b.length - a.length);
        const rows = [...document.querySelectorAll("li, [data-index]")];
        return {
          tab: String(app.roomChatTab || ""), log: (() => { const l = document.querySelector('[role="log"]'); if (!l) return null; const r = l.getBoundingClientRect(); return { box: [r.width, r.height].map(Math.round), indexRows: l.querySelectorAll("[data-index]").length, lis: l.querySelectorAll("li").length }; })(),
          selectors: Object.fromEntries(["p.MuiListItemText-secondary", ".MuiListItemText-secondary", "[data-index] p", "li p", ".ccf-scp-text", ".ccf-render-root", ".ccf-original-hidden"].map((s) => [s, document.querySelectorAll(s).length])),
          messages: list.map((m) => {
            const text = bare(m.text), cut = names.find((n) => text.trimEnd().endsWith(n)) || "";
            const head = text.slice(0, 8);
            const row = head ? rows.filter((r) => bare(r.textContent).includes(head)).pop() : null;
            const look = row ? (() => { const c = getComputedStyle(row), body = row.querySelector("p, .ccf-scp-text") || row, b = getComputedStyle(body), r = row.getBoundingClientRect(); return { h: Math.round(r.height), display: c.display, vis: c.visibility, op: c.opacity, bodyColor: b.color, bodyFont: b.fontSize, cont: row.getAttribute("data-ccf-prose-cont") || "", imgs: row.querySelectorAll("img").length, where: row.closest(".ccf-scp-panel") ? "panel" : row.closest('[role="log"]') ? "log" : "other" }; })() : null;
            return { id: String(m._id || m.id || "").slice(0, 6), tab: String(m.channel || ""), len: text.length, envelope: /⁣⁣⁣/.test(String(m.text || "")), endsCutin: cut ? cut.slice(0, 3) : "", at: m.createdAt ? new Date(Number(m.createdAt)).toTimeString().slice(0, 8) : "", row: look };
          })
        };
      } catch (e) { return String(e.message || e).slice(0, 120); }
    })()
  };
  console.warn("[컷인 그림 진단]", out);
  copy(JSON.stringify(out, null, 1));
})();
