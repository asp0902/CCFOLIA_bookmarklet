// 핸드아웃을 받는 쪽(플레이어) 점검 — 코코포리아 룸 콘솔에 붙여 넣고 실행(북마클릿·확장 모두). 결과는 콘솔(경고)과 클립보드에 들어갑니다.
// 보는 것: 핸드아웃 도구가 켜졌는지, 인사 팝업에 동의했는지(동의해야 연결됨), 연결 여부, 내 사본(inbox) 구독, 받은 핸드아웃 수, 마지막 수신, 최근 오류.
(() => {
  const api = window.__CCF_HANDOUT_DEBUG__;
  let out;
  if (!api) out = { error: "핸드아웃 도구가 이 페이지에 없습니다(북마클릿을 다시 누르거나 확장을 새로고침)." };
  else if (typeof api.receiveDiag !== "function") out = { error: "핸드아웃 도구가 옛 버전입니다(0.1.118 이상 필요): 페이지를 새로고침한 뒤 북마클릿을 다시 눌러 주세요." };
  else {
    out = api.receiveDiag();
    out.hint = !out.active ? "핸드아웃 기능이 꺼져 있음"
      : !out.greeted && !out.connected ? "이 룸에서 '카피바라와 함께합니다' 창의 [확인]을 누르지 않아 연결되지 않음 — 툴킷 메뉴에서 인사 창을 다시 띄워 확인을 눌러 주세요"
      : !out.connected ? `아직 연결 전(${out.syncReason || "이유 없음"})`
      : !out.inboxSubscribed ? "연결은 됐지만 내 사본 구독이 없음"
      : !out.inboxActive ? "내 사본을 읽지 못함(issue 확인)"
      : out.received ? "정상: 받은 핸드아웃이 있음"
      : "정상 연결, 아직 받은 핸드아웃 없음(GM 쪽 권한표·공유를 확인)";
  }
  const text = JSON.stringify(out, null, 1);
  console.warn(text);
  try { copy(text); console.warn("클립보드에 복사했습니다."); } catch (_) { /* copy 없음 */ }
})();
