// x.com / twitter.com: a "seen" check under every tweet. X switches off the repost / like marks of old tweets, so what was looked at is kept here.
// ISOLATED content script; chrome.storage.local: xSeen = { tweetId: checkedAtMs }, xSeenHide = false turns the hiding off (default on).
// Checked by hand only (the ✓ button right of the like button). A checked tweet is hidden from the timelines (its cellInnerDiv), with a 5 second undo; the main tweet of a
// tweet page stays. The bookmarks page gets a third tab "확인 완료" with the list of the checked tweets (x-seen-list.js).
(() => {
  "use strict";
  if (window.top !== window || window.__CAPYBARA_X_SEEN__) return;
  window.__CAPYBARA_X_SEEN__ = true;

  const KEY = "xSeen";
  const HIDE_KEY = "xSeenHide";
  const MAX = 50000;
  const BTN = "data-capybara-xseen-btn";
  const CELL = "data-capybara-xseen-cell";
  const SNAP = "xSeenSnap:";
  const snaps = new Set(); // ids that have a saved look
  const snapPending = new Set();
  const SNAP_MAX = 300000;
  const CHECK_PATH = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
  const TAB = "data-capybara-xseen-tab";
  const TAB_LIST = "data-capybara-xseen-tablist";
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
      if (ids.length > MAX) ids.sort((a, b) => seen[a] - seen[b]).slice(0, ids.length - MAX).forEach(id => { delete seen[id]; chrome.storage.local.remove(SNAP + id).catch(() => {}); });
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
    [${TAB}] { position: relative; }
    [${TAB}][data-active="1"] span { color: #e7e9ea !important; font-weight: 700 !important; }
    [${TAB}][data-active="1"]::after { content: ""; position: absolute; left: 50%; bottom: 0; transform: translateX(-50%); width: 56px; height: 4px; border-radius: 9999px; background: #1d9bf0; }
    [data-capybara-xseen-dim] span { color: #71767b !important; font-weight: 400 !important; }
    [data-capybara-xseen-mute] { visibility: hidden !important; }
    #capybara-xseen-tip { position: fixed; z-index: 2147483647; pointer-events: none; padding: 2px 4px; border-radius: 4px; background: rgba(91, 112, 131, .9); color: #fff; font: 400 11px/1.3 -apple-system, "Segoe UI", Roboto, sans-serif; white-space: nowrap; transform: translateX(-50%); }
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
    if (on) seen[id] = Date.now(); else { delete seen[id]; if (alive()) chrome.storage.local.remove(SNAP + id).catch(() => {}); }
    save();
    return true;
  };

  // What the tweet looked like when it was checked: the article's own markup (its classes make it look the same on x.com), cleaned: no script / frame / video / event attributes, no
  // button of ours; kept in xSeenSnap:{id}. The "확인 완료" list draws it as a timeline cell.
  const snapshot = article => {
    try {
      const copy = article.cloneNode(true);
      copy.querySelectorAll("script, iframe, video, source, [data-capybara-xseen-cell]").forEach(el => el.remove());
      for (const el of [copy, ...copy.querySelectorAll("*")]) {
        for (const attr of [...el.attributes]) {
          if (/^on/i.test(attr.name) || /^data-capybara/.test(attr.name) || (/^(href|src)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
        }
        if (el.matches("a[href]")) el.setAttribute("href", new URL(el.getAttribute("href"), location.origin).href);
      }
      window.__capybaraXSeenList?.clean(copy);
      const html = copy.outerHTML;
      return html.length <= SNAP_MAX ? html : "";
    } catch (_) { return ""; }
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

  const inOwnList = el => !!el.closest("[data-capybara-xseen-list]");
  const paint = article => {
    if (inOwnList(article)) return; // the saved looks of the tab are not tweets of the page
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
      button.setAttribute("aria-label", "확인 완료");
    }
    // an old check without a saved look: the tweet is on a page now, keep how it looks
    if (on && !snaps.has(id) && !snapPending.has(id)) {
      const html = snapshot(article);
      if (html && alive()) { snapPending.add(id); chrome.storage.local.set({ [SNAP + id]: html }).catch(() => {}); }
    }
    if (on) article.setAttribute("data-capybara-seen", "1"); else article.removeAttribute("data-capybara-seen");
    const timelineCell = article.closest('[data-testid="cellInnerDiv"]');
    if (timelineCell) {
      if (on && hideOn && !isMainOfTweetPage(id)) timelineCell.setAttribute("data-capybara-hidden", "1");
      else timelineCell.removeAttribute("data-capybara-hidden");
    }
  };

  // The bookmarks page ("역사", /i/bookmarks) has the tabs 북마크 | 마음에 들어요: a third one, "확인 완료", is added (a copy of the last tab). It puts the list of the checked tweets
  // in the place of the page body (the siblings after the header are hidden); any other tab, or leaving the page, puts the page back.
  let tabActive = false, mounted = null, listBox = null;
  const hiddenBodies = [];
  const onBookmarksPage = () => /^\/i\/(?:bookmarks|history)(?:\/|$)/.test(location.pathname); // the page is /i/history (called 역사), /i/bookmarks too
  const findTablist = () => (onBookmarksPage() ? [...document.querySelectorAll('[role="tablist"]')].find(list => list.querySelectorAll('[role="tab"]').length >= 2 && !list.hasAttribute(TAB_LIST)) : null);

  // localStorage.xSeenDebug = 1: the time of each step of a tab switch is kept (document.documentElement.dataset.capybaraXseenDebug, JSON) and written to the console
  const debugOn = () => { try { return localStorage.getItem("xSeenDebug") === "1"; } catch (_) { return false; } };
  const debugLog = entry => {
    try {
      const log = JSON.parse(document.documentElement.dataset.capybaraXseenDebug || "[]");
      log.push(entry);
      document.documentElement.dataset.capybaraXseenDebug = JSON.stringify(log.slice(-40));
      console.info("[x-seen]", entry);
    } catch (_) {}
  };
  let paintRuns = 0, paintMs = 0;

  const deactivate = (reason = "") => {
    if (!tabActive && !listBox) return;
    const debug = debugOn(), t0 = performance.now(), steps = {};
    const step = name => { if (debug) steps[name] = Math.round((performance.now() - t0) * 10) / 10; };
    const items = listBox ? listBox.querySelectorAll("*").length : 0;
    tabActive = false;
    try { mounted?.destroy(); } catch (_) {}
    mounted = null;
    step("destroy");
    listBox?.remove();
    listBox = null;
    step("removeList");
    for (const el of hiddenBodies.splice(0)) el.removeAttribute("data-capybara-hidden");
    step("unhideBody");
    for (const el of document.querySelectorAll("[data-capybara-xseen-mute]")) el.removeAttribute("data-capybara-xseen-mute");
    for (const el of document.querySelectorAll("[data-capybara-xseen-dim]")) el.removeAttribute("data-capybara-xseen-dim");
    const mine = document.querySelector(`[${TAB}]`);
    if (mine) mine.dataset.active = "0";
    step("tabs");
    if (debug) {
      const runsBefore = paintRuns, msBefore = paintMs;
      requestAnimationFrame(() => {
        const frame1 = Math.round((performance.now() - t0) * 10) / 10;
        requestAnimationFrame(() => debugLog({ event: "deactivate", reason, listElements: items, syncSteps: steps, toFrame1: frame1, toFrame2: Math.round((performance.now() - t0) * 10) / 10, paintAllRuns: paintRuns - runsBefore, paintAllMs: Math.round((paintMs - msBefore) * 10) / 10, at: new Date().toISOString() }));
      });
    }
  };

  const activate = tablist => {
    deactivate();
    tabActive = true;
    const mine = tablist.querySelector(`[${TAB}]`);
    if (mine) mine.dataset.active = "1";
    // the other tabs lose their selected look, their blue underline is muted
    for (const tab of tablist.querySelectorAll('[role="tab"]')) {
      if (tab === mine) continue;
      tab.setAttribute("data-capybara-xseen-dim", "1");
      for (const el of tab.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.backgroundColor === "rgb(29, 155, 240)" && parseFloat(cs.height) <= 6) el.setAttribute("data-capybara-xseen-mute", "1");
      }
    }
    // the page body: the first sibling after the header (going up from the tab list) that comes with content; ours takes its place
    let node = tablist, anchor = null;
    for (let depth = 0; node && depth < 8 && !node.matches('[data-testid="primaryColumn"], main'); depth += 1, node = node.parentElement) {
      if (node.nextElementSibling) { anchor = node; if (node.nextElementSibling.querySelector('[data-testid="cellInnerDiv"]')) break; }
    }
    if (!anchor) return;
    for (let sibling = anchor.nextElementSibling; sibling; sibling = sibling.nextElementSibling) { sibling.setAttribute("data-capybara-hidden", "1"); hiddenBodies.push(sibling); }
    listBox = document.createElement("div");
    listBox.setAttribute("data-capybara-xseen-list", "1");
    anchor.after(listBox);
    mounted = window.__capybaraXSeenList?.mount(listBox, { snapshots: true, onBlocked: () => { if (alive()) chrome.runtime.sendMessage({ type: "x-seen-open" }).catch(() => {}); } });
  };

  const ensureTab = () => {
    if (!onBookmarksPage()) { deactivate(); return; }
    const tablist = findTablist() || document.querySelector(`[${TAB_LIST}]`);
    if (!tablist) { deactivate(); return; }
    if (tablist.querySelector(`[${TAB}]`)) return;
    const tabs = [...tablist.children];
    const last = tabs[tabs.length - 1];
    if (!last) return;
    const copy = last.cloneNode(true);
    const link = copy.matches('[role="tab"]') ? copy : copy.querySelector('[role="tab"]');
    if (!link) return;
    link.setAttribute(TAB, "1");
    link.dataset.active = tabActive ? "1" : "0";
    link.setAttribute("aria-selected", "false");
    link.removeAttribute("data-testid");
    link.setAttribute("href", "#");
    for (const label of link.querySelectorAll("span")) {
      if (!label.children.length && label.textContent.trim()) { label.textContent = "확인 완료"; break; }
    }
    // the icon is the other tab's own svg (same size, spacing and colour): only its path becomes a check mark
    const icon = link.querySelector("svg");
    if (icon) {
      const paths = icon.querySelectorAll("path");
      paths.forEach((path, index) => { if (index) path.remove(); });
      paths[0]?.setAttribute("d", CHECK_PATH);
    }
    tablist.setAttribute(TAB_LIST, "1");
    last.after(copy);
  };

  const paintAll = () => {
    frame = 0;
    const t0 = performance.now();
    ensureTab();
    document.querySelectorAll('article[data-testid="tweet"]').forEach(paint);
    paintRuns += 1; paintMs += performance.now() - t0;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paintAll); };

  // the hover tip of the ✓ button, shaped like the one of the like button (small grey box under the button, after a short delay)
  let tipTimer = 0;
  const hideTip = () => { clearTimeout(tipTimer); document.getElementById("capybara-xseen-tip")?.remove(); };
  document.addEventListener("mouseover", event => {
    const button = event.target instanceof Element ? event.target.closest(`[${BTN}]`) : null;
    if (!button) return;
    hideTip();
    tipTimer = setTimeout(() => {
      if (!button.isConnected) return;
      const rect = button.getBoundingClientRect();
      const tip = document.createElement("div");
      tip.id = "capybara-xseen-tip";
      tip.textContent = "확인 완료";
      tip.style.left = `${rect.left + rect.width / 2}px`;
      tip.style.top = `${rect.bottom + 4}px`;
      document.body.append(tip);
    }, 300);
  }, true);
  document.addEventListener("mouseout", event => { if (event.target instanceof Element && event.target.closest(`[${BTN}]`)) hideTip(); }, true);
  document.addEventListener("wheel", hideTip, { capture: true, passive: true });

  document.addEventListener("click", event => {
    hideTip();
    const target = event.target instanceof Element ? event.target : null;
    const mineTab = target?.closest(`[${TAB}]`);
    if (mineTab) {
      event.stopPropagation();
      event.preventDefault();
      if (!tabActive) activate(mineTab.closest('[role="tablist"]'));
      return;
    }
    // another tab of the page (or the back button of the page): the page body comes back, X goes on with its own click
    if (tabActive && target?.closest('[role="tab"]')) deactivate(target.closest('[role="tab"]').textContent.trim().slice(0, 20));
    const toggle = target?.closest(`[${BTN}]`);
    if (toggle) {
      event.stopPropagation();
      event.preventDefault();
      const current = toggle.closest("article");
      const currentId = current && tweetId(current);
      if (!currentId) return;
      const nowOn = !seen[currentId];
      const html = nowOn ? snapshot(current) : "";
      mark(currentId, nowOn);
      if (html && alive()) chrome.storage.local.set({ [SNAP + currentId]: html }).catch(() => {});
      paint(current);
      if (nowOn && hideOn && !isMainOfTweetPage(currentId)) showToast(currentId);
    }
  }, true);

  // what changes inside our own list is not the page's business (the saved looks hold tweets too)
  const ours = node => (node instanceof Element ? node : node?.parentElement)?.closest?.("[data-capybara-xseen-list], #capybara-xseen-toast, #capybara-xseen-tip");
  const observer = new MutationObserver(mutations => {
    if (!alive()) { observer.disconnect(); return; }
    if (mutations.every(mutation => ours(mutation.target))) return;
    schedule();
  });

  chrome.storage.local.get(null).then(result => {
    for (const key of Object.keys(result)) if (key.startsWith(SNAP)) snaps.add(key.slice(SNAP.length));
    seen = result[KEY] || {};
    hideOn = result[HIDE_KEY] !== false;
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key of Object.keys(changes)) if (key.startsWith(SNAP)) { const id = key.slice(SNAP.length); if (changes[key].newValue) snaps.add(id); else { snaps.delete(id); snapPending.delete(id); } }
    if (changes[KEY]) seen = changes[KEY].newValue || {};
    if (changes[HIDE_KEY]) hideOn = changes[HIDE_KEY].newValue !== false;
    if (changes[KEY] || changes[HIDE_KEY]) schedule();
  });
})();
