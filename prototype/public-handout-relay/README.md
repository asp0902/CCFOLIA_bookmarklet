# 공개 핸드아웃 릴레이 프로토타입

공개 핸드아웃 1개를 GM의 카피바라 확장에서 참여자 웹페이지로 읽기 전용 전달하는 로컬 검증 서버입니다. CCFOLIA 쿠키·토큰·전체 DOM, `gmNotes`, 권한표, 비밀 자료는 받지 않습니다.

## 실행

```powershell
cd "prototype\public-handout-relay"
node server.mjs
```

출력된 `GM token`을 카피바라 3세 확장 옵션에 입력하고 확장과 CCFOLIA 탭을 새로고침합니다. 핸드아웃 카드의 **참여자 웹에 공개 내용 공유** 버튼을 누르면 참여자 링크가 표시됩니다.

## 보안 범위

- GM Bearer 토큰과 참여자 초대 토큰은 분리됩니다.
- 참여자는 링크 fragment의 토큰을 동의 버튼을 누른 뒤 HttpOnly 세션으로 교환합니다.
- 세션은 룸에 묶여 다른 룸 API를 읽을 수 없습니다.
- 공유 중단 시 연결과 이후 조회를 차단합니다.
- 본문은 plain text로만 렌더링합니다.
- 서버 재시작 시 모든 공유와 세션이 사라집니다.
- 이미 표시되거나 복사된 내용은 원격 회수할 수 없습니다.

공개 테스트 배포: `https://capybara-public-handout-relay.for-trpg.workers.dev`

배포판은 룸별 SQLite Durable Object로 승인·세션·자료를 보존합니다. GM 토큰은 Worker secret에만 저장됩니다. 무료 한도 초과, 배포 삭제 또는 Durable Object 저장소 삭제 시 서비스가 중단될 수 있습니다.

## 실시간 푸시

서버에서 클라이언트로의 전달은 WebSocket으로 즉시 밀어 줍니다(Durable Object Hibernation API, 유휴 시 과금되는 시간 없이 연결 유지). 전송(참여자 → 서버, GM → 서버)은 지금처럼 HTTP POST입니다.

- 참여자 화면: `/api/rooms/{id}/ws` (HttpOnly 세션 쿠키로 인증). 새 메시지, 핸드아웃, 룸 정보 변경, 접근 취소·공유 중지 알림을 받습니다.
- GM 확장: `/api/admin/rooms/{id}/ws`. 브라우저 WebSocket은 `Authorization` 헤더를 못 쓰므로 GM 토큰을 `Sec-WebSocket-Protocol`(`capybara-gm`, base64url 토큰)로 보냅니다. 새 참여자 명령을 즉시 받습니다. 서버는 응답에서 `capybara-gm`만 돌려주고 토큰은 되돌려 보내지 않습니다.
- 20초마다 `ping`/`pong`(서버가 자동 응답)으로 연결을 유지하고, 응답이 없으면 끊고 재연결합니다.
- **폴링은 안전망으로 남아 있습니다.** 연결이 열려 있으면 10초마다, 끊겨 있으면 1.5초마다 조회합니다. 웹소켓이 막힌 환경에서도 동작합니다.
- 코코포리아 쪽 채팅 읽기도 폴링 대신 CCFOLIA 메시지 저장소 구독(`relaySubscribe`)으로 즉시 반응합니다.

