// 카피바라 4세 초대 페이지(릴레이 서버)에서 "확장이 설치되어 있다"는 표시만 남긴다. 다른 정보는 읽거나 보내지 않는다.
(() => {
  "use strict";
  document.documentElement.dataset.capybaraExtension = chrome.runtime.getManifest().version;
})();
