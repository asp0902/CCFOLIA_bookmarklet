"use strict";

const isRoomTab = tab => { try { return new URL(tab.url).origin === "https://ccfolia.com"; } catch (_) { return false; } };
const flagError = async (tabId, error) => {
  console.error("[Capybara personal extension]", error);
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#c62828" });
  await chrome.action.setTitle({ tabId, title: error.message || "실행 실패" });
};

// 툴바 아이콘: 웹 공유 설정 모달을 연다(다시 누르면 닫힘). 툴킷 패널은 모달의 "툴킷 열기"로 연다.
chrome.action.onClicked.addListener(async (tab) => {
  if (!Number.isInteger(tab.id)) return;
  try {
    if (!isRoomTab(tab)) throw new Error("코코포리아 탭에서 사용해주세요.");
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["share-modal.js"] });
    // opening the settings clears an error mark, but not the number of waiting join requests
    if (await chrome.action.getBadgeText({ tabId: tab.id }) === "!") {
      await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
      await chrome.action.setTitle({ tabId: tab.id, title: "웹 공유 설정" });
    }
  } catch (error) { await flagError(tab.id, error); }
});

// Waiting join requests (sent by relay-bridge from the room tab): a blue number on that tab's icon; 0 clears it; an error mark ("!") has priority.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "relay-pending" || !Number.isInteger(sender.tab?.id) || !isRoomTab(sender.tab)) return;
  const tabId = sender.tab.id;
  const count = Math.max(0, Math.min(99, Math.trunc(Number(message.count)) || 0));
  (async () => {
    if (await chrome.action.getBadgeText({ tabId }) === "!") return;
    if (count > 0) {
      await chrome.action.setBadgeText({ tabId, text: String(count) });
      await chrome.action.setBadgeBackgroundColor({ tabId, color: "#1976d2" });
      await chrome.action.setTitle({ tabId, title: `참가 승인 요청 ${count}건` });
    } else {
      await chrome.action.setBadgeText({ tabId, text: "" });
      await chrome.action.setTitle({ tabId, title: "웹 공유 설정 (코코포리아에서 사용)" });
    }
  })().catch(() => {});
});

// Roll20 tab -> campaign number, learned from the addresses the tab visits: .../campaigns/details/<number>/... (before "Launch Game"), join, or /editor/setcampaign/<number>.
// The setcampaign pattern is a precaution: how Launch Game opens the editor was not observed. A new tab opened from a tab with a number inherits it.
const R20_CAMPAIGN_URL = /^https:\/\/app\.roll20\.net\/(?:campaigns\/(?:details|join)|editor\/setcampaign)\/(\d+)/;
const tabCampaigns = async () => (await chrome.storage.session.get(["r20TabCampaign"])).r20TabCampaign || {};
const saveTabCampaigns = value => chrome.storage.session.set({ r20TabCampaign: value });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const number = R20_CAMPAIGN_URL.exec(changeInfo.url || "")?.[1];
  if (number) tabCampaigns().then(known => saveTabCampaigns({ ...known, [tabId]: number })).catch(() => {});
});
chrome.tabs.onCreated.addListener(tab => {
  if (tab.openerTabId == null) return;
  tabCampaigns().then(known => { const number = known[tab.openerTabId]; if (number) return saveTabCampaigns({ ...known, [tab.id]: number }); }).catch(() => {});
});
chrome.tabs.onRemoved.addListener(tabId => {
  tabCampaigns().then(known => { if (tabId in known) { delete known[tabId]; return saveTabCampaigns(known); } }).catch(() => {});
});

