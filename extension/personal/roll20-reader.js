// Roll20 editor tab: reads new chat messages from the page and hands them to the background worker, which forwards them to the
// linked CCFOLIA room tab (storage r20Link). One direction only (Roll20 -> CCFOLIA). Whispers, GM-only and system lines are never sent.
(() => {
  "use strict";
  // The campaign page remembers its number in this tab's sessionStorage; the game screen of the same tab reads it back. It survives page and extension
  // reloads, disappears with the tab and is never shared with other tabs.
  const STORE_KEY = "capybaraR20Campaign";
  const onCampaignPage = /^\/campaigns\/(?:details|join)\/(\d+)/.exec(location.pathname);
  if (onCampaignPage) { try { sessionStorage.setItem(STORE_KEY, onCampaignPage[1]); } catch (_) {} return; }
  const storedCampaign = () => { try { return sessionStorage.getItem(STORE_KEY) || ""; } catch (_) { return ""; } };
  const clean = (value, max) => String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
  const SKIP = ".whisper, .private, .system";
  const seen = new Set();
  let lastName = "";
  const startedAt = Date.now(); // the chat history fills in shortly after load; anything seen in the first seconds is history and never sent
  // The editor URL is the same for every campaign; the campaign id is in an inline script of the page (campaign_id = 123).
  let campaignId = "";
  const findCampaignId = () => campaignId ||= [...document.scripts].map(s => s.textContent.match(/campaign_id\s*=\s*(\d+)/)?.[1]).find(Boolean) || storedCampaign();
  // The speaker's picture (https only, 500 chars). It is read before the avatar node is removed from the text below.
  let lastAvatar = "";
  const avatarOf = el => {
    const src = el.querySelector(".avatar img")?.getAttribute("src");
    if (!src) return "";
    try { const url = new URL(src, location.href); return url.protocol === "https:" && url.href.length <= 500 ? url.href : ""; } catch (_) { return ""; }
  };
  // A message that carries styled links or pictures (a CSS macro): its markup is rebuilt as the macro text it was typed as, so the CCFOLIA side can convert it with the same function the chat input uses
  // ([label](#" style="…") for a styled link, [x](https://…) for a picture). Plain text, roll results and anything with a style that could not be written back (a ")" or a quote in it) stay plain.
  const httpsUrl = value => { try { const url = new URL(value, location.href); return url.protocol === "https:" && url.href.length <= 500 && !/[\s()<>"]/.test(url.href) ? url.href : ""; } catch (_) { return ""; } };
  const macroOf = (body, kind) => {
    let styled = false;
    const walk = node => {
      if (node.nodeType === 3) return node.nodeValue;
      if (node.nodeType !== 1) return "";
      if (node.tagName === "BR") return "\n";
      if (node.tagName === "IMG") { const src = httpsUrl(node.getAttribute("src")); if (src) styled = true; return src ? `[x](${src})` : ""; }
      if (node.tagName === "A") {
        const inner = [...node.childNodes].map(walk).join("").replace(/[\r\n]+/g, " ");
        const style = (node.getAttribute("style") || "").trim();
        if (node.querySelector("img")) return inner;
        if (style && !/[)"\r\n]/.test(style)) { styled = true; return `[${inner.replace(/[\[\]]/g, "")}](#" style="${style}")`; }
        return inner;
      }
      return [...node.childNodes].map(walk).join("");
    };
    const text = walk(body).trim();
    return styled && text.length <= 8000 ? `${kind === "desc" ? "/desc " : ""}${text}` : "";
  };
  const read = el => {
    const by = el.querySelector(".by");
    const name = by ? clean(by.textContent, 80).replace(/:$/, "").trim() : "";
    // Roll20 leaves the name (and picture) out of consecutive lines by the same speaker; a new name takes its own picture, or none
    if (name) { lastName = name; lastAvatar = avatarOf(el); }
    const kind = el.classList.contains("rollresult") ? "rollresult" : el.classList.contains("emote") ? "emote" : el.classList.contains("desc") ? "desc" : "general";
    let text, macro = "";
    if (kind === "rollresult") {
      const formula = clean(el.querySelector(".formula")?.textContent, 200).replace(/^rolling\s+/i, "");
      text = `${formula} → ${clean(el.querySelector(".rolled")?.textContent, 40)}`;
    } else {
      const body = el.cloneNode(true);
      body.querySelectorAll(".by, .tstamp, .avatar").forEach(node => node.remove());
      text = clean(body.innerText, 2000); // roll templates keep their line breaks
      macro = macroOf(body, kind);
    }
    return { id: clean(el.dataset.messageid, 160), name: name || lastName, avatar: name ? lastAvatar : (avatarOf(el) || lastAvatar), text, ...(macro ? { macro } : {}), kind, source: "roll20", campaignId };
  };
  // "/desc" box beside the send button of the game screen's chat input (#textchat-input: textarea, #speakingas select, #chatSendBtn; measured on a game screen): when it is ticked, every line of the
  // message that is not empty and does not start with "/" gets "/desc " in front just before Roll20 takes the text. Roll20 does the sending: Enter (keydown, which Roll20 turns into a click on the
  // send button) and the send button click are only seen first (capture phase) and the textarea value is changed. Lines that already are a command stay as they are; ticked state is kept per campaign.
  const DESC_ID = "capybara-r20-desc";
  const descStore = () => `capybaraR20Desc:${findCampaignId() || "game"}`;
  const descLines = value => String(value).split("\n").map(line => (line.trim() && !line.trim().startsWith("/") ? `/desc ${line.trimStart()}` : line)).join("\n");
  const chatBox = () => document.querySelector("#textchat-input textarea");
  const applyDesc = () => {
    const box = document.getElementById(DESC_ID)?.querySelector("input"), area = chatBox();
    if (!box?.checked || !area) return;
    const next = descLines(area.value);
    if (next !== area.value) area.value = next;
  };
  const autocompleteOpen = () => [...document.querySelectorAll("ul.ui-autocomplete")].some(list => list.offsetParent !== null);
  document.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && event.target === chatBox() && !autocompleteOpen()) applyDesc();
  }, true);
  document.addEventListener("click", event => { if (event.target.closest?.("#chatSendBtn")) applyDesc(); }, true);
  const mountDesc = () => {
    if (document.getElementById(DESC_ID)) return;
    const send = document.querySelector("#textchat-input #chatSendBtn");
    if (!send) return;
    const label = document.createElement("label");
    label.id = DESC_ID;
    label.title = "켜면 보내는 줄마다 앞에 /desc 를 붙입니다";
    label.style.cssText = "display:inline-block;margin-left:8px;vertical-align:middle;font:inherit;font-size:13px;color:#333;cursor:pointer;white-space:nowrap";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.style.cssText = "margin:0 3px 0 0;vertical-align:middle";
    try { input.checked = localStorage.getItem(descStore()) === "1"; } catch (_) {}
    input.addEventListener("change", () => { try { localStorage.setItem(descStore(), input.checked ? "1" : "0"); } catch (_) {} });
    label.append(input, "/desc");
    send.after(label);
  };
  // Voice and video off on entering the game (measured on a game screen): the settings sidebar keeps its sections in the page even when it is closed, "음성&영상" (#collapseAudioAndVideo) among them. Its
  // controls are Element Plus selects: a label.legacy-label, a .el-select with the chosen text in .el-select__placeholder and an input[role=combobox] whose aria-controls names the list of options, which
  // sits in a popper in the page (display none until opened). "채팅 기술" is #select_chat_tech; "송신 옵션" and "수신 옵션" only exist while the chat technology is on. A choice is made the way a click does it:
  // clicking the option in that list. Nothing is opened or shown. Only a control whose chosen text differs is touched; what cannot be found or clicked is left alone (one line in the console).
  const AV_TARGETS = [
    { label: "송신 옵션", want: "미사용" },
    { label: "수신 옵션", want: "미사용" },
    { label: "채팅 기술", want: "영상/음성 채팅 사용 안 함" }
  ];
  const avSelectFor = text => {
    const root = document.getElementById("collapseAudioAndVideo");
    const label = root && [...root.querySelectorAll("label")].find(node => node.textContent.trim() === text);
    return label?.parentElement?.querySelector(".el-select") || null;
  };
  const avChosen = select => (select.querySelector(".el-select__placeholder, .el-select__selected-item:not(.is-hidden)")?.textContent || "").trim();
  const avOptions = select => {
    const id = select.querySelector("input[role=combobox]")?.getAttribute("aria-controls");
    const list = id ? document.getElementById(id) : null;
    return [...(list?.closest(".el-select__popper") || list || document).querySelectorAll(".el-select-dropdown__item")];
  };
  const avPass = () => {
    let touched = 0, pending = 0;
    for (const target of AV_TARGETS) {
      const select = avSelectFor(target.label);
      if (!select) continue;
      if (avChosen(select) === target.want) continue;
      const option = avOptions(select).find(item => item.textContent.trim() === target.want);
      if (!option) { pending += 1; continue; }
      option.click();
      touched += 1;
    }
    return { touched, pending };
  };
  const startAvOff = () => {
    let enabled = true;
    try { chrome.storage.local.get(["r20AvOff"]).then(value => { enabled = value.r20AvOff !== false; }); } catch (_) {}
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (!enabled || !document.getElementById("collapseAudioAndVideo")) { if (tries > 90) clearInterval(timer); return; }
      const { touched, pending } = avPass();
      // the sections of the settings sidebar are drawn a little after the page; once every control that exists has the wanted choice there is nothing more to do
      if (!touched && !pending && AV_TARGETS.some(target => avSelectFor(target.label))) clearInterval(timer);
      if (tries > 90) { clearInterval(timer); if (pending) console.info("[capybara roll20] voice/video: an option could not be found"); }
    }, 1000);
  };
  const scan = () => {
    if (!chrome.runtime?.id) { clearInterval(timer); return; } // orphaned after an extension reload
    for (const el of document.querySelectorAll("#textchat .content div.message[data-messageid]")) {
      const id = el.dataset.messageid;
      if (seen.has(id)) continue;
      seen.add(id);
      const message = read(el);
      if (findCampaignId()) message.campaignId = campaignId; // the game screen usually has none; the background knows it from the tab's campaign page
      if (Date.now() - startedAt < 3000 || el.matches(SKIP) || !message.text) continue;
      chrome.runtime.sendMessage({ type: "r20-message", message }).catch(() => {});
    }
  };
  // New lines are picked up as soon as they are added; the slow poll covers the time before the chat list exists (and a replaced list).
  let observed = null;
  const observe = () => {
    const content = document.querySelector("#textchat .content");
    if (!content || content === observed) return;
    observed = content;
    new MutationObserver(scan).observe(content, { childList: true });
  };
  const timer = setInterval(() => { observe(); scan(); mountDesc(); }, 5000);
  startAvOff();
  const mountTimer = setInterval(() => { mountDesc(); if (document.getElementById(DESC_ID)) clearInterval(mountTimer); }, 500); // the chat input appears a little after the page loads
  setTimeout(() => clearInterval(mountTimer), 60000);
  observe();
  scan();
})();
