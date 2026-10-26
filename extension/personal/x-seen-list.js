// The list of the checked tweets (x.com "seen" check), shared by the extension page x-seen.html and the "확인 완료" tab of x.com's bookmarks page (x-seen.js).
// window.__capybaraXSeenList.mount(container, { onBlocked }) fills the container: the "hide from the timeline" switch, the tweets newest check first as X's own embed, 20 at a time,
// each with "다시 보이기" (uncheck). onBlocked() is called once when the page's security policy refuses the embed frames.
(() => {
  "use strict";
  if (window.__capybaraXSeenList) return;
  const KEY = "xSeen", HIDE_KEY = "xSeenHide", SNAP = "xSeenSnap:", PAGE = 20;
  const CSS = `
    .cxs { color: #e7e9ea; font: 15px/1.4 sans-serif; padding: 12px 16px; }
    .cxs .cxs-bar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid #2f3336; border-radius: 8px; margin-bottom: 16px; }
    .cxs .cxs-bar label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .cxs .cxs-item { border: 1px solid #2f3336; border-radius: 12px; margin-bottom: 16px; padding: 8px; }
    .cxs .cxs-item iframe { display: block; width: 100%; min-height: 200px; border: 0; color-scheme: dark; }
    .cxs .cxs-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 4px 0; font-size: 13px; color: #71767b; }
    .cxs .cxs-meta a { color: #1d9bf0; }
    .cxs button { cursor: pointer; border: 1px solid #FFD400; background: transparent; color: #FFD400; border-radius: 16px; padding: 4px 12px; font: inherit; }
    .cxs .cxs-snap { position: relative; border-bottom: 1px solid #2f3336; cursor: pointer; }
    .cxs .cxs-snap > .cxs-undo { position: absolute; top: 8px; right: 48px; z-index: 2; }
    .cxs .cxs-more { display: block; margin: 8px auto 32px; padding: 8px 20px; }
    .cxs [hidden] { display: none !important; }
    .cxs .cxs-empty, .cxs .cxs-note { color: #71767b; padding: 24px 0; text-align: center; }`;

  const mount = (container, options = {}) => {
    if (!document.querySelector("style[data-cxs]")) {
      const style = document.createElement("style");
      style.setAttribute("data-cxs", "1");
      style.textContent = CSS;
      (document.head || document.documentElement).append(style);
    }
    container.classList.add("cxs");
    container.textContent = "";
    let seen = {}, shown = 0, blocked = false;

    const bar = document.createElement("div");
    bar.className = "cxs-bar";
    const label = document.createElement("label");
    const hide = document.createElement("input");
    hide.type = "checkbox";
    label.append(hide, " 타임라인에서 숨기기");
    const count = document.createElement("span");
    bar.append(label, count);
    const note = document.createElement("div");
    note.className = "cxs-note";
    note.hidden = true;
    const list = document.createElement("div");
    const more = document.createElement("button");
    more.type = "button";
    more.className = "cxs-more";
    more.textContent = "더 보기";
    more.hidden = true;
    container.append(bar, note, list, more);

    const order = () => Object.keys(seen).sort((a, b) => seen[b] - seen[a]);
    const showEmpty = () => { list.innerHTML = ""; const empty = document.createElement("div"); empty.className = "cxs-empty"; empty.textContent = "확인한 트윗이 없습니다."; list.append(empty); };
    const forget = (id, box) => {
      delete seen[id];
      box.remove();
      shown -= 1;
      count.textContent = order().length + "개";
      chrome.storage.local.set({ [KEY]: seen });
      chrome.storage.local.remove(SNAP + id);
      if (!order().length) showEmpty();
    };
    // the checked tweet as it looked (the markup saved at the check), like a timeline cell: a click opens the tweet, the button shows it again
    const addSnapshot = (id, html) => {
      const box = document.createElement("div");
      box.className = "cxs-snap";
      box.dataset.id = id;
      const template = document.createElement("template");
      template.innerHTML = html;
      box.append(template.content);
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "cxs-undo";
      undo.textContent = "다시 보이기";
      undo.addEventListener("click", event => { event.stopPropagation(); forget(id, box); });
      box.addEventListener("click", event => { event.preventDefault(); if (event.target.closest(".cxs-undo")) return; window.open(`https://x.com/i/status/${id}`, "_blank", "noopener"); }, true);
      box.append(undo);
      list.append(box);
    };
    const addItem = (id, html) => {
      if (html) { addSnapshot(id, html); return; }
      const box = document.createElement("div");
      box.className = "cxs-item";
      box.dataset.id = id;
      const frame = document.createElement("iframe");
      frame.src = `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=dark&dnt=true`;
      frame.loading = "lazy";
      frame.title = "트윗 " + id;
      const meta = document.createElement("div");
      meta.className = "cxs-meta";
      const link = document.createElement("a");
      link.href = `https://x.com/i/status/${id}`;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "원본 열기 (보이지 않으면 삭제·비공개 트윗)";
      const undo = document.createElement("button");
      undo.type = "button";
      undo.textContent = "다시 보이기";
      undo.addEventListener("click", () => forget(id, box));
      meta.append(link, undo);
      box.append(frame, meta);
      list.append(box);
    };
    const more20 = async () => {
      const ids = order();
      const chunk = ids.slice(shown, shown + PAGE);
      shown = Math.min(ids.length, shown + PAGE);
      more.hidden = shown >= ids.length;
      // the snapshots only where the page can draw them (x.com); the extension page uses X's embed for all
      const snaps = options.snapshots ? await chrome.storage.local.get(chunk.map(id => SNAP + id)) : {};
      for (const id of chunk) addItem(id, typeof snaps[SNAP + id] === "string" ? snaps[SNAP + id] : "");
    };
    more.addEventListener("click", more20);
    hide.addEventListener("change", () => chrome.storage.local.set({ [HIDE_KEY]: hide.checked }));

    // the embed tells its height by message
    const onMessage = event => {
      if (event.origin !== "https://platform.twitter.com") return;
      let data = event.data;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch (_) { return; } }
      const params = data?.["twttr.embed"]?.params?.[0];
      if (data?.["twttr.embed"]?.method !== "twttr.private.resize" || !params?.height) return;
      for (const frame of container.querySelectorAll("iframe")) if (frame.contentWindow === event.source) frame.style.height = params.height + "px";
    };
    // the page's security policy may refuse the embed frames (x.com): tell the caller once, it can use the extension page instead
    const onViolation = event => {
      if (blocked || !/frame|child/.test(event.violatedDirective || "") || !/platform\.twitter\.com/.test(event.blockedURI || "")) return;
      blocked = true;
      note.textContent = "이 페이지에서는 트윗 미리보기를 불러올 수 없어 새 탭에서 목록을 엽니다.";
      note.hidden = false;
      options.onBlocked?.();
    };
    window.addEventListener("message", onMessage);
    document.addEventListener("securitypolicyviolation", onViolation);

    chrome.storage.local.get([KEY, HIDE_KEY]).then(result => {
      seen = result[KEY] || {};
      hide.checked = result[HIDE_KEY] !== false;
      count.textContent = order().length + "개";
      if (!order().length) showEmpty(); else more20();
    });
    return { destroy() { window.removeEventListener("message", onMessage); document.removeEventListener("securitypolicyviolation", onViolation); container.textContent = ""; } };
  };
  window.__capybaraXSeenList = { mount };
})();
