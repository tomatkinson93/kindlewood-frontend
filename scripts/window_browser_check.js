// Browser pass for KWWindow at 1400×900, 390×844 and 844×390 (touch)
// (docs/LAYOUT_SPEC.md §7). Needs Playwright with Chromium (preinstalled in
// the cloud container; not a project dependency). Serve the site first:
//   python3 -m http.server 8099
//   node scripts/window_browser_check.js http://localhost:8099/ /tmp [desktop|phone|landscape]
// The site never fires "load" offline (fonts), so it waits for the DOM.
const { chromium, devices } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:8099/';
const OUT = process.argv[3] || '.';
let pass = 0, fail = 0;
const check = (n, ok, x) => { console.log((ok ? '  ✔ ' : '  ✘ ') + n + (x ? ' — ' + x : '')); ok ? pass++ : fail++; };

(async () => {
  const browser = await chromium.launch();
  const views = [
    { name: 'desktop 1400×900', viewport: { width: 1400, height: 900 }, hasTouch: false, phone: false },
    { name: 'phone 390×844', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, phone: true },
    { name: 'landscape 844×390 touch', viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, phone: true },
  ];
  const only = process.argv[4];
  for (const v of views.filter(x => !only || x.name.startsWith(only))) {
    console.log(v.name);
    const ctx = await browser.newContext({ viewport: v.viewport, hasTouch: v.hasTouch, isMobile: !!v.isMobile, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route(/^https?:\/\/(?!localhost)/, r => r.abort());   // no outside requests (fonts) in the sandbox
    await page.route('**/js/config.js*', r => r.fulfill({ contentType: 'application/javascript', body: "window.KINDLEWOOD_API='http://localhost:1';" }));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.KWWindow && window.KWDialog, null, { timeout: 15000 });

    // An opener to return focus to.
    await page.evaluate(() => {
      const b = document.createElement('button'); b.id = 'opener'; b.textContent = 'open'; b.style.cssText = 'position:fixed;top:0;left:0;z-index:1';
      document.body.appendChild(b); b.focus();
    });
    await page.evaluate(() => {
      window._clicks = 0;
      window.KWWindow.open({
        id: 'test-l', title: 'Families', icon: 'families', size: 'L', help: 'families',
        tabs: [{ key: 'a', label: 'Short' }, { key: 'b', label: 'Long' }],
        render(body, st) {
          body.innerHTML = st.tab === 'a'
            ? '<p>Short tab.</p><button class="kw-btn primary" data-action="hit" id="hit">Hit</button><input id="field" value="">'
            : '<div style="height:3000px">Long tab.</div><button class="kw-btn" id="deep">Deep</button>';
        },
        actions: { hit() { window._clicks++; } },
      });
    });
    const box = async sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }, sel);
    const b1 = await box('.kww');
    if (v.phone) check('full-screen sheet on phones', b1.w === v.viewport.width && b1.h === v.viewport.height, JSON.stringify(b1));
    else check('size L is 980×720', b1.w === 980 && b1.h === 720, JSON.stringify(b1));
    check('focus moved into the window', await page.evaluate(() => document.querySelector('.kww').contains(document.activeElement)));
    await page.click('[data-kww-tab="b"]');
    const b2 = await box('.kww');
    check('switching to a long tab keeps the size; the body scrolls', b2.w === b1.w && b2.h === b1.h && await page.evaluate(() => { const b = document.querySelector('.kww-body'); return b.scrollHeight > b.clientHeight; }));
    await page.click('[data-kww-tab="a"]');
    await page.click('#hit');
    check('data-action runs the window\'s action', await page.evaluate(() => window._clicks) === 1);
    // Tab trap: tab many times, focus never leaves the window.
    let outside = 0;
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); if (!await page.evaluate(() => document.querySelector('.kww').contains(document.activeElement))) outside++; }
    check('Tab stays inside the window', outside === 0);
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Shift+Tab'); if (!await page.evaluate(() => document.querySelector('.kww').contains(document.activeElement))) outside++; }
    check('Shift+Tab stays inside too', outside === 0);
    // A second window on top; Escape closes only the top one.
    await page.evaluate(() => window.KWWindow.open({ id: 'test-s', title: 'Small', size: 'S', render(b) { b.innerHTML = '<p>Top</p>'; } }));
    const z = await page.evaluate(() => [...document.querySelectorAll('.kww-backdrop')].map(e => Number(getComputedStyle(e).zIndex)));
    check('the newer window stacks above the older', z.length === 2 && z[1] > z[0], z.join(' < '));
    if (!v.phone) { const bs = await box('[data-kww="test-s"]'); check('size S is 420 wide', bs.w === 420, JSON.stringify(bs)); }
    await page.keyboard.press('Escape');
    check('Escape closes only the top window', await page.evaluate(() => !window.KWWindow.isOpen('test-s') && window.KWWindow.isOpen('test-l')));
    // A field with text keeps Escape.
    await page.fill('#field', 'abc');
    await page.focus('#field');
    await page.keyboard.press('Escape');
    check('Escape in a field with text does not close the window', await page.evaluate(() => window.KWWindow.isOpen('test-l')));
    // A confirm sits above the window and owns the keys.
    const answer = page.evaluate(() => window.KWDialog.confirm({ title: 'Sure?', message: 'Test' }));
    await page.waitForSelector('.kwd-backdrop');
    const zc = await page.evaluate(() => [Number(getComputedStyle(document.querySelector('.kwd-backdrop')).zIndex), Number(getComputedStyle(document.querySelector('.kww-backdrop')).zIndex)]);
    check('a confirm sits above the window', zc[0] > zc[1], zc.join(' > '));
    await page.keyboard.press('Escape');
    check('Escape answers the confirm, the window stays', (await answer) === false && await page.evaluate(() => window.KWWindow.isOpen('test-l')));
    if (v.phone) check('the phone tab bar hides behind the window', await page.evaluate(() => !document.body.classList.contains('kw-shell') || document.body.classList.contains('kw-overlay')));
    await page.screenshot({ path: `${OUT}/window-${v.viewport.width}x${v.viewport.height}.png` });
    // Close with the button: focus returns to the opener.
    await page.click('[data-kww="test-l"] .kww-close');
    check('the close button closes it and focus returns to the opener', await page.evaluate(() => !window.KWWindow.isOpen() && document.activeElement && document.activeElement.id === 'opener'));
    // Reopen: remembered tab.
    await page.evaluate(() => window.KWWindow.open({ id: 'test-l', title: 'F', tabs: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], render() {} }));
    check('reopened on the tab it was left on', await page.evaluate(() => window.KWWindow.get('test-l').tab) === 'a');
    await page.evaluate(() => window.KWWindow.closeAll());
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
