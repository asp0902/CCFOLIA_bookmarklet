// 코코포리아(GM 계정, 룸 Ch5CAlmjd 등) 콘솔에 붙여넣기: "내 캐릭터 목록"에 다른 사람 캐릭터가 안 보이는 이유를 클립보드에 복사한다(읽기만 함).
// 먼저 "내 캐릭터 목록" 패널을 열어 둔 상태에서 실행.
(() => {
  const d = window.__CCF_OTHERS_CHARS__?.diag?.() || { error: 'others-characters 0.1.1 이상이 로드되지 않음(툴킷 새로고침 필요)', version: window.__CCF_OTHERS_CHARS__?.version || null };
  copy(d); console.log(d);
})();