// Roll20 -> CCFOLIA: forward a chat line from the Roll20 tab to the CCFOLIA room tab it is linked to (storage r20Links, keyed by Roll20 campaign id, set in the share modal).
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "r20-message" || !String(sender.tab?.url || "").startsWith("https://app.roll20.net/")) return;
  (async () => {
    const { r20Links } = await chrome.storage.local.get(["r20Links"]);
    // The game screen itself has no campaign number; the tab's earlier campaign page address does (remembered below). No number -> dropped, never guessed.
    const campaignId = String(message.message?.campaignId || (await tabCampaigns())[sender.tab.id] || "");
    const link = campaignId ? r20Links?.[campaignId] : null;
    if (!link?.roomId) return;
    const [tab] = await chrome.tabs.query({ url: `https://ccfolia.com/rooms/${link.roomId}*` });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "r20-message", message: { ...message.message, channel: link.channel } });
  })().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "capybara-open-toolkit" || !Number.isInteger(sender.tab?.id) || !isRoomTab(sender.tab)) return;
  (async () => {
    try {
      const target = { tabId: sender.tab.id };
      const results = await chrome.scripting.executeScript({ target, world: "MAIN", files: ["bootstrap.js"] });
      if (!results[0]?.result) throw new Error("로딩 실패. 룸을 새로고침한 뒤 다시 시도해주세요.");
      await chrome.scripting.executeScript({ target, world: "MAIN", func: () => window.__CAPYBARA_TOOLKIT__?.openPanel() });
    } catch (error) { await flagError(sender.tab.id, error); }
  })();
});

// x.com "seen" check (x-seen.js): the left menu item opens the list page of the extension in a new tab.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "x-seen-open" || !/^https:\/\/(x|twitter)\.com\//.test(sender.tab?.url || "")) return;
  chrome.tabs.create({ url: chrome.runtime.getURL("x-seen.html") }).catch(() => {});
});

// 새 메시지 → 핸드폰 푸시(ntfy). 룸 탭(ntfy-page/ntfy-bridge)이 보내 달라고 하면, 저장된 설정(서버·topic)으로 ntfy 에 JSON 으로 발행한다.
// 서버·topic 은 저장소에서 직접 읽는다(페이지가 정할 수 없다). 보내는 것은 제목·짧은 본문·클릭 주소뿐이고 계정 정보는 없다.
const NTFY_DEFAULT_SERVER = "https://ntfy.sh";
const NTFY_TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ntfySent = [];
const buildNtfyRequest = (config, payload) => {
  if (!config || typeof config !== "object") throw new Error("알림 설정이 없습니다.");
  const topic = String(config.topic || "");
  if (!NTFY_TOPIC_RE.test(topic)) throw new Error("topic 이름은 영문·숫자·-·_ 만 쓸 수 있습니다.");
  let server;
  try { server = new URL(String(config.server || NTFY_DEFAULT_SERVER)); } catch (_) { throw new Error("서버 주소가 올바르지 않습니다."); }
  if (!(server.protocol === "https:" || (server.protocol === "http:" && server.hostname === "127.0.0.1"))) throw new Error("서버 주소는 https 여야 합니다.");
  const clickOk = (value) => { try { return new URL(value).origin === "https://ccfolia.com" ? new URL(value).href : ""; } catch (_) { return ""; } };
  const body = { topic, title: String(payload?.title || "").slice(0, 100) || "카피바라", message: String(payload?.message || "").slice(0, 200) || "새 메시지", tags: ["speech_balloon"] };
  const click = clickOk(payload?.click);
  if (click) body.click = click;
  return { url: server.origin + "/", origin: server.origin, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } };
};
const sendNtfy = async (payload, { test = false } = {}) => {
  const { ntfy } = await chrome.storage.local.get(["ntfy"]);
  if (!test && !ntfy?.enabled) return { ok: false, error: "꺼져 있음" };
  const request = buildNtfyRequest(ntfy, payload);
  // 기본 서버는 manifest 의 host_permissions 로 허용돼 있고, 다른 서버는 설정에서 사용자가 허용한 것만 쓴다.
  if (request.origin !== NTFY_DEFAULT_SERVER && !(await chrome.permissions.contains({ origins: [request.origin + "/*"] }))) throw new Error("이 서버로 보내려면 설정에서 서버 접근을 허용해야 합니다.");
  const now = Date.now();
  while (ntfySent.length && now - ntfySent[0] > 60_000) ntfySent.shift();
  if (ntfySent.length >= 12) return { ok: false, error: "분당 전송 상한" };
  ntfySent.push(now);
  const response = await fetch(request.url, request.init);
  if (!response.ok) throw new Error(`ntfy 서버가 거절했습니다 (${response.status})`);
  return { ok: true };
};
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message?.type !== "ntfy-send" && message?.type !== "ntfy-test") || !isRoomTab(sender.tab || {})) return;
  sendNtfy(message.payload, { test: message.type === "ntfy-test" })
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true; // 응답은 비동기
});
