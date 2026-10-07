# 코딩 세션 인수인계 (카피바라 4세)

> 이 내용을 새 코딩 세션의 첫 메시지로 붙여 넣으세요.

## 작업 규칙
- 저장소: `asp0902/CCFOLIA_bookmarklet` (로컬 폴더 `C:\Users\asp92\OneDrive\바탕 화면\TRPG\#05 중계_카피바라 4세` = 클론)
- 작업이 끝나면 확인 없이 커밋 → 푸시 → PR 생성 → 병합(main 직접 푸시도 허용). 테스트 실패·충돌 시 멈추고 보고.
- 병합 후 로컬 폴더는 `git pull origin main`으로 동기화.
- 확장(`extension/personal`) 파일이 바뀌면 사용자에게 "확장 새로고침"을 안내(manifest 버전도 올림).
- 유저스크립트(`legacy/*.user.js`)는 상단 `@version`과 코드 안 버전 문자열을 함께 올림. GitHub Pages 반영은 `curl https://asp0902.github.io/CCFOLIA_bookmarklet/legacy/<파일> | grep @version`으로 확인.
- 릴레이 Worker 배포: `prototype/public-handout-relay/cloudflare`에서 `npx --yes wrangler deploy` (Worker 이름 `capybara-iv`, https://capybara-iv.for-trpg.workers.dev). GM_TOKEN 같은 비밀값은 다루지 않음.
- 파일은 CRLF. 테스트 실행 시 환경 변수:
  - `PLAYWRIGHT_MODULE=C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`
  - `CHROMIUM_EXECUTABLE=C:/Program Files/Google/Chrome/Application/chrome.exe`
- `gh pr create --body`에 백틱(`)을 넣으면 bash 명령 치환으로 깨짐 → 백틱 없이 작성.
- 로컬 `wrangler dev`는 Durable Object 오류로 불안정. 참여자 페이지는 `public` 폴더를 `python -m http.server`로 띄우고 브라우저에서 `renderState(...)`를 직접 호출해 확인하는 방식이 빠름.

## 확정된 방향
- 참여자는 GM이 발행한 **초대 링크로 들어오는 웹 플레이 룸**을 사용. 설치·북마클릿·유저스크립트·크롬 웹 스토어 방식은 쓰지 않음(사용자 결정).
- 구조: GM 브라우저(확장 + 툴킷)가 코코포리아 데이터를 읽어 릴레이로 전달하고, 참여자의 명령(채팅 등)은 GM 쪽이 대신 실행.
- 코코포리아 기능 "전체"가 아니라 **참여자에게 필요한 기능**만 구현. 목록과 진행 상황은 이슈 #200(https://github.com/asp0902/CCFOLIA_bookmarklet/issues/200)에서 관리하고, 새로 필요한 기능은 수시로 추가.
- 참고: 초대 팝업의 "동의"는 현재 실제 코코포리아 룸(ccfolia.com/rooms/ID)으로 이동시키고 설치 안내 링크(docs/adopt)를 보여 줌. 위 방향과 맞지 않으므로 "동의 → 웹 플레이 룸 입장"으로 되돌릴지 사용자 확인 필요.

## 다음 작업 후보 (이슈 #200 순서)
1. 롤20 CSS 매크로(색 띠) 표시 — 참여자 채팅 `participant.js`의 `renderRich`
2. 주사위 굴림 결과 카드 — 네이티브 모양, 성공/실패 색
3. 내 말 드래그 이동 — 참여자 → 릴레이 → GM 확장이 코코포리아에 반영
4. 내 캐릭터 상태값 수정, 캐릭터 시트·메모 보기
5. 화자 선택 — GM이 허용한 캐릭터로만 발언
6. 코코포리아 변경 감지 점검 테스트(GM 쪽 데이터 읽기 호환)

## 주요 파일
- 참여자 화면: `prototype/public-handout-relay/public/index.html`, `participant.js`, `style.css`
- 서버: `prototype/public-handout-relay/cloudflare/worker.mjs` (CSP, `/api/admin/rooms/:id/{messages,scene,channels,bgm}` 등)
- GM 쪽 전달: `extension/personal/relay-page.js`(MAIN world), `relay-bridge.js`(ISOLATED), `legacy/ccfolia-chat-panel.user.js`의 `relayMessages` / `relayScene` / `relaySceneSubscribe` / `relayChannels` / `relaySend`
- 설치 안내 페이지: `docs/adopt/index.html`
- 관련 테스트: `tools/test-relay-bridge.cjs`, `test-relay-page.cjs`, `test-share-modal.cjs`, `test-participant-rich-text.cjs`, `test-chat-panel-format-spans.cjs`, `test-chat-panel-speaker-icons.cjs`

## 현재 버전
- 확장 `extension/personal` 1.5.0 (이름 "카피바라 4세")
- `chat-panel` 0.2.25, `format-sync` 0.1.65, `chat-notifier` 0.3.24, `theme-switcher` 0.2.26, `standing-picker` 0.1.16

## 실사용 확인이 아직 없는 것
- GM과 참여자를 실제로 연결한 상태의 시험: 장면 전달, 유튜브 BGM 소리, 핸드아웃 팝업, 탭별 채팅, 서식 메시지, 캐릭터 상태 패널.
- 플로팅 창(Document PiP): 클릭이 필요해 자동 테스트로 열어 보지 못함.
- 백틱 단축키·방향키 선택: 코드로 만든 키 이벤트로만 확인(실제 키보드 확인은 사용자 몫).
