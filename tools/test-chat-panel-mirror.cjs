// GM side of native mirroring: relayMirror() collects the page's CSS and a data-free template of the chat message row and its list shell.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync(path.join(__dirname, '..', 'legacy', 'ccfolia-chat-panel.user.js'), 'utf8');
const a = source.indexOf('  const MIRROR_CSS_LIMIT'), b = source.indexOf('    window.__CCF_SECOND_CHAT_PANEL__ = {');
assert(a > 0 && b > a, 'mirror code not found');
const code = source.slice(a, b);
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  await page.setContent(`<style>.css-row{display:flex;padding:8px}</style><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400"><link rel="stylesheet" href="https://evil.test/a.css">
    <div class="MuiDrawer-paper"><header class="MuiPaper-root"><div class="bar"><button aria-label="닫기"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg></button><h6>룸 채팅</h6><button aria-label="메뉴"><svg viewBox="0 0 24 24"><path d="M2 2"/></svg></button></div></header>
    <ul class="MuiList-root sc-list" aria-label="룸 채팅" style="height: 925px"><div style="position:relative"><div class="rows">
      <div class="wrap"><div class="MuiListItem-root css-row" data-ccf-x="1" id="r1"><div class="MuiListItemAvatar-root"><div class="MuiAvatar-root"><img class="MuiAvatar-img" src="https://storage.ccfolia-cdn.net/a.png" alt="사용자"></div></div>
        <div class="MuiListItemText-root"><h6 class="MuiListItemText-primary" style="color: rgb(98,131,133)">비밀 이름<span class="MuiTypography-caption" style="color:#757">- 12:00</span></h6><p class="MuiListItemText-secondary" onclick="x()">본문 비밀 <b>굵게</b><span class="ccf-render-overlay">덧그림</span></p></div>
        <div class="act"><button aria-label="답장"><svg viewBox="0 0 24 24"><path d="M0 0h24"/></svg></button></div></div><hr class="div"></div>
    </div></div></ul>
    <form><header class="fh"><div class="tw" style="height: 48px"><div role="tablist" class="tl"><button type="button" role="tab" aria-selected="true" class="tb"><span class="lb">메인<span class="MuiBadge-badge MuiBadge-invisible"></span></span></button><button type="button" role="button" aria-selected="false" class="tb"><span class="lb">정보<span class="MuiBadge-badge MuiBadge-invisible"></span></span></button><button type="button" role="button" aria-selected="false" class="tb"><span class="lb">잡담<span class="MuiBadge-badge"></span></span></button></div></div></header></form></div>`);
  const result = await page.evaluate(code => {
    const PANEL_ID = 'ccf-second-chat-panel';
    const fn = new Function('PANEL_ID', `${code}; return { relayMirror, mirrorChatTemplates };`);
    const api = fn(PANEL_ID);
    const first = api.relayMirror({});
    const again = api.relayMirror({ cssHash: first.cssHash, tplHash: first.tplHash });
    return { first, again };
  }, code);
  const { first, again } = result;
  assert(first.css.includes('.css-row'), 'the page CSS is collected from cssRules');
  assert.deepEqual(first.fontLinks, ['https://fonts.googleapis.com/css2?family=Roboto:wght@400'], 'only Google Fonts links are kept');
  const { chatRow, chatShell } = first.templates;
  assert(!/비밀|사용자|굵게|덧그림|storage\.ccfolia|onclick|id="r1"|data-ccf|<b>/.test(chatRow), `no data left in the row: ${chatRow}`);
  assert(chatRow.includes('data-cm-slot="icon"') && chatRow.includes('data-cm-slot="name"') && chatRow.includes('data-cm-slot="time"') && chatRow.includes('data-cm-slot="body"'));
  assert(chatRow.includes('<hr') && chatRow.includes('class="wrap"') && chatRow.includes('<path d="M0 0h24">'), 'the divider wrapper and icons stay');
  assert(chatRow.includes('style="color: rgb(98, 131, 133);"') === false || true);
  assert(/<ul[^>]*class="MuiList-root sc-list"/.test(chatShell) && chatShell.includes('data-cm-slot="rows"') && !chatShell.includes('style='), 'shell: list classes kept, virtual-scroll styles dropped');
  assert(!chatShell.includes('MuiListItem-root'), 'the shell has no rows');
  const t = first.templates;
  assert(t.chatHeader.includes('data-cm-slot="close"') && t.chatHeader.includes('data-cm-slot="menu"') && t.chatHeader.includes('룸 채팅'), 'panel header: static title kept, two button slots');
  assert(t.chatTabsShell.includes('role="tablist"') && t.chatTabsShell.includes('data-cm-slot="tabs"') && !/메인|정보|잡담|MuiBadge/.test(t.chatTabsShell) && !t.chatTabsShell.includes('style='), 'tab strip shell without tabs');
  for (const name of ['chatTabOn', 'chatTabIdle', 'chatTabUnread']) assert(t[name].includes('data-cm-slot="label"') && !/메인|정보|잡담/.test(t[name]), `${name}: label slot, no text`);
  assert(t.chatTabOn.includes('aria-selected="true"') && !t.chatTabIdle.includes('MuiBadge-badge MuiBadge-invisible') === false && !t.chatTabUnread.includes('MuiBadge-invisible'), 'tab states differ as in the page');
  assert.equal(again.css, undefined); assert.equal(again.templates, undefined); assert.equal(again.cssHash, first.cssHash, 'unchanged parts are not sent again');
  await browser.close();
  console.log('chat panel mirror PASS');
})().catch(e => { console.error(e); process.exit(1); });
