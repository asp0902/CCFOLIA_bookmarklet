// x.com / twitter.com: a "seen" check under every tweet. X switches off the repost / like marks of old tweets, so what was looked at is kept here.
// ISOLATED content script; chrome.storage.local key xSeen = { tweetId: checkedAtMs }. Checking: the ✓ button, or a like / repost click (a tweet that already shows unlike / unretweet counts too).
(() => {
  "use strict";
  if (window.top !== window || window.__CAPYBARA_X_SEEN__) return;
  window.__CAPYBARA_X_SEEN__ = true;

  const KEY = "xSeen";
  const MAX = 50000;
  const BTN = "data-capybara-xseen-btn";
  let seen = {};
  let saveTimer = 0;
  let frame = 0;

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
    [${BTN}] { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; align-self: center; flex: 0 0 auto; width: 34px; height: 34px; margin: 0; padding: 0; border-radius: 50%; color: #71767b; font: 700 17px/1 sans-serif; text-align: center; }
    [${BTN}]:hover { background: rgba(255, 212, 0, .15); color: #FFD400; }
    [${BTN}][data-on="1"] { color: #FFD400; }`;
  document.documentElement.append(style);

  const tweetId = article => {
    const link = article.querySelector("a[href*='/status/'] time")?.closest("a") || article.querySelector("a[href*='/status/']");
    return link?.getAttribute("href").match(/\/status\/(\d+)/)?.[1] || "";
  };
  const actionRow = article => [...article.querySelectorAll('[role="group"]')].reverse().find(g => g.querySelector('[data-testid="like"], [data-testid="unlike"]')) || null;

  const mark = (id, on) => {
    if (!id || !!seen[id] === on) return false;
    if (on) seen[id] = Date.now(); else delete seen[id];
    save();
    return true;
  };

  const paint = article => {
    const id = tweetId(article);
    if (!id) return;
    // the virtual list reuses the elements: the id is read again every time
    if (article.querySelector('[data-testid="unlike"], [data-testid="unretweet"]')) mark(id, true);
    const row = actionRow(article);
    let button = article.querySelector(`[${BTN}]`);
    if (row && !button) {
      button = document.createElement("button");
      button.type = "button";
      button.setAttribute(BTN, "1");
      button.textContent = "✓";
      row.append(button);
    }
    const on = !!seen[id];
    if (button) {
      button.dataset.on = on ? "1" : "0";
      button.title = on ? "확인함 (누르면 해제)" : "확인함으로 표시";
    }
    if (on) article.setAttribute("data-capybara-seen", "1"); else article.removeAttribute("data-capybara-seen");
  };

  const paintAll = () => { frame = 0; document.querySelectorAll('article[data-testid="tweet"]').forEach(paint); };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paintAll); };

  document.addEventListener("click", event => {
    const toggle = event.target instanceof Element && event.target.closest(`[${BTN}]`);
    if (toggle) {
      event.stopPropagation();
      event.preventDefault();
      const current = toggle.closest("article");
      const currentId = current && tweetId(current);
      if (currentId) { mark(currentId, !seen[currentId]); paint(current); }
      return;
    }
    const hit = event.target instanceof Element && event.target.closest('[data-testid="like"], [data-testid="retweet"]');
    const article = hit && hit.closest('article[data-testid="tweet"]');
    if (article && mark(tweetId(article), true)) paint(article);
  }, true);

  const observer = new MutationObserver(() => { if (!alive()) { observer.disconnect(); return; } schedule(); });

  chrome.storage.local.get(KEY).then(result => {
    seen = result[KEY] || {};
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[KEY]) return;
    seen = changes[KEY].newValue || {};
    schedule();
  });
})();
