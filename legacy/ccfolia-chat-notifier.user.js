// ==UserScript==
// @name         CCFOLIA Chat Notifier by Capybara_korea
// @namespace    https://greasyfork.org/ko/scripts/578091-ccf-chat-notifier-by-capybara-korea
// @version      0.2.76
// @description  Plays a chat alert sound when new CCFOLIA messages arrive while the room is unfocused.
// @description:ko 코코포리아 탭이나 창이 비활성 상태일 때 새 채팅이 오면 소리로만 알립니다.
// @license      Copyright @Capybara_korea. All rights reserved.
// @match        https://ccfolia.com/*
// @match        https://*.ccfolia.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  const INIT_GRACE_MS = 1500;
  const MIN_NOTIFY_GAP_MS = 700;
  const TITLE_DEBOUNCE_MS = 120;
  const FALLBACK_THROTTLE_MS = 2500;
  const FOCUS_SYNC_DELAY_MS = 200;
  const BGM_PROGRESS_UPDATE_MS = 500;
  const BGM_RECENT_CLICK_MS = 8000;
  const BGM_NATIVE_EDIT_GRACE_MS = 5000;
  const BGM_DRAWER_WIDTH_PX = 640;
  const BGM_WEB_AUDIO_MIN_DURATION = 8;
  const BGM_STORAGE_PREFIX = "ccf-chat-notifier:youtube-bgm:";
  const BGM_STORAGE_KEY = `${BGM_STORAGE_PREFIX}__global_library__`; // 룸 주소 대신 전역 키 사용
  const BGM_STORAGE_META_KEY = "__ccfBgmMeta";
  const BGM_STORAGE_META_VERSION = 1;
  const BGM_DELETED_ENTRY_LIMIT = 200;
  const TOOLKIT_DB_NAME = "capybara-toolkit";
  const TOOLKIT_STORE_ROOM_DATA = "roomData";
  const TOOLKIT_STORE_ASSETS = "assets";
  const YOUTUBE_IFRAME_API_URL = "https://www.youtube.com/iframe_api";
  const YOUTUBE_EMBED_HOST = "https://www.youtube-nocookie.com";
  const YOUTUBE_PLAYER_MIN_SIZE = 200;
  const YOUTUBE_AUDIO_REINFORCE_DELAYS_MS = Object.freeze([0, 80, 250, 700, 1500]);
  const DEBUG_ENABLED = true;
  const DEBUG_PREFIX = "[CCF Chat Notifier]";
  const ROOM_PATH_RE = /^\/rooms\/[^/?#]+/i;
  // Distinct from format-sync's INVIS markers so the two scripts don't collide.
  const BGM_SHARE_START = "???";
  const BGM_SHARE_END = "???";
  const BGM_SHARE_INVIS_MAP = ["?", "?", "?", "?"];
  const BGM_SHARE_PROTOCOL_VERSION = 1;
  const BGM_SHARE_DOM_ATTR = "data-ccf-bgm-share";
  const BGM_SHARE_SENDER_ID = `bgm-share-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // 채팅 기반 공유는 폰트/렌더링에 따라 비가시 문자가 ?로 새어 보이는 사례가 있어
  // 영구히 비활성화. 대신 아래 Firestore 채널을 사용한다. (수신 측에서 과거 채팅에
  // 남아 있는 비가시 봉투를 숨기기 위한 [data-ccf-bgm-share] CSS는 그대로 둔다.)
  const BGM_CHAT_SHARE_ENABLED = false;

  // === Firestore 기반 BGM 동기화 ===
  // 두 가지 모드를 별도 플래그로 관리한다:
  //   - SLOT_SYNC: 슬롯 목록 자체를 모든 클라이언트에 복제. 현재는 OFF.
  //     (코코포리아 네이티브 BGM도 슬롯 공유는 안 함. 채워두면 panel만 지저분해짐)
  //   - PLAYBACK_SYNC: "지금 재생 중" 신호만 전파. ON.
  //     A가 재생/정지 누르면 B가 동일 곡을 자동 재생/정지. 자연 종료는 self-terminate.
  // 인증 토큰은 CCFOLIA가 이미 IndexedDB(firebaseLocalStorageDb)에 저장해 둔 idToken을
  // 그대로 빌려 쓴다. PATCH가 403이면 콘솔에 1회 경고 후 조용히 실패.
  const BGM_FIRESTORE_SHARE_ENABLED = true;        // 마스터 스위치 (둘 중 하나라도 켜져 있으면 폴링)
  const BGM_FIRESTORE_SLOT_SYNC_ENABLED = false;   // 슬롯 목록 동기화 (PATCH/DELETE/list)
  const BGM_FIRESTORE_PLAYBACK_SYNC_ENABLED = true; // 재생 신호 동기화 (단일 doc)
  const BGM_FIRESTORE_PROJECT_ID = "ccfolia-160aa";
  const BGM_FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${BGM_FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
  const BGM_FIRESTORE_SUBCOLLECTION = "capybaraToolkitBgm";
  const BGM_FIRESTORE_PLAYBACK_DOC_ID = "nowPlaying"; // Firestore 예약어(__*__) 회피
  const BGM_FIRESTORE_PLAYBACK_FRESH_MS = 30 * 60 * 1000; // 30분 이상 묵은 playing 신호는 무시(잔류 신호 자동복귀 방지)
  const BGM_FIRESTORE_POLL_INTERVAL_MS = 5000;
  const BGM_FIRESTORE_TOKEN_TTL_MS = 5 * 60 * 1000;
  const FIREBASE_AUTH_DB_NAME = "firebaseLocalStorageDb";
  const FIREBASE_AUTH_STORE_NAME = "firebaseLocalStorage";
  const MESSAGE_SCOPE_SELECTOR = '[role="log"], [aria-live="polite"], [aria-live="assertive"], .MuiDrawer-paper, ul.MuiList-root';
  const MESSAGE_ITEM_SELECTOR = 'li, [role="listitem"], .MuiListItem-root, [data-index]';
  const MESSAGE_TEXT_SELECTOR = [
    'p.MuiTypography-root.MuiTypography-body2',
    'div.MuiTypography-root.MuiTypography-body2',
    'p.MuiTypography-root',
    'div.MuiTypography-root',
    '.MuiListItemText-root > p',
    '.MuiListItemText-root > div',
    '[data-index] p',
    '[data-index] div.MuiTypography-root',
    'li p'
  ].join(", ");
  const CHAT_DRAWER_TITLE_RE = /룸\s*채팅|room\s*chat|チャット|chat/i;
  const BGM_DIALOG_KEYWORD_RE = /BGM|bgm|external\s*file|file\s*url|youtube|YouTube|유튜브|외부\s*파일|파일\s*URL|音?|サウンド|ル?プ|loop|volume/i;
  // 이전 패턴 /url|youtube|external|file|유튜브|외부|파일/i 는 "파일" / "file" 단독 매칭이라
  // 너무 헐거웠다. 이미지 라이브러리(전경/배경/캐릭터 등 선택 팝업)의 file 관련 라벨까지
  // 모두 BGM URL 입력으로 오인 → tryCenterCcfBgmDialogs가 팝업 크기 제한을 걸어
  // 팝업이 비좁아짐. BGM에서 실제로 쓰이는 "외부 파일 / 파일 URL / external file / file URL"
  // 같은 구체 문구로만 매칭하도록 좁힌다. (url, youtube, 유튜브는 단독 키워드로도 충분히 특이함)
  const BGM_INPUT_HINT_RE = /\burl\b|youtube|유튜브|external\s*file|file\s*url|외부\s*파일|파일\s*url/i;
  const CCF_SUITE_REGISTRY_KEY = "ccf-suite-registry-v1";
  const CCF_SUITE_SCRIPT_STATE_KEY = "ccf-suite-script-states-v1";
  const CCF_SUITE_REGISTER_EVENT = "ccf-suite:register";
  const CCF_SUITE_REQUEST_EVENT = "ccf-suite:request-register";
  const CCF_CHAT_NOTIFIER_SCRIPT_INFO = Object.freeze({
    id: "ccf-chat-notifier",
    name: "CCFOLIA Chat Notifier",
    version: getUserscriptVersion("0.2.40"),
    namespace: "https://greasyfork.org/ko/scripts/578091-ccf-chat-notifier-by-capybara-korea"
  });
  const MAX_KNOWN_MESSAGE_KEYS = 160;
  const SOUND_BASE64 = [
    "T2dnUwACAAAAAAAAAAD4ABszAAAAALAWSF0BHgF2b3JiaXMAAAAAAkSsAAAAAAAAAHECAAAAAAC4AU9nZ1MAAAAAAAAAAAAA+AAb",
    "MwEAAABGc6E2ES3/////////////////////A3ZvcmJpcx0AAABYaXBoLk9yZyBsaWJWb3JiaXMgSSAyMDA3MDYyMgAAAAABBXZv",
    "cmJpcylCQ1YBAAgAAAAxTCDFgNCQVQAAEAAAYCQpDpNmSSmllKEoeZiUSEkppZTFMImYlInFGGOMMcYYY4wxxhhjjCA0ZBUAAAQA",
    "gCgJjqPmSWrOOWcYJ45yoDlpTjinIAeKUeA5CcL1JmNuprSma27OKSUIDVkFAAACAEBIIYUUUkghhRRiiCGGGGKIIYcccsghp5xy",
    "CiqooIIKMsggg0wy6aSTTjrpqKOOOuootNBCCy200kpMMdVWY669Bl18c84555xzzjnnnHPOCUJDVgEAIAAABEIGGWQQQgghhRRS",
    "iCmmmHIKMsiA0JBVAAAgAIAAAAAAR5EUSbEUy7EczdEkT/IsURM10TNFU1RNVVVVVXVdV3Zl13Z113Z9WZiFW7h9WbiFW9iFXfeF",
    "YRiGYRiGYRiGYfh93/d93/d9IDRkFQAgAQCgIzmW4ymiIhqi4jmiA4SGrAIAZAAABAAgCZIiKZKjSaZmaq5pm7Zoq7Zty7Isy7IM",
    "hIasAgAAAQAEAAAAAACgaZqmaZqmaZqmaZqmaZqmaZqmaZpmWZZlWZZlWZZlWZZlWZZlWZZlWZZlWZZlWZZlWZZlWZZlWZZlWUBo",
    "yCoAQAIAQMdxHMdxJEVSJMdyLAcIDVkFAMgAAAgAQFIsxXI0R3M0x3M8x3M8R3REyZRMzfRMDwgNWQUAAAIACAAAAAAAQDEcxXEc",
    "ydEkT1It03I1V3M913NN13VdV1VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVWB0JBVAAAEAAAhnWaWaoAIM5BhIDRk",
    "FQCAAAAAGKEIQwwIDVkFAAAEAACIoeQgmtCa8805DprloKkUm9PBiVSbJ7mpmJtzzjnnnGzOGeOcc84pypnFoJnQmnPOSQyapaCZ",
    "0JpzznkSmwetqdKac84Z55wOxhlhnHPOadKaB6nZWJtzzlnQmuaouRSbc86JlJsntblUm3POOeecc84555xzzqlenM7BOeGcc86J",
    "2ptruQldnHPO+WSc7s0J4ZxzzjnnnHPOOeecc84JQkNWAQBAAAAEYdgYxp2CIH2OBmIUIaYhkx50jw6ToDHIKaQejY5GSqmDUFIZ",
    "J6V0gtCQVQAAIAAAhBBSSCGFFFJIIYUUUkghhhhiiCGnnHIKKqikkooqyiizzDLLLLPMMsusw84667DDEEMMMbTSSiw11VZjjbXm",
    "nnOuOUhrpbXWWiullFJKKaUgNGQVAAACAEAgZJBBBhmFFFJIIYaYcsopp6CCCggNWQUAAAIACAAAAPAkzxEd0REd0REd0REd0REd",
    "z/EcURIlURIl0TItUzM9VVRVV3ZtWZd127eFXdh139d939eNXxeGZVmWZVmWZVmWZVmWZVmWZQlCQ1YBACAAAABCCCGEFFJIIYWU",
    "Yowxx5yDTkIJgdCQVQAAIACAAAAAAEdxFMeRHMmRJEuyJE3SLM3yNE/zNNETRVE0TVMVXdEVddMWZVM2XdM1ZdNVZdV2Zdm2ZVu3",
    "fVm2fd/3fd/3fd/3fd/3fd/XdSA0ZBUAIAEAoCM5kiIpkiI5juNIkgSEhqwCAGQAAAQAoCiO4jiOI0mSJFmSJnmWZ4maqZme6ami",
    "CoSGrAIAAAEABAAAAAAAoGiKp5iKp4iK54iOKImWaYmaqrmibMqu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67qu67pA",
    "aMgqAEACAEBHciRHciRFUiRFciQHCA1ZBQDIAAAIAMAxHENSJMeyLE3zNE/zNNETPdEzPVV0RRcIDVkFAAACAAgAAAAAAMCQDEux",
    "HM3RJFFSLdVSNdVSLVVUPVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVdU0TdM0gdCQlQAAGQAA5KSm1HoOEmKQOYlB",
    "aAhJxBzFXDrpnKNcjIeQI0ZJ7SFTzBAEtZjQSYUU1OJaah1zVIuNrWRIQS22xlIh5agHQkNWCAChGQAOxwEcTQMcSwMAAAAAAAAA",
    "SdMATRQBzRMBAAAAAAAAwNE0QBM9QBNFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAcTQM0UQQ0UQQAAAAAAAAATRQB0VQB0TQBAAAAAAAAQBNFwDNFQDRVAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcTQM0UQQ0UQQAAAAAAAAATRQBUTUBTzQB",
    "AAAAAAAAQBNFQDRNQFRNAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAQ4AAAEWQqEhKwKAOAEAh+NAkiBJ8DSAY1nwPHgaTBPgWBY8D5oH0wQA",
    "AAAAAAAAAABA8jR4HjwPpgmQNA+eB8+DaQIAAAAAAAAAAAAgeR48D54H0wRIngfPg+fBNAEAAAAAAAAAAADwTBOmCdGEagI804Rp",
    "wjRhqgAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACAAQcAgAATykChISsCgDgBAIejSBIAADiSZFkAAKBIkmUBAIBlWZ4HAACSZXke",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAIABBwCAABPK",
    "QKEhKwGAKAAAh6JYFnAcywKOY1lAkiwLYFkATQN4GkAUAYAAAIACBwCAABs0JRYHKDRkJQAQBQDgcBTL0jRR5DiWpWmiyHEsS9NE",
    "kWVpmqaJIjRL00QRnud5pgnP8zzThCiKomkCUTRNAQAABQ4AAAE2aEosDlBoyEoAICQAwOE4luV5oiiKpmmaqspxLMvzRFEUTVNV",
    "XZfjWJbniaIomqaqui7L0jTPE0VRNE1VdV1omueJoiiapqq6LjRNFE3TNFVVVV0XmuaJpmmaqqqqrgvPE0XTNE1VdV3XBaJomqap",
    "qq7rukAUTdM0VdV1XReIomiapqq6rusC0zRNVVVd15VlgGmqqqq6riwDVFVVXdeVZRmgqqrquq4rywDXdV3ZlWVZBuC6rivLsiwA",
    "AODAAQAgwAg6yaiyCBtNuPAAFBqyIgCIAgAAjGFKMaUMYxJCCqFhTEJIIWRSUioppQpCKiWVUkFIpaRSMkotpZZSBSGVkkqpIKRS",
    "UikFAIAdOACAHVgIhYasBADyAAAIY5RizDnnJEJKMeaccxIhpRhzzjmpFGPOOeeclJIx55xzTkrJmHPOOSelZMw555yTUjrnnHMO",
    "SimldM4556SUUkLonHNSSimdc845AQBABQ4AAAE2imxOMBJUaMhKACAVAMDgOJalaZ4niqZpSZKmeZ4nmqZpapKkaZ4niqZpmjzP",
    "80RRFE1TVXme54miKJqmqnJdURRN0zRNVSXLoiiKpqmqqgrTNE3TVFVVhWmapmmqquvCtlVVVV3XdWHbqqqqruu6wHVd13VlGbiu",
    "67quLAsAAE9wAAAqsGF1hJOiscBCQ1YCABkAAIQxCCmEEFIGIaQQQkgphZAAAIABBwCAABPKQKEhKwGAcAAAgBCMMcYYY4wxNoxh",
    "jDHGGGOMMXEKY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhj",
    "jDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHG2FprrbVWABjOhQNAWYSNM6wknRWOBhcashIA",
    "CAkAAIxBiDHoJJSSSkoVQow5KCWVllqKrUKIMQilpNRabDEWzzkHoaSUWooptuI556Sk1FqMMcZaXAshpZRaiy22GJtsIaSUUmsx",
    "xlpjM0q1lFqLMcYYayxKuZRSa7HFGGuNRSibW2sxxlprrTUp5XNLsdVaY6y1JqOMkjHGWmustdYilFIyxhRTrLXWmoQwxvcYY6wx",
    "51qTEsL4HlMtsdVaa1JKKSNkjanGWnNOSglljI0t1ZRzzgUAQD04AEAlGEEnGVUWYaMJFx6AQkNWAgC5AQAIQkoxxphzzjnnnHMO",
    "UqQYc8w55yCEEEIIIaQIMcaYc85BCCGEEEJIGWPMOecghBBCCKGEklLKmHPOQQghhFJKKSWl1DnnIIQQQiillFJKSqlzzkEIIYRS",
    "SimllJRSCCGEEEIIpZRSSikppZRCCCGEEkoppZRSUkophRBCCKWUUkoppaSUUgohhBBKKaWUUkpJKaUUQgmllFJKKaWUklJKKaUQ",
    "SimllFJKKSWllFJKpZRSSimllFJKSimllEoppZRSSimllJRSSimVUkoppZRSSikppZRSSqmUUkoppZRSUkoppZRSKaWUUkoppaSU",
    "UkoppVJKKaWUUkpJKaWUUkqllFJKKaWUklJKKaWUUiqllFJKKaUAAKADBwCAACMqLcROM648AkcUMkxAhYasBADIAAAQB7G01lqr",
    "jHLKSUmtQ0Ya5qCk2EkHIbVYS2UgQcpJSp2CCCkGqYWMKqWYk5ZCy5hSDGIrMXSMMUc55VRCxxgAAACCAAADETITCBRAgYEMADhA",
    "SJACAAoLDB3DRUBALiGjwKBwTDgnnTYAAEGIT2dnUwABAAAAAAAAAAD4ABszAgAAAHodOF0BkcwQiYjFIDGhGigqpgOAxQWGfADI",
    "0NhIu7iALgNc0MVdB0IIQhCCWBxAAQk4OOGGJ97whBucoFNU6kAAAAAAAB4A4AEAINkAIiKimePo8PgACREZISkxOUERAAAAAAA7",
    "APgAAEhSgIiIaOY4Ojw+QEJERkhKTE5QAgAAAQQAAAAAQAABCAgIAAAAAAAEAAAACAhPZ2dTAASVHQAAAAAAAPgAGzMDAAAA/dsW",
    "HxFL/1H/Lf86/w3/Df8T/1D/j+wR85w4nZsftuVasa651GD1t3D1B8DmjAGwb3W6zuZu7Hvz09Pe6Nlsfs6kOq/sql408VnwKPeO",
    "AlaE0c1MT65NN6RoYQUcpxCoAJr2XLO3f0N9TJhAW/QIbpIC8WvABv4AgAIALKutb62mDQulGAAAAABAZmm/RK6L04gEAEBJPpVR",
    "qEHmbn2my5MMJMysrbHrxqK0e7eFUxftuPOd45zjxXnz+t1358mJBsADXAIz3TPd+4WZ3c/T+98z0wUB1N87GzR8ea76wzfVyVyk",
    "k5qZA5VnZjfVd052NueksorbTbnv2b8eF47i/vRDtM5rnmU+6/F7uvePF1k+60ziHpbDT1soourknj/JT3dzuO/4t+vDqZM9PVOG",
    "yqbJqp9crR3sfNlf6/+iGjQF87a3r1/b1aegwXlO94HMqZx3fPu5ibU2eegvyQYx/Ug/tSwxpigvxxYzU9ND5SmahYRmmOGHhu4E",
    "4Geh2PX8OT4tM/d3X4GfAScQqigNhnffRXPovNUmxaT/otfbvl+82fewNJTVF6VIEYtCA8mOAJ4XPTbpJjJp6hrIJ3wwN503zV0U",
    "0sSrwRECRwE9AIBdVet925qqqpIAAAAAADJlPupa0jr7ELXIBIDpyVRIxxTLCRFGLJQvRdz03sWaUqb52bO8TqeHT58+bapoTc1h",
    "29Qc/LpuAbx3POMBh/eJvTgAwLnOnAf1sedZeDPV/y5yxiQCODfZVJ1pch8Cr/mY8tkP01Pn1xbAb+nPGS9xf8bf+kGZbO39+dVd",
    "sg24NRtOx9PXJjq/8V1D9fl7fd8ZKp6pU6f76fM9y7PUVLV2pO4+ZOacWv0ynvHQC1q6zx27lUgXDABMn5p6umrW1TSY6euYfp8P",
    "kJ4uGDBctwI+eTs644b53MJsA2z4WabHp9mHc4G9hPVnnXn+A0s6wD08fNHudv/OWTyezgTlAd7m7Jt0yBXuTwvMJi2+t2jZpJtM",
    "GfGEjSNV2E9sv49MVU1bq4WGmqoSAAAA2Gq8jdo4WCRp9UmDAAR5trnN7UZpVl93fN/YWzFstoWNtlq3NfOZyyy3owX3Vc+nlhWK",
    "eHH0vdxyFQip25+u333+jrOsBQCAqysg4IMrngPunedx76F4f10BjvstvIehYYCkeQb3d3A8x3MfuMc0CctJugcxNG++MJ1wYKbe",
    "5+TQU9m8D5PMybyHpq/Tu+uiel087nfmQMQkWpPKRwbVD3uvzflUTjJjmvdlzApge6B15v/08GV76KSNpXua/Y9Mr00utwvNNLOp",
    "/b1j27lQ/yFjZ/LCsHQOs99TlJtaUPGU/f3evpnx73C/Xzv15e8cAxC2DQDoBgNIWHG0s4reEc4DoEU4DhIAAY0FIAD+BnXT099/",
    "D3e//iGJQjGudVSzf/r5P9R6f7jpFlU/7GeTJlu8YwAIqWp9Va1VUhAAACA+srXa2JlSV2oWO623AAq1C7u7k7x5/o2Vn65PWDFk",
    "e2erD/eZ6RkaTcEkvoWkM7Lt2q2HK+kQb51ynak/dmZyeSGTBpgZAA4A+wAcwIM9CItxCoHnDcEg1jnnOdP4P7dzX10ARXa++cDP",
    "hhRHyzoC5Qvw43OzE79FPRvdz86PiAzi/dPAa0q7650p4KRWZ+8cN5Mx9bOxc//FMesyjd16+x9/f7MFOLB1sPuFcuWYRJ3sIQtu",
    "XhizzzEt5AgAW0mqDaCfQTJIBmTZbWlywcdJFPG0XgmAggcAXjfV27f//1bB+WemQy6TZ43XT9//y5X3f+IBnPH1wzyPn963BpKy",
    "Uq1Tp1omAIwMUFU1a61qTAAAAADMt3tnZlvfeNynQx/L9cVX/2P85OiNMYO3XrZjRCADnp8BgM55FhZnyKtfcuwXkolhlrx6qpmh",
    "4qjDau486PiSRkK4BADwAPAAcDjg4oEFDuDh0rtzPIMPuATzJwPfDtwyo3bj/n5QPYP30G9WFycaZ31NC6QrCycRfUWdCTPJrhRw",
    "HnJiiKlkqIo4hxwm8zhP3bnprgZXTfGWI6DgoeWuf7Gn6MwPL92m2VsUdNXzg4ZMugaeHfY7v8579x7MYs3qAsxPLXvMiwEwrLsP",
    "/AQyAD5HxZcfP0ObcX8dQzbk9fZZ3fPHz/BUuN9GnqKheHHGf77jd0cDGACAyARBSAmp1mrRUAoAAAAgp/+bhZOJHD3ydf1F34vp",
    "w+jMDG4BsDqYLfoJAABUP8mMaypN9/+nZ9TCQYZ1TsY83+FBd82SdCfb0xv3fceFJ9rZkXFsdB9Xd2WUA2ABAGABDvxgOXAAwMMB",
    "/nl///gMANTtfbi5D43/GcZV0zTZVxXVzZApumAOcV4Jee4kZspe3peJaTudKvrMJqXrGTphKhd6Tld1DDc/9nN8yfhbyjrmU9r+",
    "KDsz8zSpbubNwfbPikds7Po2k3Qls6drZoqjBr41Lwwkrcy89gaRkWFpH+jXDBBa8UvAAQCe5iSPL3/DPsn7n2erEsf1DSpubz/D",
    "a85+miK5c01TaLK0R093EAAAGFVV1bbaqpkGxQwAAPzeqe23f/F78+b398dG7l9PWI+feJkCqZFjcbYW2o8EAMD7jvry3UV5jBY/",
    "5mdLH5IKAGQZDm7qySL3YuL4L4ndiBcwVe1zKwrby25PEfzvED9rFXg/FBC3l+7hgAfgAcDB8Xg4DgAe7nDYn4LhDD+5wTBntseF",
    "3XbOMdwx8niz9rjzAC7lMtD1TpVmYr/AtUmgkkP1KJked346l57T0wLnKS4P1T1J9aj2/qFOz/gjlybS+jt3YX/F04XmjNW9uT3M",
    "GW4OA5z0AMmczGdDXewG6PwhCxif59gFY8vhPwI/p+4+3tyOmepvTTMkxf6b2P2d6wEDFEh6G2zZTrqL0voeDeAYCZBpnLcu6Qrh",
    "1oYvAf5Es88gCOAUAL5lZMvD36DfHUPCNcRUsoziuIrfA4N5G7gYHtgP2sByVBQdbdUiLEK6qgEAwHoa1dUhhVwyRRRahlqsHi+r",
    "6zx5lZsv74nbra0dX8looxXPlDmbrZnV893DU2limXV7xjnO9XiamB3q+uH1aXItx5T9+HDv49/f+/Cy0dM5cjwU87yNozhyQ+1+",
    "l1W1D1lkkZW48fM/kXled/Uj+N9XzH8HE45923tLeVyYx5/fO7+fSuZ5m82vXxZT0X0VWf3/vQ8wZ9P/rutmf6+pfv9+NrAHGeTB",
    "fd2R6fd5m5F1pqei+CqmK89AD2Sx78uLs9cgTiqpdAPMYXpQfH0/Z5Lpt7PkhGmy+v350+8zAFlpr3C/z2YyYvN/xpRlH7uYsnA+",
    "d1LJ2ed9poGsLKjr7K7fr67u3JVfeWcBQIOs9/HL9ZtXU2xi//OwkwX0riyyRvF19gFgemBaI6pCAEAA9NtAKUmZeiNA/l8QLpML",
    "AABAv11O0q/xKAsqP0ilvxVoybg2ZFW7CYkU8k4A7xIAeQUA",
  ].join("");
  const UNREAD_PATTERNS = [
    /^\s*\((\d+)\)/,
    /^\s*（(\d+)）/,
    /^\s*\[(\d+)\]/,
    /^\s*［(\d+)］/,
    /^\s*【(\d+)】/,
    /^\s*<(\d+)>/,
    /^\s*＜(\d+)＞/
  ];

  let chatNotifierActive = true;
  let ccfChatNotifierDebugApi = null;
  const teardownDisposers = [];
  const teardownAbortController = new AbortController();
  const teardownSignal = teardownAbortController.signal;

  function registerTeardown(disposer) {
    if (typeof disposer === "function") {
      teardownDisposers.push(disposer);
    }
  }

  function withTeardownSignal(options) {
    if (options == null) {
      return { signal: teardownSignal };
    }
    if (typeof options === "boolean") {
      return { capture: options, signal: teardownSignal };
    }
    if (typeof options === "object") {
      if (options.signal && options.signal !== teardownSignal) {
        return options;
      }
      return { ...options, signal: teardownSignal };
    }
    return { signal: teardownSignal };
  }

  function runChatNotifierTeardown() {
    if (!chatNotifierActive) return false;
    chatNotifierActive = false;
    try {
      teardownAbortController.abort();
    } catch (error) {
      debugLog("teardown-abort-failed", serializeError(error));
    }
    while (teardownDisposers.length) {
      const disposer = teardownDisposers.pop();
      try {
        disposer();
      } catch (error) {
        debugLog("teardown-disposer-failed", serializeError(error));
      }
    }
    try {
      if (typeof ccfBgmProgressTimer === "number" && ccfBgmProgressTimer) {
        window.clearTimeout(ccfBgmProgressTimer);
        ccfBgmProgressTimer = 0;
      }
      if (typeof titleChangeTimer === "number" && titleChangeTimer) {
        window.clearTimeout(titleChangeTimer);
        titleChangeTimer = 0;
      }
      if (typeof focusSyncTimer === "number" && focusSyncTimer) {
        window.clearTimeout(focusSyncTimer);
        focusSyncTimer = 0;
      }
      if (typeof ccfBgmDomEnhanceTimer === "number" && ccfBgmDomEnhanceTimer) {
        window.clearTimeout(ccfBgmDomEnhanceTimer);
        ccfBgmDomEnhanceTimer = 0;
      }
    } catch (error) {
      debugLog("teardown-timer-clear-failed", serializeError(error));
    }
    try {
      document.getElementById("ccf-bgm-enhancer-style")?.remove();
      document.getElementById("ccf-youtube-bgm-player")?.remove();
      document.querySelectorAll([
        ".ccf-bgm-progress-root",
        ".ccf-bgm-progress-break",
        ".ccf-bgm-native-tooltip",
        ".ccf-youtube-bgm-player-dock",
        ".ccf-youtube-bgm-popover",
        ".ccf-youtube-bgm-preview-host",
        ".ccf-youtube-bgm-drag-clone",
        ".ccf-youtube-bgm-list",
        ".ccf-youtube-bgm-row-wrap",
        '[data-ccf-youtube-bgm-registered]',
        '[data-ccf-bgm-share]'
      ].join(", ")).forEach((el) => {
        if (el.matches?.('[data-ccf-youtube-bgm-registered], [data-ccf-bgm-share]')) {
          el.removeAttribute("data-ccf-youtube-bgm-registered");
          el.removeAttribute("data-ccf-bgm-share");
          return;
        }
        el.remove();
      });
      document.querySelectorAll([
        '[data-ccf-bgm-drawer-size-lock]',
        '[data-ccf-bgm-panel]',
        '[data-ccf-bgm-button-row]',
        '[data-ccf-bgm-progress-host]',
        '[data-ccf-bgm-progress-flow]',
        '[data-ccf-bgm-dialog-root]',
        '[data-ccf-bgm-dialog-paper]',
        '[data-ccf-bgm-slot-key]'
      ].join(", ")).forEach((el) => {
        el.removeAttribute("data-ccf-bgm-drawer-size-lock");
        el.removeAttribute("data-ccf-bgm-panel");
        el.removeAttribute("data-ccf-bgm-button-row");
        el.removeAttribute("data-ccf-bgm-progress-host");
        el.removeAttribute("data-ccf-bgm-progress-flow");
        el.removeAttribute("data-ccf-bgm-dialog-root");
        el.removeAttribute("data-ccf-bgm-dialog-paper");
        el.removeAttribute("data-ccf-bgm-slot-key");
      });
      ccfBgmPlayerDock?.remove?.();
      ccfBgmPlayerDock = null;
      ccfBgmPlayerHost = null;
      try { ccfBgmPlayer?.destroy?.(); } catch (error) { /* youtube player teardown */ }
      ccfBgmPlayer = null;
      ccfBgmPlayerReady = false;
    } catch (error) {
      debugLog("teardown-dom-sweep-failed", serializeError(error));
    }
    try {
      if (notificationAudio) {
        notificationAudio.pause?.();
        notificationAudio.src = "";
        notificationAudio = null;
      }
    } catch (error) {
      debugLog("teardown-audio-cleanup-failed", serializeError(error));
    }
    try {
      if (window.__CCF_CHAT_NOTIFIER_DEBUG__ === ccfChatNotifierDebugApi) {
        delete window.__CCF_CHAT_NOTIFIER_DEBUG__;
      }
    } catch (error) {
      debugLog("teardown-debug-api-cleanup-failed", serializeError(error));
    }
    return true;
  }

  registerWithCcfSuite(CCF_CHAT_NOTIFIER_SCRIPT_INFO);
  window.addEventListener(CCF_SUITE_REQUEST_EVENT, handleCcfSuiteRegisterRequest, withTeardownSignal());
  if (!isCcfSuiteScriptEnabled(CCF_CHAT_NOTIFIER_SCRIPT_INFO.id)) {
    return;
  }

  if (!ROOM_PATH_RE.test(location.pathname)) {
    return;
  }

  let titleObserver = null;
  let headObserver = null;
  let chatObserver = null;
  let titleChangeTimer = 0;
  let focusSyncTimer = 0;

  let readyAt = Date.now();
  let lastTitle = "";
  let lastUnreadCount = null;
  let lastNotifiedKey = "";
  let lastNotifyAt = 0;
  let notificationAudio = null;
  let notificationAudioUrl = "";
  let soundUnlocked = false;
  let didGestureProbe = false;
  let lastAudioError = null;
  let lastPlayError = null;
  let windowFocused = document.hasFocus();

  const knownMessageKeySet = new Set();
  const knownMessageElementKeys = new WeakMap();
  const ccfBgmSlotMap = new Map();

  let ccfBgmObserver = null;
  let ccfBgmEventsBound = false;
  let ccfBgmEnhancerInitialized = false;
  let ccfBgmStorageLoaded = false;
  let ccfBgmStorageLoadPromise = null;
  let ccfBgmStorageMigratedFromLocal = false;
  let ccfBgmDeletedEntries = {};
  const CCF_BGM_TOOLKIT_FEATURE_ID = "ccf-chat-notifier";
  const CCF_BGM_TOOLKIT_ROOM_KEY = "__global_library__"; // Toolkit 저장소 키도 전역으로 변경
  let ccfBgmApiReadyPromise = null;
  let ccfBgmPlayer = null;
  let ccfBgmPlayerHost = null;
  let ccfBgmPlayerDock = null;
  let ccfBgmPlayerVisible = false;
  let ccfBgmPlayerVideoId = "";
  let ccfBgmPlayerReady = false;
  let ccfBgmActiveSlotKey = "";
  let ccfBgmActiveEntryKey = "";
  const CCF_BGM_ACTIVE_KEY = "ccf-chat-notifier:youtube-bgm:active";

  function persistCcfBgmActiveSlot(slotKey, entryKey, videoId, state = "playing") {
    try {
      if (!slotKey || !entryKey) {
        window.localStorage.removeItem(CCF_BGM_ACTIVE_KEY);
        return;
      }
      window.localStorage.setItem(CCF_BGM_ACTIVE_KEY, JSON.stringify({
        slotKey,
        entryKey,
        videoId: videoId || "",
        state,
        updatedAt: Date.now()
      }));
    } catch (_) { /* persist 실패는 무시 — 새로고침 후 fallback 정렬로 cue */ }
  }

  // ccfBgmActiveSlotKey reset 시점에 entry 정보는 유지하되 state 만 갱신.
  // 새로고침 후 자동재생 여부 판단을 위해 last state 보존.
  function updateCcfBgmPersistedState(state) {
    try {
      const raw = window.localStorage.getItem(CCF_BGM_ACTIVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.entryKey !== "string") return;
      parsed.state = state;
      parsed.updatedAt = Date.now();
      window.localStorage.setItem(CCF_BGM_ACTIVE_KEY, JSON.stringify(parsed));
    } catch (_) {}
  }

  function readCcfBgmPersistedActiveSlot() {
    try {
      const raw = window.localStorage.getItem(CCF_BGM_ACTIVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.entryKey === "string" ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  let ccfBgmActiveLoop = true;
  let ccfBgmLastControlSeed = null;
  let ccfBgmEditingSlotKey = "";
  let ccfBgmLastDialogSlotKey = "";
  let ccfBgmLastBgmClickAt = 0;
  let ccfBgmNativeEditGraceUntil = 0;
  let ccfSuppressStopHandlerUntil = 0;
  const ccfBgmNativeLoadedSlots = new Set();
  const ccfBgmKnownNativeMedia = new Set();
  const ccfBgmNativeMediaListeners = new WeakSet();
  const ccfBgmCreationTrackedMedia = new WeakSet();
  let ccfBgmProgressRoot = null;
  let ccfBgmProgressTimer = 0;
  let ccfBgmDomEnhanceTimer = 0;
  let ccfBgmNativeTooltipEl = null;
  let ccfBgmNativeTooltipButton = null;
  let ccfBgmPreviewPlayer = null;
  let ccfBgmPreviewHost = null;
  let ccfBgmPreviewVideoId = "";
  let ccfBgmPreviewActive = false;
  let ccfBgmPreviewResumeMain = false;
  let ccfBgmLastNativeMedia = null;
  let ccfBgmLastWebAudio = null;
  let ccfBgmAudioContextNow = null;
  let ccfBgmEditPopover = null;
  let ccfYoutubeBgmDragState = null;
  let ccfYoutubeBgmSuppressClickUntil = 0;
  const ccfBgmTitleFetchMap = new Map();

  init();

  function init() {
    exposeDebugApi();
    bindForegroundEvents();
    bindAudioUnlockEvents();
    syncTitleState();
    observeTitle();
    observeChatMessages();
    scheduleCcfBgmEnhancerInit();
    debugLog("init", {
      version: "0.2.76",
      href: location.href,
      title: document.title || ""
    });
  }

  function handleCcfSuiteRegisterRequest(event) {
    const targetId = event?.detail?.targetId;
    if (targetId && targetId !== CCF_CHAT_NOTIFIER_SCRIPT_INFO.id) return;
    registerWithCcfSuite(CCF_CHAT_NOTIFIER_SCRIPT_INFO);
  }

  function getUserscriptVersion(fallbackVersion) {
    try {
      const runtimeVersion = typeof GM_info !== "undefined" && typeof GM_info?.script?.version === "string"
        ? GM_info.script.version.trim()
        : "";
      return runtimeVersion || fallbackVersion;
    } catch (error) {
      return fallbackVersion;
    }
  }

  function registerWithCcfSuite(scriptInfo) {
    try {
      const registry = readCcfSuiteRegistry();
      const previous = registry.scripts[scriptInfo.id] && typeof registry.scripts[scriptInfo.id] === "object"
        ? registry.scripts[scriptInfo.id]
        : {};
      const now = new Date().toISOString();
      const sessionId = typeof window.__CCF_SUITE_MANAGER_SESSION_ID === "string"
        ? window.__CCF_SUITE_MANAGER_SESSION_ID
        : "";

      registry.scripts[scriptInfo.id] = {
        ...previous,
        ...scriptInfo,
        installedAt: previous.installedAt || now,
        lastSeenAt: now,
        lastSeenUrl: location.href,
        lastSeenSessionId: sessionId
      };

      window.localStorage.setItem(CCF_SUITE_REGISTRY_KEY, JSON.stringify(registry));
      window.dispatchEvent(
        new CustomEvent(CCF_SUITE_REGISTER_EVENT, {
          detail: registry.scripts[scriptInfo.id]
        })
      );
    } catch (error) {
      // Ignore suite registration failures.
    }
  }

  function readCcfSuiteRegistry() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CCF_SUITE_REGISTRY_KEY) || "{}");
      return parsed && typeof parsed.scripts === "object"
        ? { scripts: parsed.scripts }
        : { scripts: {} };
    } catch (error) {
      return { scripts: {} };
    }
  }

  function isCcfSuiteScriptEnabled(scriptId) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(CCF_SUITE_SCRIPT_STATE_KEY) || "{}");
      return !parsed || typeof parsed !== "object" || parsed[scriptId] !== false;
    } catch (error) {
      return true;
    }
  }

  function bindForegroundEvents() {
    window.addEventListener("focus", handleWindowFocus, withTeardownSignal(true));
    window.addEventListener("blur", handleWindowBlur, withTeardownSignal(true));
    window.addEventListener("pageshow", handleForegroundSync, withTeardownSignal(true));
    document.addEventListener("visibilitychange", handleVisibilityChange, withTeardownSignal(true));
  }

  function bindAudioUnlockEvents() {
    const unlock = () => {
      primeNotificationSound("user-gesture", true);
    };

    document.addEventListener("pointerdown", unlock, withTeardownSignal({ capture: true, passive: true }));
    document.addEventListener("keydown", unlock, withTeardownSignal(true));
  }

  function handleWindowFocus() {
    windowFocused = true;
    handleForegroundSync();
  }

  function handleVisibilityChange() {
    windowFocused = document.hasFocus();
    debugLog("visibility-change", getFocusState());
    handleForegroundSync();
  }

  function handleForegroundSync() {
    debugLog("foreground-sync", getFocusState());

    if (isRoomUnfocused()) {
      return;
    }

    window.clearTimeout(focusSyncTimer);
    focusSyncTimer = window.setTimeout(() => {
      syncTitleState();
      primeKnownMessageKeys();
      lastNotifiedKey = "";
    }, FOCUS_SYNC_DELAY_MS);
  }

  function handleWindowBlur() {
    windowFocused = false;
    debugLog("window-blur", getFocusState());
  }

  function observeTitle() {
    attachHeadObserver();
    attachTitleObserver(document.querySelector("head > title"));
  }

  function attachHeadObserver() {
    const head = document.head;
    if (!head || headObserver) {
      if (!head) {
        window.setTimeout(attachHeadObserver, 50);
      }
      return;
    }

    headObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList") {
          continue;
        }

        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "TITLE") {
            attachTitleObserver(node);
            scheduleTitleCheck();
          }
        });

        mutation.removedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "TITLE") {
            detachTitleObserver();
          }
        });
      }
    });

    headObserver.observe(head, {
      childList: true,
      subtree: false
    });
    registerTeardown(() => {
      headObserver?.disconnect();
      headObserver = null;
    });
  }

  function attachTitleObserver(titleElement) {
    if (!titleElement) {
      return;
    }

    detachTitleObserver();

    titleObserver = new MutationObserver(() => {
      scheduleTitleCheck();
    });

    titleObserver.observe(titleElement, {
      characterData: true,
      childList: true,
      subtree: true
    });
  }

  function detachTitleObserver() {
    if (!titleObserver) {
      return;
    }

    titleObserver.disconnect();
    titleObserver = null;
  }

  function scheduleTitleCheck() {
    window.clearTimeout(titleChangeTimer);
    titleChangeTimer = window.setTimeout(() => {
      handleTitleChange(readTitle());
    }, TITLE_DEBOUNCE_MS);
  }

  function handleTitleChange(nextTitle) {
    const normalizedTitle = normalizeSpace(nextTitle);
    if (!normalizedTitle || normalizedTitle === lastTitle) {
      return;
    }

    const previousTitle = lastTitle;
    const previousUnreadCount = lastUnreadCount;
    const nextUnreadCount = extractUnreadCount(normalizedTitle);

    lastTitle = normalizedTitle;
    lastUnreadCount = nextUnreadCount;

    debugLog("title-changed", {
      previousTitle,
      nextTitle: normalizedTitle,
      previousUnreadCount,
      nextUnreadCount,
      focus: getFocusState()
    });

    if (!canNotifyNow()) {
      return;
    }

    if (!shouldNotify(previousTitle, normalizedTitle, previousUnreadCount, nextUnreadCount)) {
      return;
    }

    notifyAboutMessage("title");
  }

  function shouldNotify(previousTitle, nextTitle, previousUnreadCount, nextUnreadCount) {
    if (nextUnreadCount !== null) {
      if (previousUnreadCount !== null && nextUnreadCount <= previousUnreadCount) {
        return false;
      }
      return isFreshNotificationKey(`count:${nextUnreadCount}`);
    }

    if (!previousTitle) {
      return false;
    }

    if (stripUnreadPrefix(previousTitle) === stripUnreadPrefix(nextTitle)) {
      return false;
    }

    if (Date.now() - lastNotifyAt < FALLBACK_THROTTLE_MS) {
      return false;
    }

    return isFreshNotificationKey(`title:${nextTitle}`);
  }

  function isFreshNotificationKey(suffix) {
    const key = `${location.pathname}|${suffix}`;
    if (key === lastNotifiedKey) {
      return false;
    }
    lastNotifiedKey = key;
    return true;
  }

  function notifyAboutMessage(reason = "unknown") {
    lastNotifyAt = Date.now();
    debugLog("notify", {
      reason,
      title: lastTitle,
      unreadCount: lastUnreadCount,
      focus: getFocusState()
    });
    playNotificationSound(reason);
  }

  function observeChatMessages() {
    if (!document.body) {
      window.setTimeout(observeChatMessages, 50);
      return;
    }

    if (chatObserver) {
      return;
    }

    primeKnownMessageKeys();
    debugLog("chat-observer-attached", {
      scopeCount: findChatMessageScopes().length
    });

    chatObserver = new MutationObserver((mutations) => {
      const candidates = new Set();

      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const parent = mutation.target?.parentElement;
          const owner = findMessageItemRoot(parent);
          if (owner) {
            candidates.add(owner);
          }
          continue;
        }

        if (mutation.type === "childList") {
          if (mutation.target instanceof HTMLElement) {
            const targetItem = findMessageItemRoot(mutation.target);
            if (targetItem) {
              candidates.add(targetItem);
            }
          }

          mutation.addedNodes.forEach((node) => {
            collectCandidateMessageItems(node, candidates);
          });
        }
      }

      if (!candidates.size) {
        return;
      }

      candidates.forEach((itemRoot) => {
        if (BGM_CHAT_SHARE_ENABLED) {
          ccfBgmShareInspectChatItem(itemRoot);
        }
        registerMessageItem(itemRoot, true);
      });
    });

    chatObserver.observe(document.body, {
      characterData: true,
      childList: true,
      subtree: true
    });
    registerTeardown(() => {
      chatObserver?.disconnect();
      chatObserver = null;
    });
    registerTeardown(() => detachTitleObserver());
  }

  function collectCandidateMessageItems(node, out) {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    const directItem = findMessageItemRoot(node);
    if (directItem) {
      out.add(directItem);
    }

    if (node.matches?.(MESSAGE_ITEM_SELECTOR)) {
      out.add(node);
    }

    if (node.matches?.(MESSAGE_TEXT_SELECTOR)) {
      const owner = findMessageItemRoot(node);
      if (owner) {
        out.add(owner);
      }
    }

    node.querySelectorAll?.(MESSAGE_ITEM_SELECTOR).forEach((item) => {
      if (item instanceof HTMLElement) {
        out.add(item);
      }
    });

    node.querySelectorAll?.(MESSAGE_TEXT_SELECTOR).forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }

      const owner = findMessageItemRoot(element);
      if (owner) {
        out.add(owner);
      }
    });
  }

  function primeKnownMessageKeys() {
    const items = findCurrentMessageItems();
    items.forEach((itemRoot) => {
      registerMessageItem(itemRoot, false);
    });
    debugLog("prime-known-messages", {
      count: items.length,
      knownKeys: knownMessageKeySet.size
    });
  }

  function findCurrentMessageItems() {
    const out = [];
    const seen = new Set();

    findChatMessageScopes().forEach((scope) => {
      if (!(scope instanceof HTMLElement)) {
        return;
      }

      if (scope.matches?.(MESSAGE_ITEM_SELECTOR) && isPotentialMessageItem(scope)) {
        seen.add(scope);
        out.push(scope);
      }

      scope.querySelectorAll?.(MESSAGE_ITEM_SELECTOR).forEach((item) => {
        if (!(item instanceof HTMLElement)) {
          return;
        }
        if (seen.has(item)) {
          return;
        }
        if (!isPotentialMessageItem(item)) {
          return;
        }

        seen.add(item);
        out.push(item);
      });
    });

    return out;
  }

  function findChatMessageScopes() {
    const scopes = new Set();
    const drawers = [...document.querySelectorAll(".MuiDrawer-paper")]
      .filter((drawer) => drawer instanceof HTMLElement)
      .filter((drawer) => looksLikeChatDrawer(drawer));
    const roots = drawers.length ? drawers : [document.body];

    roots.forEach((root) => {
      if (!(root instanceof HTMLElement)) {
        return;
      }

      if (root.matches?.(MESSAGE_SCOPE_SELECTOR) && isChatMessageScope(root)) {
        scopes.add(root);
      }

      root.querySelectorAll?.(MESSAGE_SCOPE_SELECTOR).forEach((scope) => {
        if (scope instanceof HTMLElement && isChatMessageScope(scope)) {
          scopes.add(scope);
        }
      });
    });

    return [...scopes];
  }

  function isChatMessageScope(scope) {
    if (!(scope instanceof HTMLElement)) {
      return false;
    }
    if (!isVisible(scope)) {
      return false;
    }

    const drawer = scope.closest(".MuiDrawer-paper");
    if (drawer instanceof HTMLElement) {
      return looksLikeChatDrawer(drawer);
    }

    return looksLikeChatDrawer(scope);
  }

  function looksLikeChatDrawer(root) {
    if (!(root instanceof HTMLElement) || !isVisible(root)) {
      return false;
    }

    const headings = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .map((node) => normalizeSpace(node.textContent || ""))
      .filter(Boolean)
      .join(" ");
    if (CHAT_DRAWER_TITLE_RE.test(headings)) {
      return true;
    }

    const hasEditor = !!root.querySelector('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
    const hasSubmit = [...root.querySelectorAll('button[type="submit"]')]
      .some((button) => {
        const label = normalizeSpace(button.textContent || button.getAttribute("aria-label") || "");
        return !label || /전송|send|送信/i.test(label);
      });
    return hasEditor && hasSubmit;
  }

  function registerMessageItem(itemRoot, allowNotify) {
    if (!isPotentialMessageItem(itemRoot)) {
      return false;
    }

    const key = buildMessageKey(itemRoot);
    if (!key) {
      return false;
    }

    const previousElementKey = knownMessageElementKeys.get(itemRoot) || "";
    if (previousElementKey === key) {
      return false;
    }
    knownMessageElementKeys.set(itemRoot, key);

    if (knownMessageKeySet.has(key)) {
      return false;
    }

    knownMessageKeySet.add(key);
    trimKnownMessageKeys();

    debugLog("message-item-registered", {
      allowNotify,
      key,
      textPreview: extractMessageText(itemRoot).slice(0, 120),
      focus: getFocusState()
    });

    if (!allowNotify || !canNotifyNow()) {
      return false;
    }
    if (!isFreshNotificationKey(`dom:${key}`)) {
      return false;
    }

    notifyAboutMessage(`dom:${key}`);
    return true;
  }

  function trimKnownMessageKeys() {
    if (knownMessageKeySet.size <= MAX_KNOWN_MESSAGE_KEYS) {
      return;
    }

    const staleKeys = [...knownMessageKeySet].slice(0, knownMessageKeySet.size - MAX_KNOWN_MESSAGE_KEYS);
    staleKeys.forEach((key) => {
      knownMessageKeySet.delete(key);
    });
  }

  function isPotentialMessageItem(itemRoot) {
    if (!(itemRoot instanceof HTMLElement) || !isVisible(itemRoot)) {
      return false;
    }
    if (!itemRoot.closest(MESSAGE_SCOPE_SELECTOR)) {
      return false;
    }
    if (!isChatMessageScope(itemRoot.closest(MESSAGE_SCOPE_SELECTOR))) {
      return false;
    }
    if (itemRoot.closest('button, form, [role="dialog"]')) {
      return false;
    }
    if (itemRoot.closest('textarea, input, [contenteditable="true"], [role="textbox"]')) {
      return false;
    }

    const nestedItem = itemRoot.parentElement?.closest?.(MESSAGE_ITEM_SELECTOR) || null;
    if (nestedItem instanceof HTMLElement && nestedItem !== itemRoot) {
      return false;
    }

    return !!extractMessageText(itemRoot);
  }

  function buildMessageKey(itemRoot) {
    if (!(itemRoot instanceof HTMLElement)) {
      return "";
    }

    const scope = itemRoot.closest(MESSAGE_SCOPE_SELECTOR);
    const text = extractMessageText(itemRoot);
    if (!text) {
      return "";
    }

    const stableId = normalizeSpace(
      itemRoot.getAttribute("data-index")
      || itemRoot.getAttribute("data-id")
      || itemRoot.id
      || ""
    );
    if (stableId) {
      return `id:${stableId}@@${text.slice(0, 240)}`;
    }

    const itemCount = scope instanceof HTMLElement
      ? scope.querySelectorAll(MESSAGE_ITEM_SELECTOR).length
      : 0;
    return `count:${itemCount}@@${text.slice(0, 240)}`;
  }

  function extractMessageText(itemRoot) {
    const textElement = findPrimaryMessageTextElement(itemRoot);
    const raw = textElement instanceof HTMLElement
      ? (typeof textElement.innerText === "string" ? textElement.innerText : textElement.textContent || "")
      : (typeof itemRoot.innerText === "string" ? itemRoot.innerText : itemRoot.textContent || "");
    return normalizeSpace(raw);
  }

  function findPrimaryMessageTextElement(itemRoot) {
    if (!(itemRoot instanceof HTMLElement)) {
      return null;
    }

    const candidates = [itemRoot, ...itemRoot.querySelectorAll(MESSAGE_TEXT_SELECTOR), ...itemRoot.querySelectorAll("p, div, span")];
    let bestNode = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    candidates.forEach((candidate) => {
      if (!(candidate instanceof HTMLElement)) {
        return;
      }
      if (!isCandidateMessageText(candidate, itemRoot)) {
        return;
      }

      const score = scoreMessageTextCandidate(candidate);
      if (score > bestScore) {
        bestScore = score;
        bestNode = candidate;
      }
    });

    return bestNode;
  }

  function isCandidateMessageText(element, itemRoot) {
    if (!(element instanceof HTMLElement) || !(itemRoot instanceof HTMLElement)) {
      return false;
    }
    if (!itemRoot.contains(element)) {
      return false;
    }
    if (!isVisible(element)) {
      return false;
    }
    if (element.closest('button, form, [role="dialog"]')) {
      return false;
    }
    if (element.closest('textarea, input, [contenteditable="true"], [role="textbox"]')) {
      return false;
    }

    const text = normalizeSpace(typeof element.innerText === "string" ? element.innerText : (element.textContent || ""));
    if (!text || text.length > 6000) {
      return false;
    }
    return true;
  }

  function scoreMessageTextCandidate(element) {
    if (!(element instanceof HTMLElement)) {
      return Number.NEGATIVE_INFINITY;
    }

    const text = normalizeSpace(typeof element.innerText === "string" ? element.innerText : (element.textContent || ""));
    if (!text) {
      return Number.NEGATIVE_INFINITY;
    }

    let score = Math.min(100, text.length);
    if (element.matches?.(MESSAGE_TEXT_SELECTOR)) {
      score += 120;
    }
    if (element.closest(".MuiListItemText-root")) {
      score += 24;
    }
    if (element.childElementCount > 0) {
      score -= Math.min(48, element.childElementCount * 8);
    }
    return score;
  }

  function findMessageItemRoot(element) {
    if (!(element instanceof HTMLElement)) {
      return null;
    }

    if (element.matches?.(MESSAGE_ITEM_SELECTOR)) {
      return element;
    }

    return element.closest(MESSAGE_ITEM_SELECTOR);
  }

  function syncTitleState() {
    const title = readTitle();
    lastTitle = title;
    lastUnreadCount = extractUnreadCount(title);
  }

  function readTitle() {
    return normalizeSpace(document.title || "");
  }

  function extractUnreadCount(title) {
    for (const pattern of UNREAD_PATTERNS) {
      const match = pattern.exec(title);
      if (!match) {
        continue;
      }

      const count = Number.parseInt(match[1], 10);
      if (Number.isFinite(count)) {
        return count;
      }
    }

    return null;
  }

    function ensureNotificationAudioUrl() {
    if (notificationAudioUrl) {
      return notificationAudioUrl;
    }

    const binary = window.atob(SOUND_BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: "audio/ogg" });
    notificationAudioUrl = URL.createObjectURL(blob);
    return notificationAudioUrl;
  }
  function ensureNotificationAudio() {
    if (notificationAudio) {
      return notificationAudio;
    }

    const audio = new Audio(ensureNotificationAudioUrl());
    audio.preload = "auto";
    audio.volume = 1;
    audio.addEventListener("loadeddata", () => {
      debugLog("audio-loadeddata", { readyState: audio.readyState });
    });
    audio.addEventListener("canplaythrough", () => {
      debugLog("audio-canplaythrough", { readyState: audio.readyState });
    });
    audio.addEventListener("error", () => {
      lastAudioError = readAudioError(audio);
      debugLog("audio-error", lastAudioError);
    });
    notificationAudio = audio;
    return notificationAudio;
  }

  function primeNotificationSound(source = "manual", runProbe = false) {
    const audio = ensureNotificationAudio();
    if (soundUnlocked) {
      if (runProbe && DEBUG_ENABLED && !didGestureProbe) {
        didGestureProbe = true;
        window.setTimeout(() => {
          playNotificationSound("gesture-probe");
        }, 0);
      }
      return Promise.resolve(true);
    }

    try {
      audio.load();
    } catch (error) {
      debugLog("audio-load-failed", serializeError(error));
    }

    const originalMuted = audio.muted;
    const originalVolume = audio.volume;
    audio.muted = true;
    audio.volume = 0;

    const finalize = (ok, extra = {}) => {
      soundUnlocked = soundUnlocked || ok;
      try {
        audio.pause();
      } catch (error) {
        // Ignore pause failures during priming.
      }
      try {
        audio.currentTime = 0;
      } catch (error) {
        // Ignore reset failures during priming.
      }
      audio.muted = originalMuted;
      audio.volume = originalVolume;
      debugLog(ok ? "audio-primed" : "audio-prime-failed", {
        source,
        readyState: audio.readyState,
        ...extra
      });
      if (ok && runProbe && DEBUG_ENABLED && !didGestureProbe) {
        didGestureProbe = true;
        window.setTimeout(() => {
          playNotificationSound("gesture-probe");
        }, 0);
      }
      return ok;
    };

    try {
      const playResult = audio.play();
      if (playResult && typeof playResult.then === "function") {
        return playResult.then(() => finalize(true)).catch((error) => finalize(false, {
          error: serializeError(error)
        }));
      }
      return Promise.resolve(finalize(true));
    } catch (error) {
      return Promise.resolve(finalize(false, {
        error: serializeError(error)
      }));
    }
  }

  function playNotificationSound(reason = "notify") {
    const audio = ensureNotificationAudio();
    lastPlayError = null;

    try {
      audio.pause();
    } catch (error) {
      // Ignore pause failures before replay.
    }

    try {
      audio.currentTime = 0;
    } catch (error) {
      debugLog("audio-currentTime-reset-failed", serializeError(error));
    }

    audio.muted = false;
    audio.volume = 1;

    debugLog("audio-play-attempt", {
      reason,
      soundUnlocked,
      readyState: audio.readyState,
      focus: getFocusState()
    });

    try {
      const playResult = audio.play();
      if (playResult && typeof playResult.then === "function") {
        return playResult.then(() => {
          debugLog("audio-play-started", {
            reason,
            readyState: audio.readyState
          });
          return true;
        }).catch((error) => {
          lastPlayError = serializeError(error);
          debugLog("audio-play-failed", {
            reason,
            readyState: audio.readyState,
            error: lastPlayError,
            focus: getFocusState()
          });
          return false;
        });
      }

      debugLog("audio-play-started", {
        reason,
        readyState: audio.readyState
      });
      return Promise.resolve(true);
    } catch (error) {
      lastPlayError = serializeError(error);
      debugLog("audio-play-threw", {
        reason,
        error: lastPlayError
      });
      return Promise.resolve(false);
    }
  }

  function stripUnreadPrefix(title) {
    let stripped = title;
    for (const pattern of UNREAD_PATTERNS) {
      if (pattern.test(stripped)) {
        stripped = stripped.replace(pattern, "");
        break;
      }
    }
    return normalizeSpace(stripped);
  }

  function isRoomUnfocused() {
    return document.visibilityState !== "visible" || !document.hasFocus();
  }

  function normalizeSpace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function debugLog(event, details = null) {
    if (!DEBUG_ENABLED) {
      return;
    }

    if (details == null) {
      console.debug(DEBUG_PREFIX, event);
      return;
    }

    console.debug(DEBUG_PREFIX, event, details);
  }

  function canNotifyNow() {
    if (Date.now() - readyAt < INIT_GRACE_MS) {
      return false;
    }
    if (!isRoomUnfocused()) {
      return false;
    }
    if (Date.now() - lastNotifyAt < MIN_NOTIFY_GAP_MS) {
      return false;
    }
    return true;
  }

  function serializeError(error) {
    if (!error) {
      return "";
    }

    return {
      name: String(error.name || ""),
      message: String(error.message || error)
    };
  }

  function readAudioError(audio) {
    if (!audio?.error) {
      return null;
    }

    return {
      code: audio.error.code,
      message: String(audio.error.message || "")
    };
  }

  function getFocusState() {
    return {
      hidden: document.hidden,
      visibilityState: document.visibilityState,
      windowFocused,
      hasFocus: document.hasFocus()
    };
  }

  function getCcfNativeMediaDebugList() {
    return getCcfNativeMediaCandidates().map((media, index) => describeCcfNativeMedia(media, index));
  }

  function describeCcfNativeMedia(media, index = null) {
    const source = getNativeMediaSource(media);
    return {
      index,
      tag: media?.tagName || "",
      src: source,
      currentSrc: media?.currentSrc || "",
      duration: media?.duration ?? null,
      currentTime: media?.currentTime ?? null,
      paused: media?.paused ?? null,
      muted: media?.muted ?? null,
      volume: media?.volume ?? null,
      readyState: media?.readyState ?? null,
      networkState: media?.networkState ?? null,
      inDocument: media instanceof HTMLMediaElement ? document.contains(media) : false,
      isLastNative: media === ccfBgmLastNativeMedia,
      isNotificationAudio: isNotificationAudioMedia(media),
      isPotentialBgm: isPotentialNativeBgmMedia(media)
    };
  }

  function exposeDebugApi() {
    ccfChatNotifierDebugApi = {
      isActive() {
        return chatNotifierActive;
      },
      disable() {
        return runChatNotifierTeardown();
      },
      getState() {
        return {
          href: location.href,
          title: lastTitle,
          unreadCount: lastUnreadCount,
          knownMessageKeys: knownMessageKeySet.size,
          lastNotifyAt,
          soundUnlocked,
          didGestureProbe,
          audioReadyState: notificationAudio?.readyState ?? null,
          audioPaused: notificationAudio?.paused ?? null,
          lastAudioError,
          lastPlayError,
          focus: getFocusState()
        };
      },
      primeSound() {
        return primeNotificationSound("manual-api");
      },
      testSound() {
        return playNotificationSound("manual-api");
      },
      getNativeMediaList() {
        return getCcfNativeMediaDebugList();
      },
      getNativePlayback() {
        const media = findActiveNativeBgmMedia();
        return media ? describeCcfNativeMedia(media) : null;
      },
      getWebAudioPlayback() {
        return readCcfWebAudioPlaybackTime();
      },
      getWebAudioState() {
        return ccfBgmLastWebAudio ? {
          total: ccfBgmLastWebAudio.total,
          playDuration: ccfBgmLastWebAudio.playDuration,
          offset: ccfBgmLastWebAudio.offset,
          loop: ccfBgmLastWebAudio.loop,
          loopStart: ccfBgmLastWebAudio.loopStart,
          loopEnd: ccfBgmLastWebAudio.loopEnd,
          stopped: ccfBgmLastWebAudio.stopped,
          createdAt: ccfBgmLastWebAudio.createdAt
        } : null;
      },
      getYoutubePlayerState() {
        if (!ccfBgmPlayer) {
          return null;
        }

        const iframe = typeof ccfBgmPlayer.getIframe === "function"
          ? ccfBgmPlayer.getIframe()
          : null;
        const activeButton = findCcfBgmButtonBySlot(ccfBgmActiveSlotKey);
        const activeEntry = ccfBgmSlotMap.get(ccfBgmActiveEntryKey)
          || findCcfReadyYoutubeEntryForSlot(ccfBgmActiveSlotKey)?.[1];
        const computed = ccfBgmActiveSlotKey
          ? readCcfYoutubeBgmPlaybackState(ccfBgmActiveSlotKey, activeEntry, activeButton)
          : null;

        return {
          activeSlotKey: ccfBgmActiveSlotKey,
          activeEntryKey: ccfBgmActiveEntryKey,
          videoId: ccfBgmPlayerVideoId,
          volume: typeof ccfBgmPlayer.getVolume === "function" ? ccfBgmPlayer.getVolume() : null,
          muted: typeof ccfBgmPlayer.isMuted === "function" ? ccfBgmPlayer.isMuted() : null,
          playerState: typeof ccfBgmPlayer.getPlayerState === "function" ? ccfBgmPlayer.getPlayerState() : null,
          computed,
          iframeSrc: iframe instanceof HTMLIFrameElement ? iframe.src : "",
          iframeAllow: iframe instanceof HTMLIFrameElement ? iframe.getAttribute("allow") || "" : ""
        };
      },
      forceYoutubeSound(volume = 100) {
        if (!ccfBgmPlayer) {
          return false;
        }

        try {
          if (typeof ccfBgmPlayer.unMute === "function") ccfBgmPlayer.unMute();
          if (typeof ccfBgmPlayer.setVolume === "function") {
            ccfBgmPlayer.setVolume(Math.max(1, Math.min(100, Number(volume) || 100)));
          }
          if (typeof ccfBgmPlayer.playVideo === "function") ccfBgmPlayer.playVideo();
          return true;
        } catch (error) {
          debugLog("bgm-youtube-force-sound-failed", serializeError(error));
          return false;
        }
      },
      getYoutubeBgmEntries() {
        return [...ccfBgmSlotMap.entries()].map(([entryKey, entry]) => ({
          entryKey,
          ...ccfBgmShareSerializableEntry(entry)
        }));
      },
      inspectYoutubeBgmStorage() {
        return collectCcfBgmStorageCandidates().then((candidates) => candidates.map((candidate) => ({
          source: candidate.source,
          tier: candidate.tier,
          count: candidate.count,
          updatedAt: candidate.updatedAt
        })));
      },
      recoverYoutubeBgmStorage() {
        return recoverCcfBgmStorageFromCandidates().then((result) => {
          if (result?.payload) {
            ccfBgmSlotMap.clear();
            applyCcfBgmPersistedPayload(result.payload);
            markCcfYoutubeBgmSlotButtons();
            tryEnhanceCcfBgmPanel();
            renderCcfYoutubeBgmLibraryItems();
          }
          return {
            recovered: !!result?.payload,
            source: result?.source || "",
            count: result?.count || 0
          };
        });
      },
      multiSelect: {
        state() {
          return {
            selected: [...ccfBgmMultiSelectedEntries],
            mode: getCcfBgmActiveDialogScopes(document).some(isCcfBgmMultiSelectModeForScope)
          };
        },
        sync() {
          syncCcfBgmYoutubeMultiSelectUI();
          return [...ccfBgmMultiSelectedEntries];
        },
        clear() {
          clearCcfBgmMultiSelect();
          syncCcfBgmYoutubeMultiSelectUI();
        },
        deleteSelected() {
          return deleteCcfBgmSelectedYoutubeEntries("debug");
        },
        dumpNativeCheckbox() {
          const scopes = getCcfBgmActiveDialogScopes(document);
          for (const scope of scopes) {
            const tpl = findNativeBgmCheckboxTemplate(scope);
            if (tpl instanceof HTMLElement) {
              return {
                outerHtml: tpl.outerHTML,
                tagName: tpl.tagName,
                classes: tpl.className,
                parent: tpl.parentElement?.tagName,
                parentClass: tpl.parentElement?.className
              };
            }
          }
          return null;
        },
        dumpNativeRow() {
          const scopes = getCcfBgmActiveDialogScopes(document);
          for (const scope of scopes) {
            if (!scope.querySelectorAll) continue;
            const rows = scope.querySelectorAll('.MuiListItemButton-root:not(.ccf-youtube-bgm-item)');
            for (const r of rows) {
              if (r.closest('.ccf-youtube-bgm-row-wrap, .ccf-youtube-bgm-popover')) continue;
              const wrap = r.closest('.MuiListItem-root') || r;
              return wrap.outerHTML.slice(0, 4000);
            }
          }
          return null;
        }
      }
    };
    window.__CCF_CHAT_NOTIFIER_DEBUG__ = ccfChatNotifierDebugApi;
  }

  function scheduleCcfBgmEnhancerInit() {
    // 새로고침 후 autoplay 케이스: persisted state==="playing" 이면 init 흐름을
    // 기다리지 않고 즉시 YT API preload + slotMap 로드 + play. 사용자 클릭부터
    // 재생까지 딜레이 최소화.
    primeAutoplayFastPath();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initCcfBgmEnhancer, { once: true });
      window.setTimeout(() => {
        if (!ccfBgmEnhancerInitialized) {
          initCcfBgmEnhancer();
        }
      }, 2000);
      return;
    }

    // 이전엔 setTimeout 300ms 지연 — 그러나 readyState 가 이미 complete/interactive
    // 이면 ccfolia DOM 도 대부분 mount 끝남. 지연 제거.
    initCcfBgmEnhancer();
  }

  function primeAutoplayFastPath() {
    try {
      const persisted = readCcfBgmPersistedActiveSlot();
      if (persisted?.state !== "playing") return;
      loadYoutubeIframeApi();

      if (document.readyState === "loading" || !document.body) return;
      if (ccfBgmActiveSlotKey || ccfBgmPlayer) return;

      const raw = window.localStorage.getItem(BGM_STORAGE_KEY);
      if (!raw) return;
      let library;
      try { library = JSON.parse(raw); } catch (_) { return; }
      if (!library || typeof library !== "object") return;

      const entry = library[persisted.entryKey];
      if (!entry?.videoId) return;

      if (!ccfBgmSlotMap.has(persisted.entryKey)) {
        ccfBgmSlotMap.set(persisted.entryKey, entry);
      }

      playCcfYoutubeBgmSlot(persisted.slotKey, entry, null, 0, persisted.entryKey);
    } catch (_) { /* fast path 실패해도 정상 init 흐름이 처리 */ }
  }

  function initCcfBgmEnhancer() {
    if (ccfBgmEnhancerInitialized) {
      return;
    }

    ccfBgmEnhancerInitialized = true;
    injectCcfBgmEnhancerStyle();
    hookCcfBgmNativeMediaProgress();
    hookCcfBgmMediaElementCreation();
    hookCcfBgmWebAudioProgress();
    bindCcfBgmEvents();
    observeCcfBgmDom();
    // 북마클릿이 켜지기 전에 이미 재생 중이던 네이티브 BGM은 위 훅들이 잡아내지 못한다.
    // (play() 호출은 이미 끝났고, 미디어 요소도 이미 DOM에 존재) 그래서 init 직후
    // DOM을 훑어 현재 재생 중/진행 중인 미디어를 트래커에 등록한다.
    // 코코포리아가 미디어 요소를 늦게 만들 가능성에 대비해 여러 시점에 재시도.
    scheduleCcfBgmInitScans();
    tryEnhanceCcfBgmPanel();
    tryCenterCcfBgmDialogs();

    loadCcfBgmSlotMap().then(() => {
      if (ccfBgmSlotMap.size) {
        loadYoutubeIframeApi();
        prepareCcfYoutubeBgmPlayerFromEntries([...ccfBgmSlotMap.entries()]);
        fetchStoredCcfYoutubeTitles();
      }
      debugLog("bgm-enhancer-init", {
        slots: ccfBgmSlotMap.size,
        storage: getCcfBgmToolkitStorage() ? "toolkit-idb" : "local-storage"
      });
    });
  }

  function scanExistingNativeBgmMedia() {
    // 페이지에 이미 존재하는 audio/video 요소를 훑어, 재생 중이거나 진행 중인 미디어를
    // 현재 활성 네이티브 BGM으로 등록한다. handleCcfNativeMediaActivity가 알아서
    // 진행바 갱신·이벤트 리스너 부착 등을 해준다.
    // 코코포리아가 미디어 요소를 늦게 mount하는 경우가 있어 여러 시점에 재시도한다.
    const allMedia = [...document.querySelectorAll("audio, video")];
    let qualifying = 0;
    let registered = 0;
    for (const media of allMedia) {
      if (!(media instanceof HTMLMediaElement)) continue;
      if (!isPotentialNativeBgmMedia(media)) continue;
      qualifying += 1;
      const isPlaying = !media.paused && !media.ended;
      const hasProgress = media.currentTime > 0;
      if (!isPlaying && !hasProgress) continue;
      handleCcfNativeMediaActivity(media, isPlaying ? "play" : "pause", "init-scan");
      registered += 1;
    }
    debugLog("bgm-native-media-init-scan", {
      totalMediaElements: allMedia.length,
      qualifyingForBgm: qualifying,
      registered
    });
    return registered;
  }

  function scheduleCcfBgmInitScans() {
    // 즉시 + 지연 재시도. 코코포리아가 BGM <audio> 요소를 lazy-mount하거나, 사용자가
    // 북마클릿을 누른 직후에 미디어가 막 mount되는 경우에 대비.
    scanExistingNativeBgmMedia();
    const delays = [300, 1000, 2500, 5000];
    delays.forEach((ms) => {
      window.setTimeout(() => {
        if (!chatNotifierActive) return;
        // 이미 한 번 등록된 미디어는 handleCcfNativeMediaActivity 내부에서 set 추가만
        // 일어나므로 중복 호출이 부작용을 일으키지 않는다.
        scanExistingNativeBgmMedia();
      }, ms);
    });
  }

  function hookCcfBgmNativeMediaProgress() {
    if (!window.HTMLMediaElement?.prototype) {
      return;
    }

    if (window.__ccfBgmNativeMediaProgressHooked) {
      return;
    }

    const mediaProto = window.HTMLMediaElement.prototype;
    const originalPlay = mediaProto.play;
    if (typeof originalPlay !== "function") {
      return;
    }

    window.__ccfBgmNativeMediaProgressHooked = true;

    const patchedMediaPlay = function patchedCcfBgmMediaPlay() {
      const media = this;
      const playResult = originalPlay.apply(media, arguments);
      if (!chatNotifierActive) {
        return playResult;
      }
      const remember = () => {
        if (!chatNotifierActive) return;
        handleCcfNativeMediaActivity(media, "play", "play-hook");
      };

      if (playResult && typeof playResult.then === "function") {
        playResult.then(remember).catch((error) => {
          debugLog("bgm-native-play-hook-rejected", serializeError(error));
        });
      } else {
        window.setTimeout(remember, 0);
      }

      return playResult;
    };

    mediaProto.play = patchedMediaPlay;

    registerTeardown(() => {
      if (mediaProto.play === patchedMediaPlay) {
        mediaProto.play = originalPlay;
        window.__ccfBgmNativeMediaProgressHooked = false;
      }
    });

    debugLog("bgm-native-media-hooked");
  }

  function hookCcfBgmWebAudioProgress() {
    if (window.__ccfBgmWebAudioProgressHooked) {
      return;
    }

    if (!window.AudioBufferSourceNode?.prototype) {
      return;
    }

    const sourceProto = window.AudioBufferSourceNode.prototype;
    const originalStart = sourceProto.start;
    const originalStop = sourceProto.stop;
    if (typeof originalStart !== "function" || typeof originalStop !== "function") {
      return;
    }

    window.__ccfBgmWebAudioProgressHooked = true;

    const patchedWebAudioStart = function patchedCcfBgmWebAudioStart(when = 0, offset = 0, duration) {
      if (!chatNotifierActive) {
        return originalStart.apply(this, arguments);
      }
      let trackingState = null;
      try {
        trackingState = createCcfWebAudioTrackingState(this, when, offset, duration);
      } catch (error) {
        debugLog("bgm-webaudio-state-build-failed", serializeError(error));
      }

      const startResult = originalStart.apply(this, arguments);

      if (trackingState && shouldTrackCcfWebAudioState(trackingState)) {
        ccfBgmAudioContextNow = trackingState.contextNow;
        ccfBgmLastWebAudio = trackingState;
        ccfBgmLastNativeMedia = null;

        // [수정됨] 효과음 재생 시 유튜브 BGM 강제 정지 로직 삭제

        startCcfBgmProgressLoop();
        window.setTimeout(updateCcfBgmProgressBar, 0);

        this.addEventListener?.("ended", () => {
          if (ccfBgmLastWebAudio?.source === this) {
            ccfBgmLastWebAudio.stopped = true;
            window.setTimeout(updateCcfBgmProgressBar, 50);
          }
        }, { once: true });

        debugLog("bgm-webaudio-start", {
          total: trackingState.total,
          playDuration: trackingState.playDuration,
          offset: trackingState.offset,
          loop: trackingState.loop,
          when
        });
      }

      return startResult;
    };

    const patchedWebAudioStop = function patchedCcfBgmWebAudioStop() {
      if (!chatNotifierActive) {
        return originalStop.apply(this, arguments);
      }
      try {
        if (ccfBgmLastWebAudio?.source === this) {
          ccfBgmLastWebAudio.stopped = true;
          window.setTimeout(updateCcfBgmProgressBar, 50);
        }
      } catch (error) {
        debugLog("bgm-webaudio-stop-hook-failed", serializeError(error));
      }

      return originalStop.apply(this, arguments);
    };

    sourceProto.start = patchedWebAudioStart;
    sourceProto.stop = patchedWebAudioStop;

    registerTeardown(() => {
      let restored = false;
      if (sourceProto.start === patchedWebAudioStart) {
        sourceProto.start = originalStart;
        restored = true;
      }
      if (sourceProto.stop === patchedWebAudioStop) {
        sourceProto.stop = originalStop;
        restored = true;
      }
      if (restored) {
        window.__ccfBgmWebAudioProgressHooked = false;
      }
    });

    debugLog("bgm-webaudio-hooked");
  }

  // 코코포리아가 DOM에 붙지 않은 Audio 객체를 autoplay로 재생하는 경우,
  // .play() 메서드 후크로는 잡히지 않는다. 미디어 엘리먼트의 생성/소스 지정
  // 시점을 후킹해 직접 play 이벤트 리스너를 붙여 추적한다.
  function trackCcfBgmCreatedMedia(media) {
    if (!(media instanceof HTMLMediaElement) || ccfBgmCreationTrackedMedia.has(media)) {
      return;
    }
    ccfBgmCreationTrackedMedia.add(media);
    // autoplay로 재생돼 .play()를 거치지 않아도 'play'/'playing' 이벤트는 발생한다.
    ["play", "playing"].forEach((type) => {
      media.addEventListener(type, () => {
        if (!chatNotifierActive) {
          return;
        }
        handleCcfNativeMediaActivity(media, "play", "media-created");
      }, true);
    });
  }

  function hookCcfBgmMediaElementCreation() {
    if (window.__ccfBgmMediaCreationHooked) {
      return;
    }
    window.__ccfBgmMediaCreationHooked = true;

    // 1) Audio 생성자
    const OrigAudio = window.Audio;
    if (typeof OrigAudio === "function") {
      const PatchedAudio = function CcfBgmAudio() {
        const media = arguments.length
          ? new OrigAudio(arguments[0])
          : new OrigAudio();
        try { trackCcfBgmCreatedMedia(media); } catch (_) {}
        return media;
      };
      PatchedAudio.prototype = OrigAudio.prototype;
      window.Audio = PatchedAudio;
      registerTeardown(() => {
        if (window.Audio === PatchedAudio) {
          window.Audio = OrigAudio;
        }
      });
    }

    // 2) document.createElement('audio'|'video')
    const origCreateElement = document.createElement;
    if (typeof origCreateElement === "function") {
      const patchedCreateElement = function ccfBgmCreateElement(tagName) {
        const element = origCreateElement.apply(this, arguments);
        try {
          if (typeof tagName === "string" && /^(?:audio|video)$/i.test(tagName)) {
            trackCcfBgmCreatedMedia(element);
          }
        } catch (_) {}
        return element;
      };
      document.createElement = patchedCreateElement;
      registerTeardown(() => {
        if (document.createElement === patchedCreateElement) {
          document.createElement = origCreateElement;
        }
      });
    }

    // 3) src / srcObject 세터 — 이미 존재하던 엘리먼트를 재사용하는 경우 대응
    const proto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    if (proto) {
      ["src", "srcObject"].forEach((prop) => {
        try {
          const desc = Object.getOwnPropertyDescriptor(proto, prop);
          if (!desc || typeof desc.set !== "function" || typeof desc.get !== "function") {
            return;
          }
          const patched = {
            configurable: true,
            enumerable: desc.enumerable,
            get() { return desc.get.call(this); },
            set(value) {
              try { trackCcfBgmCreatedMedia(this); } catch (_) {}
              return desc.set.call(this, value);
            }
          };
          Object.defineProperty(proto, prop, patched);
          registerTeardown(() => {
            const current = Object.getOwnPropertyDescriptor(proto, prop);
            if (current && current.set === patched.set) {
              Object.defineProperty(proto, prop, desc);
            }
          });
        } catch (error) {
          debugLog("bgm-media-src-hook-failed", serializeError(error));
        }
      });
    }

    registerTeardown(() => {
      window.__ccfBgmMediaCreationHooked = false;
    });

    debugLog("bgm-media-creation-hooked");
  }

  function createCcfWebAudioTrackingState(source, when, offset, duration) {
    const ctx = source?.context;
    const bufferDuration = Number(source?.buffer?.duration) || 0;
    if (!ctx || bufferDuration <= 0) {
      return null;
    }

    const safeOffset = Math.max(0, Math.min(bufferDuration, Number(offset) || 0));
    const explicitDuration = Number(duration);
    const remainingDuration = Math.max(0, bufferDuration - safeOffset);
    const playDuration = Number.isFinite(explicitDuration) && explicitDuration > 0
      ? Math.min(explicitDuration, remainingDuration || explicitDuration)
      : remainingDuration;
    const ctxNow = Number(ctx.currentTime) || 0;
    const requestedWhen = Number(when);
    const startedAt = Number.isFinite(requestedWhen) && requestedWhen > 0
      ? Math.max(ctxNow, requestedWhen)
      : ctxNow;
    const loop = source.loop === true;
    const loopStart = Math.max(0, Math.min(bufferDuration, Number(source.loopStart) || 0));
    const rawLoopEnd = Number(source.loopEnd) || 0;
    const loopEnd = loop && rawLoopEnd > 0
      ? Math.max(loopStart, Math.min(bufferDuration, rawLoopEnd))
      : bufferDuration;

    if (playDuration <= 0 && bufferDuration <= 0) {
      return null;
    }

    return {
      source,
      contextNow: () => Number(ctx.currentTime) || 0,
      startedAt,
      offset: safeOffset,
      total: bufferDuration,
      playDuration,
      loop,
      loopStart,
      loopEnd,
      stopped: false,
      createdAt: Date.now()
    };
  }

  function shouldTrackCcfWebAudioState(state) {
    if (!state || state.total <= 0) {
      return false;
    }

    return state.loop
      || state.total >= BGM_WEB_AUDIO_MIN_DURATION
      || state.playDuration >= BGM_WEB_AUDIO_MIN_DURATION
      || isRecentCcfBgmClick();
  }

  function bindCcfBgmEvents() {
    if (ccfBgmEventsBound) {
      return;
    }

    ccfBgmEventsBound = true;
    document.addEventListener("keydown", handleCcfBgmUrlKeydown, withTeardownSignal(true));
    document.addEventListener("keypress", handleCcfBgmUrlKeydown, withTeardownSignal(true));
    document.addEventListener("submit", handleCcfBgmUrlSubmit, withTeardownSignal(true));
    document.addEventListener("click", handleCcfBgmDocumentClick, withTeardownSignal(true));
    document.addEventListener("pointerover", handleCcfBgmTooltipPointerOver, withTeardownSignal(true));
    document.addEventListener("pointerout", handleCcfBgmTooltipPointerOut, withTeardownSignal(true));
    document.addEventListener("pointerdown", handleCcfBgmTooltipPointerOut, withTeardownSignal(true));
    registerTeardown(teardownCcfBgmNativeTooltip);
    registerTeardown(destroyCcfBgmPreviewPlayer);
    [
      "play",
      "timeupdate",
      "loadedmetadata",
      "durationchange",
      "seeking",
      "seeked",
      "pause",
      "ended"
    ].forEach((type) => {
      document.addEventListener(type, handleCcfNativeMediaPlay, withTeardownSignal(true));
    });
  }

  function handleCcfNativeMediaPlay(event) {
    const media = event.target;
    handleCcfNativeMediaActivity(media, event.type, "media-event");
  }

  function handleCcfNativeMediaActivity(media, eventType = "unknown", source = "unknown") {
    if (!isPotentialNativeBgmMedia(media)) {
      return;
    }

    const shouldRemember = eventType === "play"
      || media === ccfBgmLastNativeMedia
      || !media.paused
      || media.currentTime > 0
      || isRecentCcfBgmClick();
    if (!shouldRemember) {
      return;
    }

    ccfBgmKnownNativeMedia.add(media);
    attachCcfNativeMediaListeners(media);
    ccfBgmLastNativeMedia = media;

    if (eventType === "play") {
      ccfBgmLastWebAudio = null;
    }

    // [수정됨] 동시 재생을 위해 네이티브 재생 시 유튜브 BGM 강제 정지 로직 삭제

    startCcfBgmProgressLoop();
    updateCcfBgmProgressBar();

    if (eventType === "pause" || eventType === "ended") {
      window.setTimeout(() => {
        if (
          eventType === "pause"
          && media === ccfBgmLastNativeMedia
          && media.paused
          && media.currentTime <= 0
        ) {
          ccfBgmLastNativeMedia = null;
        }
        updateCcfBgmProgressBar();
      }, 50);
    }

    if (source !== "media-event" && eventType === "play") {
      debugLog("bgm-native-media-tracked", {
        source,
        tag: media.tagName,
        src: getNativeMediaSource(media),
        inDocument: document.contains(media)
      });
    }
  }

  function attachCcfNativeMediaListeners(media) {
    if (!(media instanceof HTMLMediaElement) || ccfBgmNativeMediaListeners.has(media)) {
      return;
    }

    ccfBgmNativeMediaListeners.add(media);
    [
      "timeupdate",
      "loadedmetadata",
      "durationchange",
      "seeking",
      "seeked",
      "pause",
      "ended"
    ].forEach((type) => {
      media.addEventListener(type, handleCcfNativeMediaPlay, true);
    });
  }

  function observeCcfBgmDom() {
    if (!document.body) {
      window.setTimeout(observeCcfBgmDom, 100);
      return;
    }

    if (ccfBgmObserver) {
      return;
    }

    ccfBgmObserver = new MutationObserver((mutations) => {
      if (mutations.length && mutations.every(isCcfBgmIgnoredMutation)) {
        return;
      }
      scheduleCcfBgmDomEnhance();
    });

    ccfBgmObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "aria-selected", "class", "style", "value"]
    });
    registerTeardown(() => {
      ccfBgmObserver?.disconnect();
      ccfBgmObserver = null;
    });
  }

  function scheduleCcfBgmDomEnhance() {
    if (ccfBgmDomEnhanceTimer) {
      return;
    }

    ccfBgmDomEnhanceTimer = window.setTimeout(() => {
      ccfBgmDomEnhanceTimer = 0;
      markCcfBgmDrawerSizeLocks();
      if (isCcfNativeBgmEditGraceActive()) {
        return;
      }
      tryEnhanceCcfBgmPanel();
      tryCenterCcfBgmDialogs();
      tryCaptureYoutubeUrlsFromBgmDialogs();
      syncCcfActiveBgmState();
    }, 120);
  }

  function isCcfBgmIgnoredMutation(mutation) {
    const target = mutation?.target;
    if (!(target instanceof Element)) {
      return false;
    }

    return !!target.closest(
      ".ccf-bgm-progress-root, .ccf-youtube-bgm-player-dock, .ccf-youtube-bgm-popover"
    );
  }

  function startCcfNativeBgmEditGrace() {
    ccfBgmNativeEditGraceUntil = Date.now() + BGM_NATIVE_EDIT_GRACE_MS;
    debugLog("bgm-native-edit-grace", {
      until: ccfBgmNativeEditGraceUntil
    });
  }

  function isCcfNativeBgmEditGraceActive() {
    return Date.now() < ccfBgmNativeEditGraceUntil;
  }

  function handleCcfBgmDocumentClick(event) {
    if (ccfBgmActiveSlotKey && event.target instanceof Element) {
      const nativeItem = event.target.closest(".MuiListItemButton-root");
      const dialogHost = event.target.closest(".MuiDialog-root, .MuiPopover-root, .MuiModal-root");

      const isBgmDialog = dialogHost instanceof HTMLElement && (
        dialogHost.getAttribute("data-ccf-bgm-dialog-root") === "1" || 
        isLikelyCcfBgmDialog(dialogHost)
      );

      if (
        nativeItem instanceof HTMLElement
        && !nativeItem.classList.contains("ccf-youtube-bgm-item")
        && isBgmDialog
      ) {
        // 複数選択(multi-select) 모드에서 row 클릭은 "선택 토글"이지 "전환 재생"이 아니다.
        // 체크박스가 row나 다이얼로그에 노출돼 있으면 우리는 정지/마킹 로직을 스킵.
        const inMultiSelect = !!(
          nativeItem.querySelector('input[type="checkbox"], .MuiCheckbox-root')
          || (dialogHost instanceof HTMLElement && dialogHost.querySelector('input[type="checkbox"]:not([hidden]), .MuiCheckbox-root'))
        );
        if (!inMultiSelect) {
          const targetSlotKey = ccfBgmEditingSlotKey || ccfBgmLastDialogSlotKey;
          if (ccfBgmActiveSlotKey && targetSlotKey === ccfBgmActiveSlotKey) {
            stopCcfYoutubeBgm("native-library-selected");
            ccfBgmNativeLoadedSlots.add(targetSlotKey);
            markCcfYoutubeBgmSlotButtons();
            window.setTimeout(markCcfYoutubeBgmSlotButtons, 150);
            window.setTimeout(markCcfYoutubeBgmSlotButtons, 500);
          }
        }
      }
    }

    const button = event.target instanceof Element
      ? event.target.closest("button")
      : null;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    if (isCcfNativeBgmEditButton(button)) {
      startCcfNativeBgmEditGrace();
      return;
    }

    // ========== 정지 버튼 완벽 분리 로직 ==========
    if (isCcfBgmStopButton(button)) {
      if (Date.now() < ccfSuppressStopHandlerUntil) {
        return;
      }
      
      const isGlobalStopButton = button.classList.contains("MuiIconButton-sizeSmall");
      const targetSlotKey = ccfBgmEditingSlotKey || ccfBgmLastDialogSlotKey || ccfBgmActiveSlotKey;

      if (isGlobalStopButton) {
        // 1. 하단 툴바의 전체 정지 버튼을 누른 경우 -> 유튜브도 강제 정지
        stopCcfYoutubeBgm("stop-button");
      } else {
        // 2. 개별 팝업의 정지 버튼을 누른 경우
        if (ccfBgmActiveSlotKey && targetSlotKey === ccfBgmActiveSlotKey) {
          // [유튜브 음원 팝업]에서 정지: 코코포리아가 네이티브를 끄지 못하게 이벤트 차단!
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation?.();
          stopCcfYoutubeBgm("stop-button");
        } else {
          // [네이티브 음원 팝업]에서 정지: 스크립트는 유튜브를 건드리지 않고 가만히 둡니다.
          // (코코포리아가 이벤트를 받아서 알아서 네이티브 음원만 끕니다)
        }
      }

      if (targetSlotKey) {
        ccfBgmNativeLoadedSlots.delete(targetSlotKey);
        // 우리가 유튜브를 끈 경우에만 상태(pending)를 업데이트
        if (isGlobalStopButton || (ccfBgmActiveSlotKey && targetSlotKey === ccfBgmActiveSlotKey)) {
          let pendingChanged = false;
          getCcfYoutubeEntriesForSlot(targetSlotKey).forEach(([entryKey, entry]) => {
            if (entryKey && entry && entry.pending !== true) {
              entry.pending = true;
              ccfBgmSlotMap.set(entryKey, entry);
              pendingChanged = true;
            }
          });
          if (pendingChanged) persistCcfBgmSlotMap();
        }
        markCcfYoutubeBgmSlotButtons();
      }
      window.setTimeout(updateCcfBgmProgressBar, 50);
      return;
    }
    // ===========================================

    const slotKey = getCcfBgmSlotKeyFromButton(button);
    if (slotKey) {
      ccfBgmEditingSlotKey = slotKey;
      ccfBgmLastDialogSlotKey = slotKey;
      ccfBgmLastBgmClickAt = Date.now();
      updateCcfBgmSlotStateFromButton(slotKey, button);

      window.setTimeout(() => {
        tryCenterCcfBgmDialogs();
        tryCaptureYoutubeUrlsFromBgmDialogs();
        tryEnhanceCcfBgmPanel();
      }, 80);

      window.setTimeout(() => {
        tryCenterCcfBgmDialogs();
        tryCaptureYoutubeUrlsFromBgmDialogs();
      }, 350);
      return;
    }

    if (isCcfBgmControlButton(button)) {
      ccfBgmLastControlSeed = button;
      window.setTimeout(() => syncCcfActiveBgmState(button), 80);
      window.setTimeout(() => syncCcfActiveBgmState(button), 180);
      window.setTimeout(() => syncCcfActiveBgmState(button), 420);
    }
  }

  function handleCcfBgmUrlKeydown(event) {
    if (event.key !== "Enter") {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
      return;
    }

    const dialog = getCcfBgmDialogRoot(target);
    if (dialog instanceof HTMLElement && isCcfRoomSettingsDialog(dialog)) {
      return;
    }

    const value = target.value || target.getAttribute("value") || "";
    const youtubeUrl = extractCcfYoutubeUrl(value);
    if (!youtubeUrl || !extractCcfYoutubeVideoId(youtubeUrl)) {
      return;
    }

    if (!shouldBlockCcfYoutubeUrlInput(target) && !canFallbackBgmSlot()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    if (event.type !== "keydown") {
      return;
    }

    const committed = commitCcfYoutubeUrlInput(target, "enter");
    if (!committed) {
      debugLog("bgm-youtube-enter-blocked-but-not-committed", {
        value,
        editingSlot: ccfBgmEditingSlotKey,
        lastDialogSlot: ccfBgmLastDialogSlotKey
      });
      return;
    }

    clearCcfBgmUrlInput(target);

    window.setTimeout(() => {
      renderCcfYoutubeBgmLibraryItems(getCcfBgmDialogRoot(target));
    }, 0);
  }

  function canFallbackBgmSlot() {
    return !!(ccfBgmEditingSlotKey || ccfBgmLastDialogSlotKey);
  }

  function handleCcfBgmUrlSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    const input = [...form.querySelectorAll("input, textarea")]
      .find((candidate) => {
        if (!(candidate instanceof HTMLInputElement) && !(candidate instanceof HTMLTextAreaElement)) {
          return false;
        }

        return !!extractCcfYoutubeUrl(candidate.value || candidate.getAttribute("value") || "");
      });

    if (!input || !shouldBlockCcfYoutubeUrlInput(input)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    const committed = commitCcfYoutubeUrlInput(input, "submit");
    if (!committed) {
      debugLog("bgm-youtube-submit-blocked-but-not-committed", {
        value: input.value || input.getAttribute("value") || "",
        editingSlot: ccfBgmEditingSlotKey,
        lastDialogSlot: ccfBgmLastDialogSlotKey
      });
      return;
    }

    clearCcfBgmUrlInput(input);

    window.setTimeout(() => {
      renderCcfYoutubeBgmLibraryItems(getCcfBgmDialogRoot(input));
    }, 0);
  }

  function commitCcfYoutubeUrlInput(input, reason = "manual") {
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
      return false;
    }

    const url = extractCcfYoutubeUrl(input.value || input.getAttribute("value") || "");
    if (!url || !extractCcfYoutubeVideoId(url)) {
      return false;
    }

    const context = getCcfBgmUrlInputContext(input);
    if (!context?.slotKey) {
      return false;
    }

    storeCcfBgmSlotUrl(context.slotKey, url, context.dialog);
    loadYoutubeIframeApi();

    debugLog("bgm-youtube-url-committed", {
      reason,
      slotKey: context.slotKey,
      url
    });

    return true;
  }

  function clearCcfBgmUrlInput(input) {
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
      return;
    }

    try {
      const proto = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (valueSetter) {
        valueSetter.call(input, "");
      } else {
        input.value = "";
      }
    } catch (error) {
      input.value = "";
    }

    input.setAttribute("value", "");
  }

  function shouldBlockCcfYoutubeUrlInput(input) {
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
      return false;
    }

    if (isCcfNativeBgmEditGraceActive()) {
      return false;
    }

    const dialog = getCcfBgmDialogRoot(input);
    if (dialog instanceof HTMLElement && isCcfRoomSettingsDialog(dialog)) {
      return false;
    }

    const recentBgmClick = isRecentCcfBgmClick();
    const likelyInput = isLikelyCcfBgmUrlInput(input);
    const likelyDialog = dialog instanceof HTMLElement && isLikelyCcfBgmDialog(dialog);
    const dialogSlotKey = dialog instanceof HTMLElement ? dialog.dataset.ccfBgmSlotKey || "" : "";
    const markedDialog = dialog instanceof HTMLElement && dialog.getAttribute("data-ccf-bgm-dialog-root") === "1";

    if (likelyDialog || recentBgmClick || !!dialogSlotKey || (likelyInput && markedDialog)) {
      return true;
    }

    return likelyInput && canFallbackBgmSlot();
  }

  function getCcfBgmUrlInputContext(input) {
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
      return null;
    }

    if (isCcfNativeBgmEditGraceActive()) {
      return null;
    }

    const dialog = getCcfBgmDialogRoot(input);
    if (dialog instanceof HTMLElement && isCcfRoomSettingsDialog(dialog)) {
      return null;
    }

    const recentBgmClick = isRecentCcfBgmClick();
    const likelyInput = isLikelyCcfBgmUrlInput(input);
    const likelyDialog = dialog instanceof HTMLElement && isLikelyCcfBgmDialog(dialog);
    const dialogSlotKey = dialog instanceof HTMLElement ? dialog.dataset.ccfBgmSlotKey || "" : "";
    const markedDialog = dialog instanceof HTMLElement && dialog.getAttribute("data-ccf-bgm-dialog-root") === "1";

    const dialogContextOk = likelyDialog || recentBgmClick || !!dialogSlotKey || (likelyInput && markedDialog);
    const fallbackContextOk = likelyInput && canFallbackBgmSlot();

    if (!dialogContextOk && !fallbackContextOk) {
      return null;
    }

    const slotKey = inferCcfBgmSlotKeyFromElement(dialog)
      || dialogSlotKey
      || (recentBgmClick ? ccfBgmEditingSlotKey : "")
      || (likelyDialog || markedDialog ? ccfBgmLastDialogSlotKey : "")
      || (fallbackContextOk ? (ccfBgmEditingSlotKey || ccfBgmLastDialogSlotKey) : "");

    if (!slotKey) {
      return null;
    }

    return {
      dialog,
      slotKey
    };
  }

  function tryCaptureYoutubeUrlsFromBgmDialogs() {
    if (isCcfNativeBgmEditGraceActive()) {
      return;
    }

    const dialogs = getCcfBgmDialogCandidates();
    dialogs.forEach((dialog) => {
      if (!(dialog instanceof HTMLElement) || !isLikelyCcfBgmDialog(dialog)) {
        return;
      }

      const slotKey = inferCcfBgmSlotKeyFromElement(dialog)
        || dialog.dataset.ccfBgmSlotKey
        || (isRecentCcfBgmClick() ? ccfBgmEditingSlotKey : "")
        || ccfBgmLastDialogSlotKey;

      if (!slotKey) {
        return;
      }

      if (!dialog.dataset.ccfBgmSlotKey) {
        dialog.dataset.ccfBgmSlotKey = slotKey;
      }
      ccfBgmLastDialogSlotKey = slotKey;
    });
  }

  function clampCcfBgmVolume(value, fallback = 100) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function getCcfYoutubeBgmEditVolume(entry, slotKey) {
    const storedVolume = Number(entry?.volume);
    if (Number.isFinite(storedVolume) && (storedVolume > 0 || entry?.volumeEdited === true)) {
      return clampCcfBgmVolume(storedVolume, 100);
    }

    const slotVolume = readCcfBgmSlotVolumeFromButton(findCcfBgmButtonBySlot(slotKey));
    const fallbackVolume = clampCcfBgmVolume(slotVolume, 100);
    return fallbackVolume > 0 ? fallbackVolume : 100;
  }

  function isDefaultCcfYoutubeBgmTitle(value) {
    const title = normalizeSpace(value || "");
    return !title || title === "YouTube BGM";
  }

  function isCustomCcfYoutubeBgmName(entry) {
    const displayName = normalizeSpace(entry?.displayName || "");
    const title = normalizeSpace(entry?.title || "");
    return !!displayName && displayName !== "YouTube BGM" && displayName !== title;
  }

  function normalizeCcfBgmSlotKey(value) {
    const match = String(value || "").trim().match(/^BGM\s*(\d+)/i);
    return match ? `BGM${match[1]}`.toUpperCase() : "";
  }

  function makeCcfYoutubeBgmEntryKey(slotKey, videoId) {
    const safeSlot = normalizeCcfBgmSlotKey(slotKey) || "BGM";
    const safeVideoId = sanitizeCcfYoutubeVideoId(videoId) || "youtube";
    return `${safeSlot}:youtube:${safeVideoId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  }

  function getCcfBgmEntrySlotKey(entryKey, entry = null) {
    return normalizeCcfBgmSlotKey(entry?.slotKey)
      || normalizeCcfBgmSlotKey(entryKey);
  }

  function getCcfYoutubeBgmOrder(entry, fallback = 0) {
    const order = Number(entry?.order);
    if (Number.isFinite(order) && order > 0) {
      return order;
    }

    const createdAt = Number(entry?.createdAt);
    if (Number.isFinite(createdAt) && createdAt > 0) {
      return createdAt;
    }

    const updatedAt = Number(entry?.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt > 0) {
      return updatedAt;
    }

    return fallback;
  }

  function compareCcfYoutubeBgmEntries(a, b) {
    const [aKey, aEntry] = a;
    const [bKey, bEntry] = b;
    const orderDiff = getCcfYoutubeBgmOrder(aEntry) - getCcfYoutubeBgmOrder(bEntry);
    if (orderDiff) {
      return orderDiff;
    }

    const slotDiff = getCcfBgmEntrySlotKey(aKey, aEntry)
      .localeCompare(getCcfBgmEntrySlotKey(bKey, bEntry));
    if (slotDiff) {
      return slotDiff;
    }

    return aKey.localeCompare(bKey);
  }

  function getNextCcfYoutubeBgmOrder() {
    const maxOrder = [...ccfBgmSlotMap.values()].reduce((max, entry) => {
      return Math.max(max, getCcfYoutubeBgmOrder(entry));
    }, 0);
    return Math.max(Date.now(), maxOrder + 1);
  }

  function getCcfYoutubeEntriesForSlot(slotKey) {
    const normalizedSlotKey = normalizeCcfBgmSlotKey(slotKey);
    if (!normalizedSlotKey) {
      return [];
    }

    return [...ccfBgmSlotMap.entries()]
      .filter(([entryKey, entry]) => {
        return entry?.videoId
          && getCcfBgmEntrySlotKey(entryKey, entry) === normalizedSlotKey;
      })
      .sort(compareCcfYoutubeBgmEntries);
  }

  function findCcfReadyYoutubeEntryForSlot(slotKey) {
    return getCcfYoutubeEntriesForSlot(slotKey)
      .find(([, entry]) => entry?.pending !== true) || null;
  }

  function hasCcfReadyYoutubeEntryForSlot(slotKey) {
    return !!findCcfReadyYoutubeEntryForSlot(slotKey);
  }

  function findCcfYoutubeEntryKey(slotKey, targetEntry) {
    if (!targetEntry?.videoId) {
      return "";
    }

    const exactHit = getCcfYoutubeEntriesForSlot(slotKey)
      .find(([, entry]) => entry === targetEntry);
    if (exactHit) {
      return exactHit[0];
    }

    const matchedHit = getCcfYoutubeEntriesForSlot(slotKey)
      .find(([, entry]) => {
        return entry?.videoId === targetEntry.videoId
          && entry?.url === targetEntry.url
          && Number(entry?.updatedAt || 0) === Number(targetEntry.updatedAt || 0);
      });
    return matchedHit?.[0] || "";
  }

  function createCcfYoutubeBgmEntry(slotKey, url, videoId, previous = {}) {
    const previousTitle = normalizeSpace(previous.title || "");
    const previousDisplayName = normalizeSpace(previous.displayName || "");
    const isSameVideo = previous.videoId === videoId;
    const slotButton = findCcfBgmButtonBySlot(slotKey);
    const buttonState = readCcfBgmStateFromButton(slotButton);
    const slotVolume = clampCcfBgmVolume(readCcfBgmSlotVolumeFromButton(slotButton), 100) || 100;
    const title = isSameVideo && previousTitle ? previousTitle : "YouTube BGM";
    const displayName = isCustomCcfYoutubeBgmName(previous)
      ? previousDisplayName
      : (isSameVideo && previousDisplayName ? previousDisplayName : title);
    const now = Date.now();
    const createdAt = Number(previous.createdAt) || now;

    return {
      ...previous,
      slotKey: normalizeCcfBgmSlotKey(slotKey),
      url,
      videoId,
      title,
      displayName: normalizeSpace(displayName || "") || title,
      volume: Number.isFinite(Number(previous.volume)) && (Number(previous.volume) > 0 || previous.volumeEdited === true)
        ? clampCcfBgmVolume(previous.volume)
        : slotVolume,
      volumeEdited: previous.volumeEdited === true,
      loop: typeof previous.loop === "boolean" ? previous.loop : buttonState.loop,
      updatedAt: previous.url === url && previous.videoId === videoId
        ? Number(previous.updatedAt) || now
        : now,
      createdAt,
      order: Number.isFinite(Number(previous.order)) && Number(previous.order) > 0
        ? Number(previous.order)
        : getNextCcfYoutubeBgmOrder(),
      pending: isSameVideo ? previous.pending !== false : true
    };
  }

  function storeCcfBgmSlotUrl(slotKey, url, mountRoot = null) {
    const videoId = extractCcfYoutubeVideoId(url);
    if (!slotKey || !videoId) {
      return;
    }

    const normalizedSlotKey = normalizeCcfBgmSlotKey(slotKey);
    const entryKey = makeCcfYoutubeBgmEntryKey(normalizedSlotKey, videoId);
    const entry = createCcfYoutubeBgmEntry(normalizedSlotKey, url, videoId, {});

    const tabSignature = normalizeCcfBgmTabSignature(
      getCcfBgmActiveTabSignature(mountRoot instanceof Element ? mountRoot : null)
    );
    if (tabSignature) {
      entry.tabSignature = tabSignature;
    }

    ccfBgmLastDialogSlotKey = normalizedSlotKey;
    ccfBgmSlotMap.set(entryKey, entry);
    persistCcfBgmSlotMap();
    debugLog("bgm-youtube-url-stored", {
      slotKey: normalizedSlotKey,
      entryKey,
      url
    });
    fetchCcfYoutubeTitle(entryKey, entry);
    renderCcfYoutubeBgmLibraryItems(mountRoot);
    markCcfYoutubeBgmSlotButtons();
    cueCcfYoutubeBgmSlot(normalizedSlotKey, entry, entryKey);
  }

  function updateCcfBgmSlotStateFromButton(slotKey, button) {
    const state = readCcfBgmStateFromButton(button);
    const slotVolume = clampCcfBgmVolume(readCcfBgmSlotVolumeFromButton(button), 100) || 100;
    getCcfYoutubeEntriesForSlot(slotKey).forEach(([entryKey, entry]) => {
      if (!entry?.videoId) {
        return;
      }

      entry.loop = state.loop;
      if (entry.volumeEdited !== true) {
        entry.volume = slotVolume;
      }
      ccfBgmSlotMap.set(entryKey, entry);
    });
  }

  function fetchStoredCcfYoutubeTitles() {
    ccfBgmSlotMap.forEach((entry, entryKey) => {
      if (entry?.videoId && isDefaultCcfYoutubeBgmTitle(entry.title)) {
        fetchCcfYoutubeTitle(entryKey, entry);
      }
    });
  }

  function fetchCcfYoutubeTitle(entryKey, entry) {
    if (!entryKey || !entry?.url || !entry?.videoId) {
      return;
    }

    const cacheKey = `${entryKey}:${entry.videoId}`;
    if (ccfBgmTitleFetchMap.has(cacheKey)) {
      return;
    }

    const request = fetchCcfNoembedTitle(entry.url)
      .then((title) => {
        applyCcfYoutubeBgmTitle(entryKey, entry.videoId, title);
      })
      .catch((error) => {
        ccfBgmTitleFetchMap.delete(cacheKey);
        debugLog("bgm-youtube-title-fetch-failed", error?.fetchError
          ? {
            fetch: error.fetchError,
            jsonp: error.jsonpError
          }
          : serializeError(error));
      });

    ccfBgmTitleFetchMap.set(cacheKey, request);
  }

  function fetchCcfNoembedTitle(url) {
    const noembedUrl = `https://noembed.com/embed?url=${encodeURIComponent(url)}`;

    return fetch(noembedUrl, {
      credentials: "omit",
      referrerPolicy: "no-referrer"
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`noembed-http-${response.status}`);
        }

        return response.json();
      })
      .then((data) => normalizeSpace(data?.title || ""))
      .catch((fetchError) => {
        return fetchCcfNoembedTitleJsonp(url).catch((jsonpError) => {
          const error = new Error("noembed-title-failed");
          error.fetchError = serializeError(fetchError);
          error.jsonpError = serializeError(jsonpError);
          throw error;
        });
      });
  }

  function fetchCcfNoembedTitleJsonp(url) {
    return new Promise((resolve, reject) => {
      const scriptTarget = document.head || document.documentElement || document.body;
      if (!scriptTarget) {
        reject(new Error("noembed-jsonp-target-missing"));
        return;
      }

      const callbackName = `__ccfYoutubeBgmTitleCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      let completed = false;

      const cleanup = () => {
        window.clearTimeout(timer);
        try {
          delete window[callbackName];
        } catch (error) {
          window[callbackName] = undefined;
        }
        script.remove();
      };

      const timer = window.setTimeout(() => {
        if (completed) {
          return;
        }

        completed = true;
        cleanup();
        reject(new Error("noembed-jsonp-timeout"));
      }, 8000);

      window[callbackName] = (data) => {
        if (completed) {
          return;
        }

        completed = true;
        cleanup();
        resolve(normalizeSpace(data?.title || ""));
      };

      script.onerror = () => {
        if (completed) {
          return;
        }

        completed = true;
        cleanup();
        reject(new Error("noembed-jsonp-error"));
      };

      script.async = true;
      script.src = `https://noembed.com/embed?url=${encodeURIComponent(url)}&callback=${encodeURIComponent(callbackName)}`;
      scriptTarget.appendChild(script);
    });
  }

  function applyCcfYoutubeBgmTitle(entryKey, videoId, title) {
    const normalizedTitle = normalizeSpace(title || "");
    if (!normalizedTitle) {
      return false;
    }

    const current = ccfBgmSlotMap.get(entryKey);
    if (!current || current.videoId !== videoId) {
      return false;
    }

    const hasCustomName = isCustomCcfYoutubeBgmName(current);
    const nextDisplayName = hasCustomName ? current.displayName : normalizedTitle;
    if (current.title === normalizedTitle && current.displayName === nextDisplayName) {
      return true;
    }

    current.title = normalizedTitle;
    current.displayName = nextDisplayName;
    current.updatedAt = Date.now();
    ccfBgmSlotMap.set(entryKey, current);
    persistCcfBgmSlotMap();
    renderCcfYoutubeBgmLibraryItems();
    markCcfYoutubeBgmSlotButtons();
    return true;
  }

  function adoptCcfYoutubeBgmPlayerTitle(entryKey, videoId) {
    window.setTimeout(() => {
      if (!entryKey || !videoId || !ccfBgmPlayer || ccfBgmPlayerVideoId !== videoId) {
        return;
      }

      try {
        const data = typeof ccfBgmPlayer.getVideoData === "function"
          ? ccfBgmPlayer.getVideoData()
          : null;
        // 플레이어가 아직 이전 영상 데이터를 들고 있을 수 있으므로,
        // getVideoData()의 video_id가 대상 영상과 일치할 때만 제목을 반영한다.
        // (일치하지 않으면 다른 음원의 제목이 덮어씌워지는 오류 발생)
        if (data && data.video_id === videoId && data.title) {
          applyCcfYoutubeBgmTitle(entryKey, videoId, data.title);
        }
      } catch (error) {
        debugLog("bgm-youtube-player-title-failed", serializeError(error));
      }
    }, 600);
  }

  function readCcfYoutubeBgmPlaybackState(slotKey, entry, button) {
    const state = readCcfBgmStateFromButton(button || findCcfBgmButtonBySlot(slotKey));
    const storedEntry = entry
      || ccfBgmSlotMap.get(ccfBgmActiveEntryKey)
      || findCcfReadyYoutubeEntryForSlot(slotKey)?.[1];

    if (storedEntry && Number.isFinite(Number(storedEntry.volume))) {
      const entryVolume = getCcfYoutubeBgmEditVolume(storedEntry, slotKey);
      const globalVolume = readCcfBgmGlobalVolume(button || findCcfBgmButtonBySlot(slotKey));
      state.volume = Math.max(0, Math.min(100, Math.round(entryVolume * globalVolume / 100)));
    }

    if (storedEntry && typeof storedEntry.loop === "boolean") {
      state.loop = storedEntry.loop;
    }

    return state;
  }

  function prepareCcfYoutubeBgmPlayerFromEntries(entries) {
    if (ccfBgmActiveSlotKey || ccfBgmPlayer) {
      return;
    }

    const candidates = (entries || []).filter(([entryKey, entry]) => {
      return entryKey
        && entry?.videoId
        && getCcfBgmEntrySlotKey(entryKey, entry);
    });

    // 새로고침 직전 마지막으로 활성화된 entry 우선 cue. 없으면 기존 정렬 사용.
    let hit = null;
    const persisted = readCcfBgmPersistedActiveSlot();
    if (persisted?.entryKey) {
      hit = candidates.find(([entryKey]) => entryKey === persisted.entryKey) || null;
    }
    if (!hit) {
      hit = candidates.sort(compareCcfYoutubeBgmEntries)[0];
    }
    if (!hit) {
      return;
    }

    const targetSlotKey = getCcfBgmEntrySlotKey(hit[0], hit[1]);
    // 새로고침 직전 state 가 "playing" 이었으면 자동재생, 아니면 cue 만.
    if (persisted?.state === "playing") {
      playCcfYoutubeBgmSlot(targetSlotKey, hit[1], findCcfBgmButtonBySlot(targetSlotKey), 0, hit[0]);
    } else {
      cueCcfYoutubeBgmSlot(targetSlotKey, hit[1], hit[0]);
    }
  }

  function cueCcfYoutubeBgmSlot(slotKey, entry, entryKey = "", options = {}) {
    const normalizedSlotKey = normalizeCcfBgmSlotKey(slotKey);
    const videoId = entry?.videoId || extractCcfYoutubeVideoId(entry?.url || "");
    const resolvedEntryKey = entryKey || findCcfYoutubeEntryKey(normalizedSlotKey, entry);
    if (!normalizedSlotKey || !videoId || ccfBgmActiveSlotKey) {
      return;
    }

    if (!ensureYoutubePlayerHost({ visible: !!options.visible })) {
      return;
    }

    loadYoutubeIframeApi().then(() => {
      if (!window.YT || !window.YT.Player || ccfBgmActiveSlotKey) {
        return;
      }

      try {
        if (ccfBgmPlayer) {
          if (ccfBgmPlayerVideoId !== videoId && typeof ccfBgmPlayer.cueVideoById === "function") {
            ccfBgmPlayer.cueVideoById(videoId);
            ccfBgmPlayerVideoId = videoId;
          }
          adoptCcfYoutubeBgmPlayerTitle(resolvedEntryKey, videoId);
          return;
        }

        ccfBgmPlayerVideoId = videoId;
        ccfBgmPlayerReady = false;
        ccfBgmPlayer = new window.YT.Player(ccfBgmPlayerHost, {
          width: String(YOUTUBE_PLAYER_MIN_SIZE),
          height: String(YOUTUBE_PLAYER_MIN_SIZE),
          host: YOUTUBE_EMBED_HOST,
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            origin: location.origin
          },
          events: {
            onReady(event) {
              ccfBgmPlayerReady = true;
              mountCcfYoutubeBgmPlayerFrame(event.target);
              if (!ccfBgmActiveSlotKey && typeof event.target.cueVideoById === "function") {
                event.target.cueVideoById(videoId);
              }
              adoptCcfYoutubeBgmPlayerTitle(resolvedEntryKey, videoId);
              startCcfBgmProgressLoop();
            },
            onStateChange: handleCcfBgmPlayerStateChange
          }
        });
      } catch (error) {
        debugLog("bgm-youtube-cue-failed", serializeError(error));
      }
    });
  }

  function playCcfYoutubeBgmSlot(slotKey, entry, button, retryCount = 0, entryKey = "") {
    const normalizedSlotKey = normalizeCcfBgmSlotKey(slotKey);
    const videoId = entry?.videoId || extractCcfYoutubeVideoId(entry?.url || "");
    const resolvedEntryKey = entryKey || findCcfYoutubeEntryKey(normalizedSlotKey, entry);
    if (!normalizedSlotKey || !videoId) {
      return;
    }

    ccfBgmNativeLoadedSlots.delete(normalizedSlotKey);
    ccfBgmLastWebAudio = null;

    const state = readCcfYoutubeBgmPlaybackState(normalizedSlotKey, entry, button);
    ccfBgmActiveSlotKey = normalizedSlotKey;
    ccfBgmActiveEntryKey = resolvedEntryKey;
    ccfBgmActiveLoop = state.loop;
    // 새로고침 후 같은 트랙 복원을 위해 last active slot persist.
    persistCcfBgmActiveSlot(normalizedSlotKey, resolvedEntryKey, entry?.videoId);
    markCcfYoutubeBgmSlotButtons();

    if (typeof ccfBgmFirestoreEmitPlayback === "function") {
      ccfBgmFirestoreEmitPlayback({
        entryKey: resolvedEntryKey,
        slotKey: normalizedSlotKey,
        url: entry?.url || "",
        videoId,
        title: entry?.title || "",
        displayName: entry?.displayName || entry?.title || "",
        volume: state.volume,
        loop: state.loop,
        state: "playing"
      });
    }

    if (!ensureYoutubePlayerHost()) {
      if (retryCount < 50) {
        window.setTimeout(() => {
          playCcfYoutubeBgmSlot(normalizedSlotKey, entry, button, retryCount + 1, resolvedEntryKey);
        }, 100);
      } else {
        debugLog("bgm-youtube-player-host-missing", {
          slotKey: normalizedSlotKey,
          videoId
        });
        ccfBgmActiveSlotKey = "";
        ccfBgmActiveEntryKey = "";
        ccfBgmPlayerVisible = false;
        syncCcfYoutubeBgmPlayerDockVisibility();
        markCcfYoutubeBgmSlotButtons();
      }
      return;
    }
    stopNativeYoutubeMedia();
    
    // [수정됨] 모든 BGM을 끄는 stopCcfNormalBgmPlayback() 삭제

    const playExistingPlayer = () => {
      if (!ccfBgmPlayer) {
        return false;
      }

      try {
        if (ccfBgmPlayerVideoId !== videoId && typeof ccfBgmPlayer.loadVideoById === "function") {
          ccfBgmPlayer.loadVideoById(videoId);
          ccfBgmPlayerVideoId = videoId;
        } else if (typeof ccfBgmPlayer.playVideo === "function") {
          ccfBgmPlayer.playVideo();
        }
        applyCcfBgmPlayerVolume(state);
        if (typeof ccfBgmPlayer.playVideo === "function") {
          ccfBgmPlayer.playVideo();
        }
        window.setTimeout(() => applyCcfBgmPlayerVolume(state), 120);
        window.setTimeout(() => applyCcfBgmPlayerVolume(state), 500);
        reinforceCcfYoutubeBgmAudio(state, "existing-player");
        adoptCcfYoutubeBgmPlayerTitle(resolvedEntryKey, videoId);
        startCcfBgmProgressLoop();
        return true;
      } catch (error) {
        debugLog("bgm-youtube-load-failed", serializeError(error));
        return false;
      }
    };

    if (window.YT?.Player && ccfBgmPlayer && playExistingPlayer()) {
      return;
    }

    loadYoutubeIframeApi().then(() => {
      if (!window.YT || !window.YT.Player) {
        debugLog("bgm-youtube-api-missing");
        return;
      }

      if (ccfBgmPlayer) {
        playExistingPlayer();
        return;
      }

      ccfBgmPlayerVideoId = videoId;
      ccfBgmPlayerReady = false;
      ccfBgmPlayer = new window.YT.Player(ccfBgmPlayerHost, {
        width: String(YOUTUBE_PLAYER_MIN_SIZE),
        height: String(YOUTUBE_PLAYER_MIN_SIZE),
        host: YOUTUBE_EMBED_HOST,
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: location.origin
        },
        events: {
          onReady(event) {
            ccfBgmPlayerReady = true;
            mountCcfYoutubeBgmPlayerFrame(event.target);
            debugLog("bgm-youtube-ready", {
              slotKey: normalizedSlotKey,
              videoId
            });
            applyCcfBgmPlayerVolume(state);
            event.target.playVideo();
            window.setTimeout(() => applyCcfBgmPlayerVolume(state), 120);
            window.setTimeout(() => applyCcfBgmPlayerVolume(state), 500);
            reinforceCcfYoutubeBgmAudio(state, "new-player-ready");
            adoptCcfYoutubeBgmPlayerTitle(resolvedEntryKey, videoId);
            startCcfBgmProgressLoop();
          },
          onStateChange: handleCcfBgmPlayerStateChange
        }
      });
    });
  }

  function handleCcfBgmPlayerStateChange(event) {
    if (event?.data === window.YT?.PlayerState?.ENDED) {
      if (ccfBgmActiveLoop) {
        event.target.seekTo(0, true);
        event.target.playVideo();
      } else {
        ccfBgmActiveSlotKey = "";
        ccfBgmActiveEntryKey = "";
        ccfBgmPlayerVisible = false;
        updateCcfBgmPersistedState("stopped");
        syncCcfYoutubeBgmPlayerDockVisibility();
        markCcfYoutubeBgmSlotButtons();
      }
    }
    if (event?.data === window.YT?.PlayerState?.PLAYING) {
      syncCcfActiveBgmState();
      window.setTimeout(syncCcfActiveBgmState, 120);
      window.setTimeout(syncCcfActiveBgmState, 500);
      const activeEntry = ccfBgmSlotMap.get(ccfBgmActiveEntryKey)
        || findCcfReadyYoutubeEntryForSlot(ccfBgmActiveSlotKey)?.[1];
      reinforceCcfYoutubeBgmAudio(
        readCcfYoutubeBgmPlaybackState(ccfBgmActiveSlotKey, activeEntry, findCcfBgmButtonBySlot(ccfBgmActiveSlotKey)),
        "state-playing"
      );
    }
    startCcfBgmProgressLoop();
  }

  function stopCcfYoutubeBgm(reason = "manual") {
    // 사용자가 의도적으로 정지/제거한 경우만 신호를 보낸다. 자동 전환(다른 BGM 시작 등)과
    // 원격 적용은 송신 안 함(원격은 applying 가드로 이중 안전).
    // - manual / stop-button / youtube-bgm-remove: 사용자 의도 → 전파 ✅
    // - native-bgm-started / webaudio-bgm-started / native-library-selected: 다른 BGM이 시작돼서 자동 정지 → 전파 안 함
    // - remote-stop / remote-switch: 원격 신호 적용 중 → 전파 안 함
    const MANUAL_STOP_REASONS = new Set(["manual", "stop-button", "youtube-bgm-remove"]);
    const shouldEmit = MANUAL_STOP_REASONS.has(reason);

    if (!ccfBgmPlayer || typeof ccfBgmPlayer.stopVideo !== "function") {
      ccfBgmActiveSlotKey = "";
      ccfBgmActiveEntryKey = "";
      ccfBgmPlayerVisible = false;
      updateCcfBgmPersistedState("stopped");
      syncCcfYoutubeBgmPlayerDockVisibility();
      markCcfYoutubeBgmSlotButtons();
      if (shouldEmit && typeof ccfBgmFirestoreEmitPlayback === "function") {
        ccfBgmFirestoreEmitPlayback({ state: "stopped" });
      }
      return;
    }

    try {
      ccfBgmPlayer.stopVideo();
      debugLog("bgm-youtube-stopped", {
        reason
      });
    } catch (error) {
      debugLog("bgm-youtube-stop-failed", serializeError(error));
    }

    ccfBgmActiveSlotKey = "";
    ccfBgmActiveEntryKey = "";
    ccfBgmPlayerVisible = false;
    updateCcfBgmPersistedState("stopped");
    syncCcfYoutubeBgmPlayerDockVisibility();
    markCcfYoutubeBgmSlotButtons();
    if (shouldEmit && typeof ccfBgmFirestoreEmitPlayback === "function") {
      ccfBgmFirestoreEmitPlayback({ state: "stopped" });
    }
  }

  function syncCcfActiveBgmState(seed = null) {
    if (seed instanceof HTMLElement) {
      ccfBgmLastControlSeed = seed;
    }

    if (!ccfBgmActiveSlotKey || !ccfBgmPlayer) {
      return;
    }

    const button = findCcfBgmButtonBySlot(ccfBgmActiveSlotKey);
    if (!button) {
      return;
    }

    const activeEntry = ccfBgmSlotMap.get(ccfBgmActiveEntryKey)
      || findCcfReadyYoutubeEntryForSlot(ccfBgmActiveSlotKey)?.[1];
    const state = readCcfYoutubeBgmPlaybackState(ccfBgmActiveSlotKey, activeEntry, button);
    ccfBgmActiveLoop = state.loop;
    applyCcfBgmPlayerVolume(state);
  }

  function reinforceCcfYoutubeBgmAudio(state, reason = "play") {
    if (!ccfBgmActiveSlotKey) {
      return;
    }

    YOUTUBE_AUDIO_REINFORCE_DELAYS_MS.forEach((delay) => {
      window.setTimeout(() => {
        if (!ccfBgmActiveSlotKey || !ccfBgmPlayer) {
          return;
        }
        // 미리듣기로 본 재생을 일시정지한 동안에는 재생을 강제하지 않는다.
        if (ccfBgmPreviewActive) {
          return;
        }

        applyCcfBgmPlayerVolume(state);
        try {
          if (typeof ccfBgmPlayer.playVideo === "function") {
            ccfBgmPlayer.playVideo();
          }
          debugLog("bgm-youtube-audio-reinforced", {
            reason,
            delay,
            volume: typeof ccfBgmPlayer.getVolume === "function" ? ccfBgmPlayer.getVolume() : null,
            muted: typeof ccfBgmPlayer.isMuted === "function" ? ccfBgmPlayer.isMuted() : null,
            ready: ccfBgmPlayerReady,
            state: typeof ccfBgmPlayer.getPlayerState === "function" ? ccfBgmPlayer.getPlayerState() : null
          });
        } catch (error) {
          debugLog("bgm-youtube-audio-reinforce-failed", serializeError(error));
        }
      }, delay);
    });
  }

  function applyCcfBgmPlayerVolume(state) {
    if (!ccfBgmPlayer || typeof ccfBgmPlayer.setVolume !== "function") {
      return;
    }

    const volume = Math.max(0, Math.min(100, Number(state?.volume) || 0));
    try {
      if (volume <= 0) {
        ccfBgmPlayer.setVolume(0);
        if (typeof ccfBgmPlayer.mute === "function") {
          ccfBgmPlayer.mute();
        }
        return;
      }

      ccfBgmPlayer.setVolume(volume);
      if (typeof ccfBgmPlayer.unMute === "function") {
        ccfBgmPlayer.unMute();
      }
      ccfBgmPlayer.setVolume(volume);
      if (typeof ccfBgmPlayer.unMute === "function") {
        ccfBgmPlayer.unMute();
      }
    } catch (error) {
      debugLog("bgm-youtube-volume-failed", serializeError(error));
    }
  }

  function readCcfBgmStateFromButton(button) {
    const label = button instanceof HTMLElement ? button.getAttribute("aria-label") || "" : "";
    const loopMatch = label.match(/loop\s*:\s*(on|off)/i);
    const slotVolume = readCcfBgmSlotVolumeFromButton(button);
    const globalVolume = readCcfBgmGlobalVolume(button);

    return {
      volume: Math.max(0, Math.min(100, Math.round(slotVolume * globalVolume / 100))),
      loop: loopMatch ? loopMatch[1].toLowerCase() === "on" : true
    };
  }

  function readCcfBgmSlotVolumeFromButton(button) {
    const label = button instanceof HTMLElement ? button.getAttribute("aria-label") || "" : "";
    const volMatch = label.match(/vol\s*:\s*(-?\d+(?:\.\d+)?)/i);
    return volMatch ? convertCcfBgmSlotVolume(Number(volMatch[1])) : 100;
  }

  function convertCcfBgmSlotVolume(value) {
    if (!Number.isFinite(value)) {
      return 100;
    }

    if (value >= -60 && value <= 24) {
      return Math.max(0, Math.min(100, 100 * Math.pow(10, value / 20)));
    }

    return Math.max(0, Math.min(100, value));
  }

  function readCcfBgmGlobalVolume(seed) {
    const panel = findCcfBgmPanel(seed)
      || findCcfBgmPanel(ccfBgmLastControlSeed)
      || findCcfBgmPanel(document.activeElement)
      || findCcfBgmPanel();
    if (isCcfBgmPanelMuted(panel)) {
      return 0;
    }

    const input = panel?.querySelector('.MuiSlider-root input[type="range"]');
    if (!(input instanceof HTMLInputElement)) {
      return 100;
    }

    const value = Number(input.value);
    const min = Number(input.min || 0);
    const max = Number(input.max || 1);
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= min) {
      return 100;
    }

    if (max <= 1.1) {
      return Math.max(0, Math.min(100, Math.round(value * 100)));
    }

    return Math.max(0, Math.min(100, Math.round((value - min) / (max - min) * 100)));
  }

  function isCcfBgmPanelMuted(panel) {
    if (!(panel instanceof HTMLElement)) {
      return false;
    }

    return [...panel.querySelectorAll("button")]
      .some((button) => isCcfBgmMuteButtonActive(button));
  }

  function isCcfBgmMuteButtonActive(button) {
    if (!(button instanceof HTMLElement) || !isCcfBgmVolumeButton(button)) {
      return false;
    }
    if (getCcfBgmSlotKeyFromButton(button) || button.closest(".ccf-youtube-bgm-row-wrap, .ccf-youtube-bgm-popover")) {
      return false;
    }

    // 토글 버튼이 aria-pressed/aria-selected로 상태를 명시하면 그 값을 신뢰한다.
    // 음소거 버튼은 상태와 무관하게 스피커 아이콘이 고정돼 있어 아이콘만으로 판단하면 안 된다.
    const ariaPressed = button.getAttribute("aria-pressed");
    const ariaSelected = button.getAttribute("aria-selected");
    if (ariaPressed === "true" || ariaSelected === "true") {
      return true;
    }
    if (ariaPressed === "false" || ariaSelected === "false") {
      return false;
    }

    // volumemute(VolumeMuteIcon)는 저음량 표시 아이콘이라 음소거 판정에서 제외한다.
    const stateText = getCcfBgmButtonStateText(button);
    if (/(volumeoff|volume_off|\bmuted\b|unmute|음소거\s*해제|ミュ?ト解除|ミュ?ト中)/i.test(stateText)) {
      return true;
    }

    if (button.dataset.active === "true" || button.dataset.selected === "true" || button.dataset.checked === "true") {
      return true;
    }

    const classText = `${button.className || ""} ${button.querySelector("svg")?.getAttribute("class") || ""}`;
    return /\b(Mui-selected|selected|active)\b/i.test(classText);
  }

  function isCcfBgmVolumeButton(button) {
    return button instanceof HTMLElement
      && !!button.querySelector('[data-testid*="Volume"], [data-testid*="Mute"]');
  }

  function getCcfBgmButtonStateText(button) {
    if (!(button instanceof HTMLElement)) {
      return "";
    }

    const parts = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.dataset.testid
    ];
    button.querySelectorAll("[data-testid], title").forEach((node) => {
      if (node instanceof Element) {
        parts.push(node.getAttribute("data-testid"));
        parts.push(node.textContent);
      }
    });
    return normalizeSpace(parts.filter(Boolean).join(" "));
  }

  function tryEnhanceCcfBgmPanel() {
    if (isCcfNativeBgmEditGraceActive()) {
      return;
    }

    markCcfBgmDrawerSizeLocks();

    const panel = findCcfBgmPanel();
    if (!panel) {
      return;
    }

    ensureCcfBgmProgressBar(panel);
    if (ccfBgmPlayerVisible) {
      mountCcfYoutubeBgmPlayerFrame();
    }
    renderCcfYoutubeBgmLibraryItems();
    markCcfYoutubeBgmSlotButtons();
    startCcfBgmProgressLoop();
    syncCcfBgmYoutubeMultiSelectUI();
  }

  function markCcfBgmDrawerSizeLocks() {
    // 하단 드로어는 BGM/효과음/전경/배경 등 여러 탭이 공유한다.
    // 현재 보이는 패널이 실제 BGM 라이브러리일 때만 640px 잠금을 걸고,
    // 다른 탭(전경/배경 등)으로 옮겼거나 드로어가 닫혔으면 잠금을 즉시 해제한다.
    document.querySelectorAll(".MuiDrawer-paper.MuiDrawer-paperAnchorBottom").forEach((drawer) => {
      if (!(drawer instanceof HTMLElement)) {
        return;
      }

      if (isCcfBgmDrawer(drawer)) {
        drawer.setAttribute("data-ccf-bgm-drawer-size-lock", "1");
      } else if (drawer.hasAttribute("data-ccf-bgm-drawer-size-lock")) {
        drawer.removeAttribute("data-ccf-bgm-drawer-size-lock");
      }
    });
  }

  function isCcfBgmDrawer(drawer) {
    if (!(drawer instanceof HTMLElement)) {
      return false;
    }

    // BGM 라이브러리와 이미지 라이브러리(전경/배경/캐릭터 선택)는 둘 다
    // 하단 드로어 + MuiTabs + input[name="url"]을 가져서 헷갈리기 쉽다.
    // BGM 패널에만 고유하게 나타나는 시그널로만 좁힌다:
    //   - LibraryMusicIcon: BGM 슬롯 좌측의 음악 노트 아이콘
    //   - aria-label에 "BGM" 문자열: 한글/영어 UI
    // StopIcon, input[name="url"], "メディア"는 다른 드로어에도 등장하므로 제외.
    return !!drawer.querySelector(
      '[data-testid="LibraryMusicIcon"], [aria-label*="BGM"]'
    );
  }

  function markCcfYoutubeBgmSlotButtons() {
    // YouTube 음원을 "실제로 재생 중"인 슬롯에만 표시한다.
    // 단순 등록(대기) 상태로는 네이티브 버튼 외형을 바꾸지 않는다.
    document.querySelectorAll("button").forEach((button) => {
      const slotKey = getCcfBgmSlotKeyFromButton(button);
      if (!slotKey) {
        return;
      }

      const isPlayingYoutube = !!ccfBgmActiveSlotKey
        && slotKey === ccfBgmActiveSlotKey;
      if (isPlayingYoutube) {
        button.setAttribute("data-ccf-youtube-bgm-registered", "true");
      } else {
        button.removeAttribute("data-ccf-youtube-bgm-registered");
      }
    });

    if (
      ccfBgmNativeTooltipButton
      && !ccfBgmNativeTooltipButton.hasAttribute("data-ccf-youtube-bgm-registered")
    ) {
      hideCcfBgmNativeTooltip();
    }
  }

  function getCcfBgmTooltipEntryForSlot(slotKey) {
    if (!slotKey) {
      return null;
    }
    if (ccfBgmActiveSlotKey === slotKey && ccfBgmActiveEntryKey) {
      const activeEntry = ccfBgmSlotMap.get(ccfBgmActiveEntryKey);
      if (activeEntry?.videoId) {
        return activeEntry;
      }
    }
    const ready = findCcfReadyYoutubeEntryForSlot(slotKey);
    if (ready?.[1]?.videoId) {
      return ready[1];
    }
    return getCcfYoutubeEntriesForSlot(slotKey)[0]?.[1] || null;
  }

  function ensureCcfBgmNativeTooltip() {
    if (ccfBgmNativeTooltipEl && document.body && document.body.contains(ccfBgmNativeTooltipEl)) {
      return ccfBgmNativeTooltipEl;
    }
    const tip = document.createElement("div");
    tip.className = "ccf-bgm-native-tooltip";
    tip.setAttribute("role", "tooltip");
    tip.dataset.visible = "0";
    tip.innerHTML = [
      '<div class="ccf-bgm-native-tooltip-title"></div>',
      '<div class="ccf-bgm-native-tooltip-meta"></div>'
    ].join("");
    (document.body || document.documentElement).appendChild(tip);
    ccfBgmNativeTooltipEl = tip;
    return tip;
  }

  function showCcfBgmNativeTooltip(button, slotKey) {
    const entry = getCcfBgmTooltipEntryForSlot(slotKey);
    if (!entry) {
      hideCcfBgmNativeTooltip();
      return;
    }

    const tip = ensureCcfBgmNativeTooltip();
    const title = normalizeSpace(entry.displayName || entry.title || "YouTube BGM") || "YouTube BGM";
    const volume = clampCcfBgmVolume(entry.volume, 100);
    const loopOn = entry.loop !== false;

    const titleEl = tip.querySelector(".ccf-bgm-native-tooltip-title");
    const metaEl = tip.querySelector(".ccf-bgm-native-tooltip-meta");
    if (titleEl) {
      titleEl.textContent = title;
    }
    if (metaEl) {
      metaEl.textContent = `vol: ${volume} · loop: ${loopOn ? "on" : "off"}`;
    }

    const needsReposition = ccfBgmNativeTooltipButton !== button || tip.dataset.visible !== "1";
    ccfBgmNativeTooltipButton = button;
    tip.dataset.visible = "1";
    if (needsReposition) {
      positionCcfBgmNativeTooltip(button, tip);
    }
  }

  function positionCcfBgmNativeTooltip(button, tip) {
    if (!(button instanceof HTMLElement) || !(tip instanceof HTMLElement)) {
      return;
    }
    const rect = button.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const margin = 6;
    const left = Math.max(
      margin,
      Math.min(
        rect.left + rect.width / 2 - tipRect.width / 2,
        window.innerWidth - tipRect.width - margin
      )
    );
    let top = rect.bottom + margin;
    if (top + tipRect.height > window.innerHeight - margin) {
      top = rect.top - tipRect.height - margin;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - tipRect.height - margin));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  function hideCcfBgmNativeTooltip() {
    ccfBgmNativeTooltipButton = null;
    if (ccfBgmNativeTooltipEl) {
      ccfBgmNativeTooltipEl.dataset.visible = "0";
    }
  }

  function teardownCcfBgmNativeTooltip() {
    ccfBgmNativeTooltipButton = null;
    if (ccfBgmNativeTooltipEl) {
      ccfBgmNativeTooltipEl.remove();
      ccfBgmNativeTooltipEl = null;
    }
  }

  function handleCcfBgmTooltipPointerOver(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest('button[data-ccf-youtube-bgm-registered]');
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const slotKey = getCcfBgmSlotKeyFromButton(button);
    if (!slotKey) {
      return;
    }
    showCcfBgmNativeTooltip(button, slotKey);
  }

  function handleCcfBgmTooltipPointerOut(event) {
    if (!ccfBgmNativeTooltipButton) {
      return;
    }
    if (event.type === "pointerdown") {
      hideCcfBgmNativeTooltip();
      return;
    }
    const related = event.relatedTarget;
    if (related instanceof Node && ccfBgmNativeTooltipButton.contains(related)) {
      return;
    }
    hideCcfBgmNativeTooltip();
  }

  function hasCcfNormalSoundLoaded(button) {
    if (!(button instanceof HTMLElement)) {
      return false;
    }
    const text = normalizeSpace(button.textContent || "");
    const remainder = text.replace(/^BGM\s*\d+/i, "").trim();
    return remainder.length > 0;
  }

  function renderCcfYoutubeBgmLibraryItems(mountRoot = null) {
    const listRoot = findCcfYoutubeBgmLibraryHost(mountRoot);
    if (!(listRoot instanceof HTMLElement)) {
      cleanupMisplacedCcfYoutubeBgmItems();
      return;
    }

    if (ccfYoutubeBgmDragState?.dragging) {
      return;
    }

    cleanupMisplacedCcfYoutubeBgmItems(listRoot);

    const container = findCcfYoutubeBgmInsertionContainer(listRoot);
    if (!(container instanceof HTMLElement)) {
      return;
    }

    const activeTabSig = getCcfBgmActiveTabSignature(listRoot);
    let tabSignatureChanged = false;

    const entries = [...ccfBgmSlotMap.entries()]
      .filter(([entryKey, entry]) => {
        if (!entry?.videoId) {
          return false;
        }
        const entryTabSig = normalizeCcfBgmTabSignature(entry.tabSignature);
        
        // 1. 신규 추가 항목 (서명 없음)
        if (activeTabSig && !entryTabSig) {
          entry.tabSignature = activeTabSig;
          entry.updatedAt = Date.now();
          ccfBgmSlotMap.set(entryKey, entry);
          tabSignatureChanged = true;
          return true;
        }
        
        if (!activeTabSig) {
          return true;
        }
        
        // 2. 현재 탭 서명과 정확히 일치
        if (entryTabSig === activeTabSig) {
          return true;
        }

        // 3. [추가된 로직] 하위 호환성 및 마이그레이션 방어
        // 기존 "0::BGM 1" 형태의 서명을 가진 항목이 사라지지 않도록 처리하되,
        // PRO 탭으로는 절대 편입되지 않도록 막습니다.
        if (activeTabSig.startsWith(entryTabSig + "::")) {
          if (!/PRO/i.test(activeTabSig)) {
            entry.tabSignature = activeTabSig;
            entry.updatedAt = Date.now();
            ccfBgmSlotMap.set(entryKey, entry);
            tabSignatureChanged = true;
            return true;
          }
        }

        return false;
      });

    if (tabSignatureChanged) {
      persistCcfBgmSlotMap();
    }

    const nativeAnchorOrder = getCcfYoutubeBgmNativeAnchorOrder(container);

    // anchorSlot이 아직 없는 신규/레거시 항목을 "현재 마지막 네이티브 뒤"에 고정한다.
    // 이걸 영구 저장하지 않으면, 매 렌더마다 lastNativeAnchor(= 그때그때의 마지막 네이티브)를
    // 따라가서 새 네이티브가 추가될 때마다 YouTube가 같이 맨 아래로 끌려간다.
    // 즉 사용자가 본 "새 네이티브가 YouTube 위에 들어감" 현상의 원인.
    if (nativeAnchorOrder.length > 0) {
      const fallbackAnchor = nativeAnchorOrder[nativeAnchorOrder.length - 1];
      let anchorAssigned = false;
      entries.forEach(([entryKey, entry]) => {
        if (entry && typeof entry.anchorSlot !== "string") {
          entry.anchorSlot = fallbackAnchor;
          ccfBgmSlotMap.set(entryKey, entry);
          anchorAssigned = true;
        }
      });
      if (anchorAssigned) {
        persistCcfBgmSlotMap();
      }
    }

    const placementPlan = computeCcfYoutubeBgmPlacementPlan(entries, nativeAnchorOrder);

    if (!placementPlan.length) {
      container.querySelectorAll(".ccf-youtube-bgm-row-wrap").forEach((row) => row.remove());
      listRoot.querySelectorAll(".ccf-youtube-bgm-row-wrap").forEach((row) => row.remove());
      listRoot.dataset.ccfYoutubeBgmRenderSignature = `[]@${activeTabSig}`;
      return;
    }

    const signature = JSON.stringify(placementPlan.map(({ entryKey, entry, afterSlot }) => ({
      entryKey,
      afterSlot,
      slotKey: getCcfBgmEntrySlotKey(entryKey, entry),
      videoId: entry.videoId || "",
      title: entry.title || "",
      displayName: entry.displayName || "",
      volume: Number.isFinite(Number(entry.volume)) ? Number(entry.volume) : "",
      loop: entry.loop !== false,
      order: getCcfYoutubeBgmOrder(entry),
      tab: entry.tabSignature || ""
    }))) + `@${activeTabSig}@${nativeAnchorOrder.join("|")}`;

    const renderedDomSig = [...container.children]
      .map((child) => {
        if (!(child instanceof HTMLElement)) return "";
        if (child.classList.contains("ccf-youtube-bgm-row-wrap")) {
          return `Y:${child.dataset.ccfYoutubeBgmEntry || ""}`;
        }
        const slot = getCcfYoutubeBgmNativeSlotForListItem(child);
        return slot ? `N:${slot}` : "";
      })
      .filter(Boolean)
      .join("|");
    const expectedDomSig = buildCcfYoutubeBgmExpectedDomSig(placementPlan, nativeAnchorOrder);

    if (
      listRoot.dataset.ccfYoutubeBgmRenderSignature === signature
      && renderedDomSig === expectedDomSig
    ) {
      prepareCcfYoutubeBgmPlayerFromEntries(entries);
      return;
    }

    listRoot.dataset.ccfYoutubeBgmRenderSignature = signature;
    listRoot.querySelectorAll(".ccf-youtube-bgm-row-wrap").forEach((row) => {
      if (row.parentNode !== container) row.remove();
    });
    container.querySelectorAll(".ccf-youtube-bgm-row-wrap").forEach((row) => row.remove());

    insertCcfYoutubeBgmRowsByPlan(container, placementPlan);
    prepareCcfYoutubeBgmPlayerFromEntries(entries);
    syncCcfBgmYoutubeMultiSelectUI();
  }

  function findCcfYoutubeBgmInsertionContainer(listRoot) {
    if (!(listRoot instanceof HTMLElement)) return null;
    const nativeButtons = [...listRoot.querySelectorAll(".MuiListItemButton-root")]
      .filter((btn) => btn instanceof HTMLElement && !btn.classList.contains("ccf-youtube-bgm-item"));
    if (!nativeButtons.length) return listRoot;

    if (nativeButtons.length === 1) {
      let wrapper = nativeButtons[0];
      while (wrapper.parentElement && wrapper.parentElement !== listRoot) {
        wrapper = wrapper.parentElement;
      }
      return wrapper.parentElement instanceof HTMLElement ? wrapper.parentElement : listRoot;
    }

    const stop = listRoot.parentElement;
    const ancestors = new Set();
    let p = nativeButtons[0];
    while (p && p !== stop) {
      ancestors.add(p);
      p = p.parentElement;
    }

    p = nativeButtons[nativeButtons.length - 1];
    while (p && p !== stop) {
      if (ancestors.has(p) && p !== nativeButtons[0]) {
        if (p instanceof HTMLElement && listRoot.contains(p)) {
          return p;
        }
        return listRoot;
      }
      p = p.parentElement;
    }

    return listRoot;
  }

  function getCcfYoutubeBgmNativeSlotForListItem(item) {
    if (!(item instanceof HTMLElement)) return "";
    if (item.classList.contains("ccf-youtube-bgm-row-wrap")) return "";
    const button = item.querySelector(".MuiListItemButton-root");
    if (!(button instanceof HTMLElement) || button.classList.contains("ccf-youtube-bgm-item")) return "";
    const slotKey = getCcfBgmSlotKeyFromButton(button);
    if (slotKey) return slotKey;
    const text = normalizeSpace(button.textContent || "");
    return text ? "T:" + text : "";
  }

  function getCcfYoutubeBgmNativeAnchorOrder(container) {
    if (!(container instanceof HTMLElement)) return [];
    const order = [];
    [...container.children].forEach((child) => {
      const slot = getCcfYoutubeBgmNativeSlotForListItem(child);
      if (slot) order.push(slot);
    });
    return order;
  }

  function computeCcfYoutubeBgmPlacementPlan(entries, nativeAnchorOrder) {
    if (!Array.isArray(entries) || !entries.length) return [];
    const validAnchors = new Set(["", ...nativeAnchorOrder]);
    const lastNativeAnchor = nativeAnchorOrder.length
      ? nativeAnchorOrder[nativeAnchorOrder.length - 1]
      : "";
    const grouped = new Map();
    entries.forEach(([entryKey, entry]) => {
      // anchorSlot이 명시적으로 빈 문자열이면 "맨 위로 끌어다 둔 상태",
      // 아예 필드가 없으면 "방금 추가된 신규 항목"으로 구분한다.
      // 신규 항목은 기존 네이티브 음원 뒤(맨 아래)에 붙이는 게 자연스럽다.
      let anchor;
      if (typeof entry?.anchorSlot === "string") {
        anchor = entry.anchorSlot;
        if (!validAnchors.has(anchor)) {
          anchor = lastNativeAnchor;
        }
      } else {
        anchor = lastNativeAnchor;
      }
      if (!grouped.has(anchor)) grouped.set(anchor, []);
      grouped.get(anchor).push([entryKey, entry]);
    });
    grouped.forEach((arr) => {
      arr.sort(([aKey, aEntry], [bKey, bEntry]) => {
        const ai = Number.isFinite(Number(aEntry?.anchorIndex)) ? Number(aEntry.anchorIndex) : 9999;
        const bi = Number.isFinite(Number(bEntry?.anchorIndex)) ? Number(bEntry.anchorIndex) : 9999;
        if (ai !== bi) return ai - bi;
        return compareCcfYoutubeBgmEntries([aKey, aEntry], [bKey, bEntry]);
      });
    });
    const plan = [];
    (grouped.get("") || []).forEach(([entryKey, entry]) => {
      plan.push({ entryKey, entry, afterSlot: "" });
    });
    nativeAnchorOrder.forEach((slot) => {
      (grouped.get(slot) || []).forEach(([entryKey, entry]) => {
        plan.push({ entryKey, entry, afterSlot: slot });
      });
    });
    return plan;
  }

  function buildCcfYoutubeBgmExpectedDomSig(plan, nativeAnchorOrder) {
    const groups = new Map();
    plan.forEach((item) => {
      if (!groups.has(item.afterSlot)) groups.set(item.afterSlot, []);
      groups.get(item.afterSlot).push(item.entryKey);
    });
    const parts = [];
    (groups.get("") || []).forEach((k) => parts.push(`Y:${k}`));
    nativeAnchorOrder.forEach((slot) => {
      parts.push(`N:${slot}`);
      (groups.get(slot) || []).forEach((k) => parts.push(`Y:${k}`));
    });
    return parts.join("|");
  }

  function insertCcfYoutubeBgmRowsByPlan(container, plan) {
    if (!(container instanceof HTMLElement) || !Array.isArray(plan)) return;
    const groups = new Map();
    plan.forEach((item) => {
      if (!groups.has(item.afterSlot)) groups.set(item.afterSlot, []);
      groups.get(item.afterSlot).push(item);
    });
    const atStart = groups.get("") || [];
    const firstChild = container.firstChild;
    atStart.forEach(({ entryKey, entry }) => {
      container.insertBefore(createCcfYoutubeBgmListRow(entryKey, entry), firstChild);
    });
    [...container.children].forEach((child) => {
      const slot = getCcfYoutubeBgmNativeSlotForListItem(child);
      if (!slot) return;
      const group = groups.get(slot) || [];
      if (!group.length) return;
      const insertBefore = child.nextSibling;
      group.forEach(({ entryKey, entry }) => {
        container.insertBefore(createCcfYoutubeBgmListRow(entryKey, entry), insertBefore);
      });
    });
  }

  function createCcfYoutubeBgmListRow(entryKey, entry) {
    const slotKey = getCcfBgmEntrySlotKey(entryKey, entry);
    const row = document.createElement("div");
    const title = normalizeSpace(entry?.displayName || entry?.title || "YouTube BGM");
    const thumbnailUrl = getCcfYoutubeThumbnailUrl(entry?.videoId || "");

    row.style.opacity = "1";
    row.className = "ccf-youtube-bgm-row-wrap";
    row.dataset.ccfYoutubeBgmSlot = slotKey;
    row.dataset.ccfYoutubeBgmEntry = entryKey;

    row.innerHTML = [
      '<div role="button" tabindex="0" aria-disabled="false" aria-roledescription="sortable" style="visibility: visible;">',
      '  <div class="MuiListItem-root MuiListItem-gutters css-6h9gba">',
      `    <div class="MuiButtonBase-root MuiListItemButton-root MuiListItemButton-gutters MuiListItemButton-root MuiListItemButton-gutters css-p1biab ccf-youtube-bgm-item" tabindex="0" role="button" data-ccf-youtube-bgm-slot="${escapeCcfHtml(slotKey)}">`,
      '      <div class="MuiListItemAvatar-root css-a5kqs7">',
      `        <div class="MuiAvatar-root MuiAvatar-circular MuiAvatar-colorDefault css-1be3f8d ccf-youtube-bgm-avatar" data-ccf-youtube-bgm-has-thumb="${thumbnailUrl ? "1" : "0"}">`,
      thumbnailUrl ? `          <img class="ccf-youtube-bgm-thumb" src="${escapeCcfHtml(thumbnailUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : "",
      '          <span class="ccf-youtube-bgm-thumb-fallback" aria-hidden="true">',
      '            <svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeMedium css-vubbuv ccf-youtube-bgm-svg" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="YouTubeIcon">',
      '              <path d="M21.58 7.19a2.5 2.5 0 0 0-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.82.42A2.5 2.5 0 0 0 2.42 7.19C2 8.77 2 12 2 12s0 3.23.42 4.81a2.5 2.5 0 0 0 1.76 1.77C5.75 19 12 19 12 19s6.25 0 7.82-.42a2.5 2.5 0 0 0 1.76-1.77C22 15.23 22 12 22 12s0-3.23-.42-4.81zM10 15V9l5.2 3L10 15z"></path>',
      "            </svg>",
      "          </span>",
      '          <span class="ccf-youtube-bgm-thumb-badge" aria-hidden="true">',
      '            <svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeMedium css-vubbuv ccf-youtube-bgm-svg" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="YouTubeIcon">',
      '              <path d="M21.58 7.19a2.5 2.5 0 0 0-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.82.42A2.5 2.5 0 0 0 2.42 7.19C2 8.77 2 12 2 12s0 3.23.42 4.81a2.5 2.5 0 0 0 1.76 1.77C5.75 19 12 19 12 19s6.25 0 7.82-.42a2.5 2.5 0 0 0 1.76-1.77C22 15.23 22 12 22 12s0-3.23-.42-4.81zM10 15V9l5.2 3L10 15z"></path>',
      "            </svg>",
      "          </span>",
      "        </div>",
      "      </div>",
      '      <div class="MuiListItemText-root sc-iyHQwM eUmeWw css-1tsvksn ccf-youtube-bgm-main">',
      `        <span class="MuiTypography-root MuiTypography-body1 MuiListItemText-primary css-yb0lig ccf-youtube-bgm-title">${escapeCcfHtml(title)}</span>`,
      "      </div>",
      '      <span class="MuiTouchRipple-root css-w0pj6f"></span>',
      "    </div>",
      '    <div class="MuiListItemSecondaryAction-root css-y3qv5r">',
      '      <button class="MuiButtonBase-root MuiIconButton-root MuiIconButton-edgeEnd MuiIconButton-sizeLarge css-1pvfj5s ccf-youtube-bgm-edit" tabindex="0" type="button" aria-label="YouTube BGM 편집">',
      '        <svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeMedium css-vubbuv" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="EditIcon">',
      '          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path>',
      "        </svg>",
      '        <span class="MuiTouchRipple-root css-w0pj6f"></span>',
      "      </button>",
      "    </div>",
      "  </div>",
      "</div>"
    ].join("");

    const itemButton = row.querySelector(".ccf-youtube-bgm-item");
    const editButton = row.querySelector(".ccf-youtube-bgm-edit");
    const sortableButton = row.firstElementChild;
    const thumbnail = row.querySelector(".ccf-youtube-bgm-thumb");

    if (thumbnail instanceof HTMLImageElement) {
      thumbnail.addEventListener("error", () => {
        thumbnail.hidden = true;
        thumbnail.style.setProperty("display", "none", "important");
        thumbnail.setAttribute("aria-hidden", "true");
        thumbnail.closest(".ccf-youtube-bgm-avatar")?.setAttribute("data-ccf-youtube-bgm-thumb-failed", "1");
      }, { once: true });
    }

    if (editButton instanceof HTMLButtonElement) {
      editButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        openCcfYoutubeBgmEditPopover(entryKey, editButton);
      }, true);
    }

    const play = () => {
      const current = ccfBgmSlotMap.get(entryKey) || entry;
      // 현재 열려있는 다이얼로그의 슬롯 키를 최우선으로 가져옵니다.
      const targetSlotKey = ccfBgmEditingSlotKey || ccfBgmLastDialogSlotKey || slotKey;

      if (current) {
        current.pending = false;
        current.updatedAt = Date.now();
        ccfBgmSlotMap.set(entryKey, current);
        persistCcfBgmSlotMap();
        markCcfYoutubeBgmSlotButtons();
      }
      playCcfYoutubeBgmSlot(targetSlotKey, current, findCcfBgmButtonBySlot(targetSlotKey), 0, entryKey);
    };

    const warmPlayer = () => {
      const current = ccfBgmSlotMap.get(entryKey) || entry;
      if (!current?.videoId || ccfBgmActiveSlotKey) {
        return;
      }
      const targetSlotKey = ccfBgmEditingSlotKey || ccfBgmLastDialogSlotKey || slotKey;
      loadYoutubeIframeApi();
      cueCcfYoutubeBgmSlot(targetSlotKey, current, entryKey);
    };

    const handlePlayKeydown = (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      warmPlayer();
      play();
    };

    if (itemButton instanceof HTMLElement) {
      itemButton.addEventListener("pointerenter", warmPlayer);
      itemButton.addEventListener("focus", warmPlayer);
      itemButton.addEventListener("pointerdown", warmPlayer, true);
      itemButton.addEventListener("click", (event) => {
        if (Date.now() < ccfYoutubeBgmSuppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (event.target instanceof Element && event.target.closest(".ccf-youtube-bgm-edit")) {
          return;
        }

        warmPlayer();
        play();
      });
      itemButton.addEventListener("keydown", handlePlayKeydown);
    }

    if (sortableButton instanceof HTMLElement) {
      sortableButton.addEventListener("keydown", (event) => {
        if (event.target !== sortableButton) {
          return;
        }

        handlePlayKeydown(event);
      });
      sortableButton.addEventListener("pointerdown", (event) => {
        beginCcfYoutubeBgmRowDrag(event, row, entryKey);
      });
    }

    return row;
  }

  function beginCcfYoutubeBgmRowDrag(event, row, entryKey) {
    if (!(row instanceof HTMLElement) || !entryKey || event.button !== 0) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("button, input, textarea, select, a")) {
      return;
    }

    const muiList = row.closest(".MuiList-root");
    if (!(muiList instanceof HTMLElement)) {
      return;
    }
    const listRoot = findCcfYoutubeBgmInsertionContainer(muiList) || muiList;

    ccfYoutubeBgmDragState = {
      entryKey,
      listRoot,
      row,
      clone: null,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rowStartTop: 0,
      rowStartLeft: 0,
      dragging: false
    };

    window.addEventListener("pointermove", handleCcfYoutubeBgmRowDragMove, true);
    window.addEventListener("pointerup", handleCcfYoutubeBgmRowDragEnd, true);
    window.addEventListener("pointercancel", handleCcfYoutubeBgmRowDragEnd, true);
  }

  function handleCcfYoutubeBgmRowDragMove(event) {
    const state = ccfYoutubeBgmDragState;
    if (!state || event.pointerId !== state.pointerId) {
      return;
    }

    const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
    if (!state.dragging) {
      if (distance < 5) {
        return;
      }

      state.dragging = true;
      ccfYoutubeBgmSuppressClickUntil = Date.now() + 600;

      const rect = state.row.getBoundingClientRect();
      state.rowStartTop = rect.top;
      state.rowStartLeft = rect.left;

      const clone = state.row.cloneNode(true);
      clone.classList.add("ccf-youtube-bgm-drag-clone");
      clone.classList.remove("ccf-youtube-bgm-animating");
      clone.removeAttribute("data-ccf-youtube-bgm-animation-token");

      const sourceComputed = window.getComputedStyle(state.row);
      const cloneStyle = clone.style;
      cloneStyle.setProperty("position", "fixed", "important");
      cloneStyle.setProperty("top", `${rect.top}px`, "important");
      cloneStyle.setProperty("left", `${rect.left}px`, "important");
      cloneStyle.setProperty("width", `${rect.width}px`, "important");
      cloneStyle.setProperty("height", `${rect.height}px`, "important");
      cloneStyle.setProperty("margin", "0", "important");
      cloneStyle.setProperty("z-index", "2147483647", "important");
      cloneStyle.setProperty("pointer-events", "none", "important");
      cloneStyle.setProperty("color", sourceComputed.color, "important");
      cloneStyle.setProperty("font-family", sourceComputed.fontFamily, "important");
      cloneStyle.setProperty("font-size", sourceComputed.fontSize, "important");
      cloneStyle.setProperty("background-color", "rgba(44, 44, 44, 0.95)", "important");
      cloneStyle.setProperty("border-radius", "4px", "important");
      cloneStyle.setProperty("box-shadow",
        "0 8px 20px rgba(0, 0, 0, 0.45), 0 2px 6px rgba(0, 0, 0, 0.3)",
        "important");
      cloneStyle.setProperty("will-change", "transform", "important");

      document.body.appendChild(clone);
      state.clone = clone;

      state.row.style.setProperty("visibility", "hidden", "important");
      state.row.classList.add("ccf-youtube-bgm-dragging");
      state.listRoot.classList.add("ccf-youtube-bgm-list-dragging");
    }

    event.preventDefault();
    event.stopPropagation();

    if (state.clone) {
      const offsetX = event.clientX - state.startX;
      const offsetY = event.clientY - state.startY;
      state.clone.style.setProperty("transform", `translate3d(${offsetX}px, ${offsetY}px, 0)`, "important");
    }

    const nextRow = getCcfYoutubeBgmDragTargetRow(state.listRoot, state.row, event.clientY);
    moveCcfYoutubeBgmDraggedRow(state, nextRow);
  }

  function moveCcfYoutubeBgmDraggedRow(state, nextRow) {
    if (!state?.listRoot || !state.row) {
      return;
    }

    if (nextRow === state.row || (nextRow && nextRow === state.row.nextElementSibling)) {
      return;
    }

    if (!nextRow && !state.row.nextElementSibling) {
      return;
    }

    animateCcfYoutubeBgmListReorder(state.listRoot, state.row, () => {
      if (nextRow) {
        state.listRoot.insertBefore(state.row, nextRow);
      } else {
        state.listRoot.appendChild(state.row);
      }
    });
  }

  function animateCcfYoutubeBgmListReorder(listRoot, excludeRow, mutate) {
    if (!(listRoot instanceof HTMLElement) || typeof mutate !== "function") {
      return;
    }

    const rowsBefore = getCcfYoutubeBgmSortableRows(listRoot)
      .filter((row) => row !== excludeRow);
    const firstRects = new Map(rowsBefore.map((row) => [row, row.getBoundingClientRect()]));
    mutate();

    rowsBefore.forEach((row) => {
      const first = firstRects.get(row);
      if (!first) {
        return;
      }

      const last = row.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        return;
      }

      const token = `${Date.now()}:${Math.random()}`;
      row.dataset.ccfYoutubeBgmAnimationToken = token;
      row.classList.add("ccf-youtube-bgm-animating");
      row.style.transition = "none";
      row.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      row.getBoundingClientRect();

      window.requestAnimationFrame(() => {
        if (row.dataset.ccfYoutubeBgmAnimationToken !== token) {
          return;
        }

        row.style.transition = "transform 250ms cubic-bezier(0.25, 1, 0.5, 1)";
        row.style.transform = "";
      });

      window.setTimeout(() => {
        if (row.dataset.ccfYoutubeBgmAnimationToken !== token) {
          return;
        }

        row.classList.remove("ccf-youtube-bgm-animating");
        row.style.removeProperty("transition");
        row.style.removeProperty("transform");
        delete row.dataset.ccfYoutubeBgmAnimationToken;
      }, 280);
    });
  }

  function getCcfYoutubeBgmSortableRows(listRoot) {
    if (!(listRoot instanceof HTMLElement)) {
      return [];
    }
    const container = findCcfYoutubeBgmInsertionContainer(listRoot) || listRoot;
    return [...container.children].filter((child) => child instanceof HTMLElement);
  }

  function getCcfYoutubeBgmDragTargetRow(listRoot, draggedRow, clientY) {
    return getCcfYoutubeBgmSortableRows(listRoot)
      .filter((row) => row !== draggedRow)
      .find((row) => {
        const rect = row.getBoundingClientRect();
        return clientY < rect.top + rect.height / 2;
      }) || null;
  }

  function handleCcfYoutubeBgmRowDragEnd(event) {
    const state = ccfYoutubeBgmDragState;
    if (!state || event.pointerId !== state.pointerId) {
      return;
    }

    window.removeEventListener("pointermove", handleCcfYoutubeBgmRowDragMove, true);
    window.removeEventListener("pointerup", handleCcfYoutubeBgmRowDragEnd, true);
    window.removeEventListener("pointercancel", handleCcfYoutubeBgmRowDragEnd, true);

    state.listRoot.classList.remove("ccf-youtube-bgm-list-dragging");

    if (state.dragging) {
      event.preventDefault();
      event.stopPropagation();
      ccfYoutubeBgmSuppressClickUntil = Date.now() + 600;

      const row = state.row;
      const clone = state.clone;

      row.style.removeProperty("visibility");

      let dx = 0;
      let dy = 0;
      if (clone) {
        const cloneRect = clone.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        dx = cloneRect.left - rowRect.left;
        dy = cloneRect.top - rowRect.top;
        clone.remove();
        state.clone = null;
      }

      const token = `${Date.now()}:${Math.random()}`;
      row.dataset.ccfYoutubeBgmDropToken = token;
      row.style.transition = "none";
      row.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      row.getBoundingClientRect();

      window.requestAnimationFrame(() => {
        if (row.dataset.ccfYoutubeBgmDropToken !== token) {
          return;
        }

        row.style.transition = "transform 200ms cubic-bezier(0.25, 1, 0.5, 1)";
        row.style.transform = "";
      });

      window.setTimeout(() => {
        if (row.dataset.ccfYoutubeBgmDropToken !== token) {
          return;
        }

        row.classList.remove("ccf-youtube-bgm-dragging");
        row.style.removeProperty("transition");
        row.style.removeProperty("transform");
        delete row.dataset.ccfYoutubeBgmDropToken;
      }, 220);

      persistCcfYoutubeBgmDomOrder(state.listRoot);
    } else {
      if (state.clone) {
        state.clone.remove();
        state.clone = null;
      }
      state.row.classList.remove("ccf-youtube-bgm-dragging");
      state.row.style.removeProperty("visibility");
      state.row.style.removeProperty("transform");
    }

    ccfYoutubeBgmDragState = null;
  }

  function persistCcfYoutubeBgmDomOrder(listRoot) {
    if (!(listRoot instanceof HTMLElement)) {
      return;
    }
    const container = findCcfYoutubeBgmInsertionContainer(listRoot) || listRoot;

    let changed = false;
    let currentAnchor = "";
    let currentIndex = 0;
    const baseOrder = Date.now();
    let flatIndex = 0;

    [...container.children].forEach((child) => {
      if (!(child instanceof HTMLElement)) return;

      if (child.classList.contains("ccf-youtube-bgm-row-wrap")) {
        const entryKey = child.dataset.ccfYoutubeBgmEntry || "";
        const entry = ccfBgmSlotMap.get(entryKey);
        if (entry) {
          const nextOrder = baseOrder + flatIndex;
          const prevAnchor = typeof entry.anchorSlot === "string" ? entry.anchorSlot : "";
          const prevAnchorIndex = Number.isFinite(Number(entry.anchorIndex)) ? Number(entry.anchorIndex) : -1;

          if (
            prevAnchor !== currentAnchor
            || prevAnchorIndex !== currentIndex
            || getCcfYoutubeBgmOrder(entry) !== nextOrder
          ) {
            entry.anchorSlot = currentAnchor;
            entry.anchorIndex = currentIndex;
            entry.order = nextOrder;
            ccfBgmSlotMap.set(entryKey, entry);
            changed = true;
          }
          currentIndex++;
        }
        flatIndex++;
        return;
      }

      const slot = getCcfYoutubeBgmNativeSlotForListItem(child);
      if (slot) {
        currentAnchor = slot;
        currentIndex = 0;
      }
      flatIndex++;
    });

    if (!changed) {
      return;
    }

    delete listRoot.dataset.ccfYoutubeBgmRenderSignature;
    persistCcfBgmSlotMap();
  }

  function findCcfYoutubeBgmLibraryHost(mountRoot = null) {
    const candidates = [];

    if (mountRoot instanceof HTMLElement) {
      const dialog = getCcfBgmDialogRoot(mountRoot);
      if (dialog instanceof HTMLElement) {
        candidates.push(dialog);
      }
    }

    candidates.push(...getCcfBgmDialogCandidates()
      .filter((candidate) => candidate instanceof HTMLElement && isLikelyCcfBgmDialog(candidate)));

    for (const candidate of candidates) {
      const list = findCcfBgmMusicListInDialog(candidate);
      if (list) {
        return list;
      }
    }

    return [...document.querySelectorAll(".MuiList-root")]
      .find((list) => list instanceof HTMLElement && isCcfBgmNativeMusicList(list)) || null;
  }

  function findCcfBgmMusicListInDialog(dialog) {
    if (!(dialog instanceof HTMLElement)) {
      return null;
    }

    const root = findCcfBgmDialogPaper(dialog) || dialog;
    const lists = [
      ...(root.matches(".MuiList-root") ? [root] : []),
      ...root.querySelectorAll(".MuiList-root")
    ];

    return lists.find((list) => list instanceof HTMLElement && isCcfBgmNativeMusicList(list))
      || lists.find((list) => {
        return list instanceof HTMLElement
          && !list.querySelector("input, textarea")
          && !!list.querySelector(".MuiListItem-root .MuiListItemButton-root");
      })
      || null;
  }

  function isCcfBgmNativeMusicList(list) {
    if (!(list instanceof HTMLElement) || list.querySelector("input, textarea")) {
      return false;
    }

    return [...list.querySelectorAll(".MuiListItem-root .MuiListItemButton-root")]
      .some((button) => {
        return button instanceof HTMLElement
          && !button.classList.contains("ccf-youtube-bgm-item")
          && !!button.querySelector('[data-testid="LibraryMusicIcon"]');
      });
  }

  function cleanupMisplacedCcfYoutubeBgmItems(validList = null) {
    document.querySelectorAll(".ccf-youtube-bgm-list").forEach((list) => list.remove());

    document.querySelectorAll(".ccf-youtube-bgm-row-wrap").forEach((row) => {
      const list = row.closest(".MuiList-root");
      if (!(list instanceof HTMLElement) || (validList instanceof HTMLElement && list !== validList)) {
        row.remove();
      }
    });

    document.querySelectorAll(".ccf-youtube-bgm-item").forEach((item) => {
      const list = item.closest(".MuiList-root");
      const row = item.closest(".ccf-youtube-bgm-row-wrap");
      if (list instanceof HTMLElement && row instanceof HTMLElement && (!validList || list === validList)) {
        return;
      }

      (row instanceof HTMLElement ? row : item).remove();
    });
  }

  function openCcfYoutubeBgmEditPopover(entryKey, anchor) {
    const entry = ccfBgmSlotMap.get(entryKey);
    if (!entry) {
      return;
    }
    const slotKey = getCcfBgmEntrySlotKey(entryKey, entry);

    closeCcfYoutubeBgmEditPopover();

    const popover = document.createElement("div");
    popover.className = "MuiPaper-root MuiPaper-elevation MuiPaper-rounded MuiPaper-elevation8 MuiPopover-paper css-1vy434g ccf-youtube-bgm-popover";
    popover.setAttribute("data-ccf-youtube-bgm-popover", "1");
    const title = normalizeSpace(entry.displayName || entry.title || "YouTube BGM");
    // 네이티브 음원처럼 0.05 단위(0~1)로 스냅한다. 내부 표현은 0~100을 유지.
    const initialVolume = Math.round(getCcfYoutubeBgmEditVolume(entry, slotKey) / 5) * 5;
    // 네이티브처럼 후행 0 없이 표기 (1, 0.5, 0.75 …)
    const initialVolumeLabel = String(initialVolume / 100);
    const loop = entry.loop !== false;
    const inputId = `ccf-youtube-bgm-name-${Math.random().toString(36).slice(2, 8)}`;

    popover.innerHTML = [
      '<div class="MuiPaper-root MuiPaper-elevation MuiPaper-rounded MuiPaper-elevation6 sc-kNoaeN GxVfF css-175dgcc ccf-youtube-bgm-paper">',
      '<form>',
      '  <div class="MuiFormControl-root MuiFormControl-marginDense MuiFormControl-fullWidth MuiTextField-root css-twdmtu">',
      `    <label class="MuiFormLabel-root MuiInputLabel-root MuiInputLabel-formControl MuiInputLabel-animated MuiInputLabel-shrink MuiInputLabel-sizeMedium MuiInputLabel-filled MuiFormLabel-colorPrimary MuiFormLabel-filled MuiInputLabel-root MuiInputLabel-formControl MuiInputLabel-animated MuiInputLabel-shrink MuiInputLabel-sizeMedium MuiInputLabel-filled css-1n71hkt" data-shrink="true" for="${inputId}" id="${inputId}-label">name</label>`,
      '    <div class="MuiInputBase-root MuiFilledInput-root MuiFilledInput-underline MuiInputBase-colorPrimary MuiInputBase-fullWidth MuiInputBase-formControl css-sblib2">',
      `      <input aria-invalid="false" id="${inputId}" name="name" type="text" class="MuiInputBase-input MuiFilledInput-input css-1476h24" value="${escapeCcfHtml(title)}">`,
      '    </div>',
      '  </div>',
      '  <div class="sc-hFFBBO jJDQMj ccf-youtube-bgm-volume-row">',
      '    <svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeMedium css-vubbuv" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="VolumeDownIcon"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"></path></svg>',
      '    <span class="MuiSlider-root MuiSlider-colorPrimary MuiSlider-sizeSmall sc-cnyrnb hoiSIY css-1yyocgo ccf-youtube-bgm-slider">',
      '      <span class="MuiSlider-rail css-b04pc9"></span>',
      `      <span class="MuiSlider-track css-5wk36y" style="left: 0%; width: ${initialVolume}%;"></span>`,
      `      <span data-index="0" class="MuiSlider-thumb MuiSlider-thumbSizeSmall MuiSlider-thumbColorPrimary MuiSlider-thumb MuiSlider-thumbSizeSmall MuiSlider-thumbColorPrimary css-yxa6ry" style="left: ${initialVolume}%;"></span>`,
      `      <input class="ccf-youtube-bgm-range" data-index="0" aria-label="볼륨" aria-valuenow="${initialVolume}" aria-orientation="horizontal" aria-valuemax="100" aria-valuemin="0" name="volume" type="range" min="0" max="100" step="5" value="${initialVolume}">`,
      '    </span>',
      `    <p class="MuiTypography-root MuiTypography-body1 css-9l3uo3 ccf-youtube-bgm-volume-value">${initialVolumeLabel}</p>`,
      `    <button class="MuiButtonBase-root MuiIconButton-root MuiIconButton-colorPrimary MuiIconButton-sizeSmall css-11qx9u ccf-youtube-bgm-loop" tabindex="0" type="button" data-loop="${loop ? "1" : "0"}" aria-label="반복재생" aria-pressed="${loop ? "true" : "false"}" title="반복재생">`,
      '      <svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeMedium css-vubbuv" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="RepeatIcon"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"></path></svg>',
      '      <span class="MuiTouchRipple-root css-w0pj6f"></span>',
      '    </button>',
      '  </div>',
      '  <div class="sc-bAcsk iyVLQd ccf-youtube-bgm-actions">',
      '    <button class="MuiButtonBase-root MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeMedium MuiButton-textSizeMedium MuiButton-fullWidth MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeMedium MuiButton-textSizeMedium MuiButton-fullWidth css-652zu6 ccf-youtube-bgm-preview" tabindex="0" type="button"><span class="ccf-youtube-bgm-preview-label">미리듣기</span><span class="MuiTouchRipple-root css-w0pj6f"></span></button>',
      '    <button class="MuiButtonBase-root MuiButton-root MuiButton-text MuiButton-textSecondary MuiButton-sizeMedium MuiButton-textSizeMedium MuiButton-fullWidth MuiButton-root MuiButton-text MuiButton-textSecondary MuiButton-sizeMedium MuiButton-textSizeMedium MuiButton-fullWidth css-mjtl3p ccf-youtube-bgm-remove" tabindex="0" type="button">삭제<span class="MuiTouchRipple-root css-w0pj6f"></span></button>',
      '    <button class="MuiButtonBase-root MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeMedium MuiButton-textSizeMedium MuiButton-fullWidth MuiButton-root MuiButton-text MuiButton-textPrimary MuiButton-sizeMedium MuiButton-textSizeMedium MuiButton-fullWidth css-652zu6 ccf-youtube-bgm-save" tabindex="0" type="submit">저장<span class="MuiTouchRipple-root css-w0pj6f"></span></button>',
      '  </div>',
      '</form>',
      '</div>'
    ].join("");

    document.body.appendChild(popover);
    ccfBgmEditPopover = popover;
    positionCcfYoutubeBgmPopover(popover, anchor);
    // focusin: 코코포리아 BGM 드로어는 MUI Modal(포커스 트랩)이다. 트랩은 document
    // 레벨의 focusin 핸들러로 "포커스가 모달 밖으로 나갔다"고 판단해 즉시 포커스를
    // 되돌린다. 팝오버 내부의 focusin이 document로 전파되지 않게 막으면, 트랩이
    // 알아채지 못해 name 입력란이 포커스를 유지할 수 있다.
    ["pointerdown", "mousedown", "mouseup", "click", "touchstart", "focusin"].forEach((type) => {
      popover.addEventListener(type, (event) => {
        event.stopPropagation();
      });
    });
    popover.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        event.stopPropagation();
      }
    });

    const form = popover.querySelector("form");
    const nameInput = popover.querySelector('input[name="name"]');
    const volumeInput = popover.querySelector('input[name="volume"]');
    const sliderElement = popover.querySelector(".ccf-youtube-bgm-slider");
    const sliderTrack = popover.querySelector(".MuiSlider-track");
    const sliderThumb = popover.querySelector(".MuiSlider-thumb");
    const volumeValueLabel = popover.querySelector(".ccf-youtube-bgm-volume-value");
    const loopButton = popover.querySelector(".ccf-youtube-bgm-loop");
    const previewButton = popover.querySelector(".ccf-youtube-bgm-preview");
    const removeButton = popover.querySelector(".ccf-youtube-bgm-remove");
    let liveVolumeReinforceTimer = 0;
    let sliderPointerId = null;

    // 음원명 입력란 상호작용 보장: 포커스/타이핑을 가로채는 핸들러로부터 보호한다.
    if (nameInput instanceof HTMLInputElement) {
      nameInput.removeAttribute("readonly");
      nameInput.removeAttribute("disabled");
      ["pointerdown", "mousedown", "click", "dblclick"].forEach((type) => {
        nameInput.addEventListener(type, (event) => {
          event.stopPropagation();
          if (document.activeElement !== nameInput) {
            try { nameInput.focus(); } catch (_) {}
          }
        });
      });
      ["keydown", "keypress", "keyup", "beforeinput", "input"].forEach((type) => {
        nameInput.addEventListener(type, (event) => {
          // 전역 단축키/핸들러로 키 입력이 전파되어 삼켜지지 않도록 차단한다.
          event.stopPropagation();
        });
      });
    }

    const updateSliderVisuals = (volume) => {
      // 0.05 단위(0~100 내부에서는 5단위)로 스냅한다.
      const value = Math.round(clampCcfBgmVolume(volume, initialVolume) / 5) * 5;
      const pct = `${value}%`;
      if (sliderTrack instanceof HTMLElement) {
        sliderTrack.style.width = pct;
      }
      if (sliderThumb instanceof HTMLElement) {
        sliderThumb.style.left = pct;
      }
      if (volumeValueLabel instanceof HTMLElement) {
        volumeValueLabel.textContent = String(value / 100);
      }
      if (volumeInput instanceof HTMLInputElement) {
        volumeInput.value = String(value);
        volumeInput.setAttribute("aria-valuenow", String(value));
      }
      return value;
    };

    const applyLivePlaybackSettings = (volume, reinforce = false) => {
      // 미리듣기 중이면 볼륨 변경을 미리듣기 플레이어에 반영한다.
      if (ccfBgmPreviewActive) {
        applyCcfBgmPreviewVolume(volume);
        return;
      }

      if (ccfBgmActiveEntryKey !== entryKey) {
        return;
      }

      const loop = loopButton ? loopButton.dataset.loop === "1" : ccfBgmActiveLoop;
      ccfBgmActiveLoop = loop;
      const state = { volume, loop };
      applyCcfBgmPlayerVolume(state);
      if (reinforce && volume > 0) {
        reinforceCcfYoutubeBgmAudio(state, "edit-live");
      }
    };

    const updateVolumeFromPointer = (event, reinforce = false) => {
      if (!(sliderElement instanceof HTMLElement) || !(volumeInput instanceof HTMLInputElement)) {
        return;
      }

      const rect = sliderElement.getBoundingClientRect();
      if (!rect.width) {
        return;
      }

      const nextVolume = clampCcfBgmVolume((event.clientX - rect.left) / rect.width * 100, initialVolume);
      updateSliderVisuals(nextVolume);
      applyLivePlaybackSettings(nextVolume, reinforce);
    };

    const stopSliderPointerTracking = (event) => {
      if (sliderPointerId != null && event.pointerId !== sliderPointerId) {
        return;
      }

      window.removeEventListener("pointermove", handleSliderPointerMove, true);
      window.removeEventListener("pointerup", stopSliderPointerTracking, true);
      window.removeEventListener("pointercancel", stopSliderPointerTracking, true);
      if (sliderElement instanceof HTMLElement && sliderPointerId != null) {
        try { sliderElement.releasePointerCapture?.(sliderPointerId); } catch (_) {}
      }
      sliderPointerId = null;
      if (event.type === "pointerup") {
        updateVolumeFromPointer(event, true);
      }
    };

    const handleSliderPointerMove = (event) => {
      if (sliderPointerId != null && event.pointerId !== sliderPointerId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      updateVolumeFromPointer(event);
    };

    const handleVolumeInput = () => {
      const volume = updateSliderVisuals(Number(volumeInput?.value));
      applyLivePlaybackSettings(volume);
      if (liveVolumeReinforceTimer) {
        window.clearTimeout(liveVolumeReinforceTimer);
      }
      liveVolumeReinforceTimer = window.setTimeout(() => {
        liveVolumeReinforceTimer = 0;
        applyLivePlaybackSettings(volume, true);
      }, 90);
    };

    volumeInput?.addEventListener("input", handleVolumeInput);
    volumeInput?.addEventListener("change", handleVolumeInput);
    sliderElement?.addEventListener("pointerdown", (event) => {
      if (!(sliderElement instanceof HTMLElement) || !(volumeInput instanceof HTMLInputElement)) {
        return;
      }
      if (event.button != null && event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      sliderPointerId = event.pointerId;
      try { sliderElement.setPointerCapture?.(event.pointerId); } catch (_) {}
      updateVolumeFromPointer(event, true);
      window.addEventListener("pointermove", handleSliderPointerMove, true);
      window.addEventListener("pointerup", stopSliderPointerTracking, true);
      window.addEventListener("pointercancel", stopSliderPointerTracking, true);
    });

    loopButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = loopButton.dataset.loop !== "1";
      loopButton.dataset.loop = next ? "1" : "0";
      loopButton.setAttribute("aria-pressed", next ? "true" : "false");
      applyLivePlaybackSettings(clampCcfBgmVolume(volumeInput?.value, initialVolume));
    });

    const save = ({ closeAfter = false } = {}) => {
      const current = ccfBgmSlotMap.get(entryKey);
      if (!current) {
        return;
      }

      current.displayName = normalizeSpace(nameInput?.value || "") || current.title || "YouTube BGM";
      current.volume = volumeInput instanceof HTMLInputElement
        ? clampCcfBgmVolume(volumeInput.value, getCcfYoutubeBgmEditVolume(current, slotKey))
        : getCcfYoutubeBgmEditVolume(current, slotKey);
      current.volumeEdited = true;
      current.loop = loopButton ? loopButton.dataset.loop === "1" : current.loop !== false;
      current.updatedAt = Date.now();
      ccfBgmSlotMap.set(entryKey, current);
      persistCcfBgmSlotMap();
      renderCcfYoutubeBgmLibraryItems();
      markCcfYoutubeBgmSlotButtons();

      if (ccfBgmActiveEntryKey === entryKey) {
        ccfBgmActiveLoop = current.loop;
        applyCcfBgmPlayerVolume({
          volume: current.volume,
          loop: current.loop
        });
        reinforceCcfYoutubeBgmAudio({
          volume: current.volume,
          loop: current.loop
        }, "edit-save");
      }

      if (closeAfter) {
        closeCcfYoutubeBgmEditPopover();
      }
    };

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      save({ closeAfter: true });
    });

    previewButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      // 토글: 미리듣기 중이면 정지(본 재생 복귀), 아니면 미리듣기 시작.
      if (ccfBgmPreviewActive) {
        stopCcfYoutubeBgmPreview();
        return;
      }

      const current = ccfBgmSlotMap.get(entryKey) || entry;
      const videoId = current?.videoId || extractCcfYoutubeVideoId(current?.url || "");
      if (!videoId) {
        return;
      }
      const previewVolume = updateSliderVisuals(Number(volumeInput?.value));
      startCcfYoutubeBgmPreview(videoId, previewVolume);
    });

    removeButton?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (ccfBgmActiveEntryKey === entryKey) {
        stopCcfYoutubeBgm("youtube-bgm-remove");
      }

      ccfBgmSlotMap.delete(entryKey);
      persistCcfBgmSlotMap();
      closeCcfYoutubeBgmEditPopover();
      renderCcfYoutubeBgmLibraryItems();
      markCcfYoutubeBgmSlotButtons();
      updateCcfBgmProgressBar();
    });

    window.setTimeout(() => {
      document.addEventListener("pointerdown", handleCcfYoutubeBgmPopoverOutsidePointer, true);
      document.addEventListener("keydown", handleCcfYoutubeBgmPopoverKeydown, true);
    }, 0);
  }

  function positionCcfYoutubeBgmPopover(popover, anchor) {
    if (!(popover instanceof HTMLElement) || !(anchor instanceof HTMLElement)) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth || 300;
    const height = popover.offsetHeight || 180;

    const preferredLeft = rect.right + 4;
    const preferredTop = rect.top;

    const overflowsRight = preferredLeft + width > window.innerWidth - 8;
    const left = overflowsRight
      ? Math.max(8, rect.left - width - 4)
      : Math.max(8, Math.min(window.innerWidth - width - 8, preferredLeft));
    const top = preferredTop + height > window.innerHeight - 8
      ? Math.max(8, window.innerHeight - height - 8)
      : Math.max(8, preferredTop);

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  function handleCcfYoutubeBgmPopoverOutsidePointer(event) {
    if (!ccfBgmEditPopover) {
      return;
    }

    const target = event.target;
    if (target instanceof Node && ccfBgmEditPopover.contains(target)) {
      return;
    }

    closeCcfYoutubeBgmEditPopover();
  }

  function handleCcfYoutubeBgmPopoverKeydown(event) {
    if (event.key === "Escape") {
      closeCcfYoutubeBgmEditPopover();
    }
  }

  function closeCcfYoutubeBgmEditPopover() {
    document.removeEventListener("pointerdown", handleCcfYoutubeBgmPopoverOutsidePointer, true);
    document.removeEventListener("keydown", handleCcfYoutubeBgmPopoverKeydown, true);

    stopCcfYoutubeBgmPreview();

    if (ccfBgmEditPopover) {
      ccfBgmEditPopover.remove();
      ccfBgmEditPopover = null;
    }
  }

  // --- 미리듣기: 본 재생과 별개인 로컬 전용 플레이어 ---
  // 미리듣기는 해당 사용자 브라우저에서만 재생되며, 다른 참여자에게는 영향이 없다.

  function ensureCcfBgmPreviewHost() {
    if (ccfBgmPreviewHost && document.body && document.body.contains(ccfBgmPreviewHost)) {
      return ccfBgmPreviewHost;
    }
    const host = document.createElement("div");
    host.className = "ccf-youtube-bgm-preview-host";
    host.setAttribute("aria-hidden", "true");
    host.appendChild(document.createElement("div"));
    (document.body || document.documentElement).appendChild(host);
    ccfBgmPreviewHost = host;
    return host;
  }

  function applyCcfBgmPreviewVolume(volume) {
    if (!ccfBgmPreviewPlayer || typeof ccfBgmPreviewPlayer.setVolume !== "function") {
      return;
    }
    const vol = Math.max(0, Math.min(100, Number(volume) || 0));
    try {
      ccfBgmPreviewPlayer.setVolume(vol);
      if (vol <= 0) {
        if (typeof ccfBgmPreviewPlayer.mute === "function") ccfBgmPreviewPlayer.mute();
      } else {
        if (typeof ccfBgmPreviewPlayer.unMute === "function") ccfBgmPreviewPlayer.unMute();
        ccfBgmPreviewPlayer.setVolume(vol);
      }
    } catch (error) {
      debugLog("bgm-youtube-preview-volume-failed", serializeError(error));
    }
  }

  function startCcfYoutubeBgmPreview(videoId, volume) {
    if (!videoId) {
      return;
    }

    // 본 재생(YouTube BGM)이 진행 중이면 로컬에서만 일시정지한다.
    ccfBgmPreviewResumeMain = false;
    if (ccfBgmPlayer && typeof ccfBgmPlayer.getPlayerState === "function") {
      try {
        if (ccfBgmPlayer.getPlayerState() === window.YT?.PlayerState?.PLAYING) {
          if (typeof ccfBgmPlayer.pauseVideo === "function") {
            ccfBgmPlayer.pauseVideo();
          }
          ccfBgmPreviewResumeMain = true;
        }
      } catch (error) {
        debugLog("bgm-youtube-preview-pause-main-failed", serializeError(error));
      }
    }

    ccfBgmPreviewActive = true;
    syncCcfBgmPreviewButtonState();

    const host = ensureCcfBgmPreviewHost();
    const target = host.firstElementChild;
    const vol = Math.max(0, Math.min(100, Number(volume) || 0));

    loadYoutubeIframeApi().then(() => {
      if (!ccfBgmPreviewActive || !window.YT || !window.YT.Player) {
        return;
      }

      if (ccfBgmPreviewPlayer) {
        try {
          if (ccfBgmPreviewVideoId !== videoId && typeof ccfBgmPreviewPlayer.loadVideoById === "function") {
            ccfBgmPreviewPlayer.loadVideoById(videoId);
            ccfBgmPreviewVideoId = videoId;
          } else if (typeof ccfBgmPreviewPlayer.playVideo === "function") {
            ccfBgmPreviewPlayer.playVideo();
          }
          applyCcfBgmPreviewVolume(vol);
        } catch (error) {
          debugLog("bgm-youtube-preview-play-failed", serializeError(error));
        }
        return;
      }

      ccfBgmPreviewVideoId = videoId;
      ccfBgmPreviewPlayer = new window.YT.Player(target, {
        width: String(YOUTUBE_PLAYER_MIN_SIZE),
        height: String(YOUTUBE_PLAYER_MIN_SIZE),
        host: YOUTUBE_EMBED_HOST,
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: location.origin
        },
        events: {
          onReady(event) {
            if (!ccfBgmPreviewActive) {
              try { event.target.stopVideo(); } catch (_) {}
              return;
            }
            applyCcfBgmPreviewVolume(vol);
            try { event.target.playVideo(); } catch (_) {}
          },
          onStateChange(event) {
            if (event?.data === window.YT?.PlayerState?.ENDED) {
              stopCcfYoutubeBgmPreview();
            }
          }
        }
      });
    });
  }

  function stopCcfYoutubeBgmPreview() {
    const wasActive = ccfBgmPreviewActive;
    ccfBgmPreviewActive = false;

    if (ccfBgmPreviewPlayer && typeof ccfBgmPreviewPlayer.stopVideo === "function") {
      try {
        ccfBgmPreviewPlayer.stopVideo();
      } catch (error) {
        debugLog("bgm-youtube-preview-stop-failed", serializeError(error));
      }
    }

    // 미리듣기 때문에 일시정지했던 본 재생을 다시 이어서 재생한다.
    if (wasActive && ccfBgmPreviewResumeMain && ccfBgmPlayer && typeof ccfBgmPlayer.playVideo === "function") {
      try {
        ccfBgmPlayer.playVideo();
      } catch (error) {
        debugLog("bgm-youtube-preview-resume-main-failed", serializeError(error));
      }
    }
    ccfBgmPreviewResumeMain = false;
    syncCcfBgmPreviewButtonState();
  }

  function destroyCcfBgmPreviewPlayer() {
    stopCcfYoutubeBgmPreview();
    if (ccfBgmPreviewPlayer && typeof ccfBgmPreviewPlayer.destroy === "function") {
      try { ccfBgmPreviewPlayer.destroy(); } catch (_) {}
    }
    ccfBgmPreviewPlayer = null;
    ccfBgmPreviewVideoId = "";
    if (ccfBgmPreviewHost) {
      ccfBgmPreviewHost.remove();
      ccfBgmPreviewHost = null;
    }
  }

  function syncCcfBgmPreviewButtonState() {
    const button = ccfBgmEditPopover
      ? ccfBgmEditPopover.querySelector(".ccf-youtube-bgm-preview")
      : null;
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const label = button.querySelector(".ccf-youtube-bgm-preview-label");
    if (ccfBgmPreviewActive) {
      // 정지 상태: 네이티브 팝오버의 삭제 버튼과 동일한 색상(secondary)으로 표시.
      button.dataset.previewing = "1";
      button.classList.remove("MuiButton-textPrimary", "css-652zu6");
      button.classList.add("MuiButton-textSecondary", "css-mjtl3p");
      if (label instanceof HTMLElement) {
        label.textContent = "정지";
      }
    } else {
      button.dataset.previewing = "0";
      button.classList.remove("MuiButton-textSecondary", "css-mjtl3p");
      button.classList.add("MuiButton-textPrimary", "css-652zu6");
      if (label instanceof HTMLElement) {
        label.textContent = "미리듣기";
      }
    }
  }

  function escapeCcfHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function findCcfBgmPanel(seed = null) {
    const starts = seed instanceof HTMLElement
      ? [seed]
      : [...document.querySelectorAll("button")].filter((button) => getCcfBgmSlotKeyFromButton(button));

    for (const start of starts) {
      let node = start instanceof HTMLElement ? start : null;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        if (isCcfBgmPanelCandidate(node)) {
          return node;
        }
      }
    }

    return null;
  }

  function isCcfBgmPanelCandidate(element) {
    if (!(element instanceof HTMLElement) || !element.querySelector(".MuiSlider-root")) {
      return false;
    }

    return [...element.querySelectorAll("button")]
      .some((button) => getCcfBgmSlotKeyFromButton(button));
  }

  function ensureCcfBgmProgressBar(panel) {
    if (!(panel instanceof HTMLElement)) {
      return;
    }

    panel.setAttribute("data-ccf-bgm-panel", "1");
    const mountTarget = findCcfBgmProgressMountTarget(panel);

    if (ccfBgmProgressRoot) {
      const isMounted = mountTarget instanceof HTMLElement
        ? isCcfBgmProgressRootMountedAfter(mountTarget, ccfBgmProgressRoot)
        : panel.contains(ccfBgmProgressRoot);
      if (!isMounted) {
        insertCcfBgmProgressRoot(panel, mountTarget, ccfBgmProgressRoot);
      } else if (mountTarget instanceof HTMLElement && mountTarget.parentElement) {
        markCcfBgmProgressHost(mountTarget.parentElement);
      } else {
        markCcfBgmProgressHost(panel);
      }
      syncCcfBgmProgressWidth(mountTarget, ccfBgmProgressRoot);
      ensureCcfYoutubeBgmPlayerDock(ccfBgmProgressRoot);
      return;
    }

    const root = document.createElement("div");
    root.className = "ccf-bgm-progress-root";
    root.innerHTML = [
      '<div class="ccf-bgm-progress-layout">',
      '  <div class="ccf-bgm-progress-row">',
      '    <span class="ccf-bgm-time ccf-bgm-current">00:00</span>',
      '    <input class="ccf-bgm-progress-input" type="range" min="0" max="1000" step="1" value="0" aria-label="BGM progress">',
      '    <span class="ccf-bgm-time ccf-bgm-duration">00:00</span>',
      "  </div>",
      "</div>"
    ].join("");

    const range = root.querySelector(".ccf-bgm-progress-input");
    if (range instanceof HTMLInputElement) {
      range.addEventListener("input", () => {
        seekCcfBgmByRatio(Number(range.value) / 1000);
      });
      // dragging 동안만 자동 갱신 차단. focus 만으로는 차단 안 함 — 사용자가
      // 클릭 후 떼면 즉시 다시 자동 갱신되어 loop reset / 진행이 시각화됨.
      const setDragging = () => { range.dataset.ccfDragging = "1"; };
      const clearDragging = () => { delete range.dataset.ccfDragging; };
      range.addEventListener("pointerdown", setDragging);
      range.addEventListener("pointerup", clearDragging);
      range.addEventListener("pointercancel", clearDragging);
      range.addEventListener("blur", clearDragging);
    }

    insertCcfBgmProgressRoot(panel, mountTarget, root);
    ccfBgmProgressRoot = root;
    syncCcfBgmProgressWidth(mountTarget, root);
    ensureCcfYoutubeBgmPlayerDock(root);
  }

  function findCcfBgmProgressMountTarget(panel) {
    if (!(panel instanceof HTMLElement)) {
      return null;
    }

    const directChildren = [...panel.children].filter((child) => child instanceof HTMLElement);
    const bgmButtonRow = directChildren.find((child) => {
      return child !== ccfBgmProgressRoot && [...child.querySelectorAll("button")]
        .some((button) => getCcfBgmSlotKeyFromButton(button));
    });

    if (bgmButtonRow instanceof HTMLElement) {
      bgmButtonRow.setAttribute("data-ccf-bgm-button-row", "1");
      return bgmButtonRow;
    }

    const lastBgmButton = [...panel.querySelectorAll("button")]
      .filter((button) => getCcfBgmSlotKeyFromButton(button))
      .pop();

    if (lastBgmButton instanceof HTMLElement) {
      const row = lastBgmButton.parentElement;
      if (row instanceof HTMLElement && row !== panel && panel.contains(row)) {
        row.setAttribute("data-ccf-bgm-button-row", "1");
        return row;
      }
    }

    return null;
  }

  function isCcfBgmProgressRootMountedAfter(mountTarget, progressRoot) {
    if (!(mountTarget instanceof HTMLElement) || !(progressRoot instanceof HTMLElement)) {
      return false;
    }

    return progressRoot.parentElement === mountTarget.parentElement
      && progressRoot.previousElementSibling === mountTarget;
  }

  function insertCcfBgmProgressRoot(panel, mountTarget, progressRoot) {
    if (!(panel instanceof HTMLElement) || !(progressRoot instanceof HTMLElement)) {
      return;
    }

    if (mountTarget instanceof HTMLElement && mountTarget !== panel && mountTarget.parentElement) {
      markCcfBgmProgressHost(mountTarget.parentElement);
      mountTarget.insertAdjacentElement("afterend", progressRoot);
      syncCcfBgmProgressWidth(mountTarget, progressRoot);
      return;
    }

    markCcfBgmProgressHost(panel);
    panel.appendChild(progressRoot);
    syncCcfBgmProgressWidth(panel, progressRoot);
  }

  function syncCcfBgmProgressWidth(mountTarget, progressRoot = ccfBgmProgressRoot) {
    if (!(progressRoot instanceof HTMLElement)) {
      return;
    }

    const source = mountTarget instanceof HTMLElement && mountTarget.parentElement instanceof HTMLElement
      ? mountTarget.parentElement
      : progressRoot.parentElement;
    const sourceRect = source instanceof HTMLElement
      ? source.getBoundingClientRect()
      : null;
    const parentRect = progressRoot.parentElement instanceof HTMLElement
      ? progressRoot.parentElement.getBoundingClientRect()
      : null;
    const width = sourceRect
      ? sourceRect.width
      : 0;

    if (Number.isFinite(width) && width > 0) {
      progressRoot.style.setProperty("--ccf-bgm-progress-width", `${Math.floor(width)}px`);
      const left = parentRect && sourceRect
        ? Math.max(0, Math.floor(sourceRect.left - parentRect.left))
        : 0;
      progressRoot.style.setProperty("--ccf-bgm-progress-left", `${left}px`);
      const top = parentRect && sourceRect
        ? Math.max(0, Math.floor(sourceRect.bottom - parentRect.top))
        : 0;
      progressRoot.style.setProperty("--ccf-bgm-progress-top", `${top}px`);
    } else {
      progressRoot.style.removeProperty("--ccf-bgm-progress-width");
      progressRoot.style.removeProperty("--ccf-bgm-progress-left");
      progressRoot.style.removeProperty("--ccf-bgm-progress-top");
    }
  }

  function markCcfBgmProgressHost(host) {
    if (!(host instanceof HTMLElement)) {
      return;
    }

    host.setAttribute("data-ccf-bgm-progress-host", "1");
    try {
      const computed = window.getComputedStyle(host);
      const direction = computed.flexDirection || "";
      host.setAttribute(
        "data-ccf-bgm-progress-flow",
        direction.startsWith("column") ? "column" : "row"
      );
      if (computed.position === "static") {
        host.style.position = "relative";
      }
    } catch (error) {
      host.setAttribute("data-ccf-bgm-progress-flow", "row");
    }
  }

  function ensureCcfYoutubeBgmPlayerDock(container = null) {
    let progressRoot = container instanceof HTMLElement && container.classList.contains("ccf-bgm-progress-root")
      ? container
      : ccfBgmProgressRoot;

    if (!(progressRoot instanceof HTMLElement)) {
      const panel = container instanceof HTMLElement ? findCcfBgmPanel(container) : findCcfBgmPanel();
      if (panel instanceof HTMLElement) {
        ensureCcfBgmProgressBar(panel);
        progressRoot = ccfBgmProgressRoot;
      }
    }

    if (!(progressRoot instanceof HTMLElement)) {
      return null;
    }

    let layout = progressRoot.querySelector(".ccf-bgm-progress-layout");
    if (!(layout instanceof HTMLElement)) {
      layout = document.createElement("div");
      layout.className = "ccf-bgm-progress-layout";
      while (progressRoot.firstChild) {
        layout.appendChild(progressRoot.firstChild);
      }
      progressRoot.appendChild(layout);
    }

    if (!ccfBgmPlayerDock) {
      ccfBgmPlayerDock = document.createElement("div");
      ccfBgmPlayerDock.className = "ccf-youtube-bgm-player-dock";
      ccfBgmPlayerDock.setAttribute("aria-label", "YouTube BGM video player");
      ccfBgmPlayerDock.setAttribute("tabindex", "-1");
    }

    const progressRow = layout.querySelector(".ccf-bgm-progress-row");
    if (progressRow instanceof HTMLElement) {
      if (ccfBgmPlayerDock.parentElement !== layout || progressRow.nextElementSibling !== ccfBgmPlayerDock) {
        progressRow.insertAdjacentElement("afterend", ccfBgmPlayerDock);
      }
    } else if (ccfBgmPlayerDock.parentElement !== layout || ccfBgmPlayerDock !== layout.lastElementChild) {
      layout.appendChild(ccfBgmPlayerDock);
    }

    syncCcfYoutubeBgmPlayerDockVisibility();
    return ccfBgmPlayerDock;
  }

  function syncCcfYoutubeBgmPlayerDockVisibility() {
    if (!ccfBgmPlayerDock) {
      return;
    }

    if (ccfBgmPlayerVisible) {
      ccfBgmPlayerDock.setAttribute("data-ccf-youtube-bgm-visible", "1");
    } else {
      ccfBgmPlayerDock.removeAttribute("data-ccf-youtube-bgm-visible");
    }
  }

  function getCcfYoutubeBgmPlayerElement() {
    try {
      const iframe = ccfBgmPlayer?.getIframe?.();
      if (iframe instanceof HTMLElement) {
        return iframe;
      }
    } catch (error) {
      debugLog("bgm-youtube-iframe-read-failed", serializeError(error));
    }

    const existing = document.getElementById("ccf-youtube-bgm-player");
    if (existing instanceof HTMLElement) {
      return existing;
    }

    return ccfBgmPlayerHost instanceof HTMLElement ? ccfBgmPlayerHost : null;
  }

  // ========== 유튜브 플레이어를 코코포리아 파괴 범위 밖으로 피난시키는 로직 ==========
  function mountCcfYoutubeBgmPlayerFrame(player = null) {
    const dock = ensureCcfYoutubeBgmPlayerDock();
    if (!(dock instanceof HTMLElement)) {
      return null;
    }

    let playerElement = null;
    try {
      playerElement = player?.getIframe?.();
    } catch (error) {
      debugLog("bgm-youtube-iframe-mount-failed", serializeError(error));
    }

    if (!(playerElement instanceof HTMLElement)) {
      playerElement = getCcfYoutubeBgmPlayerElement();
    }

    if (!(playerElement instanceof HTMLElement)) {
      return null;
    }

    playerElement.id = "ccf-youtube-bgm-player";
    playerElement.classList.add("ccf-youtube-bgm-player");
    playerElement.setAttribute("width", String(YOUTUBE_PLAYER_MIN_SIZE));
    playerElement.setAttribute("height", String(YOUTUBE_PLAYER_MIN_SIZE));
    playerElement.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; web-share");
    playerElement.setAttribute("tabindex", "-1");
    playerElement.setAttribute("title", "YouTube BGM player");
    playerElement.removeAttribute("aria-hidden");
    try { playerElement.inert = false; } catch (_) {}
    
    if (playerElement.parentElement !== dock) {
      dock.appendChild(playerElement);
    }

    [
      "position",
      "left",
      "top",
      "width",
      "height",
      "opacity",
      "pointer-events",
      "z-index"
    ].forEach((property) => playerElement.style.removeProperty(property));

    ccfBgmPlayerHost = playerElement;
    return playerElement;
  }

  function startCcfBgmProgressLoop() {
    if (ccfBgmProgressTimer) {
      return;
    }
    if (!chatNotifierActive) {
      return;
    }

    const tick = () => {
      ccfBgmProgressTimer = 0;
      if (!chatNotifierActive) return;
      syncCcfActiveBgmState();
      updateCcfBgmProgressBar();
      if (!chatNotifierActive) return;
      ccfBgmProgressTimer = window.setTimeout(tick, BGM_PROGRESS_UPDATE_MS);
    };

    ccfBgmProgressTimer = window.setTimeout(tick, BGM_PROGRESS_UPDATE_MS);
  }

  let ccfBgmLoopNudgeAt = 0;
  let ccfBgmLoopNudgeFromTotal = 0; // 직전 루프 시점의 트랙 총 길이 — stale getCurrentTime 식별용
  function updateCcfBgmProgressBar() {
    if (!ccfBgmProgressRoot) {
      return;
    }

    const range = ccfBgmProgressRoot.querySelector(".ccf-bgm-progress-input");
    const current = ccfBgmProgressRoot.querySelector(".ccf-bgm-current");
    const duration = ccfBgmProgressRoot.querySelector(".ccf-bgm-duration");
    const playback = readCcfBgmPlaybackTime();
    let ratio = playback.total > 0 ? Math.max(0, Math.min(1, playback.now / playback.total)) : 0;
    let displayNow = playback.now;

    const nowMs = Date.now();
    // 임박 판정 0.25s — 시각적으로 슬라이더가 거의 끝까지 도달한 후 nudge.
    // 너무 크면(이전 1.0s) 우측 끝 도달 전 강제 0 으로 점프해 사용자가 끝을 못 봄.
    // YouTube ENDED 이벤트가 정상 발화하면 그 흐름이 우선 처리하고, 안 올 때만 backup.
    const nearEnd = playback.total > 0 && (playback.total - playback.now) <= 0.25;
    // 직전 루프 점프 후 4초 동안은 stale getCurrentTime 가능성을 의심.
    const sinceLoopNudge = nowMs - ccfBgmLoopNudgeAt;
    const justLooped = sinceLoopNudge < 4000;
    // 루프 점프 시점에 기록한 total과 같은 트랙이고, 현재 시각이 거의 끝 부근이면 → 아직 stale 상태.
    const staleAfterLoop = justLooped
      && playback.total > 0
      && Math.abs(playback.total - ccfBgmLoopNudgeFromTotal) < 1
      && ratio > 0.5;

    if (nearEnd && ccfBgmActiveLoop) {
      // 루프: 처음으로 되감기 + 진행바 시각 100% (한 frame 동안). 다음 frame 의
      // staleAfterLoop 분기가 자연스럽게 0 으로 reset 함. 이렇게 안 하면
      // 0.5s 갱신 주기 탓에 슬라이더가 ~98% 에서 0% 로 점프하여 사용자가
      // 끝 도달 시각을 못 봄.
      if (sinceLoopNudge > 2000 && ccfBgmPlayer) {
        ccfBgmLoopNudgeAt = nowMs;
        ccfBgmLoopNudgeFromTotal = playback.total;
        try {
          ccfBgmPlayer.seekTo?.(0, true);
          ccfBgmPlayer.playVideo?.();
        } catch (error) {
          debugLog?.("bgm-youtube-loop-nudge-failed", serializeError?.(error) || String(error));
        }
      }
      ratio = 1;
      displayNow = playback.total;
    } else if (nearEnd && !ccfBgmActiveLoop) {
      // 비루프 + 종료 임박: 진행바를 100%로 스냅(시각적 완성도).
      ratio = 1;
      displayNow = playback.total;
    } else if (staleAfterLoop) {
      // 루프 점프 직후이지만 getCurrentTime이 아직 끝 부근 값을 돌려주는 상황 — 강제 0 표시.
      // 추가로 한 번 더 seekTo 보강(스로틀하여 1초 간격).
      if (ccfBgmPlayer && sinceLoopNudge > 1000) {
        try {
          ccfBgmPlayer.seekTo?.(0, true);
        } catch (error) { /* nudge reinforcement failed */ }
      }
      ratio = 0;
      displayNow = 0;
    }

    // dragging 중에만 자동 갱신 차단. focus 자체엔 영향 없음.
    if (range instanceof HTMLInputElement && range.dataset.ccfDragging !== "1") {
      range.value = String(Math.round(ratio * 1000));
    }
    if (current) {
      current.textContent = formatCcfBgmTime(displayNow);
    }
    if (duration) {
      duration.textContent = formatCcfBgmTime(playback.total);
    }
  }

  function readCcfBgmPlaybackTime() {
    const youtubePlayback = readCcfYoutubePlaybackTime();
    if (youtubePlayback) {
      return youtubePlayback;
    }

    if (ccfBgmLastNativeMedia && isUsableNativeBgmMedia(ccfBgmLastNativeMedia)) {
      return {
        now: Number(ccfBgmLastNativeMedia.currentTime) || 0,
        total: Number.isFinite(ccfBgmLastNativeMedia.duration) ? Number(ccfBgmLastNativeMedia.duration) : 0
      };
    }

    const webAudioPlayback = readCcfWebAudioPlaybackTime();
    if (webAudioPlayback) {
      return webAudioPlayback;
    }

    const media = findActiveNativeBgmMedia();
    if (media) {
      return {
        now: Number(media.currentTime) || 0,
        total: Number.isFinite(media.duration) ? Number(media.duration) : 0
      };
    }

    return {
      now: 0,
      total: 0
    };
  }

  function readCcfWebAudioPlaybackTime() {
    const state = ccfBgmLastWebAudio;
    if (!state || state.stopped || !ccfBgmAudioContextNow) {
      return null;
    }

    const total = Number(state.total) || 0;
    if (total <= 0) {
      return null;
    }

    const ctxNow = ccfBgmAudioContextNow();
    const elapsed = Math.max(0, ctxNow - state.startedAt);
    let now = state.offset + elapsed;

    if (state.loop && state.loopEnd > state.loopStart) {
      if (now >= state.loopEnd) {
        const loopDuration = state.loopEnd - state.loopStart;
        now = state.loopStart + ((now - state.loopStart) % loopDuration);
      }
    } else {
      const playDuration = Number(state.playDuration) || 0;
      if (playDuration > 0) {
        now = state.offset + Math.min(elapsed, playDuration);
      }
      now = Math.min(total, now);
    }

    return {
      now: Math.max(0, Math.min(total, now)),
      total
    };
  }

  function readCcfYoutubePlaybackTime() {
    if (!ccfBgmPlayer || !ccfBgmActiveSlotKey) {
      return null;
    }

    try {
      const now = typeof ccfBgmPlayer.getCurrentTime === "function"
        ? Number(ccfBgmPlayer.getCurrentTime()) || 0
        : 0;
      const total = typeof ccfBgmPlayer.getDuration === "function"
        ? Number(ccfBgmPlayer.getDuration()) || 0
        : 0;

      if (now > 0 || total > 0) {
        return {
          now,
          total
        };
      }
    } catch (error) {
      debugLog("bgm-youtube-progress-failed", serializeError(error));
    }

    return null;
  }

  function findActiveNativeBgmMedia() {
    if (ccfBgmLastNativeMedia && isUsableNativeBgmMedia(ccfBgmLastNativeMedia)) {
      return ccfBgmLastNativeMedia;
    }

    const mediaList = getCcfNativeMediaCandidates()
      .filter((media) => media instanceof HTMLMediaElement && isUsableNativeBgmMedia(media))
      .sort((a, b) => getNativeMediaScore(b) - getNativeMediaScore(a));

    ccfBgmLastNativeMedia = mediaList[0] || null;
    return ccfBgmLastNativeMedia;
  }

  function getCcfNativeMediaCandidates() {
    const mediaSet = new Set();
    document.querySelectorAll("audio, video").forEach((media) => {
      if (media instanceof HTMLMediaElement) {
        mediaSet.add(media);
      }
    });
    ccfBgmKnownNativeMedia.forEach((media) => {
      if (media instanceof HTMLMediaElement) {
        mediaSet.add(media);
      } else {
        ccfBgmKnownNativeMedia.delete(media);
      }
    });
    return [...mediaSet];
  }

  function isUsableNativeBgmMedia(media) {
    if (!isPotentialNativeBgmMedia(media)) {
      return false;
    }

    return Number.isFinite(media.duration)
      && media.duration > 0
      && (
        !media.paused
        || media.currentTime > 0
        || media === ccfBgmLastNativeMedia
      );
  }

  function isPotentialNativeBgmMedia(media) {
    if (!(media instanceof HTMLMediaElement)) {
      return false;
    }

    if (isNotificationAudioMedia(media)) {
      return false;
    }

    if (extractCcfYoutubeUrl(getNativeMediaSource(media))) {
      return false;
    }

    return true;
  }

  function isNotificationAudioMedia(media) {
    if (!(media instanceof HTMLMediaElement)) {
      return false;
    }

    if (media === notificationAudio) {
      return true;
    }

    const source = getNativeMediaSource(media);
    return !!notificationAudioUrl && (
      source === notificationAudioUrl
      || media.currentSrc === notificationAudioUrl
      || media.src === notificationAudioUrl
    );
  }

  function getNativeMediaScore(media) {
    let score = 0;
    if (media === ccfBgmLastNativeMedia) {
      score += 30;
    }
    if (!media.paused) {
      score += 100;
    }
    if (media.currentTime > 0) {
      score += 20;
    }
    if (media.volume > 0) {
      score += 5;
    }
    return score;
  }

  function seekCcfBgmByRatio(ratio) {
    const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));

    if (ccfBgmPlayer && ccfBgmActiveSlotKey && typeof ccfBgmPlayer.seekTo === "function") {
      try {
        const duration = Number(ccfBgmPlayer.getDuration()) || 0;
        if (duration > 0) {
          ccfBgmPlayer.seekTo(duration * safeRatio, true);
          return;
        }
      } catch (error) {
        debugLog("bgm-youtube-seek-failed", serializeError(error));
      }
    }

    const media = findActiveNativeBgmMedia();
    if (media && Number.isFinite(media.duration) && media.duration > 0) {
      try {
        media.currentTime = media.duration * safeRatio;
      } catch (error) {
        debugLog("bgm-native-seek-failed", serializeError(error));
      }
    }
  }

  function tryCenterCcfBgmDialogs() {
    if (isCcfNativeBgmEditGraceActive()) {
      return;
    }

    const recentBgmClick = isRecentCcfBgmClick();
    getCcfBgmDialogCandidates().forEach((dialog) => {
      if (!(dialog instanceof HTMLElement)) {
        return;
      }

      if (isCcfNativeAudioEditPopover(dialog) || isCcfRoomSettingsDialog(dialog) || isLikelyCcfImageLibraryDialog(dialog)) {
        // 네이티브 음원 편집 팝업, 룸 설정, 이미지 라이브러리는 크기 잠금 대상이 아니다.
        // 이전 폴링에서 잘못 마크됐을 수 있으니 size lock 속성을 모두 정리.
        dialog.removeAttribute("data-ccf-bgm-dialog-root");
        dialog.removeAttribute("data-ccf-bgm-slot-key");

        const paper = findCcfBgmDialogPaper(dialog);
        if (paper) {
          paper.removeAttribute("data-ccf-bgm-dialog-paper");
          paper.removeAttribute("data-ccf-bgm-dialog-root");
          paper.removeAttribute("data-ccf-bgm-slot-key");
        }

        return;
      }

      const shouldCenter = isLikelyCcfBgmDialog(dialog)
        || (
          recentBgmClick
          && !isCcfRoomSettingsDialog(dialog)
          && !!dialog.querySelector("input, textarea, button")
        );

      if (!shouldCenter) {
        return;
      }

      dialog.setAttribute("data-ccf-bgm-dialog-root", "1");
      const slotKey = inferCcfBgmSlotKeyFromElement(dialog)
        || (recentBgmClick ? ccfBgmEditingSlotKey : "")
        || ccfBgmLastDialogSlotKey;
      if (slotKey) {
        dialog.dataset.ccfBgmSlotKey = slotKey;
        ccfBgmLastDialogSlotKey = slotKey;
      }

      const paper = findCcfBgmDialogPaper(dialog);
      if (paper) {
        paper.setAttribute("data-ccf-bgm-dialog-paper", "1");
      }
    });
  }

  function getCcfBgmDialogCandidates() {
    return [
      ...document.querySelectorAll('.MuiDialog-root, .MuiPopover-root, .MuiModal-root, [role="dialog"]')
    ];
  }

  function getCcfBgmDialogRoot(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    return element.closest('[data-ccf-bgm-dialog-root="1"], .MuiDialog-root, .MuiPopover-root, .MuiModal-root, [role="dialog"], .MuiPaper-root');
  }

  function findCcfBgmDialogPaper(dialog) {
    if (!(dialog instanceof HTMLElement)) {
      return null;
    }

    if (dialog.matches(".MuiPaper-root, [role='dialog']")) {
      return dialog;
    }

    const paper = dialog.querySelector(".MuiDialog-paper, .MuiPopover-paper, .MuiPaper-root, [role='dialog']");
    return paper instanceof HTMLElement ? paper : null;
  }

  function isCcfNativeAudioEditPopover(dialog) {
    if (!(dialog instanceof HTMLElement)) {
      return false;
    }

    const paper = findCcfBgmDialogPaper(dialog);
    if (!(paper instanceof HTMLElement) || !paper.classList.contains("MuiPopover-paper")) {
      return false;
    }
    if (paper.classList.contains("ccf-youtube-bgm-popover")) {
      return false;
    }

    return !!paper.querySelector(':scope > .MuiPaper-root > form input[name="name"]')
      && !!paper.querySelector('input[name="volume"][type="range"]')
      && !!paper.querySelector('button[type="submit"]');
  }

  function isLikelyCcfImageLibraryDialog(dialog) {
    // 필드 설정 → 배경 선택 / 전경 선택 등에서 뜨는 이미지 라이브러리 팝업 판별.
    // 명확한 구분 표시:
    //   1) "Unsplash" 텍스트가 있는 버튼/탭 (BGM 다이얼로그에는 없음)
    //   2) 이미지 타입 탭(전경/배경/캐릭터/스크린/마커/컷인) 중 2개 이상이 함께 있음
    if (!(dialog instanceof HTMLElement)) return false;

    const buttons = [...dialog.querySelectorAll("button, [role='tab']")];
    const buttonTexts = buttons.map((b) => normalizeSpace(b.textContent || ""));

    if (buttonTexts.some((t) => /\bunsplash\b/i.test(t))) {
      return true;
    }

    const imageTabPattern = /^(전경|배경|캐릭터|스크린|스크린\s*뒷면|마커|컷인|前景|背景|キャラクター|スクリーン|マ?カ?|カットイン|foreground|background|character|screen|marker|cut\s*in)$/i;
    const matchedImageTabs = buttonTexts.filter((t) => t && imageTabPattern.test(t)).length;
    if (matchedImageTabs >= 2) {
      return true;
    }

    return false;
  }

  function isCcfRoomSettingsDialog(dialog) {
    if (!(dialog instanceof HTMLElement)) {
      return false;
    }

    const text = normalizeSpace(dialog.innerText || dialog.textContent || "");
    return /룸\s*설정|룸\s*개요|룸\s*데이터|멤버\s*리스트|룸\s*복제|ル?ム\s*設定|ル?ム\s*?要|ル?ム\s*デ?タ|メンバ?\s*リスト|ル?ム\s*複製|タ?ボ\s*モ?ド/i.test(text);
  }

  function isLikelyCcfBgmDialog(dialog) {
    if (!(dialog instanceof HTMLElement)) {
      return false;
    }

    if (isCcfRoomSettingsDialog(dialog)) {
      return false;
    }

    if (isCcfNativeAudioEditPopover(dialog)) {
      return false;
    }

    // 이미지 라이브러리(필드 설정 → 배경 선택 / 전경 선택 등)는 BGM과 비슷한 URL 입력칸을
    // 가지지만 음악 다이얼로그가 아니다. center/size lock이 잘못 걸리지 않도록 배제.
    if (isLikelyCcfImageLibraryDialog(dialog)) {
      return false;
    }

    const text = normalizeSpace(dialog.innerText || dialog.textContent || "");

    // 캐릭터 편집/시트 등의 다이얼로그는 BGM 마킹 대상이 아니다.
    // 특징 텍스트("삭제" + "복제" + "화면에 추가" 등)나 시트 관련 마커가 있으면 즉시 제외.
    if (
      (/삭제|削除|Delete/.test(text) && /복제|複製|Duplicate/.test(text) && /(화면|画面|Screen|추가|追加|Add)/.test(text))
      || dialog.querySelector('[data-testid="DeleteIcon"]') && dialog.querySelector('[data-testid="ContentCopyIcon"]')
    ) {
      return false;
    }

    const hasExternalUrlInput = [...dialog.querySelectorAll("input, textarea")]
      .some((input) => isLikelyCcfBgmUrlInput(input));

    const lists = [
      ...(dialog.matches(".MuiList-root") ? [dialog] : []),
      ...dialog.querySelectorAll(".MuiList-root")
    ];
    const hasNativeMusicList = lists.some((list) => {
      return list instanceof HTMLElement && isCcfBgmNativeMusicList(list);
    });

    // BGM 다이얼로그의 강한 신호: 음악 리스트 자체.
    if (hasNativeMusicList) {
      return true;
    }

    // URL 입력칸만으로는 부족 — 음악 관련 마커(볼륨 슬라이더 / 음악 아이콘 / 재생 버튼)가
    // 함께 있을 때만 BGM으로 인정. 캐릭터 편집 등 URL 입력만 있는 다이얼로그 오탐 방지.
    const hasMusicMarker = !!dialog.querySelector(
      'input[type="range"][name="volume"], '
      + 'input[type="range"][aria-label*="volume" i], '
      + 'input[type="range"][aria-label*="음량"], '
      + 'input[type="range"][aria-label*="音量"], '
      + 'button[aria-label*="play" i], '
      + '[data-testid="PlayArrowIcon"], '
      + '[data-testid="MusicNoteIcon"], '
      + '[data-testid="LibraryMusicIcon"]'
    );

    if (hasExternalUrlInput && hasMusicMarker) {
      return true;
    }

    return isRecentCcfBgmClick()
      && !!dialog.querySelector("input, textarea")
      && hasMusicMarker
      && /external\s*file|file\s*url|youtube|YouTube|유튜브|외부\s*파일|파일\s*URL/i.test(text);
  }

  function isLikelyCcfBgmUrlInput(input) {
    if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
      return false;
    }

    const hint = [
      input.type,
      input.name,
      input.id,
      input.placeholder,
      input.getAttribute("aria-label"),
      input.closest("label")?.textContent || "",
      input.parentElement?.textContent || ""
    ].join(" ");

    return BGM_INPUT_HINT_RE.test(hint);
  }

  function inferCcfBgmSlotKeyFromElement(element) {
    if (!(element instanceof Element)) {
      return "";
    }

    const button = [...element.querySelectorAll("button")]
      .find((candidate) => getCcfBgmSlotKeyFromButton(candidate));
    if (button) {
      return getCcfBgmSlotKeyFromButton(button);
    }

    const text = normalizeSpace(element.textContent || "");
    const match = text.match(/\bBGM\d+\b/i);
    return match ? match[0].toUpperCase() : "";
  }

  function getCcfBgmActiveTabSignature(scope = null) {
    const seen = new Set();
    const scopes = [];

    if (scope instanceof Element) {
      const dialog = scope.closest('[data-ccf-bgm-dialog-root="1"], .MuiDialog-root, .MuiPopover-root, .MuiModal-root, [role="dialog"]');
      if (dialog instanceof Element && !seen.has(dialog)) {
        scopes.push(dialog);
        seen.add(dialog);
      }
      if (!seen.has(scope)) {
        scopes.push(scope);
        seen.add(scope);
      }
    }

    getCcfBgmDialogCandidates().forEach((candidate) => {
      if (candidate instanceof Element && !seen.has(candidate) && isLikelyCcfBgmDialog(candidate)) {
        scopes.push(candidate);
        seen.add(candidate);
      }
    });

    for (const root of scopes) {
      const signature = readCcfBgmActiveTabSignatureFromRoot(root);
      if (signature) {
        return signature;
      }
    }

    return "";
  }

  function readCcfBgmActiveTabSignatureFromRoot(root) {
    if (!(root instanceof Element)) {
      return "";
    }

    let baseSignature = "";
    const tablists = [...root.querySelectorAll('[role="tablist"], .MuiTabs-root')];
    for (const tablist of tablists) {
      const tabs = [...tablist.querySelectorAll('button.MuiTab-root, [role="tab"], button[aria-selected]')];
      baseSignature = readCcfBgmActiveTabSignatureFromTabs(tabs);
      if (baseSignature) {
        break;
      }
    }

    if (!baseSignature) {
      baseSignature = readCcfBgmActiveTabSignatureFromTabs(
        [...root.querySelectorAll('button.MuiTab-root, [role="tab"], button[aria-selected]')]
      );
    }

    // [추가된 로직] 상단 라이브러리 전환 버튼(MuiButtonGroup)의 활성화 상태 반영
    const activeGroupButtons = [...root.querySelectorAll('.MuiButtonGroup-root .MuiButton-contained, .MuiButtonGroup-grouped.MuiButton-contained')];
    const groupSignatures = activeGroupButtons.map(btn => {
      // textContent를 읽으면 <title>PRO</title> 텍스트까지 포함되어 탭을 정확히 구분할 수 있습니다.
      return normalizeSpace(btn.textContent || "");
    }).filter(Boolean);

    if (groupSignatures.length > 0) {
      baseSignature = baseSignature ? `${baseSignature}::${groupSignatures.join("::")}` : groupSignatures.join("::");
    }

    return baseSignature;
  }

  function readCcfBgmActiveTabSignatureFromTabs(tabs) {
    for (let idx = 0; idx < tabs.length; idx += 1) {
      const tab = tabs[idx];
      if (!(tab instanceof HTMLElement)) {
        continue;
      }
      const isSelected = tab.getAttribute("aria-selected") === "true"
        || tab.classList.contains("Mui-selected")
        || tab.getAttribute("aria-current") === "page";
      if (!isSelected) {
        continue;
      }
      const labelEl = tab.querySelector(".MuiTypography-root, p, span");
      const name = normalizeSpace(labelEl?.textContent || tab.textContent || "");
      const stableId = normalizeSpace(tab.getAttribute("aria-controls") || tab.id || "");
      return normalizeCcfBgmTabSignature(`${idx}::${name || stableId}`);
    }
    return "";
  }

  function normalizeCcfBgmTabSignature(value) {
    return normalizeSpace(value || "");
  }

  function getCcfBgmSlotKeyFromButton(button) {
    if (!(button instanceof HTMLElement)) {
      return "";
    }

    const text = normalizeSpace(button.textContent || "");
    const match = text.match(/^BGM\d+/i);
    return match ? match[0].toUpperCase() : "";
  }

  function isCcfNativeBgmEditButton(button) {
    if (!(button instanceof HTMLElement) || button.classList.contains("ccf-youtube-bgm-edit")) {
      return false;
    }

    if (!button.querySelector('[data-testid="EditIcon"]')) {
      return false;
    }

    const itemRoot = button.closest(".MuiListItem-root");
    if (!(itemRoot instanceof HTMLElement) || itemRoot.querySelector(".ccf-youtube-bgm-item")) {
      return false;
    }

    return !!itemRoot.querySelector(".MuiListItemButton-root");
  }

  function findCcfBgmButtonBySlot(slotKey) {
    if (!slotKey) {
      return null;
    }

    return [...document.querySelectorAll("button")]
      .find((button) => getCcfBgmSlotKeyFromButton(button) === slotKey) || null;
  }

  function isCcfBgmStopButton(button) {
    return button instanceof HTMLElement && !!button.querySelector('[data-testid="StopIcon"]');
  }

  function isCcfBgmControlButton(button) {
    if (!(button instanceof HTMLElement)) {
      return false;
    }

    return !!button.querySelector('[data-testid*="Volume"], [data-testid*="Loop"]')
      || !!findCcfBgmPanel(button);
  }

  function isRecentCcfBgmClick() {
    return !!ccfBgmEditingSlotKey && Date.now() - ccfBgmLastBgmClickAt <= BGM_RECENT_CLICK_MS;
  }

  function loadYoutubeIframeApi() {
    if (ccfBgmApiReadyPromise) {
      return ccfBgmApiReadyPromise;
    }

    ccfBgmApiReadyPromise = new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }

      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousCallback === "function") {
          try {
            previousCallback();
          } catch (error) {
            debugLog("bgm-youtube-previous-callback-failed", serializeError(error));
          }
        }
        resolve();
      };

      const appendApiScript = () => {
        if (document.querySelector(`script[src="${YOUTUBE_IFRAME_API_URL}"]`)) {
          return;
        }

        const scriptTarget = document.head || document.documentElement;
        if (!scriptTarget) {
          window.setTimeout(appendApiScript, 50);
          return;
        }

        const script = document.createElement("script");
        script.src = YOUTUBE_IFRAME_API_URL;
        script.async = true;
        scriptTarget.appendChild(script);
      };

      appendApiScript();
    });

    return ccfBgmApiReadyPromise;
  }

  function ensureYoutubePlayerHost(options = {}) {
    ensureCcfYoutubeBgmPlayerDock();

    ccfBgmPlayerVisible = options.visible !== false;
    syncCcfYoutubeBgmPlayerDockVisibility();

    if (ccfBgmPlayerReady) {
      const playerElement = mountCcfYoutubeBgmPlayerFrame(ccfBgmPlayer);
      if (playerElement instanceof HTMLElement) {
        return playerElement;
      }
    }

    let host = getCcfYoutubeBgmPlayerElement();
    if (!(host instanceof HTMLElement)) {
      host = document.createElement("div");
      host.id = "ccf-youtube-bgm-player";
      host.className = "ccf-youtube-bgm-player";
    }

    host.id = "ccf-youtube-bgm-player";
    host.classList.add("ccf-youtube-bgm-player");
    host.setAttribute("width", String(YOUTUBE_PLAYER_MIN_SIZE));
    host.setAttribute("height", String(YOUTUBE_PLAYER_MIN_SIZE));
    
    // 여기서도 안전 구역(document.body)에 강제 고정
    if (host.parentElement !== document.body) {
      document.body.appendChild(host);
    }
    
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("left", "-10000px", "important");
    host.style.setProperty("top", "0", "important");
    host.style.setProperty("width", "200px", "important");
    host.style.setProperty("height", "200px", "important");
    host.style.setProperty("opacity", "0", "important");
    host.style.setProperty("pointer-events", "none", "important");
    host.style.setProperty("z-index", "-1", "important");

    ccfBgmPlayerHost = host;
    return ccfBgmPlayerHost;
  }

  function stopNativeYoutubeMedia() {
    document.querySelectorAll("audio, video").forEach((media) => {
      if (!(media instanceof HTMLMediaElement)) {
        return;
      }

      if (!extractCcfYoutubeUrl(getNativeMediaSource(media))) {
        return;
      }

      try {
        media.pause();
        media.currentTime = 0;
      } catch (error) {
        debugLog("bgm-native-youtube-stop-failed", serializeError(error));
      }
    });
  }

  function stopCcfNormalBgmPlayback() {
    getCcfNativeMediaCandidates().forEach((media) => {
      if (!(media instanceof HTMLMediaElement)) {
        return;
      }

      if (!isPotentialNativeBgmMedia(media)) {
        return;
      }

      if (media.paused) {
        return;
      }

      try {
        media.pause();
        media.currentTime = 0;
      } catch (error) {
        debugLog("bgm-cocofolia-stop-failed", serializeError(error));
      }
    });

    stopCcfTrackedWebAudioPlayback("youtube-bgm-started");
    clickCcfNativeStopButtons();
  }

  function stopCcfTrackedWebAudioPlayback(reason = "manual") {
    const state = ccfBgmLastWebAudio;
    if (!state || state.stopped || !state.source) {
      return;
    }

    try {
      state.source.stop(0);
      debugLog("bgm-webaudio-stopped", { reason });
    } catch (error) {
      debugLog("bgm-webaudio-stop-failed", serializeError(error));
    }

    state.stopped = true;
  }

  function clickCcfNativeStopButtons() {
    const buttons = [...document.querySelectorAll('button [data-testid="StopIcon"]')]
      .map((icon) => icon.closest("button"))
      .filter((button) => {
        return button instanceof HTMLButtonElement
          && button.classList.contains("MuiIconButton-sizeLarge");
      });

    if (!buttons.length) {
      return;
    }

    ccfSuppressStopHandlerUntil = Date.now() + 250;

    buttons.forEach((button) => {
      try {
        button.click();
      } catch (error) {
        debugLog("bgm-native-stop-click-failed", serializeError(error));
      }
    });
  }

  function getNativeMediaSource(media) {
    if (!(media instanceof HTMLMediaElement)) {
      return "";
    }

    const source = media.querySelector("source");
    return media.currentSrc || media.src || source?.src || source?.getAttribute("src") || "";
  }

  function extractCcfYoutubeUrl(value) {
    const text = String(value || "");
    const match = text.match(/https?:\/\/(?:(?:(?:www|m|music)\.)?(?:youtube\.com|youtube-nocookie\.com)\/[^\s"'<>]+|youtu\.be\/[^\s"'<>]+)/i);
    return match ? match[0] : "";
  }

  function extractCcfYoutubeVideoId(value) {
    const urlText = extractCcfYoutubeUrl(value) || String(value || "");
    try {
      const url = new URL(urlText, location.href);
      const host = url.hostname.replace(/^www\./i, "").toLowerCase();

      if (host === "youtu.be") {
        return sanitizeCcfYoutubeVideoId(url.pathname.split("/").filter(Boolean)[0] || "");
      }

      if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
        const queryId = url.searchParams.get("v");
        if (queryId) {
          return sanitizeCcfYoutubeVideoId(queryId);
        }

        const pathMatch = url.pathname.match(/\/(?:embed|shorts|live)\/([^/?#&]+)/i);
        if (pathMatch) {
          return sanitizeCcfYoutubeVideoId(pathMatch[1]);
        }
      }
    } catch (error) {
      // Fall through to regex parsing.
    }

    const patterns = [
      /youtu\.be\/([a-zA-Z0-9_-]{6,})/i,
      /[?&]v=([a-zA-Z0-9_-]{6,})/i,
      /youtube(?:-nocookie)?\.com\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{6,})/i
    ];

    for (const pattern of patterns) {
      const match = urlText.match(pattern);
      if (match) {
        return sanitizeCcfYoutubeVideoId(match[1]);
      }
    }

    return "";
  }

  function sanitizeCcfYoutubeVideoId(videoId) {
    const match = String(videoId || "").match(/^[a-zA-Z0-9_-]{6,}$/);
    return match ? match[0] : "";
  }

  function getCcfYoutubeThumbnailUrl(videoId) {
    const safeVideoId = sanitizeCcfYoutubeVideoId(videoId);
    return safeVideoId ? `https://i.ytimg.com/vi/${safeVideoId}/mqdefault.jpg` : "";
  }

  function formatCcfBgmTime(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  const ccfBgmShareSeenMessageIds = new Set();
  const ccfBgmShareOwnMessageIds = new Set();
  let ccfBgmShareSendingDepth = 0;

  function ccfBgmShareEncode(payload) {
    const json = JSON.stringify(payload);
    const base64 = ccfBgmShareUtf8ToBase64(json);
    let bits = "";
    for (const ch of base64) {
      bits += ch.charCodeAt(0).toString(2).padStart(8, "0");
    }
    let out = BGM_SHARE_START;
    for (let i = 0; i < bits.length; i += 2) {
      const pair = bits.slice(i, i + 2).padEnd(2, "0");
      out += BGM_SHARE_INVIS_MAP[parseInt(pair, 2)];
    }
    out += BGM_SHARE_END;
    return out;
  }

  function ccfBgmShareDecode(text) {
    if (typeof text !== "string") return null;
    const startIndex = text.indexOf(BGM_SHARE_START);
    if (startIndex < 0) return null;
    const endIndex = text.indexOf(BGM_SHARE_END, startIndex + BGM_SHARE_START.length);
    if (endIndex < 0) return null;

    const encoded = text.slice(startIndex + BGM_SHARE_START.length, endIndex);
    const reverse = new Map(BGM_SHARE_INVIS_MAP.map((ch, idx) => [ch, idx]));
    let bits = "";
    for (const ch of encoded) {
      const idx = reverse.get(ch);
      if (idx == null) continue;
      bits += idx.toString(2).padStart(2, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    try {
      const base64 = String.fromCharCode(...bytes).replace(/\0+$/g, "");
      const json = ccfBgmShareBase64ToUtf8(base64);
      const parsed = JSON.parse(json);
      if (parsed && parsed.t === "bgm-share" && parsed.v === BGM_SHARE_PROTOCOL_VERSION) {
        return parsed;
      }
    } catch (error) {
      debugLog("bgm-share-decode-failed", serializeError(error));
    }
    return null;
  }

  function ccfBgmShareUtf8ToBase64(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (error) {
      debugLog("bgm-share-encode-base64-failed", serializeError(error));
      return "";
    }
  }

  function ccfBgmShareBase64ToUtf8(base64) {
    return decodeURIComponent(escape(atob(base64)));
  }

  function ccfBgmShareBuildSlotPayload(entryKey, entry) {
    if (!entry) return null;
    return {
      entryKey: String(entryKey),
      slotKey: getCcfBgmEntrySlotKey(entryKey, entry),
      url: String(entry.url || ""),
      videoId: String(entry.videoId || ""),
      title: String(entry.title || ""),
      displayName: String(entry.displayName || entry.title || ""),
      volume: Number.isFinite(Number(entry.volume)) ? clampCcfBgmVolume(entry.volume) : 100,
      loop: entry.loop !== false,
      order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : Date.now()
    };
  }

  function ccfBgmShareSendOperation(op, slotData) {
    if (ccfBgmShareSendingDepth > 0) {
      debugLog("bgm-share-send-suppressed-reentrant", { op });
      return;
    }
    if (!chatNotifierActive) {
      debugLog("bgm-share-send-suppressed-inactive", { op });
      return;
    }
    // 슬롯 목록 동기화 경로: 이제 기본 OFF. 슬롯을 다른 클라이언트에 전파하지 않는다.
    // 대신 실제 재생 시작/정지 신호(아래 PLAYBACK_SYNC)만 전파해서, 다른 사용자가
    // "현재 재생 중인 곡"만 같이 듣게 한다. 슬롯 목록은 각자 자기 panel에서만 관리.
    if (BGM_FIRESTORE_SHARE_ENABLED && BGM_FIRESTORE_SLOT_SYNC_ENABLED) {
      ccfBgmFirestoreSendOperation(op, slotData).catch((error) => {
        debugLog("bgm-firestore-send-failed", { op, error: serializeError(error) });
      });
      return;
    }
    if (!BGM_CHAT_SHARE_ENABLED) {
      // 슬롯 동기화도 채팅도 꺼져 있으면 송신할 곳이 없음. 조용히 종료.
      return;
    }
    const sentAt = Date.now();
    const messageId = `${BGM_SHARE_SENDER_ID}-${sentAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    ccfBgmShareOwnMessageIds.add(messageId);
    ccfBgmShareSeenMessageIds.add(messageId);
    const payload = {
      v: BGM_SHARE_PROTOCOL_VERSION,
      t: "bgm-share",
      op,
      id: messageId,
      sender: BGM_SHARE_SENDER_ID,
      sentAt,
      slot: slotData
    };
    const encoded = ccfBgmShareEncode(payload);
    debugLog("bgm-share-send-begin", {
      op,
      messageId,
      encodedLength: encoded.length,
      entryKey: slotData?.entryKey
    });
    ccfBgmShareSendToChat(encoded).then(() => {
      debugLog("bgm-share-send-done", { op, messageId });
    }).catch((error) => {
      debugLog("bgm-share-send-failed", serializeError(error));
    });
  }

  async function ccfBgmShareSendToChat(text) {
    const composer = ccfBgmShareFindChatComposer();
    if (!composer) {
      debugLog("bgm-share-no-composer");
      return;
    }
    debugLog("bgm-share-composer-found", {
      tagName: composer.tagName,
      role: composer.getAttribute("role"),
      contentEditable: composer.getAttribute("contenteditable"),
      placeholder: composer.getAttribute("placeholder"),
      ariaLabel: composer.getAttribute("aria-label"),
      inDrawer: !!composer.closest(".MuiDrawer-paper")
    });
    const originalValue = ccfBgmShareReadComposerValue(composer);
    ccfBgmShareWriteComposerValue(composer, text);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    ccfBgmShareSubmitComposer(composer);
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    // Best-effort restore so we don't disturb user's in-progress draft.
    const afterValue = ccfBgmShareReadComposerValue(composer);
    debugLog("bgm-share-post-submit", {
      afterValueIsEnvelope: afterValue === text,
      afterValueEmpty: afterValue === ""
    });
    if (afterValue === text || afterValue === "") {
      ccfBgmShareWriteComposerValue(composer, originalValue || "");
    }
  }

  function ccfBgmShareFindChatComposer() {
    // CCFOLIA chat composer is a textarea (or contenteditable) inside the right-side drawer.
    // Skip placeholders that look like character-name / popup inputs.
    const skipPlaceholderRe = /noname|이름|name|url|http|youtube|search|검색/i;
    const isPlausibleChatField = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      if (!isVisible(el)) return false;
      if (el.closest('[role="dialog"]')) return false;
      if (el.disabled || el.readOnly) return false;
      const placeholder = el.getAttribute("placeholder") || "";
      if (placeholder && skipPlaceholderRe.test(placeholder)) return false;
      const aria = el.getAttribute("aria-label") || "";
      if (aria && skipPlaceholderRe.test(aria)) return false;
      return true;
    };

    // Pass 1: textareas inside the drawer (most reliable).
    const textareas = document.querySelectorAll('.MuiDrawer-paper textarea');
    for (const el of textareas) {
      if (isPlausibleChatField(el)) return el;
    }

    // Pass 2: contenteditable inside the drawer.
    const editables = document.querySelectorAll('.MuiDrawer-paper [contenteditable="true"], .MuiDrawer-paper [role="textbox"]');
    for (const el of editables) {
      if (isPlausibleChatField(el)) return el;
    }

    // Pass 3: any visible textarea anywhere (last resort).
    const anyTextareas = document.querySelectorAll('textarea');
    for (const el of anyTextareas) {
      if (isPlausibleChatField(el)) return el;
    }

    return null;
  }

  function ccfBgmShareReadComposerValue(composer) {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      return composer.value || "";
    }
    return composer.textContent || "";
  }

  function ccfBgmShareWriteComposerValue(composer, value) {
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
      const proto = composer instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) {
        setter.call(composer, value);
      } else {
        composer.value = value;
      }
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    // contenteditable
    composer.textContent = value;
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }

  function ccfBgmShareSubmitComposer(composer) {
    const enterDown = new KeyboardEvent("keydown", {
      bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13
    });
    const enterPress = new KeyboardEvent("keypress", {
      bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13
    });
    const enterUp = new KeyboardEvent("keyup", {
      bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13
    });
    composer.dispatchEvent(enterDown);
    composer.dispatchEvent(enterPress);
    composer.dispatchEvent(enterUp);

    // Fallback: try submit on the enclosing form.
    const form = composer.closest("form");
    if (form && enterDown.defaultPrevented === false) {
      try {
        form.requestSubmit?.();
      } catch (error) {
        // ignore
      }
    }
  }

  function getCcfBgmSharePayloadTime(payload) {
    const sentAt = Number(payload?.sentAt);
    if (Number.isFinite(sentAt) && sentAt > 0) {
      return sentAt;
    }

    const parts = String(payload?.id || "").split("-");
    const encodedTime = parts.length >= 2 ? parts[parts.length - 2] : "";
    const parsed = parseInt(encodedTime, 36);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function ccfBgmShareApplyIncoming(payload) {
    if (!BGM_CHAT_SHARE_ENABLED) return;
    if (!payload || !payload.id || !payload.slot) return;
    if (ccfBgmShareSeenMessageIds.has(payload.id)) return;
    ccfBgmShareSeenMessageIds.add(payload.id);
    if (payload.sender === BGM_SHARE_SENDER_ID) return; // self echo
    if (ccfBgmShareOwnMessageIds.has(payload.id)) return;

    const slot = payload.slot;
    if (!slot.url || !slot.videoId) return;

    const entryKey = String(slot.entryKey || slot.slotKey);
    if (!entryKey) return;

    const payloadTime = getCcfBgmSharePayloadTime(payload);
    const existing = ccfBgmSlotMap.get(entryKey);
    if (payload.op === "remove") {
      const existingUpdatedAt = Number(existing?.updatedAt) || 0;
      if (existing && payloadTime && existingUpdatedAt > payloadTime) {
        debugLog("bgm-share-stale-remove-ignored", { entryKey, payloadTime, existingUpdatedAt });
        return;
      }

      rememberCcfBgmDeletedEntry(entryKey, payloadTime || Date.now());
      ccfBgmShareSendingDepth += 1;
      try {
        if (existing) {
          ccfBgmSlotMap.delete(entryKey);
          markCcfYoutubeBgmSlotButtons();
          tryEnhanceCcfBgmPanel();
        }
        persistCcfBgmSlotMap();
      } finally {
        ccfBgmShareSendingDepth -= 1;
      }
      return;
    }

    const deletedAt = Number(ccfBgmDeletedEntries[entryKey]) || 0;
    if (deletedAt && (!payloadTime || payloadTime <= deletedAt)) {
      debugLog("bgm-share-stale-add-ignored", { entryKey, payloadTime, deletedAt });
      return;
    }

    // add or edit
    const now = Date.now();
    const updatedAt = payloadTime || now;
    ccfBgmSlotMap.set(entryKey, {
      slotKey: slot.slotKey || entryKey,
      url: slot.url,
      videoId: slot.videoId,
      title: slot.title || "YouTube BGM",
      displayName: slot.displayName || slot.title || "YouTube BGM",
      tabSignature: normalizeCcfBgmTabSignature(slot.tabSignature),
      volume: Number.isFinite(Number(slot.volume)) ? clampCcfBgmVolume(slot.volume) : 100,
      loop: slot.loop !== false,
      updatedAt,
      createdAt: existing?.createdAt || updatedAt,
      order: Number.isFinite(Number(slot.order)) ? Number(slot.order) : (existing?.order || updatedAt),
      pending: false
    });

    ccfBgmShareSendingDepth += 1;
    try {
      persistCcfBgmSlotMap();
      markCcfYoutubeBgmSlotButtons();
      tryEnhanceCcfBgmPanel();
      fetchStoredCcfYoutubeTitles();
    } finally {
      ccfBgmShareSendingDepth -= 1;
    }
  }

  function ccfBgmShareInspectChatItem(itemRoot) {
    if (!(itemRoot instanceof HTMLElement)) return;
    if (itemRoot.dataset.ccfBgmShareInspected === "1") return;
    itemRoot.dataset.ccfBgmShareInspected = "1";
    const text = itemRoot.textContent || "";
    if (text.indexOf(BGM_SHARE_START) < 0) return;
    const payload = ccfBgmShareDecode(text);
    if (!payload) return;
    itemRoot.setAttribute(BGM_SHARE_DOM_ATTR, payload.op || "1");
    ccfBgmShareApplyIncoming(payload);
  }

  function getCcfBgmToolkitStorage() {
    const api = window.__CAPYBARA_TOOLKIT__;
    if (!api || !api.storage) return null;
    const { getRoomData, setRoomData } = api.storage;
    if (typeof getRoomData !== "function" || typeof setRoomData !== "function") return null;
    return { getRoomData, setRoomData };
  }

  function getCcfBgmRoomKeyCandidates() {
    const keys = [CCF_BGM_TOOLKIT_ROOM_KEY, location.pathname];
    const match = location.pathname.match(/^\/rooms\/([^/?#]+)/i);
    if (match) {
      const rawRoomId = match[1];
      keys.push(rawRoomId);
      try {
        keys.push(decodeURIComponent(rawRoomId));
      } catch (error) {
        // Keep the raw room id if decoding fails.
      }
      keys.push(`/rooms/${rawRoomId}`);
    }
    keys.push(`${location.origin}${location.pathname}`);
    keys.push(location.href.split(/[?#]/)[0]);
    return uniqueCcfBgmStrings(keys);
  }

  function getCcfBgmLocalStorageKeyCandidates() {
    const keys = getCcfBgmRoomKeyCandidates().map((key) => `${BGM_STORAGE_PREFIX}${key}`);
    keys.unshift(BGM_STORAGE_KEY);

    const roomTokens = getCcfBgmRoomKeyCandidates()
      .flatMap((key) => [key, encodeURIComponent(key)])
      .filter((key) => key && key.length >= 4);

    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key || !key.startsWith(BGM_STORAGE_PREFIX)) {
          continue;
        }
        if (keys.includes(key) || roomTokens.some((token) => key.includes(token))) {
          keys.push(key);
        }
      }
    } catch (error) {
      debugLog("bgm-storage-key-scan-failed", serializeError(error));
    }

    return uniqueCcfBgmStrings(keys);
  }

  function uniqueCcfBgmStrings(values) {
    return [...new Set(values.map((value) => String(value || "")).filter(Boolean))];
  }

  function readCcfBgmLocalStorage(key = BGM_STORAGE_KEY) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      debugLog("bgm-storage-local-read-failed", {
        key,
        error: serializeError(error)
      });
      return null;
    }
  }

  function writeCcfBgmLocalStorage(payload, key = BGM_STORAGE_KEY) {
    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch (error) {
      debugLog("bgm-storage-local-save-failed", {
        key,
        error: serializeError(error)
      });
    }
  }

  function getCcfBgmPayloadMeta(payload) {
    const meta = payload?.[BGM_STORAGE_META_KEY];
    return meta && typeof meta === "object" && !Array.isArray(meta) ? meta : null;
  }

  function getCcfBgmPayloadMetaUpdatedAt(payload) {
    const meta = getCcfBgmPayloadMeta(payload);
    const updatedAt = Number(meta?.updatedAt);
    return Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0;
  }

  function getCcfBgmPayloadDeletedEntries(payload) {
    const deletedEntries = getCcfBgmPayloadMeta(payload)?.deletedEntries;
    return deletedEntries && typeof deletedEntries === "object" && !Array.isArray(deletedEntries)
      ? deletedEntries
      : {};
  }

  function rememberCcfBgmDeletedEntry(entryKey, deletedAt = Date.now()) {
    const key = String(entryKey || "");
    const time = Number(deletedAt);
    if (!key || !Number.isFinite(time) || time <= 0) {
      return;
    }

    ccfBgmDeletedEntries[key] = Math.max(Number(ccfBgmDeletedEntries[key]) || 0, time);
    trimCcfBgmDeletedEntries();
  }

  function mergeCcfBgmDeletedEntries(deletedEntries) {
    Object.entries(deletedEntries || {}).forEach(([entryKey, deletedAt]) => {
      rememberCcfBgmDeletedEntry(entryKey, deletedAt);
    });
  }

  function trimCcfBgmDeletedEntries() {
    const entries = Object.entries(ccfBgmDeletedEntries)
      .map(([entryKey, deletedAt]) => [entryKey, Number(deletedAt) || 0])
      .filter(([, deletedAt]) => deletedAt > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, BGM_DELETED_ENTRY_LIMIT);
    ccfBgmDeletedEntries = Object.fromEntries(entries);
  }

  function rememberCcfBgmPayloadRemovals(nextPayload) {
    const previous = ccfBgmShareLastSnapshot || {};
    Object.keys(previous).forEach((entryKey) => {
      if (!nextPayload?.[entryKey]) {
        rememberCcfBgmDeletedEntry(entryKey);
      }
    });
  }

  function countCcfBgmPayloadEntries(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return 0;
    }

    return Object.entries(payload).reduce((count, [entryKey, entry]) => {
      if (entryKey === BGM_STORAGE_META_KEY) {
        return count;
      }

      const normalizedSlot = getCcfBgmEntrySlotKey(entryKey, entry);
      const url = String(entry?.url || "");
      const videoId = sanitizeCcfYoutubeVideoId(entry?.videoId || extractCcfYoutubeVideoId(url));
      return count + (normalizedSlot && url && videoId ? 1 : 0);
    }, 0);
  }

  function getCcfBgmPayloadUpdatedAt(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return 0;
    }

    const metaUpdatedAt = getCcfBgmPayloadMetaUpdatedAt(payload);
    return Object.entries(payload).reduce((latest, [entryKey, entry]) => {
      if (entryKey === BGM_STORAGE_META_KEY) {
        return latest;
      }

      const updatedAt = Number(entry?.updatedAt) || 0;
      const createdAt = Number(entry?.createdAt) || 0;
      const order = Number(entry?.order) || 0;
      return Math.max(latest, updatedAt, createdAt, order);
    }, metaUpdatedAt);
  }

  function addCcfBgmStorageCandidate(candidates, source, payload, tier) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return;
    }

    candidates.push({
      source,
      payload,
      tier,
      count: countCcfBgmPayloadEntries(payload),
      updatedAt: getCcfBgmPayloadUpdatedAt(payload)
    });
  }

  function chooseCcfBgmStorageCandidate(candidates) {
    const viable = candidates.filter((candidate) => candidate.count > 0 || candidate.updatedAt > 0);
    if (!viable.length) {
      return null;
    }

    viable.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
      return b.count - a.count;
    });
    return viable[0];
  }

  function readCcfBgmIndexedRecord(storeName, key) {
    if (!window.indexedDB || !storeName || !key) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const request = window.indexedDB.open(TOOLKIT_DB_NAME);
      request.onerror = () => resolve(null);
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (!db.objectStoreNames.contains(storeName)) {
            db.close();
            resolve(null);
            return;
          }

          const tx = db.transaction(storeName, "readonly");
          const store = tx.objectStore(storeName);
          const getRequest = store.get(key);
          getRequest.onsuccess = () => resolve(getRequest.result || null);
          getRequest.onerror = () => resolve(null);
          tx.oncomplete = () => db.close();
          tx.onabort = () => db.close();
        } catch (error) {
          db.close();
          debugLog("bgm-storage-idb-direct-read-failed", {
            storeName,
            key,
            error: serializeError(error)
          });
          resolve(null);
        }
      };
    });
  }

  async function readCcfBgmIndexedRoomPayload(roomKey) {
    const record = await readCcfBgmIndexedRecord(
      TOOLKIT_STORE_ROOM_DATA,
      `room:${CCF_BGM_TOOLKIT_FEATURE_ID}:${roomKey}`
    );
    return record && record.value && typeof record.value === "object" ? record.value : null;
  }

  async function readCcfBgmLocalStorageBackup(localKey) {
    const record = await readCcfBgmIndexedRecord(TOOLKIT_STORE_ASSETS, `localStorage:${localKey}`);
    if (!record || record.value == null) {
      return null;
    }

    try {
      return typeof record.value === "string" ? JSON.parse(record.value) : record.value;
    } catch (error) {
      debugLog("bgm-storage-backup-parse-failed", {
        key: localKey,
        error: serializeError(error)
      });
      return null;
    }
  }

  async function collectCcfBgmStorageCandidates() {
    const candidates = [];
    const toolkit = getCcfBgmToolkitStorage();
    const roomKeys = getCcfBgmRoomKeyCandidates();
    const localKeys = getCcfBgmLocalStorageKeyCandidates();

    if (toolkit) {
      for (const [index, roomKey] of roomKeys.entries()) {
        try {
          const record = await toolkit.getRoomData(CCF_BGM_TOOLKIT_FEATURE_ID, roomKey);
          if (record && record.value && typeof record.value === "object") {
            addCcfBgmStorageCandidate(
              candidates,
              `indexedDB:roomData:${roomKey}`,
              record.value,
              index === 0 ? 1 : 2
            );
          }
        } catch (error) {
          debugLog("bgm-storage-idb-read-failed", {
            roomKey,
            error: serializeError(error)
          });
        }
      }
    }

    for (const [index, roomKey] of roomKeys.entries()) {
      try {
        const payload = await readCcfBgmIndexedRoomPayload(roomKey);
        addCcfBgmStorageCandidate(
          candidates,
          `indexedDB-direct:roomData:${roomKey}`,
          payload,
          index === 0 ? 1 : 2
        );
      } catch (error) {
        debugLog("bgm-storage-idb-direct-room-read-failed", {
          roomKey,
          error: serializeError(error)
        });
      }
    }

    for (const [index, localKey] of localKeys.entries()) {
      addCcfBgmStorageCandidate(
        candidates,
        `localStorage:${localKey}`,
        readCcfBgmLocalStorage(localKey),
        localKey === BGM_STORAGE_KEY || index === 0 ? 1 : 2
      );
    }

    for (const localKey of localKeys) {
      const backupPayload = await readCcfBgmLocalStorageBackup(localKey);
      addCcfBgmStorageCandidate(
        candidates,
        `indexedDB:backup:${localKey}`,
        backupPayload,
        3
      );
    }

    return candidates;
  }

  async function recoverCcfBgmStorageFromCandidates() {
    const candidates = await collectCcfBgmStorageCandidates();
    const selected = chooseCcfBgmStorageCandidate(candidates);
    debugLog("bgm-storage-candidates", candidates.map((candidate) => ({
      source: candidate.source,
      tier: candidate.tier,
      count: candidate.count,
      updatedAt: candidate.updatedAt
    })));

    if (!selected) {
      return null;
    }

    writeCcfBgmLocalStorage(selected.payload);
    const toolkit = getCcfBgmToolkitStorage();
    if (toolkit) {
      try {
        await toolkit.setRoomData(CCF_BGM_TOOLKIT_FEATURE_ID, CCF_BGM_TOOLKIT_ROOM_KEY, selected.payload);
      } catch (error) {
        debugLog("bgm-storage-recovery-save-failed", serializeError(error));
      }
    }

    if (selected.tier > 1) {
      debugLog("bgm-storage-recovered", {
        source: selected.source,
        count: selected.count
      });
    }

    return selected;
  }

  async function readCcfBgmPersistedPayload() {
    try {
      const selected = await recoverCcfBgmStorageFromCandidates();
      if (selected?.payload) {
        return selected.payload;
      }
    } catch (error) {
      debugLog("bgm-storage-recovery-failed", serializeError(error));
    }

    const toolkit = getCcfBgmToolkitStorage();
    if (toolkit) {
      try {
        const record = await toolkit.getRoomData(CCF_BGM_TOOLKIT_FEATURE_ID, CCF_BGM_TOOLKIT_ROOM_KEY);
        if (record && record.value && typeof record.value === "object") {
          return record.value;
        }
        const legacy = readCcfBgmLocalStorage();
        if (legacy && !ccfBgmStorageMigratedFromLocal) {
          ccfBgmStorageMigratedFromLocal = true;
          try {
            await toolkit.setRoomData(CCF_BGM_TOOLKIT_FEATURE_ID, CCF_BGM_TOOLKIT_ROOM_KEY, legacy);
            debugLog("bgm-storage-migrated", { keys: Object.keys(legacy || {}).length });
          } catch (error) {
            debugLog("bgm-storage-migrate-failed", serializeError(error));
          }
        }
        return legacy;
      } catch (error) {
        debugLog("bgm-storage-idb-read-failed", serializeError(error));
        return readCcfBgmLocalStorage();
      }
    }
    return readCcfBgmLocalStorage();
  }

  function loadCcfBgmSlotMap() {
    if (ccfBgmStorageLoadPromise) {
      return ccfBgmStorageLoadPromise;
    }

    ccfBgmStorageLoadPromise = (async () => {
      // 1. 먼저 전역(글로벌) 저장소에 있는 데이터를 불러옵니다.
      const parsed = await readCcfBgmPersistedPayload();
      if (parsed) {
        applyCcfBgmPersistedPayload(parsed);
      }
      
      // 2. 과거에 각 방(Room)마다 흩어져 저장되어 있던 옛날 데이터를 가져와서 합칩니다.
      const didMigrate = migrateLegacyRoomDataToGlobal();
      
      // 3. 만약 합칠 옛날 데이터가 있었다면, 합쳐진 결과를 전역 저장소에 다시 최종 저장합니다.
      if (didMigrate) {
        persistCcfBgmSlotMap(); 
      }
      
      ccfBgmStorageLoaded = true;
    })().catch((error) => {
      ccfBgmStorageLoaded = true;
      debugLog("bgm-storage-load-failed", serializeError(error));
    });

    return ccfBgmStorageLoadPromise;
  }

  function applyCcfBgmPersistedPayload(parsed) {
    try {
      mergeCcfBgmDeletedEntries(getCcfBgmPayloadDeletedEntries(parsed));
      Object.entries(parsed || {}).forEach(([entryKey, entry], index) => {
        if (entryKey === BGM_STORAGE_META_KEY) {
          return;
        }

        const normalizedSlot = getCcfBgmEntrySlotKey(entryKey, entry);
        const storageKey = String(entryKey || "").includes(":youtube:")
          ? String(entryKey)
          : normalizedSlot;
        const url = String(entry?.url || "");
        const videoId = sanitizeCcfYoutubeVideoId(entry?.videoId || extractCcfYoutubeVideoId(url));
        const updatedAt = Number(entry?.updatedAt) || 0;
        const createdAt = Number(entry?.createdAt) || updatedAt || Date.now() + index;
        if (storageKey && normalizedSlot && url && videoId) {
          ccfBgmSlotMap.set(storageKey, {
            slotKey: normalizedSlot,
            url,
            videoId,
            title: normalizeSpace(entry?.title || "") || "YouTube BGM",
            displayName: normalizeSpace(entry?.displayName || entry?.title || "") || "YouTube BGM",
            tabSignature: normalizeCcfBgmTabSignature(entry?.tabSignature),
            volume: Number.isFinite(Number(entry?.volume)) ? clampCcfBgmVolume(entry.volume) : 100,
            volumeEdited: entry?.volumeEdited === true,
            loop: typeof entry?.loop === "boolean" ? entry.loop : true,
            updatedAt,
            createdAt,
            order: Number.isFinite(Number(entry?.order)) && Number(entry.order) > 0
              ? Number(entry.order)
              : createdAt,
            pending: entry?.pending !== false
          });
        }
      });
    } catch (error) {
      debugLog("bgm-storage-load-failed", serializeError(error));
    }
    // Seed share baseline so loaded-from-storage slots aren't re-broadcast on next persist.
    const baseline = {};
    ccfBgmSlotMap.forEach((entry, entryKey) => {
      baseline[entryKey] = ccfBgmShareSerializableEntry(entry);
    });
    ccfBgmShareLastSnapshot = baseline;
  }

  function persistCcfBgmSlotMap() {
    let payload;
    let persistedPayload;
    try {
      const now = Date.now();
      payload = {};
      ccfBgmSlotMap.forEach((entry, entryKey) => {
        payload[entryKey] = {
          slotKey: getCcfBgmEntrySlotKey(entryKey, entry),
          url: entry.url,
          videoId: entry.videoId,
          title: entry.title || "",
          displayName: entry.displayName || entry.title || "",
          tabSignature: normalizeCcfBgmTabSignature(entry.tabSignature),
          volume: Number.isFinite(Number(entry.volume)) ? clampCcfBgmVolume(entry.volume) : 100,
          volumeEdited: entry.volumeEdited === true,
          loop: entry.loop !== false,
          updatedAt: entry.updatedAt || now,
          createdAt: entry.createdAt || entry.updatedAt || now,
          order: getCcfYoutubeBgmOrder(entry, now),
          pending: entry.pending !== false
        };
      });
      rememberCcfBgmPayloadRemovals(payload);
      trimCcfBgmDeletedEntries();
      persistedPayload = {
        ...payload,
        [BGM_STORAGE_META_KEY]: {
          version: BGM_STORAGE_META_VERSION,
          roomKey: CCF_BGM_TOOLKIT_ROOM_KEY,
          updatedAt: now,
          count: Object.keys(payload).length,
          deletedEntries: { ...ccfBgmDeletedEntries }
        }
      };
    } catch (error) {
      debugLog("bgm-storage-serialize-failed", serializeError(error));
      return;
    }

    writeCcfBgmLocalStorage(persistedPayload);

    const toolkit = getCcfBgmToolkitStorage();
    if (toolkit) {
      toolkit.setRoomData(CCF_BGM_TOOLKIT_FEATURE_ID, CCF_BGM_TOOLKIT_ROOM_KEY, persistedPayload).catch((error) => {
        debugLog("bgm-storage-idb-save-failed", serializeError(error));
      });
    }

    ccfBgmShareDispatchDiff(payload);
  }

  let ccfBgmShareLastSnapshot = {};

  function ccfBgmShareSerializableEntry(entry) {
    return {
      url: entry?.url || "",
      videoId: entry?.videoId || "",
      title: entry?.title || "",
      displayName: entry?.displayName || "",
      tabSignature: normalizeCcfBgmTabSignature(entry?.tabSignature),
      volume: Number.isFinite(Number(entry?.volume)) ? clampCcfBgmVolume(entry.volume) : 100,
      loop: entry?.loop !== false,
      order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : 0,
      slotKey: entry?.slotKey || ""
    };
  }

  function ccfBgmShareEntriesEqual(a, b) {
    if (!a || !b) return false;
    return a.url === b.url
      && a.videoId === b.videoId
      && a.title === b.title
      && a.displayName === b.displayName
      && a.tabSignature === b.tabSignature
      && a.volume === b.volume
      && a.loop === b.loop
      && a.order === b.order;
  }

  function ccfBgmShareDispatchDiff(payload) {
    const next = ccfBgmShareCloneSnapshot(payload);
    // 활성화된 공유 채널이 하나도 없으면 베이스라인만 갱신하고 종료.
    if (!BGM_CHAT_SHARE_ENABLED && !BGM_FIRESTORE_SHARE_ENABLED) {
      ccfBgmShareLastSnapshot = next;
      return;
    }
    if (ccfBgmShareSendingDepth > 0) {
      // Snapshot the new state without emitting (otherwise we'd echo the remote update back).
      ccfBgmShareLastSnapshot = next;
      return;
    }

    const previous = ccfBgmShareLastSnapshot || {};
    const adds = [];
    const edits = [];
    const removes = [];

    for (const [entryKey, nextEntry] of Object.entries(next)) {
      const prevEntry = previous[entryKey];
      if (!prevEntry) {
        adds.push({ entryKey, nextEntry });
        continue;
      }
      if (!ccfBgmShareEntriesEqual(prevEntry, nextEntry)) {
        edits.push({ entryKey, nextEntry });
      }
    }
    for (const entryKey of Object.keys(previous)) {
      if (!next[entryKey]) {
        removes.push({ entryKey, prevEntry: previous[entryKey] });
      }
    }

    debugLog("bgm-share-diff", {
      adds: adds.length,
      edits: edits.length,
      removes: removes.length,
      baselineSize: Object.keys(previous).length,
      nextSize: Object.keys(next).length
    });

    adds.forEach(({ entryKey, nextEntry }) => {
      ccfBgmShareSendOperation("add", { entryKey, ...nextEntry });
    });
    edits.forEach(({ entryKey, nextEntry }) => {
      ccfBgmShareSendOperation("edit", { entryKey, ...nextEntry });
    });
    removes.forEach(({ entryKey, prevEntry }) => {
      ccfBgmShareSendOperation("remove", { entryKey, ...prevEntry });
    });

    ccfBgmShareLastSnapshot = next;
  }

  function ccfBgmShareCloneSnapshot(payload) {
    const out = {};
    for (const [entryKey, entry] of Object.entries(payload || {})) {
      if (entryKey === BGM_STORAGE_META_KEY) {
        continue;
      }

      const normalizedSlot = getCcfBgmEntrySlotKey(entryKey, entry);
      const url = String(entry?.url || "");
      const videoId = sanitizeCcfYoutubeVideoId(entry?.videoId || extractCcfYoutubeVideoId(url));
      if (!normalizedSlot || !url || !videoId) {
        continue;
      }

      out[entryKey] = ccfBgmShareSerializableEntry(entry);
    }
    return out;
  }

  function injectCcfBgmEnhancerStyle() {
    if (document.getElementById("ccf-bgm-enhancer-style")) {
      return;
    }

    const styleTarget = document.head || document.documentElement;
    if (!styleTarget) {
      window.setTimeout(injectCcfBgmEnhancerStyle, 50);
      return;
    }

    const style = document.createElement("style");
    style.id = "ccf-bgm-enhancer-style";
    style.textContent = `
      [data-ccf-bgm-share] {
        display: none !important;
      }

      [data-ccf-bgm-drawer-size-lock="1"] {
        box-sizing: content-box !important;
        display: flex !important;
        flex-direction: column !important;
        flex-grow: 1 !important;
        flex-shrink: 0 !important;
        width: ${BGM_DRAWER_WIDTH_PX}px !important;
        max-width: ${BGM_DRAWER_WIDTH_PX}px !important;
        min-width: 0 !important;
        max-height: 100% !important;
        min-height: 0 !important;
        overflow-x: auto !important;
        overflow-y: auto !important;
      }

      [data-ccf-bgm-panel="1"],
      [data-ccf-bgm-progress-host="1"],
      [data-ccf-bgm-button-row="1"] {
        box-sizing: border-box !important;
        max-width: 100% !important;
        min-width: 0 !important;
      }

      [data-ccf-bgm-button-row="1"] {
        margin-bottom: 0 !important;
      }

      .ccf-bgm-progress-root {
        box-sizing: border-box !important;
        display: flex !important;
        justify-content: flex-start !important;
        position: absolute !important;
        left: var(--ccf-bgm-progress-left, 0px) !important;
        top: var(--ccf-bgm-progress-top, 100%) !important;
        width: var(--ccf-bgm-progress-width, auto) !important;
        max-width: 100% !important;
        height: auto !important;
        max-height: none !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: visible !important;
        z-index: 6 !important;
        color: rgba(255, 255, 255, 0.88);
        font-size: 10px;
        line-height: 1;
      }

      .ccf-bgm-progress-layout {
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        flex-wrap: nowrap !important;
        align-items: center !important;
        justify-content: flex-start !important;
        gap: 0 !important;
        margin-left: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        height: auto !important;
        padding: 0 !important;
        overflow: visible !important;
      }

      .ccf-bgm-progress-row {
        box-sizing: border-box !important;
        display: grid !important;
        grid-template-columns: 34px minmax(0, 1fr) 34px !important;
        align-items: center !important;
        gap: 2px !important;
        flex: 0 0 auto !important;
        width: calc(100% - 16px) !important;
        max-width: calc(100% - 16px) !important;
        height: 16px !important;
        min-width: 0 !important;
        padding: 0 8px !important;
        margin: 6px 8px !important;
        overflow: hidden !important;
        align-self: center !important;
      }

      .ccf-bgm-time {
        box-sizing: border-box;
        min-width: 0;
        font-variant-numeric: tabular-nums;
        opacity: 0.82;
        text-align: center;
        line-height: 16px;
        white-space: nowrap;
        overflow: hidden;
      }

      .ccf-bgm-progress-input {
        box-sizing: border-box !important;
        display: block !important;
        justify-self: center !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        height: 4px !important;
        margin: 0 !important;
        accent-color: #2196f3;
        cursor: pointer;
      }

      button[data-ccf-youtube-bgm-registered],
      button[data-ccf-youtube-bgm-registered].MuiButtonBase-root {
        color: #2196f3 !important;
        position: relative !important;
        overflow: visible !important;
      }

      button[data-ccf-youtube-bgm-registered] svg,
      button[data-ccf-youtube-bgm-registered] .MuiSvgIcon-root,
      button[data-ccf-youtube-bgm-registered] span {
        color: #2196f3 !important;
        fill: #2196f3 !important;
      }

      button[data-ccf-youtube-bgm-registered="true"]::after {
        content: "";
        position: absolute;
        right: -4px;
        top: -4px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #ff0000;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
        pointer-events: none;
        z-index: 10;
      }

      .ccf-bgm-native-tooltip {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 2147483647;
        max-width: 320px;
        padding: 8px 10px;
        border-radius: 6px;
        background: rgba(20, 20, 20, 0.96);
        color: #fff;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.42);
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transition: opacity 120ms ease;
      }

      .ccf-bgm-native-tooltip[data-visible="1"] {
        opacity: 1;
        visibility: visible;
      }

      .ccf-bgm-native-tooltip-title {
        font-size: 12px;
        font-weight: 700;
        line-height: 1.45;
        word-break: break-word;
      }

      .ccf-bgm-native-tooltip-meta {
        margin-top: 3px;
        font-size: 11px;
        line-height: 1.4;
        color: rgba(255, 255, 255, 0.7);
        font-variant-numeric: tabular-nums;
      }

      .ccf-youtube-bgm-row-wrap {
        box-sizing: border-box !important;
        width: 100% !important;
        will-change: transform !important;
      }

      /* native css-q3kgqo 그대로 — color + padding + border-radius */
      .ccf-youtube-bgm-multi-checkbox {
        position: relative !important;
        flex: 0 0 auto !important;
        pointer-events: auto !important;
        color: rgba(255, 255, 255, 0.7) !important;
        overflow: visible !important;
      }
      .ccf-youtube-bgm-multi-checkbox svg {
        transition: fill 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important;
        fill: currentColor !important;
      }
      .ccf-youtube-bgm-multi-checkbox svg path {
        fill: currentColor !important;
      }
      .ccf-youtube-bgm-multi-checkbox.Mui-checked {
        color: rgb(220, 0, 78) !important;
      }
      /* native ListItemButton의 TouchRipple 시뮬:
         checkbox 중심에서 편집 버튼 중간쯤까지 확산 (enter 350ms + leave 350ms = ~0.7s) */
      .ccf-youtube-bgm-item {
        position: relative !important;
        overflow: hidden !important;
      }
      .ccf-youtube-bgm-row-ripple {
        position: absolute !important;
        border-radius: 50% !important;
        background-color: currentColor !important;
        pointer-events: none !important;
        transform: scale(0);
        transform-origin: center center !important;
        opacity: 0;
        animation: ccf-bgm-row-ripple-enter 350ms cubic-bezier(0.0, 0, 0.2, 1) forwards !important;
        z-index: 0 !important;
      }
      .ccf-youtube-bgm-row-ripple.is-leaving {
        animation: ccf-bgm-row-ripple-leave 350ms cubic-bezier(0.0, 0, 0.2, 1) forwards !important;
      }
      /* max opacity 0.28 — native checkbox click active tone.
         사용자 관찰: v0.2.75(0.30)는 약간 밝고, ripple은 checkbox 중심 파동이어야 한다. */
      @keyframes ccf-bgm-row-ripple-enter {
        0% { transform: scale(0); opacity: 0; }
        66% { transform: scale(0.88); opacity: 0.28; }
        100% { transform: scale(1); opacity: 0.28; }
      }
      @keyframes ccf-bgm-row-ripple-leave {
        0% { opacity: 0.28; }
        100% { opacity: 0; }
      }

      .ccf-youtube-bgm-row-wrap > [role="button"] {
        width: 100% !important;
        cursor: grab !important;
        touch-action: none !important;
      }

      .ccf-youtube-bgm-row-wrap .MuiListItem-root {
        box-sizing: border-box !important;
        width: 100% !important;
      }

      .ccf-youtube-bgm-row-wrap.ccf-youtube-bgm-dragging {
        position: relative !important;
        z-index: 1 !important;
      }

      .ccf-youtube-bgm-row-wrap.ccf-youtube-bgm-animating {
        pointer-events: none !important;
      }

      .ccf-youtube-bgm-drag-clone {
        box-sizing: border-box !important;
        list-style: none !important;
        pointer-events: none !important;
      }

      .ccf-youtube-bgm-drag-clone > [role="button"] {
        width: 100% !important;
        cursor: grabbing !important;
      }

      .ccf-youtube-bgm-row-wrap.ccf-youtube-bgm-dragging > [role="button"],
      .ccf-youtube-bgm-list-dragging .ccf-youtube-bgm-row-wrap > [role="button"] {
        cursor: grabbing !important;
      }

      .ccf-youtube-bgm-list-dragging {
        user-select: none !important;
      }

      .ccf-youtube-bgm-item {
        color: inherit !important;
      }

      .ccf-youtube-bgm-main {
        min-width: 0 !important;
      }

      .ccf-youtube-bgm-title {
        display: block !important;
        min-width: 0 !important;
        overflow: hidden !important;
        white-space: nowrap !important;
        text-overflow: ellipsis !important;
      }

      .ccf-youtube-bgm-edit svg,
      .ccf-youtube-bgm-svg {
        fill: currentColor !important;
      }

      .ccf-youtube-bgm-avatar {
        position: relative !important;
        overflow: visible !important;
        background: #111 !important;
        color: #ffffff !important;
      }

      .ccf-youtube-bgm-thumb,
      .ccf-youtube-bgm-thumb-fallback {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        border-radius: 50% !important;
      }

      .ccf-youtube-bgm-thumb {
        z-index: 1 !important;
        display: block !important;
        object-fit: cover !important;
        object-position: center !important;
      }

      .ccf-youtube-bgm-thumb-fallback {
        z-index: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        overflow: hidden !important;
        background: #757575 !important;
        color: #ffffff !important;
      }

      .ccf-youtube-bgm-thumb-badge {
        position: absolute !important;
        right: -1px !important;
        bottom: -1px !important;
        z-index: 2 !important;
        display: none !important;
        align-items: center !important;
        justify-content: center !important;
        width: 18px !important;
        height: 18px !important;
        border-radius: 50% !important;
        background: #ff0000 !important;
        color: #ffffff !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35) !important;
        pointer-events: none !important;
      }

      .ccf-youtube-bgm-avatar[data-ccf-youtube-bgm-has-thumb="1"]:not([data-ccf-youtube-bgm-thumb-failed="1"]) .ccf-youtube-bgm-thumb-badge {
        display: flex !important;
      }

      .ccf-youtube-bgm-thumb-badge .ccf-youtube-bgm-svg {
        width: 14px !important;
        height: 14px !important;
        fill: #ffffff !important;
      }

      .ccf-youtube-bgm-popover {
        -webkit-text-size-adjust: 100% !important;
        --react-pdf-annotation-layer: 1;
        --annotation-unfocused-field-background: url('data:image/svg+xml;charset=utf-8,<svg width="1" height="1" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" style="fill:rgba(0,54,255,.13)"/></svg>');
        --input-focus-border-color: Highlight;
        --input-focus-outline: 1px solid Canvas;
        --input-unfocused-border-color: #0000;
        --input-disabled-border-color: #0000;
        --input-hover-border-color: #000;
        --link-outline: none;
        --react-pdf-text-layer: 1;
        --highlight-bg-color: #b400aa;
        --highlight-selected-bg-color: #006400;
        position: fixed !important;
        z-index: 2147483647 !important;
        box-sizing: content-box !important;
        width: auto !important;
        min-width: 16px !important;
        max-width: calc(100% - 32px) !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        color: rgb(255, 255, 255) !important;
        background-color: rgba(44, 44, 44, 0.87) !important;
        background-image: none !important;
        border-radius: 4px !important;
        box-shadow: rgba(0, 0, 0, 0.2) 0px 5px 5px -3px, rgba(0, 0, 0, 0.14) 0px 8px 10px 1px, rgba(0, 0, 0, 0.12) 0px 3px 14px 2px !important;
      }

      .ccf-youtube-bgm-paper {
        box-sizing: content-box !important;
        width: 240px !important;
        margin: 0 !important;
        padding: 8px 16px !important;
        color: rgb(255, 255, 255) !important;
        background-color: rgb(18, 18, 18) !important;
        background-image: linear-gradient(rgba(255, 255, 255, 0.11), rgba(255, 255, 255, 0.11)) !important;
        border-radius: 4px !important;
        box-shadow: rgba(0, 0, 0, 0.2) 0px 3px 5px -1px, rgba(0, 0, 0, 0.14) 0px 6px 10px 0px, rgba(0, 0, 0, 0.12) 0px 1px 18px 0px !important;
        transition: box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1) !important;
      }

      /* ── 팝오버 자체 완결 스타일: 코코포리아 emotion CSS 미주입 상태에서도 정상 표시 ── */
      .ccf-youtube-bgm-popover *:not(.ccf-youtube-bgm-paper),
      .ccf-youtube-bgm-popover *:not(.ccf-youtube-bgm-paper)::before,
      .ccf-youtube-bgm-popover *:not(.ccf-youtube-bgm-paper)::after {
        box-sizing: border-box !important;
      }

      .ccf-youtube-bgm-popover form {
        display: block !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        background: transparent !important;
      }

      .ccf-youtube-bgm-popover .MuiFormControl-root {
        display: flex !important;
        flex-direction: column !important;
        position: relative !important;
        width: 100% !important;
        margin: 8px 0 4px !important;
        padding: 0 !important;
        border: 0 !important;
        vertical-align: top !important;
      }

      .ccf-youtube-bgm-popover .MuiInputBase-root {
        position: relative !important;
        display: flex !important;
        align-items: center !important;
        width: 100% !important;
        min-width: 0 !important;
        height: 56px !important;
        margin: 0 !important;
        padding: 0 !important;
        background-color: rgba(255, 255, 255, 0.09) !important;
        border: 0 !important;
        border-radius: 4px 4px 0 0 !important;
        color: rgb(255, 255, 255) !important;
        cursor: text !important;
        font-family: Roboto, Helvetica, Arial, sans-serif !important;
      }

      .ccf-youtube-bgm-popover .MuiInputBase-root::before {
        content: "" !important;
        position: absolute !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.7) !important;
        pointer-events: none !important;
      }

      .ccf-youtube-bgm-popover .MuiInputBase-root::after {
        content: "" !important;
        position: absolute !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        border-bottom: 2px solid rgb(33, 150, 243) !important;
        transform: scaleX(0) !important;
        transition: transform 0.2s cubic-bezier(0, 0, 0.2, 1) !important;
        pointer-events: none !important;
      }

      .ccf-youtube-bgm-popover .MuiInputBase-root:focus-within::after {
        transform: scaleX(1) !important;
      }

      .ccf-youtube-bgm-popover input[name="name"] {
        display: block !important;
        width: 100% !important;
        min-width: 0 !important;
        height: 56px !important;
        margin: 0 !important;
        padding: 25px 12px 8px !important;
        border: 0 !important;
        outline: none !important;
        background: transparent !important;
        color: rgb(255, 255, 255) !important;
        font-family: Roboto, Helvetica, Arial, sans-serif !important;
        font-size: 16px !important;
        font-weight: 400 !important;
        line-height: 23px !important;
        letter-spacing: 0.15px !important;
        text-overflow: ellipsis !important;
      }

      .ccf-youtube-bgm-popover label {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: translate(12px, 7px) scale(0.75) !important;
        transform-origin: top left !important;
        color: rgba(255, 255, 255, 0.7) !important;
        font-family: Roboto, Helvetica, Arial, sans-serif !important;
        font-size: 16px !important;
        font-weight: 400 !important;
        line-height: 23px !important;
        letter-spacing: 0.15px !important;
        white-space: nowrap !important;
        pointer-events: none !important;
        z-index: 1 !important;
      }

      .ccf-youtube-bgm-volume-row {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        width: 100% !important;
        height: 34px !important;
        margin: 8px 0 0 !important;
        padding: 0 !important;
      }

      .ccf-youtube-bgm-volume-row > svg {
        flex: 0 0 auto !important;
        display: block !important;
        width: 24px !important;
        height: 24px !important;
        fill: rgb(255, 255, 255) !important;
      }

      .ccf-youtube-bgm-slider {
        position: relative !important;
        display: block !important;
        flex: 1 1 auto !important;
        width: auto !important;
        min-width: 0 !important;
        height: 28px !important;
        margin: 0 8px !important;
        padding: 0 !important;
        cursor: pointer !important;
        touch-action: none !important;
      }

      .ccf-youtube-bgm-slider .MuiSlider-rail,
      .ccf-youtube-bgm-slider .MuiSlider-track {
        position: absolute !important;
        top: 50% !important;
        height: 2px !important;
        margin: 0 !important;
        transform: translateY(-50%) !important;
        border-radius: 12px !important;
        background-color: rgb(33, 150, 243) !important;
      }

      .ccf-youtube-bgm-slider .MuiSlider-rail {
        left: 0 !important;
        right: 0 !important;
        width: 100% !important;
        opacity: 0.38 !important;
      }

      .ccf-youtube-bgm-slider .MuiSlider-track {
        left: 0 !important;
        opacity: 1 !important;
      }

      .ccf-youtube-bgm-slider .MuiSlider-thumb {
        position: absolute !important;
        top: 50% !important;
        width: 12px !important;
        height: 12px !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: translate(-50%, -50%) !important;
        border-radius: 50% !important;
        background-color: rgb(33, 150, 243) !important;
      }

      .ccf-youtube-bgm-range {
        position: absolute !important;
        inset: 0 !important;
        z-index: 2 !important;
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        cursor: pointer !important;
        opacity: 0 !important;
        appearance: none !important;
        background: transparent !important;
        touch-action: none !important;
      }

      .ccf-youtube-bgm-range::-webkit-slider-thumb {
        appearance: none !important;
        width: 18px !important;
        height: 24px !important;
        background: transparent !important;
        border: 0 !important;
      }

      .ccf-youtube-bgm-volume-value {
        flex: 0 0 auto !important;
        margin: 0 !important;
        padding: 0 2px !important;
        color: rgb(255, 255, 255) !important;
        font-family: Roboto, Helvetica, Arial, sans-serif !important;
        font-size: 16px !important;
        font-weight: 400 !important;
        line-height: 24px !important;
        letter-spacing: 0.15px !important;
        text-align: center !important;
        white-space: nowrap !important;
      }

      .ccf-youtube-bgm-loop {
        flex: 0 0 auto !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 34px !important;
        height: 34px !important;
        min-width: 34px !important;
        margin: 0 !important;
        padding: 5px !important;
        border: 0 !important;
        border-radius: 50% !important;
        cursor: pointer !important;
      }

      .ccf-youtube-bgm-loop svg {
        width: 24px !important;
        height: 24px !important;
      }

      /* 반복재생 버튼: 네이티브처럼 배경/하이라이트 없이 아이콘만 표시한다. */
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop,
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop:hover,
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop:focus,
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop:focus-visible,
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop:active,
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop.Mui-focusVisible {
        background: transparent !important;
        background-color: transparent !important;
        box-shadow: none !important;
        outline: none !important;
      }

      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop .MuiTouchRipple-root {
        display: none !important;
      }

      /* 켜짐: 네이티브 primary 파랑 / 꺼짐: 흰색 */
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop[data-loop="1"],
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop[data-loop="1"] svg {
        color: rgb(33, 150, 243) !important;
        fill: rgb(33, 150, 243) !important;
        opacity: 1 !important;
      }

      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop[data-loop="0"],
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-loop[data-loop="0"] svg {
        color: rgb(255, 255, 255) !important;
        fill: rgb(255, 255, 255) !important;
        opacity: 1 !important;
      }

      .ccf-youtube-bgm-preview-host {
        position: fixed !important;
        left: -10000px !important;
        top: 0 !important;
        width: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        height: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        opacity: 0 !important;
        pointer-events: none !important;
        z-index: -1 !important;
      }

      .ccf-youtube-bgm-actions {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        width: 100% !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      .ccf-youtube-bgm-actions button {
        flex: 1 1 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        min-width: 64px !important;
        margin: 0 !important;
        padding: 6px 8px !important;
        border: 0 !important;
        border-radius: 4px !important;
        background: transparent !important;
        cursor: pointer !important;
        font-family: Roboto, Helvetica, Arial, sans-serif !important;
        font-size: 14px !important;
        font-weight: 700 !important;
        line-height: 24.5px !important;
        letter-spacing: 0.4px !important;
        text-transform: uppercase !important;
        white-space: nowrap !important;
      }

      .ccf-youtube-bgm-popover .ccf-youtube-bgm-preview,
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-save {
        color: rgb(33, 150, 243) !important;
      }

      .ccf-youtube-bgm-popover .ccf-youtube-bgm-remove,
      .ccf-youtube-bgm-popover .ccf-youtube-bgm-preview[data-previewing="1"] {
        color: rgb(220, 0, 78) !important;
      }

      .ccf-youtube-bgm-player-dock {
        box-sizing: border-box !important;
        display: none !important;
        flex: 0 0 ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        width: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        min-width: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        max-width: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        height: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        min-height: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        max-height: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        pointer-events: auto !important;
      }

      .ccf-youtube-bgm-player-dock[data-ccf-youtube-bgm-visible="1"] {
        display: block !important;
      }

      .ccf-youtube-bgm-player,
      .ccf-youtube-bgm-player-dock iframe {
        position: static !important;
        display: block !important;
        box-sizing: border-box !important;
        width: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        min-width: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        max-width: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        height: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        min-height: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        max-height: ${YOUTUBE_PLAYER_MIN_SIZE}px !important;
        border: 0 !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }

      [data-ccf-bgm-dialog-root="1"] {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
      }

      [data-ccf-bgm-dialog-paper="1"] {
        position: fixed !important;
        left: 50% !important;
        top: 50% !important;
        right: auto !important;
        bottom: auto !important;
        transform: translate(-50%, -50%) !important;
        margin: 0 !important;
        max-width: min(92vw, ${BGM_DRAWER_WIDTH_PX}px) !important;
        max-height: 88vh !important;
      }
    `;

    styleTarget.appendChild(style);
    registerTeardown(() => {
      style.remove();
    });
  }

  // 음악 라이브러리 헤더에 "複数選択 / 복수 선택 / multi select" 토글이 활성화돼 있는지 감지.
  // CCFOLIA는 토글 버튼에 aria-pressed="true" 또는 active 색상 변형 클래스(MuiButton-contained 등)를
  // 부여한다. 우리가 정확한 active class를 알 수 없으므로 "라벨로 식별 → 부모/형제에 active 단서 탐색"
  // 휴리스틱을 사용한다.
  function isCcfBgmMultiSelectActive(scope) {
    const root = scope instanceof Element ? scope.closest('[role="dialog"], .MuiDialog-root, .MuiDrawer-root') : null;
    const container = root || scope;
    if (!(container instanceof Element)) return false;
    const buttons = container.querySelectorAll("button");
    for (const btn of buttons) {
      if (!(btn instanceof HTMLElement)) continue;
      const label = (btn.getAttribute("aria-label") || btn.textContent || "").trim();
      if (!/(複数選択|複数選 ?択|복수\s*선택|multi[-\s]?select|multiselect)/i.test(label)) continue;
      // active 단서: aria-pressed="true" 또는 MuiButton-contained variant
      if (btn.getAttribute("aria-pressed") === "true") return true;
      if (/\bMuiButton-contained\b/.test(btn.className || "")) return true;
      if (btn.matches?.(".Mui-selected, .is-active, [data-active='1']")) return true;
    }
    return false;
  }

  // ========================================================================
  // 복수선택 모드 연동: YouTube row에도 체크박스 + 일괄 작업 (delete/select-all)
  // ========================================================================
  const CCF_BGM_MS_CHECKBOX_CLASS = "ccf-youtube-bgm-multi-checkbox";
  const CCF_BGM_MS_SELECTED_ATTR = "data-ccf-bgm-multi-selected";
  const CCF_BGM_MULTI_SELECT_LABEL_RE = /(複数選択|複数選 ?択|복수\s*선택|multi[-\s]?select|multiselect)/i;
  const CCF_BGM_MS_BATCH_LABEL_RE = {
    delete: /^(削除|削除する|消去|刪除|Delete|Remove|삭제|지우기)$/i,
    selectAll: /(全て選択|全選択|すべて選択|Select\s*all|전체\s*선택|모두\s*선택)/i,
    unselectAll: /(全て解除|全解除|すべて解除|Deselect|선택\s*해제|모두\s*해제)/i
  };

  const ccfBgmMultiSelectedEntries = new Set();

  function getCcfBgmActiveDialogScopes(rootScope) {
    const scope = rootScope instanceof Element ? rootScope : document;
    const found = scope.querySelectorAll
      ? scope.querySelectorAll('[role="dialog"], .MuiDialog-root, .MuiDrawer-root')
      : [];
    return found.length ? [...found] : [document];
  }

  function findNativeBgmCheckboxTemplate(scope) {
    if (!scope || !scope.querySelectorAll) return null;
    const muiBoxes = scope.querySelectorAll(
      '.MuiListItem-root .MuiCheckbox-root,' +
      ' .MuiListItemButton-root .MuiCheckbox-root'
    );
    for (const cb of muiBoxes) {
      if (!(cb instanceof HTMLElement)) continue;
      // 우리가 mount한 row/wrap/popover/checkbox 본인은 제외
      if (cb.closest('.ccf-youtube-bgm-row-wrap, .ccf-youtube-bgm-popover')) continue;
      if (cb.classList.contains(CCF_BGM_MS_CHECKBOX_CLASS)) continue;
      if (cb.closest('.' + CCF_BGM_MS_CHECKBOX_CLASS + '-wrap')) continue;
      return cb;
    }
    const inputs = scope.querySelectorAll(
      '.MuiListItem-root input[type="checkbox"],' +
      ' .MuiListItemButton-root input[type="checkbox"]'
    );
    for (const inp of inputs) {
      if (!(inp instanceof HTMLElement)) continue;
      if (inp.closest('.ccf-youtube-bgm-row-wrap, .ccf-youtube-bgm-popover')) continue;
      if (inp.closest('.' + CCF_BGM_MS_CHECKBOX_CLASS + ', .' + CCF_BGM_MS_CHECKBOX_CLASS + '-wrap')) continue;
      return inp.closest('.MuiCheckbox-root, .MuiButtonBase-root') || inp;
    }
    return null;
  }

  function isCcfBgmMultiSelectModeForScope(scope) {
    return !!findNativeBgmCheckboxTemplate(scope);
  }

  // MUI CheckBox svg path (체크된/안 된)
  const CCF_BGM_MS_SVG_UNCHECKED_PATH = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z";
  const CCF_BGM_MS_SVG_CHECKED_PATH = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z";

  function updateCcfBgmCheckboxVisual(checkboxEl, selected) {
    if (!(checkboxEl instanceof HTMLElement)) return;
    checkboxEl.querySelectorAll('input[type="checkbox"]').forEach((inp) => {
      if (inp instanceof HTMLInputElement) inp.checked = !!selected;
    });
    // native와 동일: svg path 즉시 교체, fill 색만 transition (CSS 처리)
    const svg = checkboxEl.querySelector('svg');
    if (svg) {
      const path = svg.querySelector('path');
      if (path instanceof SVGPathElement) {
        path.setAttribute('d', selected ? CCF_BGM_MS_SVG_CHECKED_PATH : CCF_BGM_MS_SVG_UNCHECKED_PATH);
      }
      svg.setAttribute('data-testid', selected ? 'CheckBoxIcon' : 'CheckBoxOutlineBlankIcon');
    }
    if (selected) {
      checkboxEl.classList.add('Mui-checked');
    } else {
      checkboxEl.classList.remove('Mui-checked');
    }
  }

  // native ListItemButton의 TouchRipple 시뮬:
  // 체크박스 클릭 → row 전체에 클릭 위치 기준 원형 ripple 확산
  function spawnCcfBgmRowRipple(row, clickX, clickY) {
    if (!(row instanceof HTMLElement)) return;
    const itemButton = row.querySelector('.ccf-youtube-bgm-item');
    if (!(itemButton instanceof HTMLElement)) return;
    const rect = itemButton.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const checkbox = row.querySelector('.' + CCF_BGM_MS_CHECKBOX_CLASS + ', .' + CCF_BGM_MS_CHECKBOX_CLASS + '-wrap');
    let ox = clickX - rect.left;
    let oy = clickY - rect.top;
    if (checkbox instanceof HTMLElement) {
      const cbRect = checkbox.getBoundingClientRect();
      ox = (cbRect.left + cbRect.width / 2) - rect.left;
      oy = (cbRect.top + cbRect.height / 2) - rect.top;
    }

    const actionButton = row.querySelector('.ccf-youtube-bgm-edit, .ccf-youtube-bgm-remove, button');
    const actionRect = actionButton instanceof HTMLElement ? actionButton.getBoundingClientRect() : null;
    const rightLimit = actionRect
      ? Math.max(rect.left, Math.min(rect.right, actionRect.left + actionRect.width / 2)) - rect.left
      : rect.width * 0.82;
    const leftRadius = ox;
    const rightRadius = Math.max(36, rightLimit - ox);
    const radius = Math.max(leftRadius, rightRadius, rect.height * 2);
    const diameter = radius * 2;

    const ripple = document.createElement('span');
    ripple.className = 'ccf-youtube-bgm-row-ripple';
    ripple.style.left = (ox - diameter / 2) + 'px';
    ripple.style.top = (oy - diameter / 2) + 'px';
    ripple.style.width = diameter + 'px';
    ripple.style.height = diameter + 'px';
    itemButton.appendChild(ripple);
    window.setTimeout(() => {
      ripple.classList.add('is-leaving');
      window.setTimeout(() => ripple.remove(), 360);
    }, 340);
  }

  function ensureCcfBgmYoutubeRowCheckbox(row, template, selected) {
    if (!(row instanceof HTMLElement)) return;
    const WRAP_CLASS = CCF_BGM_MS_CHECKBOX_CLASS + '-wrap';
    let existingWrap = row.querySelector('.' + WRAP_CLASS);
    let existing = row.querySelector('.' + CCF_BGM_MS_CHECKBOX_CLASS);

    if (!template) {
      if (existingWrap) existingWrap.remove();
      else if (existing) existing.remove();
      row.removeAttribute(CCF_BGM_MS_SELECTED_ATTR);
      return;
    }

    if (!existing) {
      const clone = template.cloneNode(true);
      if (!(clone instanceof HTMLElement)) return;
      clone.classList.add(CCF_BGM_MS_CHECKBOX_CLASS);
      if (!clone.hasAttribute('tabindex')) {
        clone.setAttribute('tabindex', '0');
      }
      clone.removeAttribute('data-ccf-bgm-slot-key');

      // native checkbox의 parent(MuiListItemIcon-root 등)도 함께 복제해서 정렬 맞춤
      let mountUnit = clone;
      const nativeParent = template.parentElement;
      if (nativeParent instanceof HTMLElement) {
        const wrap = nativeParent.cloneNode(false);
        if (wrap instanceof HTMLElement) {
          wrap.innerHTML = "";
          wrap.classList.add(WRAP_CLASS);
          wrap.appendChild(clone);
          mountUnit = wrap;
        }
      }

      // native와 동일 위치: ListItemButton(.ccf-youtube-bgm-item) 안 첫 자식으로 prepend
      // (native checkbox도 MuiListItemButton-root 안의 MuiListItemIcon-root에 있음)
      const itemButton = row.querySelector('.ccf-youtube-bgm-item');
      const listItem = row.querySelector('.MuiListItem-root');
      const mountTarget = itemButton instanceof HTMLElement
        ? itemButton
        : (listItem instanceof HTMLElement ? listItem : row);
      mountTarget.insertBefore(mountUnit, mountTarget.firstChild);

      // pointerdown은 drag handler가 가로채지 못하게 capture에서 stop
      mountUnit.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
      }, true);
      mountUnit.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      }, true);
      // click은 document level capture로 위임 처리 (wrap 자체 등록 시 fire 실패 케이스 대비)

      existing = clone;
    }

    updateCcfBgmCheckboxVisual(existing, !!selected);
    if (selected) {
      row.setAttribute(CCF_BGM_MS_SELECTED_ATTR, '1');
    } else {
      row.removeAttribute(CCF_BGM_MS_SELECTED_ATTR);
    }
  }

  function toggleCcfBgmMultiSelect(entryKey) {
    if (!entryKey) return;
    if (ccfBgmMultiSelectedEntries.has(entryKey)) {
      ccfBgmMultiSelectedEntries.delete(entryKey);
    } else {
      ccfBgmMultiSelectedEntries.add(entryKey);
    }
  }

  function clearCcfBgmMultiSelect() {
    if (!ccfBgmMultiSelectedEntries.size) return;
    ccfBgmMultiSelectedEntries.clear();
  }

  let ccfBgmLastMultiSelectMode = false;
  function syncCcfBgmYoutubeMultiSelectUI() {
    try {
      // 전체 dialog scope를 합쳐서 mode 한 번만 판정 (한 scope에서 잠시 sync race로
      // template 못 찾으면 false → 곧바로 clear되는 사고 방지)
      const scopes = getCcfBgmActiveDialogScopes(document);
      let template = null;
      for (const scope of scopes) {
        const t = findNativeBgmCheckboxTemplate(scope);
        if (t) { template = t; break; }
      }
      const modeOn = !!template;
      // mode가 ON→OFF로 전환된 시점에만 selection clear
      if (ccfBgmLastMultiSelectMode && !modeOn && ccfBgmMultiSelectedEntries.size) {
        clearCcfBgmMultiSelect();
      }
      ccfBgmLastMultiSelectMode = modeOn;

      scopes.forEach((scope) => {
        const rows = (scope && scope.querySelectorAll)
          ? scope.querySelectorAll('.ccf-youtube-bgm-row-wrap')
          : [];
        rows.forEach((row) => {
          const entryKey = row.dataset.ccfYoutubeBgmEntry || "";
          const selected = ccfBgmMultiSelectedEntries.has(entryKey);
          ensureCcfBgmYoutubeRowCheckbox(row, template, selected);
        });
      });
    } catch (err) {
      debugLog("bgm-multi-select-sync-failed", serializeError(err));
    }
  }

  function deleteCcfBgmSelectedYoutubeEntries(reason = "multi-select") {
    if (!ccfBgmMultiSelectedEntries.size) return 0;
    const keys = [...ccfBgmMultiSelectedEntries];
    let removed = 0;
    keys.forEach((entryKey) => {
      if (!ccfBgmSlotMap.has(entryKey)) {
        ccfBgmMultiSelectedEntries.delete(entryKey);
        return;
      }
      if (ccfBgmActiveEntryKey === entryKey) {
        try { stopCcfYoutubeBgm("youtube-bgm-remove"); } catch (_) {}
      }
      try { rememberCcfBgmDeletedEntry(entryKey); } catch (_) {}
      ccfBgmSlotMap.delete(entryKey);
      ccfBgmMultiSelectedEntries.delete(entryKey);
      removed += 1;
    });
    if (removed) {
      try { persistCcfBgmSlotMap(); } catch (_) {}
      try { renderCcfYoutubeBgmLibraryItems(); } catch (_) {}
      try { markCcfYoutubeBgmSlotButtons(); } catch (_) {}
      try { updateCcfBgmProgressBar(); } catch (_) {}
      debugLog("bgm-multi-select-delete", { reason, removed });
    }
    return removed;
  }

  function areAllNativeBgmRowsChecked(scope) {
    if (!(scope instanceof Element)) return false;
    const checkboxes = scope.querySelectorAll(
      '.MuiListItem-root input[type="checkbox"],' +
      ' .MuiListItemButton-root input[type="checkbox"]'
    );
    let total = 0, checked = 0;
    for (const inp of checkboxes) {
      if (!(inp instanceof HTMLInputElement)) continue;
      if (inp.closest('.ccf-youtube-bgm-row-wrap, .ccf-youtube-bgm-popover')) continue;
      total += 1;
      if (inp.checked) checked += 1;
    }
    return total > 0 && total === checked;
  }

  function selectAllCcfBgmYoutubeEntriesInScope(scope) {
    if (!(scope instanceof Element)) return;
    const rows = scope.querySelectorAll('.ccf-youtube-bgm-row-wrap');
    rows.forEach((row) => {
      const entryKey = row.dataset.ccfYoutubeBgmEntry;
      if (entryKey) ccfBgmMultiSelectedEntries.add(entryKey);
    });
  }

  function handleCcfBgmMultiSelectBatchClick(event) {
    const button = event.target instanceof Element
      ? event.target.closest('button, [role="button"]')
      : null;
    if (!(button instanceof HTMLElement)) return;
    if (button.closest('.ccf-youtube-bgm-row-wrap, .ccf-youtube-bgm-popover, .ccf-youtube-bgm-player-dock')) return;
    if (button.classList.contains(CCF_BGM_MS_CHECKBOX_CLASS)) return;
    // 개별 row 안에 있는 액션 버튼은 일괄 액션이 아님 (개별 편집/재생/삭제)
    if (button.closest('.MuiListItem-root, .MuiListItemButton-root')) return;

    const scope = button.closest('[role="dialog"], .MuiDialog-root, .MuiDrawer-root');
    if (!scope) return;
    if (!isCcfBgmMultiSelectModeForScope(scope)) return;

    const rawLabel = (button.getAttribute('aria-label') || button.textContent || '').trim();
    if (!rawLabel) return;
    const label = rawLabel.replace(/\s+/g, ' ');

    if (CCF_BGM_MS_BATCH_LABEL_RE.delete.test(label)) {
      if (ccfBgmMultiSelectedEntries.size) {
        // 다음 tick에서 실행 — native delete가 끝난 뒤 우리 entry 정리
        const targetScope = scope;
        window.setTimeout(() => {
          deleteCcfBgmSelectedYoutubeEntries("batch-delete");
          syncCcfBgmYoutubeMultiSelectUI();
        }, 0);
      }
    } else if (CCF_BGM_MS_BATCH_LABEL_RE.selectAll.test(label) || CCF_BGM_MS_BATCH_LABEL_RE.unselectAll.test(label)) {
      const targetScope = scope;
      window.setTimeout(() => {
        if (areAllNativeBgmRowsChecked(targetScope)) {
          selectAllCcfBgmYoutubeEntriesInScope(targetScope);
        } else {
          clearCcfBgmMultiSelect();
        }
        syncCcfBgmYoutubeMultiSelectUI();
      }, 30);
    }
  }

  function handleCcfBgmMultiSelectHeaderChange(event) {
    const inp = event.target;
    if (!(inp instanceof HTMLInputElement) || inp.type !== 'checkbox') return;
    if (inp.closest('.MuiListItem-root, .MuiListItemButton-root, .ccf-youtube-bgm-row-wrap, .ccf-youtube-bgm-popover')) return;
    const scope = inp.closest('[role="dialog"], .MuiDialog-root, .MuiDrawer-root');
    if (!scope || !isCcfBgmMultiSelectModeForScope(scope)) return;
    if (inp.checked) {
      selectAllCcfBgmYoutubeEntriesInScope(scope);
    } else {
      clearCcfBgmMultiSelect();
    }
    syncCcfBgmYoutubeMultiSelectUI();
  }

  // document level pointerdown capture — 클릭 시작 시점에 즉시 ripple 발동 (native와 동일)
  function handleCcfBgmYoutubeCheckboxPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const wrap = target.closest('.' + CCF_BGM_MS_CHECKBOX_CLASS + '-wrap, .' + CCF_BGM_MS_CHECKBOX_CLASS);
    if (!(wrap instanceof Element)) return;
    const row = wrap.closest('.ccf-youtube-bgm-row-wrap');
    if (!(row instanceof HTMLElement)) return;
    let cx = event.clientX;
    let cy = event.clientY;
    if (!cx && !cy) {
      const wrect = wrap.getBoundingClientRect();
      cx = wrect.left + wrect.width / 2;
      cy = wrect.top + wrect.height / 2;
    }
    spawnCcfBgmRowRipple(row, cx, cy);
  }

  // document level capture click — 우리 wrap/체크박스 클릭 시 토글
  function handleCcfBgmYoutubeCheckboxClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const wrap = target.closest('.' + CCF_BGM_MS_CHECKBOX_CLASS + '-wrap, .' + CCF_BGM_MS_CHECKBOX_CLASS);
    if (!(wrap instanceof Element)) return;
    const row = wrap.closest('.ccf-youtube-bgm-row-wrap');
    if (!(row instanceof HTMLElement)) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }
    const entryKey = row.dataset.ccfYoutubeBgmEntry;
    if (!entryKey) {
      debugLog("bgm-ms-toggle-no-key", { row: row.outerHTML.slice(0, 200) });
      return;
    }
    toggleCcfBgmMultiSelect(entryKey);
    syncCcfBgmYoutubeMultiSelectUI();
    debugLog("bgm-ms-toggle", { entryKey, selected: ccfBgmMultiSelectedEntries.has(entryKey) });
  }

  // 복수선택 토글 버튼 클릭 — OFF는 선반영(예측 제거), ON은 polling으로 native 따라감
  function handleCcfBgmMultiSelectToggleClick(event) {
    const btn = event.target instanceof Element
      ? event.target.closest('button, [role="button"]')
      : null;
    if (!(btn instanceof HTMLElement)) return;
    if (btn.closest('.ccf-youtube-bgm-row-wrap, .ccf-youtube-bgm-popover')) return;
    const label = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
    if (!CCF_BGM_MULTI_SELECT_LABEL_RE.test(label)) return;

    const wasOn = !!findNativeBgmCheckboxTemplate(document);
    if (wasOn) {
      // ON → OFF 예측: 즉시 우리 row checkbox 제거 (native 응답 기다리지 않음, 0ms)
      document.querySelectorAll('.ccf-youtube-bgm-row-wrap').forEach((row) => {
        if (!(row instanceof HTMLElement)) return;
        const w = row.querySelector('.' + CCF_BGM_MS_CHECKBOX_CLASS + '-wrap');
        if (w) w.remove();
        else {
          const cb = row.querySelector('.' + CCF_BGM_MS_CHECKBOX_CLASS);
          if (cb) cb.remove();
        }
        row.removeAttribute(CCF_BGM_MS_SELECTED_ATTR);
      });
      clearCcfBgmMultiSelect();
      ccfBgmLastMultiSelectMode = false;
    }

    // polling으로 native 변화 따라감 — 예측 틀린 경우 정정
    let lastMode = wasOn;
    const start = performance.now();
    function poll() {
      const currentMode = !!findNativeBgmCheckboxTemplate(document);
      if (currentMode !== lastMode) {
        lastMode = currentMode;
        syncCcfBgmYoutubeMultiSelectUI();
      }
      if (performance.now() - start < 500) {
        requestAnimationFrame(poll);
      } else {
        syncCcfBgmYoutubeMultiSelectUI();
      }
    }
    requestAnimationFrame(poll);
  }

  document.addEventListener('pointerdown', handleCcfBgmYoutubeCheckboxPointerDown, true);
  document.addEventListener('click', handleCcfBgmMultiSelectToggleClick, true);
  document.addEventListener('click', handleCcfBgmYoutubeCheckboxClick, true);
  document.addEventListener('click', handleCcfBgmMultiSelectBatchClick, true);
  document.addEventListener('change', handleCcfBgmMultiSelectHeaderChange, true);
  registerTeardown(() => {
    document.removeEventListener('pointerdown', handleCcfBgmYoutubeCheckboxPointerDown, true);
    document.removeEventListener('click', handleCcfBgmMultiSelectToggleClick, true);
    document.removeEventListener('click', handleCcfBgmYoutubeCheckboxClick, true);
    document.removeEventListener('click', handleCcfBgmMultiSelectBatchClick, true);
    document.removeEventListener('change', handleCcfBgmMultiSelectHeaderChange, true);
    clearCcfBgmMultiSelect();
  });

  function handleCcfNativeBgmPointerDownDelegated(event) {
    if (event.button !== 0) return;
    if (ccfYoutubeBgmDragState) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const sortable = target.closest('[aria-roledescription="sortable"]');
    if (!(sortable instanceof HTMLElement)) return;

    if (sortable.closest('.ccf-youtube-bgm-row-wrap')) return;

    const innerControl = target.closest("button, input, textarea, select, a");
    if (innerControl instanceof HTMLElement && sortable.contains(innerControl)) return;

    const muiList = sortable.closest('.MuiList-root');
    if (!(muiList instanceof HTMLElement)) return;

    if (!muiList.querySelector('[data-testid="LibraryMusicIcon"]')
        && !muiList.querySelector('.ccf-youtube-bgm-row-wrap')) {
      return;
    }

    const container = findCcfYoutubeBgmInsertionContainer(muiList) || muiList;
    if (!(container instanceof HTMLElement)) return;

    let row = sortable;
    while (row && row.parentElement !== container) {
      row = row.parentElement;
    }
    if (!(row instanceof HTMLElement) || row.parentElement !== container) return;
    if (row.classList.contains('ccf-youtube-bgm-row-wrap')) return;

    // 즉시 가로채지 않고 "드래그 후보"로만 표시한다.
    // 사용자가 일정 거리 이상 움직였을 때만 우리 드래그 로직을 발동시키고,
    // 단순 클릭(복수선택 토글 등)은 CCFOLIA 네이티브 동작이 그대로 처리되도록 한다.
    queuePendingNativeBgmDrag(event, row);
  }

  // 드래그 후보 단계 — pointermove가 임계를 넘기 전까지는 CCFOLIA 동작을 막지 않는다.
  const NATIVE_BGM_DRAG_THRESHOLD_PX = 6;
  let pendingNativeBgmDrag = null;
  function queuePendingNativeBgmDrag(downEvent, row) {
    cancelPendingNativeBgmDrag();
    pendingNativeBgmDrag = {
      pointerId: downEvent.pointerId,
      startX: downEvent.clientX,
      startY: downEvent.clientY,
      row,
      latestEvent: downEvent
    };
    document.addEventListener("pointermove", handleNativeBgmDragMove, withTeardownSignal(true));
    document.addEventListener("pointerup", cancelPendingNativeBgmDrag, withTeardownSignal(true));
    document.addEventListener("pointercancel", cancelPendingNativeBgmDrag, withTeardownSignal(true));
  }

  function handleNativeBgmDragMove(event) {
    if (!pendingNativeBgmDrag) return;
    if (event.pointerId !== pendingNativeBgmDrag.pointerId) return;
    const dx = event.clientX - pendingNativeBgmDrag.startX;
    const dy = event.clientY - pendingNativeBgmDrag.startY;
    if (Math.hypot(dx, dy) < NATIVE_BGM_DRAG_THRESHOLD_PX) return;

    const row = pendingNativeBgmDrag.row;
    const seed = pendingNativeBgmDrag.latestEvent;
    cancelPendingNativeBgmDrag();
    if (!(row instanceof HTMLElement) || !row.isConnected) return;

    // 임계를 넘긴 시점부터 우리 드래그 로직 시작.
    event.preventDefault();
    beginCcfYoutubeBgmRowDrag(seed, row, "__ccf_native__");
  }

  function cancelPendingNativeBgmDrag() {
    if (!pendingNativeBgmDrag) return;
    pendingNativeBgmDrag = null;
    document.removeEventListener("pointermove", handleNativeBgmDragMove, true);
    document.removeEventListener("pointerup", cancelPendingNativeBgmDrag, true);
    document.removeEventListener("pointercancel", cancelPendingNativeBgmDrag, true);
  }

  document.addEventListener("pointerdown", handleCcfNativeBgmPointerDownDelegated, withTeardownSignal(true));

  // ============================================================================
  // Firestore 기반 BGM 공유 모듈
  // ----------------------------------------------------------------------------
  // 송신: ccfBgmShareSendOperation에서 라우팅. 추가/편집 → PATCH, 삭제 → DELETE.
  // 수신: 5초마다 컬렉션 전체 GET → 로컬 슬롯맵과 diff하여 원격 변경분 반영.
  // 토큰: firebaseLocalStorageDb IndexedDB에서 idToken을 빌려 Authorization 헤더에 사용.
  // 실패 처리: 모든 단계가 콘솔 debugLog로 결과 코드를 남기고 조용히 종료한다.
  // ============================================================================

  const ccfBgmFirestoreState = {
    tokenCache: { token: "", fetchedAt: 0 },
    pollTimer: 0,
    active: false,
    lastSnapshot: new Map(),
    writeFailureNoted: false
  };

  function getCcfBgmFirestoreRoomId() {
    const match = location.pathname.match(/^\/rooms\/([^/?#]+)/i);
    return match ? match[1] : "";
  }

  function ccfBgmFirestoreSanitizeDocId(entryKey) {
    // Firestore 문서 ID 제약: 슬래시 금지, 1500바이트 미만, "."/".."/"__*__" 금지.
    const safe = String(entryKey || "")
      .replace(/[\/]/g, "_")
      .replace(/^\.+/, "_")
      .replace(/^__|__$/g, "_")
      .slice(0, 1000);
    return safe || "entry";
  }

  async function readFirebaseIdToken() {
    const now = Date.now();
    const cache = ccfBgmFirestoreState.tokenCache;
    if (cache.token && now - cache.fetchedAt < BGM_FIRESTORE_TOKEN_TTL_MS) {
      return cache.token;
    }
    try {
      const token = await openFirebaseAuthDbAndExtractToken();
      ccfBgmFirestoreState.tokenCache = { token: token || "", fetchedAt: now };
      if (!token) {
        debugLog("bgm-firestore-token-empty");
      } else {
        debugLog("bgm-firestore-token-refreshed", { length: token.length });
      }
      return token;
    } catch (error) {
      debugLog("bgm-firestore-token-read-failed", serializeError(error));
      return "";
    }
  }

  function openFirebaseAuthDbAndExtractToken() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finalize = (value, error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(value);
      };
      let request;
      try {
        request = indexedDB.open(FIREBASE_AUTH_DB_NAME);
      } catch (error) {
        finalize(null, error);
        return;
      }
      request.onerror = () => finalize(null, request.error || new Error("firebase auth db open failed"));
      request.onblocked = () => finalize("");
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FIREBASE_AUTH_STORE_NAME)) {
          db.close();
          finalize("");
          return;
        }
        let tx;
        try {
          tx = db.transaction(FIREBASE_AUTH_STORE_NAME, "readonly");
        } catch (error) {
          db.close();
          finalize(null, error);
          return;
        }
        const store = tx.objectStore(FIREBASE_AUTH_STORE_NAME);
        const getAll = store.getAll();
        getAll.onerror = () => { db.close(); finalize(null, getAll.error); };
        getAll.onsuccess = () => {
          const rows = Array.isArray(getAll.result) ? getAll.result : [];
          db.close();
          // 행 구조: { fbase_key: "firebase:authUser:{API_KEY}:[DEFAULT]", value: { stsTokenManager: { accessToken, ... }, ... } }
          let bestToken = "";
          for (const row of rows) {
            const key = row && typeof row.fbase_key === "string" ? row.fbase_key : "";
            const candidate = row?.value?.stsTokenManager?.accessToken;
            if (typeof candidate === "string" && candidate.length > 20) {
              // authUser 항목을 우선
              if (key.startsWith("firebase:authUser:")) {
                bestToken = candidate;
                break;
              }
              if (!bestToken) bestToken = candidate;
            }
          }
          finalize(bestToken);
        };
      };
    });
  }

  function ccfBgmFirestoreEncodeFields(entry) {
    const fields = {};
    for (const [key, value] of Object.entries(entry || {})) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string") {
        fields[key] = { stringValue: value };
      } else if (typeof value === "boolean") {
        fields[key] = { booleanValue: value };
      } else if (typeof value === "number" && Number.isFinite(value)) {
        // Firestore는 정수와 부동소수를 구분. updatedAt 등은 큰 정수라 integerValue로.
        if (Number.isInteger(value)) {
          fields[key] = { integerValue: String(value) };
        } else {
          fields[key] = { doubleValue: value };
        }
      }
    }
    return fields;
  }

  function ccfBgmFirestoreDecodeFields(fields) {
    const out = {};
    for (const [key, value] of Object.entries(fields || {})) {
      if (!value || typeof value !== "object") continue;
      if (typeof value.stringValue === "string") {
        out[key] = value.stringValue;
      } else if (typeof value.booleanValue === "boolean") {
        out[key] = value.booleanValue;
      } else if (typeof value.integerValue === "string") {
        const n = Number(value.integerValue);
        if (Number.isFinite(n)) out[key] = n;
      } else if (typeof value.doubleValue === "number") {
        out[key] = value.doubleValue;
      }
    }
    return out;
  }

  async function ccfBgmFirestoreSendOperation(op, slotData) {
    const roomId = getCcfBgmFirestoreRoomId();
    if (!roomId) {
      debugLog("bgm-firestore-send-no-room", { op });
      return;
    }
    if (!slotData?.entryKey) {
      debugLog("bgm-firestore-send-no-entry-key", { op });
      return;
    }

    const docId = ccfBgmFirestoreSanitizeDocId(slotData.entryKey);
    const url = `${BGM_FIRESTORE_BASE_URL}/rooms/${encodeURIComponent(roomId)}/${BGM_FIRESTORE_SUBCOLLECTION}/${encodeURIComponent(docId)}`;
    const token = await readFirebaseIdToken();
    if (!token) {
      debugLog("bgm-firestore-send-no-token", { op, entryKey: slotData.entryKey });
      return;
    }

    if (op === "remove") {
      try {
        const response = await fetch(url, {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${token}` },
          credentials: "omit",
          mode: "cors"
        });
        debugLog("bgm-firestore-delete-result", {
          entryKey: slotData.entryKey,
          status: response.status,
          ok: response.ok
        });
        ccfBgmFirestoreState.lastSnapshot.delete(docId);
      } catch (error) {
        debugLog("bgm-firestore-delete-failed", { entryKey: slotData.entryKey, error: serializeError(error) });
      }
      return;
    }

    // add / edit → upsert via PATCH
    const fields = ccfBgmFirestoreEncodeFields({
      entryKey: String(slotData.entryKey),
      slotKey: String(slotData.slotKey || ""),
      url: String(slotData.url || ""),
      videoId: String(slotData.videoId || ""),
      title: String(slotData.title || ""),
      displayName: String(slotData.displayName || slotData.title || ""),
      tabSignature: String(slotData.tabSignature || ""),
      volume: Number.isFinite(Number(slotData.volume)) ? Math.round(Number(slotData.volume)) : 100,
      loop: slotData.loop !== false,
      order: Number.isFinite(Number(slotData.order)) ? Math.round(Number(slotData.order)) : Date.now(),
      sender: BGM_SHARE_SENDER_ID,
      updatedAt: Date.now()
    });

    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ fields }),
        credentials: "omit",
        mode: "cors"
      });
      debugLog("bgm-firestore-write-result", {
        op,
        entryKey: slotData.entryKey,
        status: response.status,
        ok: response.ok
      });
      if (response.ok) {
        ccfBgmFirestoreState.writeFailureNoted = false;
      } else {
        const text = await response.text().catch(() => "");
        debugLog("bgm-firestore-write-error-body", {
          status: response.status,
          body: text.slice(0, 400)
        });
        if (response.status === 401) {
          // 토큰 만료 가능성 → 캐시 무효화하여 다음 시도에서 새로 읽도록.
          ccfBgmFirestoreState.tokenCache = { token: "", fetchedAt: 0 };
        }
        if (response.status === 403 && !ccfBgmFirestoreState.writeFailureNoted) {
          ccfBgmFirestoreState.writeFailureNoted = true;
          console.warn(
            "[CCF Chat Notifier] Firestore 보안 규칙이 capybaraToolkitBgm 컬렉션 쓰기를 거부했습니다. " +
            "다른 사용자에게 BGM 공유가 전파되지 않습니다. " +
            "코코포리아 측 규칙 변경이 필요하거나, 채팅 기반 공유로 폴백해야 합니다."
          );
        }
      }
    } catch (error) {
      debugLog("bgm-firestore-write-failed", { entryKey: slotData.entryKey, error: serializeError(error) });
    }
  }

  async function ccfBgmFirestoreListSlots() {
    const roomId = getCcfBgmFirestoreRoomId();
    if (!roomId) return null;
    const url = `${BGM_FIRESTORE_BASE_URL}/rooms/${encodeURIComponent(roomId)}/${BGM_FIRESTORE_SUBCOLLECTION}?pageSize=100`;
    const token = await readFirebaseIdToken();
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        credentials: "omit",
        mode: "cors"
      });
      if (response.status === 404) {
        // 컬렉션에 문서가 하나도 없으면 404가 정상. 빈 목록으로 처리.
        return [];
      }
      if (!response.ok) {
        debugLog("bgm-firestore-list-error", { status: response.status });
        return null;
      }
      const data = await response.json();
      const docs = Array.isArray(data?.documents) ? data.documents : [];
      return docs.map((doc) => {
        const docId = typeof doc.name === "string" ? doc.name.split("/").pop() : "";
        const decoded = ccfBgmFirestoreDecodeFields(doc.fields);
        const entryKey = String(decoded.entryKey || docId || "");
        return { docId, entryKey, entry: decoded };
      }).filter((item) => item.entryKey);
    } catch (error) {
      debugLog("bgm-firestore-list-failed", serializeError(error));
      return null;
    }
  }

  async function ccfBgmFirestorePollOnce() {
    if (!BGM_FIRESTORE_SHARE_ENABLED || !chatNotifierActive) return;

    // 재생 신호 동기화: 단일 nowPlaying 문서를 GET해서 변경 감지하면 자동 재생/정지.
    if (BGM_FIRESTORE_PLAYBACK_SYNC_ENABLED) {
      await ccfBgmFirestorePollPlayback().catch((error) => {
        debugLog("bgm-firestore-playback-poll-failed", serializeError(error));
      });
    }

    // 슬롯 목록 동기화는 기본 OFF — 켜져 있을 때만 컬렉션 전체 GET 후 머지.
    if (!BGM_FIRESTORE_SLOT_SYNC_ENABLED) return;

    const docs = await ccfBgmFirestoreListSlots();
    if (!docs) return; // 네트워크/권한 오류 등 — 다음 틱에 재시도

    let changed = false;
    const remoteDocIds = new Set();

    // 재진입 가드: 원격 → 로컬 적용 중에 발생한 set이 다시 송신되지 않도록.
    ccfBgmShareSendingDepth += 1;
    try {
      for (const { docId, entryKey, entry } of docs) {
        remoteDocIds.add(docId);

        // 자기 자신이 쓴 문서는 에코 무시.
        if (entry.sender === BGM_SHARE_SENDER_ID) continue;
        if (!entry.url || !entry.videoId) continue;

        const remoteUpdatedAt = Number(entry.updatedAt) || 0;
        const existing = ccfBgmSlotMap.get(entryKey);
        const localUpdatedAt = Number(existing?.updatedAt) || 0;

        // 삭제 기록과 비교: 로컬에서 의도적으로 지운 항목을 다시 끌어오지 않도록.
        const deletedAt = Number(ccfBgmDeletedEntries?.[entryKey]) || 0;
        if (deletedAt && deletedAt >= remoteUpdatedAt) continue;

        if (existing && localUpdatedAt >= remoteUpdatedAt) continue;

        ccfBgmSlotMap.set(entryKey, {
          slotKey: String(entry.slotKey || entryKey),
          url: String(entry.url),
          videoId: String(entry.videoId),
          title: String(entry.title || "YouTube BGM"),
          displayName: String(entry.displayName || entry.title || "YouTube BGM"),
          tabSignature: normalizeCcfBgmTabSignature(entry.tabSignature),
          volume: Number.isFinite(Number(entry.volume)) ? clampCcfBgmVolume(entry.volume) : 100,
          loop: entry.loop !== false,
          updatedAt: remoteUpdatedAt,
          createdAt: existing?.createdAt || remoteUpdatedAt,
          order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : remoteUpdatedAt,
          pending: false
        });
        changed = true;
        debugLog("bgm-firestore-apply-remote", { entryKey, remoteUpdatedAt });
      }

      // 원격에서 사라진 슬롯 감지 → 로컬에서도 제거.
      // 단, 한 번이라도 본 적 있는 docId만 대상으로 (첫 폴링 후부터). 그렇지 않으면
      // 처음 진입한 사용자가 자기 로컬 슬롯을 다 날려버릴 위험.
      if (ccfBgmFirestoreState.lastSnapshot.size > 0) {
        for (const [prevDocId, prevEntryKey] of ccfBgmFirestoreState.lastSnapshot) {
          if (remoteDocIds.has(prevDocId)) continue;
          if (!ccfBgmSlotMap.has(prevEntryKey)) continue;
          // 자기가 만든 슬롯은 자기 의도로만 지우게 둠 (원격 부재로 지우지 않음).
          // 다른 사용자가 만든 슬롯만 원격 부재 시 정리.
          // 현재 sender 정보가 로컬에 저장돼 있지 않으므로, 보수적으로 건너뛴다.
          // 필요하면 향후 sender를 슬롯에 저장해 처리.
          continue;
        }
      }

      // 새 스냅샷 갱신
      ccfBgmFirestoreState.lastSnapshot = new Map(
        docs.map(({ docId, entryKey }) => [docId, entryKey])
      );

      if (changed) {
        persistCcfBgmSlotMap();
        markCcfYoutubeBgmSlotButtons();
        tryEnhanceCcfBgmPanel();
      }
    } finally {
      ccfBgmShareSendingDepth -= 1;
    }
  }

  // ============================================================================
  // 재생 신호 동기화 (PLAYBACK_SYNC)
  // ----------------------------------------------------------------------------
  // 단일 문서 rooms/{roomId}/capybaraToolkitBgm/nowPlaying 를 사용해
  // "지금 누가 어떤 곡을 재생/정지했는가"만 공유한다.
  // 송신: 로컬에서 playCcfYoutubeBgmSlot / stopCcfYoutubeBgm 가 실행될 때 PATCH.
  // 수신: 폴링이 sender ≠ self인 새 신호를 감지하면 동일 곡을 자동 재생/정지.
  // self-terminate: 곡의 자연 종료(루프 OFF로 끝까지 재생)는 각 클라이언트가 알아서
  //   처리하고 신호를 보내지 않는다. 의도적 정지만 stopped 신호를 보낸다.
  // 잔류 신호 방지: 30분보다 오래된 playing 신호는 fresh load 시 자동 적용하지 않음.
  // ============================================================================

  // 마지막으로 본 신호의 시그니처(sender:startedAt:state:entryKey). 변경 감지용.
  let ccfBgmFirestoreLastPlaybackSignature = "";
  // 원격 신호를 적용하는 동안 켜지는 플래그. 켜져 있으면 play/stop 훅이 송신을 건너뜀.
  // var: fastpath 흐름이 IIFE 상단에서 ccfBgmFirestoreEmitPlayback 호출 시
  // 이 선언 도달 전이라 let 사용 시 TDZ. 함수 스코프 hoist 로 회피.
  var ccfBgmFirestorePlaybackApplying = false;

  async function ccfBgmFirestoreWritePlayback(payload) {
    if (!BGM_FIRESTORE_PLAYBACK_SYNC_ENABLED) return;
    const roomId = getCcfBgmFirestoreRoomId();
    if (!roomId) return;
    const token = await readFirebaseIdToken();
    if (!token) {
      debugLog("bgm-firestore-playback-write-no-token", { state: payload?.state });
      return;
    }

    const url = `${BGM_FIRESTORE_BASE_URL}/rooms/${encodeURIComponent(roomId)}/${BGM_FIRESTORE_SUBCOLLECTION}/${BGM_FIRESTORE_PLAYBACK_DOC_ID}`;
    const fields = ccfBgmFirestoreEncodeFields({
      entryKey: String(payload?.entryKey || ""),
      slotKey: String(payload?.slotKey || ""),
      url: String(payload?.url || ""),
      videoId: String(payload?.videoId || ""),
      title: String(payload?.title || ""),
      displayName: String(payload?.displayName || payload?.title || ""),
      volume: Number.isFinite(Number(payload?.volume)) ? Math.round(Number(payload.volume)) : 100,
      loop: payload?.loop !== false,
      state: String(payload?.state || "stopped"),
      startedAt: Date.now(),
      sender: BGM_SHARE_SENDER_ID
    });

    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ fields }),
        credentials: "omit",
        mode: "cors"
      });
      debugLog("bgm-firestore-playback-write", {
        state: payload?.state,
        entryKey: payload?.entryKey,
        status: response.status,
        ok: response.ok
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        debugLog("bgm-firestore-playback-write-error-body", {
          status: response.status,
          body: text.slice(0, 400)
        });
        if (response.status === 401) {
          ccfBgmFirestoreState.tokenCache = { token: "", fetchedAt: 0 };
        }
      }
    } catch (error) {
      debugLog("bgm-firestore-playback-write-failed", serializeError(error));
    }
  }

  async function ccfBgmFirestoreReadPlayback() {
    const roomId = getCcfBgmFirestoreRoomId();
    if (!roomId) return null;
    const url = `${BGM_FIRESTORE_BASE_URL}/rooms/${encodeURIComponent(roomId)}/${BGM_FIRESTORE_SUBCOLLECTION}/${BGM_FIRESTORE_PLAYBACK_DOC_ID}`;
    const token = await readFirebaseIdToken();
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        credentials: "omit",
        mode: "cors"
      });
      if (response.status === 404) return null; // 아직 재생 신호 없음
      if (!response.ok) {
        debugLog("bgm-firestore-playback-read-error", { status: response.status });
        return null;
      }
      const doc = await response.json();
      return ccfBgmFirestoreDecodeFields(doc.fields);
    } catch (error) {
      debugLog("bgm-firestore-playback-read-failed", serializeError(error));
      return null;
    }
  }

  async function ccfBgmFirestorePollPlayback() {
    if (!BGM_FIRESTORE_PLAYBACK_SYNC_ENABLED || !chatNotifierActive) return;
    const data = await ccfBgmFirestoreReadPlayback();
    if (!data) return;

    // 자기가 쓴 신호는 무시 (에코).
    if (data.sender === BGM_SHARE_SENDER_ID) {
      // 시그니처는 갱신해두자(다음에 진짜 신호 왔을 때 비교 기준이 됨).
      ccfBgmFirestoreLastPlaybackSignature = `${data.sender}:${data.startedAt}:${data.state}:${data.entryKey}`;
      return;
    }

    const signature = `${data.sender || ""}:${data.startedAt || 0}:${data.state || ""}:${data.entryKey || ""}`;
    if (signature === ccfBgmFirestoreLastPlaybackSignature) return;
    ccfBgmFirestoreLastPlaybackSignature = signature;

    debugLog("bgm-firestore-playback-received", {
      state: data.state,
      entryKey: data.entryKey,
      sender: data.sender,
      ageMs: Date.now() - (Number(data.startedAt) || 0)
    });

    if (data.state === "playing") {
      if (!data.videoId || !data.slotKey) {
        debugLog("bgm-firestore-playback-skip-missing-fields", { videoId: !!data.videoId, slotKey: !!data.slotKey });
        return;
      }
      // 30분보다 오래된 잔류 신호 무시(누가 옛날에 재생만 하고 정지 안 한 상태일 수 있음).
      const ageMs = Date.now() - (Number(data.startedAt) || 0);
      if (ageMs > BGM_FIRESTORE_PLAYBACK_FRESH_MS) {
        debugLog("bgm-firestore-playback-stale-ignored", { ageMs });
        return;
      }
      // 이미 같은 곡 재생 중이면 스킵.
      if (ccfBgmActiveSlotKey === data.slotKey && ccfBgmActiveEntryKey === data.entryKey) return;

      ccfBgmFirestorePlaybackApplying = true;
      try {
        // 다른 곡 재생 중이면 일단 정지 (정지 신호는 송신 안 함 — applying 가드).
        if (ccfBgmActiveSlotKey) {
          stopCcfYoutubeBgm("remote-switch");
        }
        playCcfYoutubeBgmSlot(
          data.slotKey,
          {
            videoId: data.videoId,
            url: data.url || "",
            title: data.title || "",
            displayName: data.displayName || data.title || "",
            loop: data.loop !== false,
            volume: Number.isFinite(Number(data.volume)) ? Number(data.volume) : 100
          },
          null,
          0,
          data.entryKey || ""
        );
      } finally {
        // 동기 호출이 끝났으니 즉시 해제. 비동기 player 콜백은 신호 송신을 안 한다.
        ccfBgmFirestorePlaybackApplying = false;
      }
      return;
    }

    if (data.state === "stopped") {
      if (!ccfBgmActiveSlotKey && !ccfBgmActiveEntryKey) return;
      ccfBgmFirestorePlaybackApplying = true;
      try {
        stopCcfYoutubeBgm("remote-stop");
      } finally {
        ccfBgmFirestorePlaybackApplying = false;
      }
    }
  }

  // 로컬 play/stop 호출에서 부를 헬퍼. 적용 중이면 송신을 건너뛴다(에코 방지).
  function ccfBgmFirestoreEmitPlayback(payload) {
    if (!BGM_FIRESTORE_PLAYBACK_SYNC_ENABLED) return;
    if (ccfBgmFirestorePlaybackApplying) return;
    if (!chatNotifierActive) return;
    ccfBgmFirestoreWritePlayback(payload).catch((error) => {
      debugLog("bgm-firestore-playback-emit-failed", serializeError(error));
    });
  }

  function ccfBgmFirestoreStartPolling() {
    if (!BGM_FIRESTORE_SHARE_ENABLED) return;
    if (ccfBgmFirestoreState.pollTimer || ccfBgmFirestoreState.active) return;
    ccfBgmFirestoreState.active = true;
    debugLog("bgm-firestore-poll-start", { intervalMs: BGM_FIRESTORE_POLL_INTERVAL_MS });
    const tick = async () => {
      if (!ccfBgmFirestoreState.active || !chatNotifierActive) return;
      try {
        await ccfBgmFirestorePollOnce();
      } catch (error) {
        debugLog("bgm-firestore-poll-error", serializeError(error));
      }
      if (!ccfBgmFirestoreState.active || !chatNotifierActive) return;
      ccfBgmFirestoreState.pollTimer = window.setTimeout(tick, BGM_FIRESTORE_POLL_INTERVAL_MS);
    };
    // 첫 폴링은 약간 지연시켜 토큰이 안정적으로 IndexedDB에 적재된 뒤 실행.
    ccfBgmFirestoreState.pollTimer = window.setTimeout(tick, 1500);
  }

  function ccfBgmFirestoreStopPolling() {
    ccfBgmFirestoreState.active = false;
    if (ccfBgmFirestoreState.pollTimer) {
      window.clearTimeout(ccfBgmFirestoreState.pollTimer);
      ccfBgmFirestoreState.pollTimer = 0;
    }
    debugLog("bgm-firestore-poll-stop");
  }

  // 룸 페이지에서만 폴링 (홈 등에서는 무의미).
  if (BGM_FIRESTORE_SHARE_ENABLED && ROOM_PATH_RE.test(location.pathname)) {
    ccfBgmFirestoreStartPolling();
    registerTeardown(ccfBgmFirestoreStopPolling);
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

function migrateLegacyRoomDataToGlobal() {
    let migrated = false;
    const keysToRemove = [];

    try {
      // 로컬 스토리지 전체를 순회하며 과거 룸별 키를 찾음
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        // CCF_BGM_ACTIVE_KEY 는 BGM_STORAGE_PREFIX 로 시작하지만 legacy 룸 데이터가
        // 아니라 last-played 상태 저장용. migration wipe 대상서 제외.
        if (key && key.startsWith(BGM_STORAGE_PREFIX) && key !== BGM_STORAGE_KEY && key !== CCF_BGM_ACTIVE_KEY) {
          try {
            const raw = window.localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed && typeof parsed === "object") {
              // 파싱된 과거 데이터를 현재 글로벌 맵(ccfBgmSlotMap)에 병합
              Object.entries(parsed).forEach(([entryKey, entry], index) => {
                if (entryKey === BGM_STORAGE_META_KEY) return;
                
                const normalizedSlot = getCcfBgmEntrySlotKey(entryKey, entry);
                const storageKey = String(entryKey || "").includes(":youtube:") ? String(entryKey) : normalizedSlot;
                const url = String(entry?.url || "");
                const videoId = sanitizeCcfYoutubeVideoId(entry?.videoId || extractCcfYoutubeVideoId(url));
                const updatedAt = Number(entry?.updatedAt) || 0;
                
                if (storageKey && normalizedSlot && url && videoId) {
                  const existing = ccfBgmSlotMap.get(storageKey);
                  // 이미 등록된 곡이 없거나, 과거 데이터가 더 최신인 경우에만 추가
                  if (!existing || existing.updatedAt < updatedAt) {
                    ccfBgmSlotMap.set(storageKey, {
                      slotKey: normalizedSlot,
                      url,
                      videoId,
                      title: normalizeSpace(entry?.title || "") || "YouTube BGM",
                      displayName: normalizeSpace(entry?.displayName || entry?.title || "") || "YouTube BGM",
                      tabSignature: normalizeCcfBgmTabSignature(entry?.tabSignature),
                      volume: Number.isFinite(Number(entry?.volume)) ? clampCcfBgmVolume(entry.volume) : 100,
                      volumeEdited: entry?.volumeEdited === true,
                      loop: typeof entry?.loop === "boolean" ? entry.loop : true,
                      updatedAt,
                      createdAt: Number(entry?.createdAt) || updatedAt || Date.now() + index,
                      order: Number.isFinite(Number(entry?.order)) && Number(entry.order) > 0 ? Number(entry.order) : Date.now(),
                      pending: entry?.pending !== false
                    });
                    migrated = true;
                  }
                }
              });
              // 병합이 끝난 과거 키는 삭제 목록에 추가
              keysToRemove.push(key);
            }
          } catch (e) {
            debugLog("legacy-migration-parse-failed", serializeError(e));
          }
        }
      }
      
      // 마이그레이션이 끝난 과거 룸 데이터 삭제 (스토리지 정리)
      keysToRemove.forEach(k => window.localStorage.removeItem(k));
    } catch (e) {
      debugLog("legacy-migration-failed", serializeError(e));
    }

    return migrated;
  }

function stopCcfNativeBgmForSlot(slotKey) {
    if (!slotKey) return;
    const button = findCcfBgmButtonBySlot(slotKey);
    if (!button) return;

    // 해당 슬롯의 행(Row) 컨테이너 찾기
    const container = button.closest('.MuiListItem-root');
    if (!container) return;

    // 해당 슬롯의 전용 Stop 아이콘 찾기
    const stopIcon = container.querySelector('[data-testid="StopIcon"]');
    if (!stopIcon) return;

    const stopBtn = stopIcon.closest('button');
    if (!stopBtn) return;

    // 정지 버튼 클릭 (의도적 정지이므로 StopHandler 무시 타이머 갱신)
    ccfSuppressStopHandlerUntil = Date.now() + 250;
    try {
      stopBtn.click();
    } catch (error) {
      debugLog("bgm-native-slot-stop-failed", serializeError(error));
    }
  }

})();
