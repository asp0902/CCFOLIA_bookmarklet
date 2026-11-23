// Native mirroring (participant side): CCFOLIA's own CSS (mirror.css) and the shapes of its chat parts (templates) come from the GM's browser;
// this page only fills data into those shapes. Templates are checked again here with the same code the Worker used (mirror-sanitize.mjs) and each mirrored part is drawn
// inside its own shadow root, so the mirrored CSS cannot touch the rest of this page and this page's CSS cannot touch the mirror. The CSS is fetched once as a file and shared
// by every shadow root (one constructed style sheet). If anything is missing or fails, has() stays false and the built-in renderer is used.
const cmMirror = (() => {
  let clean = null, cssHash = "", tplHash = "", helpHash = "", assetsHash = "", token = 0, toolkitCss = false;
  const templates = new Map(), hosts = new Map(), fontLinks = new Set();
  const sheet = new CSSStyleSheet(), base = new CSSStyleSheet(), fontSheet = new CSSStyleSheet(), themeSheet = new CSSStyleSheet();
  // Same-speaker grouping: the toolkit's rules (roll20-css-bridge prose mode) are part of this page, so a row is grouped in the frame it is drawn, even when the GM's CSS snapshot was taken before they existed.
  const SPEAKER_RUN_CSS = `.MuiListItem-root[data-ccf-prose-cont="1"] .MuiListItemAvatar-root { display: none !important; }.MuiListItem-root[data-ccf-prose-cont="1"] h6.MuiListItemText-primary { display: none !important; }.MuiListItem-root[data-ccf-prose-cont="1"] { padding-top: 0 !important; padding-left: 16px !important; padding-right: 16px !important; margin: 0 !important; min-height: 0 !important; }.MuiListItem-root[data-ccf-prose-cont="1"]:not([data-ccf-prose-cont-last="1"]) { padding-bottom: 5px !important; }.MuiListItem-root[data-ccf-prose-cont="1"]:not([data-ccf-prose-cont-last="1"]) { border-bottom: 0 !important; }.MuiListItem-root[data-ccf-prose-cont-leader="1"] + .MuiDivider-root, .MuiListItem-root[data-ccf-prose-cont="1"]:not([data-ccf-prose-cont-last="1"]) + .MuiDivider-root { border-color: transparent !important; background: transparent !important; }.MuiListItem-root[data-ccf-prose-cont="1"]:not([data-ccf-prose-cont-last="1"]) .MuiListItemText-root { margin: 0 !important; }.MuiListItem-root[data-ccf-prose-cont="1"][data-ccf-prose-cont-last="1"] .MuiListItemText-root { margin-top: 0 !important; }.MuiListItem-root[data-ccf-prose-cont="1"][data-ccf-prose-cont-last="1"]:has(.ccf-render-root[data-ccf-narration="1"]) .MuiListItemText-root { margin-bottom: 0 !important; }.MuiListItem-root[data-ccf-prose-cont="1"] .MuiListItemText-root { padding-left: 56px !important; }.MuiListItem-root[data-ccf-prose-cont="1"] p.MuiListItemText-secondary { margin: 0 !important; }.MuiListItem-root[data-ccf-prose-cont-leader="1"] { padding-bottom: 5px !important; border-bottom: 0 !important; }.MuiListItem-root[data-ccf-prose-cont-leader="1"] .MuiListItemText-root { margin-bottom: 0 !important; }.MuiListItem-root[data-ccf-prose-cont-leader="1"] p.MuiListItemText-secondary { margin-bottom: 0 !important; }[data-ccf-prose-cont-leader-wrap="1"] { padding-bottom: 0 !important; margin-bottom: 0 !important; }[data-ccf-prose-cont-wrap="1"] { padding-top: 0 !important; margin-top: 0 !important; min-height: 0 !important; }[data-ccf-prose-cont-wrap="1"]:not([data-ccf-prose-cont-wrap-last="1"]) { padding-bottom: 0 !important; margin-bottom: 0 !important; }`;
  base.replaceSync(SPEAKER_RUN_CSS + "[hidden]{display:none !important}ul{height:100%;box-sizing:border-box}:host{color:#fff;font-family:Roboto,'Noto Sans KR','Helvetica Neue',Arial,sans-serif}.roll-result{color:rgba(255,255,255,.7)}.msg-edited{font-size:12px;font-weight:400;color:#757575}.MuiAppBar-positionFixed{position:relative !important}[role=tab][aria-selected=true]{position:relative}[role=tab][aria-selected=true]::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;background:#f50057}");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, fontSheet, themeSheet];
  const FONT = /^https:\/\/fonts\.googleapis\.com\//;
  const api = { onChange: () => {}, help: null, assets: {} }; // help: the text of CCFOLIA's chat-command dialog (plain data, see cleanHelp)

  // A template as { root, styles }: inline style attributes are taken off before the DOM is built (style-src 'self' would refuse them) and put back through the CSSOM on every copy.
  function prepare(html) {
    // style="..." is renamed in the cleaned markup before it is parsed: even a parsed (never shown) document reports "Applying inline style violates style-src" for every style attribute.
    // The tags are the only place where ` style="` can occur (the cleaner escapes quotes in values).
    const markup = clean(html).replace(/<[^<>]*>/g, tag => tag.replace(/ style="/g, ' data-cm-style="'));
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${markup}`, "text/html");
    const root = doc.body.firstElementChild;
    if (!root) return null;
    const styles = [root, ...root.querySelectorAll("*")].map(el => { const value = el.getAttribute("data-cm-style") || ""; el.removeAttribute("data-cm-style"); return value; });
    return { root: document.importNode(root, true), styles };
  }
  // true when the GM's page had the format toolkit switched on: its rules (.ccf-render-root ...) are in the CSS. Without it the GM shows message text plain, so the mirrored rows do too.
  api.toolkit = () => toolkitCss;
  // The participant's own theme (their browser only): one sheet shared by this page and every mirrored part.
  api.setTheme = css => themeSheet.replaceSync(css);
  api.has = name => templates.has(name) && !!cssHash;
  api.make = name => {
    const template = templates.get(name);
    const copy = template.root.cloneNode(true);
    [copy, ...copy.querySelectorAll("*")].forEach((el, index) => { if (template.styles[index]) el.style.cssText = template.styles[index]; });
    return copy;
  };
  api.slot = (root, name) => (root.matches?.(`[data-cm-slot="${name}"]`) ? root : root.querySelector(`[data-cm-slot="${name}"]`));
  // A shadow root for one mirrored part; insert(host) puts the host where the part belongs on the page (called once).
  api.shadow = (id, insert) => {
    let entry = hosts.get(id);
    if (!entry) {
      const host = document.createElement("div"); host.id = id;
      const root = host.attachShadow({ mode: "open" });
      root.adoptedStyleSheets = [base, sheet, themeSheet];
      insert(host);
      entry = { host, root }; hosts.set(id, entry);
    }
    return entry;
  };
  // Replaces what a shadow root shows (the style sheets are adopted, so the content is all there is).
  api.show = (id, nodes) => { const entry = hosts.get(id); if (entry) entry.root.replaceChildren(...nodes); };

  // info: { cssHash, tplHash, fontLinks } from /state
  api.sync = async (info, roomId) => {
    if (!info || !roomId) return;
    const mine = ++token;
    try {
      if (!clean) clean = (await import("/mirror-sanitize.mjs")).cleanTemplateHtml;
      for (const href of info.fontLinks || []) {
        if (!FONT.test(href) || fontLinks.has(href)) continue;
        fontLinks.add(href);
        const el = document.createElement("link"); el.rel = "stylesheet"; el.href = href; document.head.append(el);
      }
      let changed = false;
      if ((info.tplHash && info.tplHash !== tplHash) || (info.helpHash && info.helpHash !== helpHash) || (info.assetsHash && info.assetsHash !== assetsHash)) {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/mirror.json`);
        if (!response.ok || mine !== token) return;
        const next = new Map(), loaded = await response.json();
        for (const [name, html] of Object.entries(loaded.templates || {})) { const prepared = prepare(html); if (prepared) next.set(name, prepared); }
        if (mine !== token) return;
        templates.clear(); next.forEach((value, key) => templates.set(key, value));
        tplHash = info.tplHash || tplHash; helpHash = info.helpHash || ""; assetsHash = info.assetsHash || ""; api.help = loaded.help || null; api.assets = loaded.assets || {}; changed = true;
      }
      if (info.cssHash && info.cssHash !== cssHash) {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/mirror.css?v=${encodeURIComponent(info.cssHash)}`);
        if (!response.ok || mine !== token) return;
        const text = await response.text();
        sheet.replaceSync(text);
        toolkitCss = text.includes("ccf-render-root");
        // @font-face inside a shadow root's style sheet is ignored by the browser; the same rules are registered for the whole document.
        const faces = [...sheet.cssRules].filter(rule => rule instanceof CSSFontFaceRule).map(rule => rule.cssText);
        fontSheet.replaceSync(faces.join("\n"));
        cssHash = info.cssHash; changed = true;
      }
      if (changed) api.onChange();
    } catch (error) { console.warn("mirror sync failed", error); /* the built-in renderer keeps working */ }
  };
  return api;
})();
