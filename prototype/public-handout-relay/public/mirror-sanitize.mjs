// Native mirroring: the GM browser sends CCFOLIA's own CSS and DOM shapes (templates); this file is the single place that decides what may pass.
// The Worker runs it when it stores them, the participant page runs it again before it draws them (same code, imported by both).
export const MIRROR_LIMITS = Object.freeze({ css: 900_000, tplEach: 40_000, tplCount: 60, tplTotal: 500_000, fontLinks: 6 });
// Hosts CSS url() may point to (measured on ccfolia.com 1.37.5: only data: URIs and a relative /static/media path appear; fonts come from Google Fonts).
const URL_PREFIXES = ["https://storage.ccfolia-cdn.net/", "https://fonts.gstatic.com/"];
const DATA_URL = /^data:image\/(?:png|gif|jpe?g|webp|svg\+xml)[;,]/i;
export const FONT_LINK = /^https:\/\/fonts\.googleapis\.com\/[\w\-./?=&:+,@%;]{1,500}$/;

export function mirrorHash(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `${value.length.toString(36)}-${hash.toString(36)}`;
}

const allowedUrl = value => DATA_URL.test(value) || URL_PREFIXES.some(prefix => value.startsWith(prefix));
// CSS text (a style sheet, or the value of one style attribute): no @import, no expression/behavior/javascript:, url() only to the allowed places (everything else becomes none).
export function cleanCss(css) {
  return String(css || "")
    .replace(/@import[^;{]*;?/gi, "")
    .replace(/expression\s*\(/gi, "blocked(")
    .replace(/javascript\s*:/gi, "blocked:")
    .replace(/behavior\s*:/gi, "blocked:")
    .replace(/-moz-binding\s*:/gi, "blocked:")
    .replace(/<\/?\s*style/gi, "")
    .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gis, (match, quote, address) => (allowedUrl(address.trim()) ? match : "none"));
}

const TAGS = new Set(["div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "button", "ul", "ol", "li", "form", "header", "section", "article", "nav", "main", "aside", "footer", "label", "small", "b", "i", "u", "s", "strong", "em", "br", "hr", "img", "input", "textarea", "select", "option", "ruby", "rt", "a",
  "svg", "path", "g", "circle", "rect", "line", "polyline", "polygon", "ellipse", "defs", "clippath", "lineargradient", "radialgradient", "stop", "mask", "title"]);
const VOID = new Set(["br", "hr", "img", "input"]);
const SVG_EMPTY = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "stop"]); // written as <tag ... /> so the HTML parser does not nest what follows
const ATTRS = new Set(["class", "style", "role", "type", "width", "height", "tabindex", "disabled", "placeholder", "rows", "cols", "maxlength", "focusable", "viewbox", "xmlns", "d", "fill", "fill-rule", "clip-rule", "fill-opacity", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-opacity", "opacity", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "x2", "y1", "y2", "points", "transform", "offset", "stop-color", "stop-opacity", "preserveaspectratio"]);
const attributeAllowed = name => ATTRS.has(name) || name.startsWith("aria-") || /^data-cm-[a-z0-9-]+$/.test(name);
const escapeText = text => text.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = text => text.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

// A DOM shape as a string (what the GM sends): only allowed tags and attributes are kept, text is escaped, anything that does not parse as a tag is text.
// Disallowed tags are dropped together with their content when they can carry code (script/style/iframe/object/embed), otherwise only the tag itself is dropped.
export function cleanTemplateHtml(html) {
  const source = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  let out = "", i = 0, skip = "";
  const open = [];
  while (i < source.length) {
    if (source[i] !== "<") {
      const next = source.indexOf("<", i);
      const end = next === -1 ? source.length : next;
      if (!skip) out += escapeText(source.slice(i, end));
      i = end; continue;
    }
    TAG.lastIndex = i;
    const match = TAG.exec(source);
    if (!match) { if (!skip) out += "&lt;"; i += 1; continue; }
    i = TAG.lastIndex;
    const closing = match[1] === "/", name = match[2].toLowerCase();
    if (skip) { if (closing && name === skip) skip = ""; continue; }
    if (!closing && /^(?:script|style|iframe|object|embed|template|noscript)$/.test(name)) { skip = name; continue; }
    if (!TAGS.has(name)) continue;
    if (closing) {
      const at = open.lastIndexOf(name);
      if (at !== -1) { while (open.length > at) out += `</${open.pop()}>`; }
      continue;
    }
    let attributes = "";
    for (const found of match[3].matchAll(ATTRIBUTE)) {
      const key = found[1].toLowerCase();
      if (!attributeAllowed(key)) continue;
      let value = found[2] ?? found[3] ?? "";
      if (key === "style") value = cleanCss(value).replace(/url\([^)]*\)/gi, "none"); // inline styles never load anything
      if (key === "class" || key === "role" || key === "type") value = value.replace(/[^\w\- :.]/g, "");
      attributes += ` ${key}="${escapeAttribute(value)}"`;
    }
    if (VOID.has(name)) out += `<${name}${attributes}>`;
    else if (SVG_EMPTY.has(name) || match[4] === "/") out += SVG_EMPTY.has(name) ? `<${name}${attributes}/>` : `<${name}${attributes}></${name}>`;
    else { out += `<${name}${attributes}>`; open.push(name); }
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

// What the Worker stores and the participant accepts: names are short words, sizes are capped, fonts only from Google Fonts.
// The text of CCFOLIA's chat-command help dialog ("?" next to the chat palette): { title, sections: [{ title, text, links: [{ text, href }] }] }, plain text only.
// Links are kept only when they point at the BCDice documentation (the only host that dialog links to, measured on ccfolia.com 1.37.5).
const HELP_LINK = /^https:\/\/docs\.bcdice\.org\//;
export function cleanHelp(help) {
  const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
  const sections = (Array.isArray(help?.sections) ? help.sections : []).slice(0, 12).map(section => ({
    title: text(section?.title, 100),
    text: text(section?.text, 8000),
    links: (Array.isArray(section?.links) ? section.links : []).slice(0, 8)
      .map(link => ({ text: text(link?.text, 200), href: text(link?.href, 300) })).filter(link => link.text && HELP_LINK.test(link.href))
  })).filter(section => section.title || section.text);
  return sections.length ? { title: text(help?.title, 100), system: text(help?.system, 60), sections } : null;
}
export function validateMirror(body) {
  const css = typeof body?.css === "string" ? body.css : null;
  if (css !== null && css.length > MIRROR_LIMITS.css) return { error: "css too large" };
  const templates = {};
  if (body?.templates && typeof body.templates === "object") {
    const names = Object.keys(body.templates);
    if (names.length > MIRROR_LIMITS.tplCount) return { error: "too many templates" };
    let total = 0;
    for (const name of names) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(name) || typeof body.templates[name] !== "string") return { error: "bad template name" };
      if (body.templates[name].length > MIRROR_LIMITS.tplEach) return { error: "template too large" };
      const cleaned = cleanTemplateHtml(body.templates[name]);
      total += cleaned.length;
      templates[name] = cleaned;
    }
    if (total > MIRROR_LIMITS.tplTotal) return { error: "templates too large" };
  }
  const fontLinks = (Array.isArray(body?.fontLinks) ? body.fontLinks : []).filter(link => typeof link === "string" && FONT_LINK.test(link)).slice(0, MIRROR_LIMITS.fontLinks);
  return { css: css === null ? null : cleanCss(css), templates: body?.templates ? templates : null, fontLinks, help: body?.help ? cleanHelp(body.help) : null };
}
