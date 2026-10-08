// Roll20 editor tab: reads new chat messages from the page and hands them to the background worker, which forwards them to the
// linked CCFOLIA room tab (storage r20Link). One direction only (Roll20 -> CCFOLIA). Whispers, GM-only and system lines are never sent.
(() => {
  "use strict";
  const clean = (value, max) => String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
  const SKIP = ".whisper, .private, .system";
  const seen = new Set();
  let lastName = "";
  const startedAt = Date.now(); // the chat history fills in shortly after load; anything seen in the first seconds is history and never sent
  // The editor URL is the same for every campaign; the campaign id is in an inline script of the page (campaign_id = 123).
  let campaignId = "";
  const findCampaignId = () => campaignId ||= [...document.scripts].map(s => s.textContent.match(/campaign_id\s*=\s*(\d+)/)?.[1]).find(Boolean) || "";
  const read = el => {
    const by = el.querySelector(".by");
    const name = by ? clean(by.textContent, 80).replace(/:$/, "").trim() : "";
    if (name) lastName = name; // Roll20 leaves the name out of consecutive lines by the same speaker
    const kind = el.classList.contains("rollresult") ? "rollresult" : el.classList.contains("emote") ? "emote" : el.classList.contains("desc") ? "desc" : "general";
    let text;
    if (kind === "rollresult") {
      const formula = clean(el.querySelector(".formula")?.textContent, 200).replace(/^rolling\s+/i, "");
      text = `${formula} → ${clean(el.querySelector(".rolled")?.textContent, 40)}`;
    } else {
      const body = el.cloneNode(true);
      body.querySelectorAll(".by, .tstamp, .avatar").forEach(node => node.remove());
      text = clean(body.innerText, 2000); // roll templates keep their line breaks
    }
    return { id: clean(el.dataset.messageid, 160), name: name || lastName, text, kind, source: "roll20", campaignId };
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
  const timer = setInterval(scan, 1000);
  scan();
})();
