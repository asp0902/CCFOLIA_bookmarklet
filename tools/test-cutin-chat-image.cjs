const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/asp92/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

// 컷인 명령 → 할당 이미지를 채팅 행 안에 인라인으로 보여 준다(테마 무관, 오버레이 아님). 실제 format-sync + 복제 저장소(roomEffects).
const source = fs.readFileSync(path.join(__dirname, '../legacy/ccfolia-format-sync.user.js'), 'utf8');
const GIF = 'data:image/gif;base64,R0lGODlhAgABAIAAAAAAAP///yH5BAEAAAAALAAAAAACAAEAAAIChFEAOw=='; // 2x1
const PNG = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 800 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('https://ccfolia.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset=utf-8><body style="background:#2b2b2b;color:#fff;font:14px sans-serif;margin:8px;width:380px"><div id="root"></div><div role="log"><ul id="list" style="list-style:none;margin:0;padding:0"></ul></div></body>' }));
    await page.goto('https://ccfolia.com/rooms/test');
    await page.evaluate(([gif, png]) => {
      const state = { entities: { roomEffects: { ids: ['e1', 'e2'], entities: {
        e1: { name: '번개', imageUrl: gif, volume: 1 },
        e2: { name: '불꽃', message: '!불꽃', imageUrl: png, soundUrl: 'https://example.test/s.mp3' },
        e3: { name: '이미지 없음', imageUrl: '' } } } , roomMessages: { entities: {}, ids: [] } } };
      window.__state = state;
      document.getElementById('root')['__reactContainer$test'] = { stateNode: { current: { memoizedProps: { store: { getState: () => state, dispatch() {}, subscribe: () => () => {} } } } } };
    }, [GIF, PNG]);
    await page.addScriptTag({ content: source });
    await page.waitForTimeout(400);
    const addRow = (id, text) => page.evaluate(([i, t]) => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = `<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">캐릭터</h6><p id="${i}" class="MuiTypography-root MuiTypography-body2 MuiListItemText-secondary"></p></div>`; li.querySelector('p').textContent = t; document.getElementById('list').append(li); }, [id, text]);
    const imgs = (id) => page.locator(`#${id} .ccf-cutin-chat-image img`);
    // an earlier message makes the script read the cut-in list and preload its images (as at the first scan of a real room)
    await addRow('warm', '시작'); await page.waitForTimeout(600);
    await addRow('trigger', '번개');
    await page.waitForSelector('#trigger .ccf-cutin-chat-image img', { state: 'attached', timeout: 3000 }).catch(async () => { console.log('DIAG', JSON.stringify(await page.evaluate(() => window.__CCF_FORMAT_SYNC_RUNTIME__.cutinChatDiag())), await page.evaluate(() => document.getElementById('trigger').outerHTML)); throw new Error('no image'); });
    assert.equal(await imgs('trigger').count(), 1, 'one image in the trigger row');
    assert.equal(await imgs('trigger').getAttribute('src'), GIF);
    const css = await imgs('trigger').evaluate((el) => { const c = getComputedStyle(el); return { maxHeight: c.maxHeight, maxWidth: c.maxWidth, radius: c.borderRadius }; });
    assert.equal(css.maxHeight, '200px'); assert.equal(css.maxWidth, '100%'); assert.notEqual(css.radius, '0px');
    // centred in the message body (left gap = right gap ±1px), in a normal row as in a centred narration row
    const gaps = await imgs('trigger').evaluate((el) => { const p = el.closest('p') || el.parentElement.parentElement, r = el.getBoundingClientRect(), b = p.getBoundingClientRect(); return { left: Math.round(r.left - b.left), right: Math.round(b.right - r.right) }; });
    console.log('cut-in image gaps', JSON.stringify(gaps));
    assert(Math.abs(gaps.left - gaps.right) <= 1, 'the cut-in image is centred: ' + JSON.stringify(gaps));
    // space is reserved: the width/height attributes are known (the image was preloaded when the list was read), so the row has its height before the image draws
    assert.equal(await imgs('trigger').evaluate((el) => [el.getAttribute('width'), el.getAttribute('height')]).then((v) => v.join('x')), '2x1');
    // the original text stays (React-safe), the image is appended last
    assert.equal(await page.locator('#trigger').evaluate((p) => p.firstChild.nodeType === 3 && p.firstChild.nodeValue === '번개' && p.lastElementChild.classList.contains('ccf-cutin-chat-image')), true);
    // the trigger text is hidden by CSS only (the text node stays), the image shows; plain rows are untouched; the off switch shows the text again
    const look = (id) => page.locator('#' + id).evaluate((p) => { const c = getComputedStyle(p), r = p.getBoundingClientRect(), img = p.querySelector('.ccf-cutin-chat-image img'); return { fontSize: c.fontSize, hideAttr: p.getAttribute('data-ccf-cutin-hide'), textNode: p.firstChild.nodeValue, imgVisible: !img || img.getBoundingClientRect().height > 0 }; });
    assert.deepEqual(await look('trigger'), { fontSize: '0px', hideAttr: '1', textNode: '번개', imgVisible: true }, 'trigger row: text hidden, node kept, image shown');
    await addRow('visible', '평범한 말'); await page.waitForTimeout(300);
    assert.deepEqual(await look('visible'), { fontSize: await page.locator('#visible').evaluate((p) => getComputedStyle(p).fontSize), hideAttr: null, textNode: '평범한 말', imgVisible: true }, 'plain row untouched');
    assert.notEqual((await look('visible')).fontSize, '0px');
    await page.evaluate(() => localStorage.setItem('ccfCutinChatHideText', 'off'));
    await page.evaluate(() => { document.getElementById('trigger').firstChild.nodeValue = '번개'; });
    await page.waitForFunction(() => !document.getElementById('trigger').hasAttribute('data-ccf-cutin-hide'), null, { timeout: 3000 });
    assert.notEqual((await look('trigger')).fontSize, '0px', 'off switch: the text shows again');
    await page.evaluate(() => localStorage.removeItem('ccfCutinChatHideText'));
    await page.evaluate(() => { document.getElementById('trigger').firstChild.nodeValue = '번개'; });
    await page.waitForFunction(() => document.getElementById('trigger').getAttribute('data-ccf-cutin-hide') === '1', null, { timeout: 3000 });
    // the trigger can also be the cut-in's message field
    await addRow('trigger2', '!불꽃');
    await page.waitForSelector('#trigger2 .ccf-cutin-chat-image img');
    assert.equal(await imgs('trigger2').getAttribute('src'), PNG);
    // ordinary text, a text that only contains the name, a cut-in without an image: nothing
    await addRow('plain', '평범한 말'); await addRow('contains', '번개가 친다'); await addRow('noimg', '이미지 없음');
    await page.waitForTimeout(500);
    for (const id of ['plain', 'contains', 'noimg']) assert.equal(await imgs(id).count(), 0, `${id}: no image`);
    // no duplicates on re-scan / text change back and forth
    await page.evaluate(() => { const p = document.getElementById('trigger'); p.firstChild.nodeValue = '번개'; p.appendChild(document.createElement('b')).remove(); });
    await page.waitForTimeout(400);
    assert.equal(await imgs('trigger').count(), 1, 'no duplicate after a re-scan');
    await page.evaluate(() => { document.getElementById('plain').firstChild.nodeValue = '번개'; });
    await page.waitForSelector('#plain .ccf-cutin-chat-image img');
    await page.evaluate(() => { document.getElementById('plain').firstChild.nodeValue = '다시 평범'; });
    await page.waitForFunction(() => !document.querySelector('#plain .ccf-cutin-chat-image'));
    // another image in the message (the 언성 듀엣 image or a macro GIF) -> the cut-in image is not added a second time
    await page.evaluate(() => { const li = document.createElement('li'); li.className = 'MuiListItem-root'; li.innerHTML = '<div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">a</h6><p id="dup" class="MuiTypography-root MuiTypography-body2 MuiListItemText-secondary">번개<img class="ccf-unsung-duet-msg-img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></p></div>'; document.getElementById('list').append(li); });
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#dup .ccf-cutin-chat-image').count(), 0, 'no second image when the message already has one');
    // only chat message rows: a cut-in list modal / popover / menu / drawer list whose item text equals a cut-in name gets no image (and one that was added is removed)
    await page.evaluate(() => {
      const host = document.createElement('div');
      host.innerHTML = '<div class="MuiDialog-root" role="dialog"><ul><li class="MuiListItem-root"><div class="MuiListItemText-root"><p id="modalItem" class="MuiListItemText-secondary">번개</p></div></li></ul></div>'
        + '<div class="MuiPopover-root"><ul><li class="MuiMenuItem-root"><p id="popItem" class="MuiListItemText-secondary">번개</p></li></ul></div>'
        + '<aside class="MuiDrawer-paper"><ul><li class="MuiListItem-root"><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">컷인</h6><p id="drawerItem" class="MuiListItemText-secondary">번개</p></div></li></ul></aside>'
        + '<div class="ccf-scp-panel"><ul><li class="ccf-scp-row MuiListItem-root"><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">패널</h6><p id="panelRow" class="MuiListItemText-secondary">번개</p></div></li></ul></div>'
        + '<ul><li class="MuiListItem-root"><div class="MuiListItemText-root"><h6 class="MuiListItemText-primary">연갈<span class="MuiTypography-caption"> - 오늘 14:44</span></h6><p id="captionRow" class="MuiListItemText-secondary">번개</p></div></li></ul>';
      document.body.append(host);
    });
    await page.waitForSelector('#panelRow .ccf-cutin-chat-image img');
    await page.waitForSelector('#captionRow .ccf-cutin-chat-image img');
    await page.waitForTimeout(400);
    for (const id of ['modalItem', 'popItem', 'drawerItem']) assert.equal(await imgs(id).count(), 0, id + ': no image outside chat message rows');
    // an image that is already there is taken off again
    await page.evaluate(() => { const el = document.getElementById('modalItem'); el.setAttribute('data-ccf-cutin-chat', 'x'); const w = document.createElement('span'); w.className = 'ccf-cutin-chat-image'; w.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">'; el.appendChild(w); el.firstChild.nodeValue = '번개 '; });
    await page.waitForFunction(() => !document.querySelector('#modalItem .ccf-cutin-chat-image'));
    // the list is re-read only when roomEffects changes (a new cut-in works at once)
    await page.evaluate(() => { const effects = window.__state.entities.roomEffects; window.__state.entities.roomEffects = { ...effects, entities: { ...effects.entities, e4: { name: '새컷인', imageUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' } } }; });
    await addRow('fresh', '새컷인');
    await page.waitForSelector('#fresh .ccf-cutin-chat-image img');
    // diagnostics
    const diag = await page.evaluate(() => window.__CCF_FORMAT_SYNC_RUNTIME__.cutinChatDiag());
    assert.equal(diag.store, true); assert(diag.triggers.some(([text]) => text === '번개')); assert(diag.sampleKeys[0].includes('imageUrl'));
    // off switch
    await page.evaluate(() => localStorage.setItem('ccfCutinChatImage', 'off'));
    await addRow('off', '불꽃');
    await page.waitForTimeout(500);
    assert.equal(await imgs('off').count(), 0, 'off: no image for new rows');
    await page.evaluate(() => { document.getElementById('trigger').firstChild.nodeValue = '번개'; document.getElementById('trigger').append(document.createElement('i')); });
    await page.waitForFunction(() => !document.querySelector('#trigger .ccf-cutin-chat-image'));
    assert.deepEqual(errors, [], 'no page errors');
    console.log('cutin chat image PASS');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
