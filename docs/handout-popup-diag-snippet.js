// 핸드아웃 팝업 진단(읽기만 함). 결과는 클립보드에 복사됩니다(uid 는 앞 6자, 본문 없음).
// GM 화면: 팝업을 보낸 직후, 아래 줄의 "핸드아웃 id" 자리에 그 핸드아웃 id 를 넣어 실행(모르면 비워 두면 가장 최근 핸드아웃).
(() => { const id = ""; /* 핸드아웃 id(비우면 첫 핸드아웃) */ const out = window.__CCF_HANDOUT_DEBUG__?.shareDiag?.(id) ?? "핸드아웃 스크립트 없음"; console.warn("[핸드아웃 공유 진단]", out); copy(JSON.stringify(out, null, 1)); })();
// 플레이어 화면(북마클릿 포함): 팝업이 안 뜬 직후 실행.
(() => { const out = window.__CCF_HANDOUT_DEBUG__?.receiveDiag?.() ?? "핸드아웃 스크립트 없음"; console.warn("[핸드아웃 수신 진단]", out); copy(JSON.stringify(out, null, 1)); })();
