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
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: "웹 공유 설정" });
  } catch (error) { await flagError(tab.id, error); }
});

// Roll20 -> CCFOLIA: forward a chat line from the Roll20 tab to the CCFOLIA room tab it is linked to (storage r20Link, set in the share modal).
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "r20-message" || !String(sender.tab?.url || "").startsWith("https://app.roll20.net/")) return;
  (async () => {
    const { r20Link } = await chrome.storage.local.get(["r20Link"]);
    if (!r20Link?.roomId) return;
    const [tab] = await chrome.tabs.query({ url: `https://ccfolia.com/rooms/${r20Link.roomId}*` });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "r20-message", message: { ...message.message, channel: r20Link.channel } });
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
