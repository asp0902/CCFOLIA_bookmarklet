# 규칙 초안(배포 안 함): 사이코로픽션 시트 — 플레이어는 본인 시트만 읽기

character-sheet 0.5.45부터 화면에서는 플레이어에게 본인 시트만 보인다(목록·GM 도구 시트 탭·열기). 하지만 지금 규칙은 `sheets` 문서를 로그인한 누구나 읽을 수 있다. 그래서 다른 사람 시트의 공개 부분이 브라우저까지 온다(화면에 그리지만 않음). 비밀·사명(`sheetSecrets`)은 이미 GM과 소유자만 읽는다.

## 바꿀 곳 (`firebase/firestore.rules`, `match /sheets/{sheetId}`)

```
match /sheets/{sheetId} {
  // 전: allow read: if signedIn();
  allow read: if isGm(roomId) || (signedIn() && resource.data.ownerUid == request.auth.uid);
  // 전: 멤버가 자기 uid를 ownerUid로 적으면 남의 시트도 덮어쓸 수 있었다
  allow create: if (isGm(roomId) || (isMember(roomId) && request.resource.data.ownerUid == request.auth.uid)) && <지금과 같은 형식 검사>;
  allow update: if (isGm(roomId) || (isMember(roomId) && resource.data.ownerUid == request.auth.uid && request.resource.data.ownerUid == request.auth.uid)) && <지금과 같은 형식 검사>;
  allow delete: (지금 그대로)
}
```

## 함께 바뀌는 동작 (배포 전에 결정할 것)

1. **목록 구독**: 지금은 `sheets` 컬렉션 전체를 구독한다. 읽기 제한이 걸리면 플레이어의 컬렉션 구독이 permission-denied로 실패한다. 그래서 플레이어는 `where("ownerUid", "==", uid)` 쿼리로 구독하도록 코드도 같이 바꿔야 한다(GM은 지금처럼 전체).
2. **연결 캐릭터 기준**: 화면 규칙의 "연결 캐릭터가 내 캐릭터" 조건(GM이 만든 시트를 플레이어 캐릭터에 연결한 경우)은 규칙에서 확인할 수 없다. 캐릭터 소유 정보는 코코포리아 쪽 데이터라 툴킷 DB에 없다. 그런 시트를 플레이어가 받으려면 GM이 시트의 소유자(ownerUid)를 그 플레이어로 바꿔 줘야 한다. 이건 지금 없는 기능이다.
3. **소유권 넘기기**: 지금은 소유자가 아닌 멤버가 편집하면 ownerUid가 그 사람으로 바뀌며 넘어간다(코코포리아 캐릭터 소유권을 가져간 경우). update 제한이 걸리면 이 길이 막힌다. 그러면 넘기기는 GM만 할 수 있다.

배포는 사용자 승인 후, 사용자가 콘솔에서 게시한다(지난번과 같은 방식).


## 2026-11-18 코드 반영(character-sheet 0.5.49) — 게시는 사용자

- `firebase/firestore.rules`의 `sheets` 블록을 위 초안대로 바꿨다(읽기 = GM·소유자, 수정 = GM 또는 지금 소유자).
- 코드:
  - 플레이어는 `where("ownerUid", "==", 나)` 쿼리로 자기 시트만 구독한다. GM은 전체를 구독한다.
  - 플레이어는 남의 시트를 쓰거나 지우지 않는다.
- 소유자 넘기기: GM 화면이 자동으로 한다.
  - 시트의 연결 캐릭터(player)를 코코포리아에서 가진 사람(roomCharacters.owner = 코코포리아 uid)을 찾는다.
  - 구성원 목록(members: 툴킷 uid ↔ 코코포리아 uid)에서 그 사람의 가장 최근 툴킷 uid를 소유자로 쓴다.
  - 그 사람이 다른 브라우저를 쓰면 가장 최근 것 하나만 소유자가 된다.
- 게시 전에도 동작한다(지금 규칙은 읽기가 더 넓어서 쿼리도 통과).

### 게시 방법(사용자)
1. Firebase 콘솔 → Firestore Database → **규칙** 탭을 연다.
2. 저장소의 `firebase/firestore.rules` 전체 내용으로 바꾼다.
3. **게시**를 누른다.
4. 확인 사항:
   - 플레이어 화면: 자기 시트만 보이고, 비밀·사명이 보이는지.
   - GM 화면: 전체 시트가 보이는지.
   - 연결 캐릭터를 가진 플레이어에게 시트가 넘어가는지.
