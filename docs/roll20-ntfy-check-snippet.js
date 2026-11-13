// Roll20 캠페인(게임 화면) 탭의 콘솔에 붙여넣기: Roll20 → 폰 푸시 상태를 클립보드에 복사한다. (확장 content script 가 documentElement.dataset 에 상태를 둔다)
// 순서: ① 확장을 새로고침하고 Roll20 게임 화면을 연다 → ② 10초 기다린 뒤 다른 계정/탭에서 메시지를 보낸다 → ③ 이 스니펫 실행.
(() => {
  let status = null;
  try { status = JSON.parse(document.documentElement.dataset.capybaraR20Ntfy || 'null'); } catch (_) {}
  const out = {
    // null 이면 확장의 roll20-reader.js 가 이 탭에 안 들어온 것(확장 새로고침·Roll20 탭 새로고침 필요)
    status,
    // total: 푸시 대상으로 센 메시지 수, lastSkip: 마지막으로 거른 이유, sentLastMin: 최근 1분 전송 수, lastError: 전송 오류(백그라운드가 돌려준 것), graceLeftMs: 접속 직후 이력 제외 남은 시간
    tick: document.documentElement.dataset.capybaraR20Tick || null,
    chatLines: document.querySelectorAll('#textchat .content div.message[data-messageid]').length,
    visible: document.visibilityState, focused: document.hasFocus(),
  };
  copy(out);
  console.warn(out);
})();
