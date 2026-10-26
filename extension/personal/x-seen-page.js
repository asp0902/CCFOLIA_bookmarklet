// The list of checked tweets (x.com "seen" check): newest check first, 20 at a time, each shown as X's own embed. "다시 보이기" = uncheck.
"use strict";
const KEY = "xSeen", HIDE_KEY = "xSeenHide", PAGE = 20;
const list = document.getElementById("list"), more = document.getElementById("more"), count = document.getElementById("count"), hide = document.getElementById("hide");
let seen = {}, shown = 0;

const order = () => Object.keys(seen).sort((a, b) => seen[b] - seen[a]);
const addItem = id => {
  const box = document.createElement("div");
  box.className = "item";
  box.dataset.id = id;
  const frame = document.createElement("iframe");
  frame.src = `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=dark&dnt=true`;
  frame.loading = "lazy";
  frame.title = "트윗 " + id;
  const meta = document.createElement("div");
  meta.className = "meta";
  const link = document.createElement("a");
  link.href = `https://x.com/i/status/${id}`;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "원본 열기 (보이지 않으면 삭제·비공개 트윗)";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.textContent = "다시 보이기";
  undo.addEventListener("click", () => {
    delete seen[id];
    box.remove();
    shown -= 1;
    count.textContent = order().length + "개";
    chrome.storage.local.set({ [KEY]: seen });
    if (!order().length) list.innerHTML = '<div class="empty">확인한 트윗이 없습니다.</div>';
  });
  meta.append(link, undo);
  box.append(frame, meta);
  list.append(box);
};
const more20 = () => {
  const ids = order();
  for (const id of ids.slice(shown, shown + PAGE)) addItem(id);
  shown = Math.min(ids.length, shown + PAGE);
  more.hidden = shown >= ids.length;
};
// the embed tells its height by message
window.addEventListener("message", event => {
  if (event.origin !== "https://platform.twitter.com") return;
  let data = event.data;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch (_) { return; } }
  const params = data?.["twttr.embed"]?.params?.[0];
  if (data?.["twttr.embed"]?.method !== "twttr.private.resize" || !params?.height) return;
  for (const frame of document.querySelectorAll("iframe")) if (frame.contentWindow === event.source) frame.style.height = params.height + "px";
});
more.addEventListener("click", more20);
hide.addEventListener("change", () => chrome.storage.local.set({ [HIDE_KEY]: hide.checked }));
chrome.storage.local.get([KEY, HIDE_KEY]).then(result => {
  seen = result[KEY] || {};
  hide.checked = result[HIDE_KEY] !== false;
  count.textContent = order().length + "개";
  if (!order().length) list.innerHTML = '<div class="empty">확인한 트윗이 없습니다.</div>';
  else more20();
});
