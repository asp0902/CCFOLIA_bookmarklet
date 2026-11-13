// 코코포리아 콘솔에 붙여넣기: 광기 발현 알림이 안 뜨는 이유를 클립보드에 복사한다(읽기만 함). 크툴루 룸에서, SAN 을 깎아 본 뒤 실행.
(() => {
  const d = window.__CCF_MADNESS__?.diag?.() || { error: 'ccfolia-madness 0.1.2 이상이 로드되지 않음(툴킷 새로고침 필요)', version: window.__CCF_MADNESS__?.version || null };
  copy(d); console.warn(d);
})();
