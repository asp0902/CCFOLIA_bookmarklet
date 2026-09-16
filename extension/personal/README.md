# 카피바라 3세 개인용 확장판

기존 북마클릿을 자동 실행하는 Chrome Manifest V3 확장입니다.
기존 북마클릿과 GitHub Pages 배포 파일은 변경하지 않습니다.

## 설치

1. Chrome에서 `chrome://extensions`를 엽니다.
2. 오른쪽 위 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
4. 이 문서가 있는 `extension/personal` 폴더를 선택합니다.
5. 코코포리아 탭을 새로고침합니다. 확장 메뉴에서 아이콘을 고정할 수 있습니다.

## 동작

- `https://ccfolia.com/`에서 자동 실행합니다. 홈에서 룸으로 이동하는 경우도 기존 로더가 처리합니다.
- 확장 아이콘을 누르면 툴킷 패널을 엽니다. 초기 로딩 실패 시 재시도합니다.
- 이미 북마클릿이 실행 중이면 다시 초기화하지 않습니다. 기존 설정과 룸 데이터 저장소를 그대로 사용합니다.
- 확장 설치 전부터 열려 있던 탭은 새로고침하거나 확장 아이콘을 누릅니다.
- 확장을 끄거나 삭제한 뒤에는 룸을 새로고침해야 주입된 코드가 사라집니다.

## 업데이트 및 제한

- 기능 코드는 기존 GitHub Pages 로더에서 가져옵니다. 배포 후 룸을 새로고침하면 반영됩니다.
- 확장 자체의 파일을 수정했다면 `chrome://extensions`에서 확장 새로고침 후 룸도 새로고침합니다.
- 완전 오프라인/코드 내장형 확장이 아닙니다. 인터넷 연결과 기존 사이트의 스크립트 허용 정책에 의존합니다.
- **개인용 로컬 설치 전용**입니다. 원격 코드를 실행하므로 이 패키지를 Chrome 웹 스토어에 제출하지 마세요.
- 권한은 코코포리아 페이지의 스크립트 실행뿐입니다. 쿠키, 전체 방문 기록, 다른 사이트 접근 권한은 요청하지 않습니다.
- 다른 사람에게는 기존 북마클릿을 그대로 배포하면 됩니다.

공식 참고: [로컬 확장 설치](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked),
[MAIN 실행 환경](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts),
[원격 코드 제한](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).
