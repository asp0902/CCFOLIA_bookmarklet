# 작업 지시서 (최우선): Roll20 새 메시지 → 스마트폰 푸시(ntfy) (사용자 요청, 2026-11-12)

> 사용자: Roll20에서 오는 메시지도 ntfy로 받고 싶음. "User JavaScript and CSS"(크롬 확장, 사이트별 사용자 JS/CSS 주입)를 활용하는 방법도 있는 것 같음. **Roll20 쪽을 먼저 우선 처리.**
> 순서: 이 문서 → (코코포리아 ntfy 훅 미호출 수정) → 시트·다른 사람 캐릭터 → batch-1112c.
> 단, 코코포리아 ntfy 수정과 원인이 겹치면(같은 ntfy-page/설정 공유) 함께 처리해도 됨.

## 1. 우리 확장 경로 (기본)
- 확장(personal)은 이미 `app.roll20.net/editor*`, `/campaigns/*`에 `roll20-reader.js`를 주입하고 host_permissions에 `https://ntfy.sh/*`가 있음.
- Roll20 채팅(`#textchat .content`의 `.message` 추가)을 감지 → 새 메시지면 ntfy 전송.
  - **설정은 코코포리아 ntfy와 공유**(같은 저장소의 enabled·topic·onlyAway·awayMinutes·scope·keywords). 별도 설정 화면 만들지 않음. 필요하면 "Roll20도 받기" 스위치 1개만 추가(기본 켬).
  - 제목/본문: `[Roll20] 이름: 내용 앞 60자`. 굴림 결과(`.rollresult`, 인라인 롤)는 "주사위: 결과값" 정도로 요약. 이미지·HTML 제거.
  - 제외: 페이지 로드 시 이미 있던 이력(아카이브 로드 포함 — Roll20은 접속 시 과거 메시지를 한꺼번에 붙임, 로드 후 grace 필요), 내 메시지(Roll20 `.message.you` 또는 by 이름 = 현재 발화자 선택값), 자리 비움 아님(onlyAway 켜졌을 때 탭 보이고 최근 입력 있음), 분당 상한(코코포리아와 같은 값).
  - 귓속말(`.message.private`)은 나에게 온 것만 포함 — 표시 "[Roll20 귓속말]".
  - 전송은 content script(확장 권한)에서 fetch — Roll20 CSP 영향 없음. **계정 정보·캠페인 id를 ntfy로 보내지 않음**(이름·짧은 본문만).
- 진단: `window.__CCF_ROLL20_NTFY__`(page↔content 브리지 필요하면) 또는 content 쪽 상태를 콘솔에서 볼 수 있게: total, lastSkip, sentLastMin, lastError — 코코포리아 snippet2와 같은 모양. 사용자용 copy() 스니펫 `docs/roll20-ntfy-check-snippet.js`.

## 2. "User JavaScript and CSS" 경로 (확장 없는 사람/보조)
- 조사: 그 확장이 스크립트를 **페이지 컨텍스트**에 넣는지(그럼 Roll20 CSP의 connect-src가 ntfy.sh를 막는지), 자체 권한으로 fetch를 허용하는지 실측. 결과를 문서에 표로.
- 되는 경우: `tools/roll20-ntfy.user-js.js` — 붙여넣기용 단일 파일(설정은 맨 위 상수: topic, onlyAway 등 — **사용자가 직접 입력**, 우리가 값 채우지 않음), 1과 같은 감지·제외 규칙. 설치 방법 짧은 안내(docs).
- CSP로 막히면: 막힌다고 보고하고, 대안(우리 확장 사용 / 그 확장의 백그라운드 fetch 기능이 있으면 그것)만 정리.
- 이 경로도 코코포리아용(User JS로 툴킷 로더를 넣는 방식)이 가능한지 한 줄 의견.

## 3. 테스트
- 복제 Roll20 채팅 DOM: 로드 이력 0건, 새 남의 메시지 1건 → POST 1회(본문 형식), 내 메시지 skip, 굴림 요약, 귓속말, 분당 상한, onlyAway.
- 실측은 사용자 몫(Roll20 캠페인 접속) — 확인 방법 안내: 확장 새로고침 → Roll20 캠페인 열기 → 다른 계정/다른 탭에서 메시지 → 폰 알림.

## 완료 후
- 버전 올림·병합(확장이면 사용자에게 확장 새로고침 안내), Pages 확인.

## 결과 (2026-11-12, 구현)
- **우리 확장 경로**: `extension/personal/roll20-reader.js`가 새 줄마다 `ntfyOnMessage`를 부른다(설정은 `chrome.storage.local.ntfy`를 코코포리아와 공유; `roll20:false`로 Roll20만 끌 수 있고 기본 켬 — 설정 화면 스위치는 만들지 않았다). 전송은 백그라운드(`ntfy-send`)가 하고, 백그라운드는 이제 코코포리아 탭과 `app.roll20.net` 탭의 `ntfy-send`만 받는다(`ntfy-test`는 코코포리아 탭만). 확장 1.52.13 — 확장을 새로고침하고 Roll20 탭을 새로 고쳐야 적용된다.
- 규칙: 접속 후 8초 안에 본 줄=이력 제외(처음 3초는 읽지도 않음), 시스템 줄 제외, 내 줄(`.you` 또는 선택한 발화자와 같은 이름) 제외, onlyAway(탭을 보고 있고 최근 조작) 제외, 분당 6회 상한 + 10초 묶음("외 N건"), 굴림은 `주사위: 결과`, 귓속말은 `[Roll20 귓속말]`(내가 보낸 것은 제외), 키워드 범위 적용. 제목은 `[Roll20] 이름`, 본문은 `includeText`가 켜진 경우에만 `이름: 앞 60자`(아니면 "새 메시지가 도착했습니다."). 캠페인 번호·계정은 보내지 않는다.
- 진단: 콘솔 `document.documentElement.dataset.capybaraR20Ntfy`(JSON: total, lastSkip, lastError, sentLastMin, enabled, hasTopic, roll20Switch, onlyAway, graceLeftMs) — 점검 스니펫 `docs/roll20-ntfy-check-snippet.js`(copy()).
- **User JavaScript and CSS 경로**: Roll20의 CSP를 **실측하지 못했다**(봇 차단으로 403 Cloudflare 확인 페이지만 오고, 거기 나온 CSP는 확인 페이지 자체의 것이라 의미 없음). 그래서 CSP 판정 없이 `tools/roll20-ntfy.user-js.js`(맨 위 `topic`은 비워 둠 — 사용자가 직접 입력)를 만들었고, 막히면 콘솔에 `[roll20-ntfy] 전송 실패(CSP 일 수 있음)`가 뜬다 → 그땐 확장을 쓴다. 코코포리아에 툴킷 로더를 User JS로 넣는 방식은 코코포리아 CSP/`script-src`와 로더의 외부 스크립트 로드 때문에 되지 않을 가능성이 높다는 한 줄 의견(미실측).
- 테스트: `tools/test-roll20-ntfy.cjs`(복제 Roll20 채팅 DOM; 이력 0건, 남의 줄 1건 → 1회, 묶음, 내 줄, 굴림 요약, 귓속말, 본문 60자, includeText 꺼짐, Roll20 스위치, onlyAway, 꺼짐, user-js 경로).
- 실측은 사용자 몫: 확장 새로고침 → Roll20 캠페인 열기 → 10초 뒤 다른 계정/탭에서 메시지 → 폰 알림 → 안 오면 `docs/roll20-ntfy-check-snippet.js` 결과를 보내 주세요.
