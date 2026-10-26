// x.com / twitter.com: a "seen" check under every tweet. X switches off the repost / like marks of old tweets, so what was looked at is kept here.
// ISOLATED content script; chrome.storage.local: xSeen = { tweetId: checkedAtMs }, xSeenHide = false turns the hiding off (default on).
// Checked by hand only (the ✓ button right of the like button). A checked tweet is hidden from the timelines (its cellInnerDiv), with a 5 second undo; the main tweet of a
// tweet page stays. The left menu gets "확인한 트윗" under "북마크": it opens x-seen.html (the list, with the hiding switch).
(() => {
  "use strict";
  if (window.top !== window || window.__CAPYBARA_X_SEEN__) return;
  window.__CAPYBARA_X_SEEN__ = true;

  const KEY = "xSeen";
  const HIDE_KEY = "xSeenHide";
  const MAX = 50000;
  const BTN = "data-capybara-xseen-btn";
  const CELL = "data-capybara-xseen-cell";
  const NAV = "data-capybara-xseen-nav";
  let seen = {};
  let hideOn = true;
  let saveTimer = 0;
  let frame = 0;
  let toastTimer = 0;

  const alive = () => !!chrome.runtime?.id;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!alive()) return;
      const ids = Object.keys(seen);
      if (ids.length > MAX) ids.sort((a, b) => seen[a] - seen[b]).slice(0, ids.length - MAX).forEach(id => { delete seen[id]; });
      chrome.storage.local.set({ [KEY]: seen }).catch(() => {});
    }, 300);
  };

  const style = document.createElement("style");
  style.textContent = `
    article[data-capybara-seen="1"] { box-shadow: inset 3px 0 0 #FFD400; }
    [data-capybara-hidden="1"] { display: none !important; }
    [${CELL}] { display: flex; align-items: center; flex: 1 1 0; min-width: 0; }
    [${BTN}] { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; align-self: center; flex: 0 0 auto; width: 34px; height: 34px; margin: 0; padding: 0; border-radius: 50%; color: #71767b; font: 700 17px/1 sans-serif; text-align: center; }
    [${BTN}]:hover { background: rgba(255, 212, 0, .15); color: #FFD400; }
    [${BTN}][data-on="1"] { color: #FFD400; }
    #capybara-xseen-toast { position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); z-index: 2147483647; display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-radius: 8px; background: #1d9bf0; color: #fff; font: 400 14px/1.3 sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.4); }
    #capybara-xseen-toast button { all: unset; cursor: pointer; font-weight: 700; text-decoration: underline; }`;
  document.documentElement.append(style);

  const tweetId = article => {
    const link = article.querySelector("a[href*='/status/'] time")?.closest("a") || article.querySelector("a[href*='/status/']");
    return link?.getAttribute("href").match(/\/status\/(\d+)/)?.[1] || "";
  };
  const actionRow = article => [...article.querySelectorAll('[role="group"]')].reverse().find(g => g.querySelector('[data-testid="like"], [data-testid="unlike"]')) || null;
  const isMainOfTweetPage = id => location.pathname.match(/\/status\/(\d+)/)?.[1] === id;

  const mark = (id, on) => {
    if (!id || !!seen[id] === on) return false;
    if (on) seen[id] = Date.now(); else delete seen[id];
    save();
    return true;
  };

  const showToast = id => {
    document.getElementById("capybara-xseen-toast")?.remove();
    clearTimeout(toastTimer);
    const toast = document.createElement("div");
    toast.id = "capybara-xseen-toast";
    const text = document.createElement("span");
    text.textContent = "숨겼습니다";
    const undo = document.createElement("button");
    undo.type = "button";
    undo.textContent = "되돌리기";
    undo.addEventListener("click", () => { mark(id, false); toast.remove(); paintAll(); });
    toast.append(text, undo);
    document.body.append(toast);
    toastTimer = setTimeout(() => toast.remove(), 5000);
  };

  const paint = article => {
    const id = tweetId(article);
    if (!id) return;
    // the virtual list reuses the elements: the id is read again every time
    const row = actionRow(article);
    let button = article.querySelector(`[${BTN}]`);
    if (row && !button) {
      // right next to the like button: a cell of the same shape after the one that holds it
      const likeCell = [...row.children].find(child => child.querySelector('[data-testid="like"], [data-testid="unlike"]'));
      const cell = document.createElement("div");
      cell.className = likeCell?.className || "";
      cell.setAttribute(CELL, "1");
      button = document.createElement("button");
      button.type = "button";
      button.setAttribute(BTN, "1");
      button.textContent = "✓";
      cell.append(button);
      if (likeCell) likeCell.after(cell); else row.append(cell);
    }
    const on = !!seen[id];
    if (button) {
      button.dataset.on = on ? "1" : "0";
      button.title = on ? "확인함 (누르면 해제)" : "확인함으로 표시";
    }
    if (on) article.setAttribute("data-capybara-seen", "1"); else article.removeAttribute("data-capybara-seen");
    const timelineCell = article.closest('[data-testid="cellInnerDiv"]');
    if (timelineCell) {
      if (on && hideOn && !isMainOfTweetPage(id)) timelineCell.setAttribute("data-capybara-hidden", "1");
      else timelineCell.removeAttribute("data-capybara-hidden");
    }
  };

  // the left menu: "확인한 트윗" right under "북마크", the same shape (the bookmarks link cloned, icon and label replaced)
  const ensureNav = () => {
    if (document.querySelector(`[${NAV}]`)) return;
    const bookmarks = document.querySelector('nav a[href="/i/bookmarks"]');
    if (!bookmarks) return;
    const item = bookmarks.cloneNode(true);
    item.setAttribute(NAV, "1");
    item.setAttribute("href", "#");
    item.removeAttribute("aria-current");
    item.removeAttribute("data-testid");
    item.setAttribute("aria-label", "확인한 트윗");
    for (const label of item.querySelectorAll("span")) {
      if (!label.children.length && label.textContent.trim()) { label.textContent = "확인한 트윗"; break; }
    }
    const icon = item.querySelector("svg");
    const checkIcon = document.createElement("span");
    checkIcon.textContent = "✓";
    checkIcon.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;font:700 22px/1 sans-serif;color:inherit";
    if (icon) icon.replaceWith(checkIcon); else item.prepend(checkIcon);
    bookmarks.after(item);
  };

  const paintAll = () => { frame = 0; ensureNav(); document.querySelectorAll('article[data-testid="tweet"]').forEach(paint); };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paintAll); };

  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const nav = target?.closest(`[${NAV}]`);
    if (nav) {
      event.stopPropagation();
      event.preventDefault();
      if (alive()) chrome.runtime.sendMessage({ type: "x-seen-open" }).catch(() => {});
      return;
    }
    const toggle = target?.closest(`[${BTN}]`);
    if (toggle) {
      event.stopPropagation();
      event.preventDefault();
      const current = toggle.closest("article");
      const currentId = current && tweetId(current);
      if (!currentId) return;
      const nowOn = !seen[currentId];
      mark(currentId, nowOn);
      paint(current);
      if (nowOn && hideOn && !isMainOfTweetPage(currentId)) showToast(currentId);
    }
  }, true);

  const observer = new MutationObserver(() => { if (!alive()) { observer.disconnect(); return; } schedule(); });

  chrome.storage.local.get([KEY, HIDE_KEY]).then(result => {
    seen = result[KEY] || {};
    hideOn = result[HIDE_KEY] !== false;
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[KEY]) seen = changes[KEY].newValue || {};
    if (changes[HIDE_KEY]) hideOn = changes[HIDE_KEY].newValue !== false;
    if (changes[KEY] || changes[HIDE_KEY]) schedule();
  });
})();
