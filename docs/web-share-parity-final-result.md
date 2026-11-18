# 웹 공유 화면(플레이룸) 최종 점검 결과 — 2026-11-18

대상 기간: #492 ~ #576. 웹 공유 화면은 자체 렌더러(`prototype/public-handout-relay/public/participant.js`의 `renderRich`·`styleSegment`·`renderRoll20`)와 GM 화면에서 미러링한 코코포리아 모양을 씁니다.

**이번 점검에서 고친 것**(participant.js, Worker 재배포 전까지는 웹 공유 화면에 반영되지 않음 — 사용자 승인 필요)
1. 컷인 이름으로 끝나는 서식·나레이션 메시지(`글 + 봉투 + @컷인`): 서식이 풀리고 `@컷인`이 보이던 것 → 서식 유지, 이름 숨김(GM 화면과 같음).
2. 메시지 글꼴(fontId): 허용 목록(툴킷과 같은 14종)의 Google 글꼴로 그림. Worker CSP가 fonts.googleapis.com·gstatic을 이미 허용합니다.
3. 같은 화자 묶기: 같은 이름이라도 스탠딩(아이콘)이 다르면 따로 묶음(GM 화면 기본값과 같음).
4. 붙여 넣은 그림(서식의 imageUrl): 그리지 않고 있었음 → 이 페이지가 받을 수 있는 주소(코코포리아 CDN·imgur·data 그림)는 그림으로 그림. 그 밖의 주소는 설명 글자만 나옵니다(아래 '남은 것').

테스트: `tools/test-participant-parity.cjs`(새로 추가). participant·mirror 테스트 전부 PASS.

| 기능 | 코코포리아 화면 | 웹 공유 화면 | 근거 |
|---|---|---|---|
| 서식 B/I/U/S·색·배경·크기·정렬 | 있음 | 반영 | renderRich/styleSegment, test-participant-rich-text |
| 루비·툴팁·블러·코드 | 있음 | 반영 | styleSegment(ruby/rt, title, blur, codeMode) |
| 제목 # / ## / ### | 있음(보낼 때 크기 run으로 바뀜) | 반영 | 크기·굵게 run이라 그대로 그려짐 |
| 메시지 글꼴(fontId) | #561 | **이번에 반영** | messageFont, test-participant-parity |
| 나레이션·구분선 | 있음 | 반영 | data-ccf-narration / data-ccf-break(mirror.css) |
| 컷인 + 나레이션 | #546 | **이번에 반영** | decodeEnvelope 컷인 꼬리 |
| 숨긴 메시지 | GM만 보임 | 반영(보내지 않음) | chat-panel relayView: hidden이면 중계 안 함 |
| 같은 화자 묶기 | #564 | **이번에 반영**(스탠딩 기준) | markSpeakerRuns |
| 메시지 순서 | #534 | 반영 | 중계가 저장소 순서로 보냄 |
| 인라인 롤 [[..]] 박스 | 있음(roll20-css-bridge) | 반영 | renderRoll20(roll20Macro 봉투) |
| 붙여 넣은 그림 | 있음 | **부분 반영**(허용 주소만) | 아래 남은 것 ① |
| 인세인 판정 카드·특기표 카드·아이템 카드 | theme-switcher(내 화면 테마) | **빠짐** | 아래 남은 것 ② |
| 핸드아웃 공유·팝업·줄바꿈·비밀 권한 | 있음 | 반영 | test-participant-handouts, handout-sanitize |
| 핸드아웃 Sv 서식·크기 조절 창 | GM 편집 기능 | 해당 없음 | 참여자는 보기만 함 |
| 시트(본인 것만·서식·디자인) | 코코포리아 화면 기능 | 해당 없음 | 웹 공유 화면에는 시트 창이 없음 |
| 커스텀 커맨드 룸 공유 | GM·참여자 코코포리아 입력칸 | 해당 없음 | 웹 공유 입력은 명령을 GM 쪽 코코포리아로 넘김 |
| BGM(룸별·정지 상태) | 있음 | 반영 | #518/#523, test-participant-room-audio |
| 테마(색 확장·투명·프리셋·글꼴) | 내 화면 설정 | 해당 없음 | 각자 자기 화면 설정(참여자 화면은 GM 화면 모양 미러) |
| 우클릭 메뉴(말·다이스) | 있음 | 반영 | docs/context-menus.md, participant 메뉴 |
| 서식 바 색 픽커·Sv 메뉴 | 입력 도구 | 해당 없음/별도 | 웹 공유 입력의 서식 툴바는 test-participant-format-toolbar |

## 남은 것(결정 필요)
① **툴킷 저장 그림 토큰(ccf-firestore-image)·Firebase Storage 주소 그림**: 웹 공유 화면은 Firestore에 접근하지 않고, CSP가 이 주소를 허용하지 않아 설명 글자만 나옵니다. 그리려면 Worker가 그림을 대신 받아 주는 경로(프록시)나 CSP 확장이 필요합니다(Worker 변경).
② **인세인 카드**: GM 화면 테마(theme-switcher)가 그리는 카드라 웹 공유 화면에는 없습니다. 반영하려면 카드 그리기를 공용 모듈로 빼서 웹 공유 화면에서도 쓰게 해야 합니다(중간 크기 작업).
③ **실제 화면 나란히 캡처**(docs/img/parity-final-*.png): Worker를 재배포한 뒤 테스트 룸에서 찍겠습니다.

## 배포(사용자 승인 필요)
- participant.js 변경은 Worker(capybara-iv)에 정적 파일로 실립니다 → `wrangler deploy` 재배포가 필요합니다. 승인하면 배포한 뒤 캡처하겠습니다.
- 규칙 변경은 없습니다.
