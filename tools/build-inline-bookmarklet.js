const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const loaderPath = path.join(root, "src", "capybara-toolkit-loader.js");
const outputPath = path.join(root, "bookmarklet.inline.localhost.js");
const baseUrl = "http://127.0.0.1:4173/";

const loader = fs.readFileSync(loaderPath, "utf8");
const source = [
  `window.__CAPYBARA_TOOLKIT_BASE_URL__=${JSON.stringify(baseUrl)};`,
  loader
].join("\n");

const bookmarklet = `javascript:${encodeURIComponent(source)}`;
fs.writeFileSync(outputPath, bookmarklet, "utf8");

console.log(`Wrote ${path.relative(root, outputPath)} (${bookmarklet.length} chars)`);
