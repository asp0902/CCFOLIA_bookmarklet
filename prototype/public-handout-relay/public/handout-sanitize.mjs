// Handouts sent to a participant: the body is HTML the GM's CCFOLIA handout tool rendered (formatting, lists, headings, images, links). It is cleaned here to an allow list, by the Worker before it is stored
// and again by the participant page before it is shown (this file is served to the page and imported by the Worker, the same code both times).
// Tags are an allow list; attributes: class (plain words), a safe subset of style, https links, images only as small data URIs or from CCFOLIA's own CDN; everything else is dropped, text is escaped.
export const HANDOUT_LIMITS = Object.freeze({ htmlEach: 600_000, itemsPerPerson: 60, totalPerPerson: 1_800_000, title: 200 });

const TAGS = new Set(["p", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "br", "hr", "b", "i", "u", "s", "strong", "em", "code", "pre", "a", "img", "small", "sub", "sup", "table", "thead", "tbody", "tr", "td", "th"]);
const VOID = new Set(["br", "hr", "img"]);
const DROP_WITH_CONTENT = /^(?:script|style|iframe|object|embed|template|noscript|svg|math|form|textarea|select)$/;
const STYLE_PROPS = new Set(["color", "background-color", "font-size", "font-weight", "font-style", "text-align", "text-decoration", "line-height", "letter-spacing", "margin", "padding", "border-radius", "text-shadow"]);
const SAFE_VALUE = /^[#%.,\s\w()-]{1,80}$/;
const IMAGE_DATA = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]{1,1400000}$/;
const IMAGE_CDN = /^https:\/\/storage\.ccfolia-cdn\.net\/[\w\-./%~+=]{1,300}$/;
const LINK = /^https:\/\/[^\s<>"']{1,500}$/;
const escapeText = text => text.replace(/&(?!(?:amp|lt|gt|quot|nbsp|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = text => text.replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/y;
const ATTRIBUTE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;

function cleanStyle(value) {
  const kept = [];
  for (const declaration of String(value || "").split(";")) {
    const at = declaration.indexOf(":");
    if (at < 1) continue;
    const prop = declaration.slice(0, at).trim().toLowerCase(), val = declaration.slice(at + 1).trim();
    if (STYLE_PROPS.has(prop) && SAFE_VALUE.test(val) && !/url|expression|javascript|@import/i.test(val)) kept.push(`${prop}:${val}`);
  }
  return kept.join(";");
}
const decode = value => value.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export function cleanHandoutHtml(html) {
  const source = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  let out = "", i = 0, skip = "";
  const open = [];
  while (i < source.length) {
    if (source[i] !== "<") {
      const next = source.indexOf("<", i), end = next === -1 ? source.length : next;
      if (!skip) out += escapeText(source.slice(i, end));
      i = end; continue;
    }
    TAG.lastIndex = i;
    const match = TAG.exec(source);
    if (!match) { if (!skip) out += "&lt;"; i += 1; continue; }
    i = TAG.lastIndex;
    const closing = match[1] === "/", name = match[2].toLowerCase();
    if (skip) { if (closing && name === skip) skip = ""; continue; }
    if (!closing && DROP_WITH_CONTENT.test(name)) { skip = name; continue; }
    if (!TAGS.has(name)) continue;
    if (closing) { const at = open.lastIndexOf(name); if (at !== -1) while (open.length > at) out += `</${open.pop()}>`; continue; }
    let attributes = "", hasSrc = false;
    for (const found of match[3].matchAll(ATTRIBUTE)) {
      const key = found[1].toLowerCase();
      const value = decode(found[2] ?? found[3] ?? "");
      if (key === "class") { const cls = value.replace(/[^\w\- ]/g, "").trim(); if (cls) attributes += ` class="${escapeAttribute(cls)}"`; }
      else if (key === "style") { const style = cleanStyle(value); if (style) attributes += ` style="${escapeAttribute(style)}"`; }
      else if (key === "href" && name === "a") { if (LINK.test(value)) attributes += ` href="${escapeAttribute(value)}" target="_blank" rel="noopener noreferrer"`; }
      else if (key === "src" && name === "img") { if (IMAGE_DATA.test(value) || IMAGE_CDN.test(value)) { attributes += ` src="${escapeAttribute(value)}"`; hasSrc = true; } }
      else if (key === "alt" && name === "img") attributes += ` alt="${escapeAttribute(value.slice(0, 200))}"`;
      else if ((key === "width" || key === "height") && name === "img" && /^\d{1,4}$/.test(value)) attributes += ` ${key}="${value}"`;
      else if ((key === "colspan" || key === "rowspan") && /^\d{1,2}$/.test(value) && (name === "td" || name === "th")) attributes += ` ${key}="${value}"`;
    }
    if (name === "img") { if (hasSrc) out += `<img${attributes}>`; else out += `<span class="handout-missing-image">[이미지]</span>`; continue; }
    if (VOID.has(name)) out += `<${name}${attributes}>`;
    else if (match[4] === "/") out += `<${name}${attributes}></${name}>`;
    else { out += `<${name}${attributes}>`; open.push(name); }
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
// One handout as it is stored for one person. secretHtml is empty for everyone who may not read the secret part: the caller decides, this only bounds and cleans.
export function cleanHandoutItem(item) {
  const html = cleanHandoutHtml(text(item?.html, HANDOUT_LIMITS.htmlEach * 2)).slice(0, HANDOUT_LIMITS.htmlEach);
  const secretHtml = cleanHandoutHtml(text(item?.secretHtml, HANDOUT_LIMITS.htmlEach * 2)).slice(0, HANDOUT_LIMITS.htmlEach);
  const id = text(item?.id, 100).replace(/[^\w\-]/g, "");
  if (!id) return null;
  return { id, title: text(item?.title, HANDOUT_LIMITS.title), html, secretHtml, folder: text(item?.folder, 80), order: Number.isFinite(Number(item?.order)) ? Math.round(Number(item.order)) : 0, updatedAt: text(item?.updatedAt, 40) };
}
// A person's list: bounded in number and in total size (later items are dropped first).
export function cleanHandoutList(items) {
  const out = [];
  let total = 0;
  for (const item of Array.isArray(items) ? items : []) {
    if (out.length >= HANDOUT_LIMITS.itemsPerPerson) break;
    const cleaned = cleanHandoutItem(item);
    if (!cleaned) continue;
    const size = cleaned.html.length + cleaned.secretHtml.length + cleaned.title.length;
    if (total + size > HANDOUT_LIMITS.totalPerPerson) continue;
    total += size; out.push(cleaned);
  }
  return out;
}
