// Roll20 game screen: voice and video are switched off on entering. The fake settings sidebar copies what was measured on a game screen: #collapseAudioAndVideo with Element Plus selects
// (label + .el-select with the chosen text in .el-select__placeholder, input[role=combobox] with aria-controls naming a popper of .el-select-dropdown__item, closed). Only a control whose chosen text
// differs is clicked (the option, not the control); the switch in the extension's storage turns it off; what cannot be found is left alone.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'extension', 'personal', 'roll20-reader.js'), 'utf8');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const select = (id, label, chosen, options) => `<form><label class="legacy-label">${label}</label><div class="el-select w-100"><div class="el-select__wrapper"><div class="el-select__selection"><div class="el-select__selected-item el-select__input-wrapper is-hidden"><input ${id === 'chat' ? 'id="select_chat_tech"' : ''} class="el-select__input" role="combobox" aria-controls="list-${id}"></div><div class="el-select__selected-item el-select__placeholder"><span>${chosen}</span></div></div></div></div>
    <div class="el-popper is-pure is-light el-select__popper" style="display:none"><ul id="list-${id}">${options.map(o => `<li class="el-select-dropdown__item${o === chosen ? ' is-selected' : ''}">${o}</li>`).join('')}</ul></div></form>`;
  const run = async ({ chat, send, receive, flag }) => {
    const page = await browser.newPage();
    await page.route('https://app.roll20.net/editor/', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<script>var campaign_id = 22089717;</script><div id="textchat"><div class="content"></div></div>
      <div id="collapseAudioAndVideo" class="panel-collapse collapse" style="display:none"><div class="panel-body">
        ${select('chat', '채팅 기술', chat, ['Integrated Voice & Video', '영상/음성 채팅 사용 안 함'])}
        ${send === undefined ? '' : select('send', '송신 옵션', send, ['미사용', '영상', '음성'])}
        ${receive === undefined ? '' : select('receive', '수신 옵션', receive, ['미사용', '영상', '음성'])}
      </div></div>
      <script>window.clicks = []; document.addEventListener('click', e => { const item = e.target.closest('.el-select-dropdown__item'); if (!item) return; window.clicks.push(item.parentElement.id + ':' + item.textContent); const form = item.closest('form'); form.querySelector('.el-select__placeholder span').textContent = item.textContent; if (item.parentElement.id === 'list-chat' && item.textContent.startsWith('영상/음성')) form.parentElement.querySelectorAll('form').forEach(f => { if (f !== form) f.remove(); }); });</script>` }));
    await page.goto('https://app.roll20.net/editor/');
    await page.evaluate(flag => { window.chrome = { runtime: { id: 'x', sendMessage: async () => {} }, storage: { local: { get: async () => (flag === undefined ? {} : { r20AvOff: flag }) } } }; }, flag);
    await page.evaluate(code);
    await page.waitForTimeout(2600);
    const result = await page.evaluate(() => ({ clicks: window.clicks, chat: document.querySelector('#select_chat_tech').closest('form').querySelector('.el-select__placeholder span').textContent, forms: document.querySelectorAll('#collapseAudioAndVideo form').length, shown: getComputedStyle(document.getElementById('collapseAudioAndVideo')).display }));
    await page.close();
    return result;
  };
  // on, everything differs: send and receive first, then the chat technology (which makes the other two go away); the panel is never shown
  assert.deepEqual(await run({ chat: 'Integrated Voice & Video', send: '영상', receive: '음성' }), { clicks: ['list-send:미사용', 'list-receive:미사용', 'list-chat:영상/음성 채팅 사용 안 함'], chat: '영상/음성 채팅 사용 안 함', forms: 1, shown: 'none' });
  // only what differs: send is already right
  assert.deepEqual((await run({ chat: 'Integrated Voice & Video', send: '미사용', receive: '음성' })).clicks, ['list-receive:미사용', 'list-chat:영상/음성 채팅 사용 안 함']);
  // already as wanted (the usual case, the chat technology is off and the other two are not there): nothing happens
  assert.deepEqual((await run({ chat: '영상/음성 채팅 사용 안 함' })).clicks, []);
  assert.deepEqual((await run({ chat: '영상/음성 채팅 사용 안 함', send: '미사용', receive: '미사용', flag: true })).clicks, []);
  // switched off in the extension's settings: nothing happens
  assert.deepEqual((await run({ chat: 'Integrated Voice & Video', send: '영상', receive: '음성', flag: false })).clicks, []);
  console.log('roll20 av off PASS');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
