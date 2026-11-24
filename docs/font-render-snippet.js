// 글꼴 흐림·깨짐 진단 (읽기 전용 — 아무것도 바꾸지 않음). 룸 화면 콘솔에 붙여 넣고 Enter. 결과는 클립보드에 복사됨.
// 메시지 글 내용은 싣지 않는다(글자 수만).
(async () => {
  const c = document.createElement("canvas").getContext("2d");
  const width = (f) => { c.font = `32px ${f}, monospace`; return Math.round(c.measureText("가나다라마바사 abcWg").width); };
  const mono = width("monospace");
  const localInstalled = Object.fromEntries(["NanumGothic", "나눔고딕", "NanumMyeongjo", "나눔명조", "Malgun Gothic"].map((n) => [n, width(`"${n}"`) !== mono]));
  const faces = [...document.fonts].filter((f) => /Nanum|Noto Sans KR|Gowun/.test(f.family)).map((f) => `${f.family.replace(/"/g, "")} ${f.weight} ${f.style} ${f.status}`);
  const faceCount = faces.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  const pick = (el) => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    const chain = [];
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const t = getComputedStyle(e);
      const odd = {};
      if (t.transform !== "none" && t.transform !== "matrix(1, 0, 0, 1, 0, 0)") odd.transform = t.transform;
      if (t.opacity !== "1") odd.opacity = t.opacity;
      if (t.filter !== "none") odd.filter = t.filter;
      if (t.backdropFilter && t.backdropFilter !== "none") odd.backdrop = t.backdropFilter;
      if (t.willChange !== "auto") odd.willChange = t.willChange;
      if (t.textShadow !== "none") odd.textShadow = t.textShadow;
      if (Object.keys(odd).length) chain.push(`${e.tagName}.${String(e.className).split(" ")[0]} ${JSON.stringify(odd)}`);
    }
    return { font: s.fontFamily.slice(0, 80), weight: s.fontWeight, style: s.fontStyle, size: s.fontSize, letterSpacing: s.letterSpacing, synthesis: s.fontSynthesis, smoothing: s.webkitFontSmoothing, top: +(r.top * devicePixelRatio % 1).toFixed(2), chars: (el.textContent || "").length, chain: chain.slice(0, 8) };
  };
  const rows = [...document.querySelectorAll('[role="log"] .ccf-render-overlay, [role="log"] p.MuiListItemText-secondary, .ccf-scp-panel .ccf-render-overlay, .ccf-scp-panel p.MuiListItemText-secondary')].slice(-6);
  const out = { dpr: devicePixelRatio, zoom: Math.round(devicePixelRatio * 100) + "%", localInstalled, faces: faceCount, rows: rows.map(pick), versions: { formatSync: window.__CCF_FORMAT_SYNC_RUNTIME__?.version || null } };
  console.warn("[글꼴 진단]", out);
  try { copy(JSON.stringify(out, null, 1)); console.warn("결과가 클립보드에 복사되었습니다."); } catch (_) {}
})();
