// Native mirroring (participant side): CCFOLIA's own CSS (mirror.css) and the shape of its chat list and message row (templates) come from the GM's browser;
// this page only fills the data into those shapes. Templates are checked again here with the same code the Worker used (mirror-sanitize.mjs) and drawn inside a shadow root,
// so the mirrored CSS cannot touch the rest of this page and this page's CSS cannot touch the mirror. If anything is missing or fails, active() stays false and the built-in renderer is used.
const cmMirror = (() => {
  let clean = null, cssHash = "", tplHash = "", shell = null, row = null, host = null, shadow = null, link = null, token = 0;
  const fontLinks = new Set();
  const FONT = /^https:\/\/fonts\.googleapis\.com\//;
  const api = { onChange: () => {}, active: () => !!(shell && row && cssHash && host) };

  // A template as { root, styles }: inline style attributes are taken off before the DOM is built (style-src 'self' would refuse them) and put back through the CSSOM on every copy.
  function prepare(html) {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${clean(html)}`, "text/html");
    const root = doc.body.firstElementChild;
    if (!root) return null;
    const styles = [root, ...root.querySelectorAll("*")].map(el => { const value = el.getAttribute("style") || ""; el.removeAttribute("style"); return value; });
    return { root: document.importNode(root, true), styles };
  }
  function instantiate(template) {
    const copy = template.root.cloneNode(true);
    [copy, ...copy.querySelectorAll("*")].forEach((el, index) => { if (template.styles[index]) el.style.cssText = template.styles[index]; });
    return copy;
  }
  const slot = (root, name) => (root.matches?.(`[data-cm-slot="${name}"]`) ? root : root.querySelector(`[data-cm-slot="${name}"]`));

  function ensureHost(roomId) {
    if (host) return;
    const messages = document.getElementById("messages");
    host = document.createElement("div"); host.id = "messages-host";
    shadow = host.attachShadow({ mode: "open" });
    const base = new CSSStyleSheet();
    base.replaceSync(":host{display:block;color:#fff;font-family:Roboto,'Noto Sans KR','Helvetica Neue',Arial,sans-serif}.roll-result{color:rgba(255,255,255,.7)}.msg-edited{font-size:12px;font-weight:400;color:#757575}");
    shadow.adoptedStyleSheets = [base];
    link = document.createElement("link"); link.rel = "stylesheet";
    shadow.append(link);
    messages.after(host);
    messages.hidden = true;
  }

  api.host = () => host;
  api.slot = slot;
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
      if (info.tplHash && info.tplHash !== tplHash) {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/mirror.json`);
        if (!response.ok) return;
        const { templates } = await response.json();
        if (mine !== token) return;
        const nextShell = templates?.chatShell && prepare(templates.chatShell), nextRow = templates?.chatRow && prepare(templates.chatRow);
        if (!nextShell || !nextRow) return;
        shell = nextShell; row = nextRow; tplHash = info.tplHash; changed = true;
      }
      if (info.cssHash && info.cssHash !== cssHash) {
        ensureHost(roomId);
        link.href = `/api/rooms/${encodeURIComponent(roomId)}/mirror.css?v=${encodeURIComponent(info.cssHash)}`;
        cssHash = info.cssHash; changed = true;
      } else if (shell && row && cssHash) ensureHost(roomId);
      if (changed) api.onChange();
    } catch (_) { /* the built-in renderer keeps working */ }
  };
  // Draws the list: fill(rowRoot, message) puts one message's data into a fresh copy of the row template.
  api.render = (messages, fill) => {
    const list = instantiate(shell);
    const rows = slot(list, "rows");
    if (!rows) return false;
    for (const message of messages) { const copy = instantiate(row); fill(copy, message); rows.append(copy); }
    [...shadow.children].filter(el => el !== link).forEach(el => el.remove());
    shadow.append(list);
    return true;
  };
  return api;
})();
