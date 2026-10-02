# 참여자용 플레이 룸 기능 지도

기준: 2026-10-01 현재 저장소 코드. `검증`은 코드/자동 검사와 실제 CCFOLIA 룸 검증을 구분한다.

| 영역 | 기존 원본/경로 | 권한·데이터 경계 | 웹 이식/브리지 판정 | 검증 상태 |
|---|---|---|---|---|
| 채팅 읽기 | `ccfolia-chat-panel.user.js`의 Redux `entities.roomMessages`, `readMessages()` | GM 브라우저에서 공개 `main` 채널만 정규화해 릴레이 | `relayMessages()` 재사용. ID/화자/본문/시각만 전송 | 코드 연결, 실제 룸 미검증 |
| 채팅 쓰기 | 같은 파일의 Firebase 인증·최근 메시지 템플릿·Firestore REST `sendMessage()` | GM 로그인으로 기록됨. 참여자 계정 아님. 본문에 `[참여자 웹 · 이름]` 강제 | `relaySend()` 재사용. 서버 명령은 `chat.send`만 허용 | 기존 쓰기 경로는 코드 존재. 새 브리지 실제 룸 미검증 |
| 서식/CSS 매크로 | `ccfolia-format-sync.user.js`, `ccfolia-roll20-css-bridge.user.js`의 invisible envelope/허용 스타일 렌더러 | 원격 HTML/JS 전달 금지. 현재 세로 단면은 plain text | 파서와 sanitizer 분리 후 이식 필요 | 미구현 |
| 판정 | `ccfolia-roll-triggers.user.js`, 채팅 패널의 BCDice/단순 주사위 결과 | 판정 원본은 CCFOLIA. 재접속 시 재굴림 금지 | 결과 메시지 읽기는 가능. 참여자 판정 명령은 명령 타입/결과 ID 설계 후 | 미구현 |
| 캐릭터/스탯/시트 | `ccfolia-character-sheet.user.js`, CCFOLIA `roomCharacters`/로컬 룸 데이터 | 할당 캐릭터만 참가자에게 전송. GM/타인 비밀 필드 제외 | 별도 DTO와 소유권 검사가 필요 | 조사 완료, 미구현 |
| 공개 핸드아웃 | `ccfolia-handout.user.js`의 `description` 공개 본문 | GM이 명시 공유한 `id/title/bodyText`만 | 기존 `/api/share`와 플레이 룸 article 통합 | 자동 서버 검사 기존 통과, 새 UI 미검증 |
| 비밀 핸드아웃 | 같은 파일의 `gmNotes`, permissions | 권한 없는 참가자에게 전송 금지. CSS 숨김 금지 | 참가자별 허용 DTO/서버 필터 필요 | 미구현 |
| 장면/맵/토큰 | CCFOLIA 룸 Redux/DOM, 기존 북마클릿에 독립 플레이 뷰 없음 | 공개 장면·토큰만. 이미지 URL 접근권한 검증 필요 | 캔버스/상태 DTO를 새로 설계해야 함. iframe/리다이렉트 금지 | 미조사/미구현 |
| GIF/컷인 | `ccfolia-format-sync.user.js`; 네이티브 컷인은 메인, 채팅은 반복 GIF | 참여자 룸으로 보낼 공개 효과만 선택 | 기존 `makeGifLoopForever` 재사용 후보. 네이티브 컷인 복제 금지 | 기존 동작 테스트 있음, 웹 룸 미구현 |
| BGM/사운드 | `ccfolia-chat-notifier.user.js` | 외부 미디어 URL·자동재생·볼륨 동의 필요 | 상태 DTO/사용자 재생 동작 필요 | 미구현 |
| 로그/테마 | `ccfolia-log-package.user.js`, `ccfolia-theme-switcher.user.js` | 로그는 승인된 공개 채팅만. GM 로컬 테마는 기본 비공개 | 공통 색 토큰만 선택적 반영 가능 | 미구현 |
| 슬래시 매크로/팔레트 | `ccfolia-slash-macros.user.js`, `ccfolia-palette-filter.user.js` | GM 로컬 설정/비밀 명령 공유 금지 | 참여자 할당 캐릭터용 허용 명령 목록 필요 | 미구현 |
| 추가 채팅/알림/사용자 패널 | `ccfolia-chat-panel.user.js`, notifier, presence | CCFOLIA 계정 존재를 외부 신원으로 사용 금지 | 플레이 룸 전용 UI로 대체 | 채팅 단면만 구현 |

## 현재 세로 단면

- 툴바 아이콘을 누르면 열리는 웹 공유 창에서 사용/릴레이 주소/GM 토큰을 저장한다.
- GM CCFOLIA 룸 탭이 `/api/connect`로 연결하고 초대 URL을 저장해 웹 공유 창에 보여 준다.
- 참가자는 동의 후 HttpOnly 세션을 받고, GM 승인 전 데이터가 전달되지 않는다.
- 승인 후 공개 `main` 채팅과 명시 공유된 공개 핸드아웃만 본다.
- 참가자 채팅은 서버 명령 큐를 거쳐 확장으로 전달된다. CCFOLIA 기록은 GM 인증을 사용하므로 본문에 외부 출처를 강제 표시한다.
- 메시지/명령 ID, 서버 중복표, 확장 전달 ID 캐시로 반사와 재전송을 줄인다. CCFOLIA 쓰기와 ACK 사이 브라우저 강제 종료는 실제 룸 검증이 필요하다.

## 의도적 제외

원격 임의 JS/DOM 실행, GM 쿠키·Firebase 토큰 전송, 보호된 비밀 자료 전송, CCFOLIA iframe/리다이렉트, 작동하지 않는 장면/토큰/사운드 버튼은 만들지 않는다.
