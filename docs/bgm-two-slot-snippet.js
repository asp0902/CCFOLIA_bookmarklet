// BGM 두 슬롯 동시 재생 진단(읽기만 함). 순서: ① 새로고침 → ② 유튜브(BGM01)와 기본 음원(BGM02)을 문제가 생기는 순서대로 튼다 → ③ 한쪽이 멈추면 바로
// F12 → Console 에 붙여 넣고 Enter. 결과는 클립보드에 복사됩니다(곡 제목·주소 없음: 호스트 이름과 슬롯 이름만).
(() => {
  const dbg = window.__CCF_CHAT_NOTIFIER_DEBUG__;
  const trace = (dbg?.bgmTrace?.() || []).slice(-30).map((e) => ({ ...e, videoId: e.videoId ? "(있음)" : "", title: undefined }));
  const media = [...document.querySelectorAll("audio, video")].map((m) => ({ host: String(m.currentSrc || m.src || "").replace(/^https?:\/\/([^/]+).*$/, "$1").slice(0, 40), paused: m.paused, ended: m.ended, t: Math.round(m.currentTime || 0) }));
  const slots = [...document.querySelectorAll("[data-ccf-bgm-slot-key]")].map((el) => ({ slot: el.getAttribute("data-ccf-bgm-slot-key"), youtube: el.getAttribute("data-ccf-youtube-bgm") || "", stopIcon: !!el.closest(".MuiListItem-root")?.querySelector('[data-testid="StopIcon"]') }));
  const out = { notifier: dbg?.version || "", trace, media, slots };
  console.warn("[BGM 두 슬롯 진단]", out);
  copy(JSON.stringify(out, null, 1));
})();
