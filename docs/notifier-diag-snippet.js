// 코코포리아 콘솔에 붙여넣기: 폰 푸시가 안 올 때의 진단 값을 클립보드에 복사한다(결과를 그대로 붙여 달라고 하면 됨).
// 순서: ① 이 룸 탭을 연 채로 다른 계정/플레이룸에서 메시지를 하나 보낸다 → ② 이 스니펫 실행.
(() => {
  const d = window.__CCF_NOTIFIER_DIAG__ ? window.__CCF_NOTIFIER_DIAG__() : null;
  const n = window.__CCF_NTFY_STATE__ || null;
  const out = {
    notifierDiag: d, // register(줄 등록 시도) / live(실시간 등록) / hookCalls(푸시 훅 호출) / blocked(막힌 이유별 횟수: not-message-item, no-key, known-key, same-element-key, grace, no-hook, old-timestamp) / lastBlock
    ntfyState: n ? { total: n.total, lastSkip: n.lastSkip, lastError: n.lastError, sentLastMin: (n.sent || []).length } : null,
    ntfyDiag: window.__CCF_NTFY_DIAG__ ? window.__CCF_NTFY_DIAG__() : null,
    versions: { toolkit: window.__CAPYBARA_TOOLKIT__?.version || null },
    visible: document.visibilityState, focused: document.hasFocus(),
  };
  copy(out);
  console.warn(out);
})();
