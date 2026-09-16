"use strict";

chrome.action.onClicked.addListener(async (tab) => {
  if (!Number.isInteger(tab.id)) return;
  try {
    if (!tab.url || new URL(tab.url).origin !== "https://ccfolia.com") {
      throw new Error("코코포리아 탭에서 사용해주세요.");
    }
    const target = { tabId: tab.id };
    const results = await chrome.scripting.executeScript({ target, world: "MAIN", files: ["bootstrap.js"] });
    if (!results[0]?.result) throw new Error("로딩 실패. 룸을 새로고침하거나 아이콘을 눌러 다시 시도해주세요.");
    await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: () => window.__CAPYBARA_TOOLKIT__?.openPanel()
    });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: "카피바라 3세 열기" });
  } catch (error) {
    console.error("[Capybara personal extension]", error);
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#c62828" });
    await chrome.action.setTitle({ tabId: tab.id, title: error.message || "실행 실패" });
  }
});
