// Usage: node tests/e2e/smoke.js [checkName]   (does not start a server)
const {chromium} = require('playwright');
const {execFileSync, spawn} = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const MATHJAX = process.env.MATHJAX_LOCAL;

async function withPage(fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e));
  if (MATHJAX) {
    await page.route('https://cdnjs.cloudflare.com/**', r =>
      r.fulfill({path: MATHJAX, contentType: 'application/javascript'}));
  }
  try {
    await fn(page);
    if (errors.length) throw new Error('pageerror: ' + errors.map(e => e.message).join('; '));
  } finally {
    await browser.close();
  }
}

const checks = {
  async practiceSkip() {
    await withPage(async page => {
      await page.goto(BASE + '#practice');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.click('[data-act=sec][data-sec=QA]');
      const id1 = (await page.locator('.list > article.card').nth(0).getAttribute('id')).slice(2);
      const card = () => page.locator(`#c-${id1}`);
      const cell = (sec, k) => page.locator(`#secstats tr[data-sec=${sec}] [data-k=${k}]`).innerText().then(t => t.trim());
      const fail = m => { throw new Error('practiceSkip: ' + m); };
      // a timed single question: Show solution = skipped, time thrown away, can't answer
      await card().locator('[data-act=t-start]').click();
      await card().locator('[data-act=reveal]').click();
      if (!(await card().locator('.chip.skip').count())) fail('no Skipped chip');
      if (await card().locator('button.opt[data-act=pick]:not([disabled])').count()) fail('options still answerable');
      if (await card().locator('.ptimer').count()) fail('timer still shown');
      if (await page.locator('[data-timer]').count()) fail('clock still running');
      const t = await page.evaluate(id => JSON.parse(localStorage.getItem('catpyq.times.v1') || '{}')[id], id1);
      if (t) fail('time kept: ' + JSON.stringify(t));
      if (await cell('QA', 'skipped') !== '1' || await cell('QA', 'attempted') !== '0') fail('stats row');
      if ((await page.locator('#tally [data-k=skipped] b').innerText()).trim() !== '1') fail('tally skipped');
      // persists across reload; Try again brings it back
      await page.reload();
      if (!(await card().locator('.chip.skip').count())) fail('skip lost on reload');
      await card().locator('[data-act=retry]').click();
      if (await card().locator('.chip.skip').count()) fail('still skipped after Try again');
      if (!(await card().locator('[data-act=t-start]').count())) fail('no Start timer after Try again');
      if (await cell('QA', 'skipped') !== '0') fail('skipped not cleared');
      // in a set: Show solution pauses the set timer; Show set explanation skips the rest and stops it
      await page.click('[data-act=sec][data-sec=DILR]');
      const set = page.locator('.list > article.card.set', {has: page.locator('[data-act=setsol]')}).first();
      const sid = (await set.getAttribute('id')).slice(2);
      const S = () => page.locator(`#c-${sid}`);
      await S().locator('.set-head [data-act=t-start]').click();
      const q0 = S().locator('.set-q').nth(0);
      if (await q0.locator('button.opt[data-act=pick]').count()) await q0.locator('button.opt[data-act=pick]').first().click();
      else { await q0.locator('.tita input').fill('1'); await q0.locator('[data-act=tita]').click(); }
      await S().locator('.set-q').nth(1).locator('[data-act=reveal]').click();
      if ((await S().locator('.set-head [data-act=t-start]').innerText()).trim() !== 'Resume') fail('set timer not paused by Show solution');
      if (!(await S().locator('.set-q').nth(1).locator('.chip.skip').count())) fail('set question not skipped');
      await S().locator('[data-act=setsol]').click();
      if (!/^Took /.test((await S().locator('.set-head .ptimer').innerText()).trim())) fail('set timer not stopped by set explanation');
      const nq = await S().locator('.set-q').count();
      if (await S().locator('.set-q .chip.skip').count() !== nq - 1) fail('remaining set questions not skipped');
      if (await cell('DILR', 'skipped') !== String(nq - 1)) fail('DILR skipped count');
    });
  },
  async practiceTimerEdges() {
    await withPage(async page => {
      await page.goto(BASE + '#practice');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.click('[data-act=sec][data-sec=QA]');
      const id1 = (await page.locator('.list > article.card').nth(0).getAttribute('id')).slice(2);
      const btn = () => page.locator(`#c-${id1} [data-act=t-start]`);
      const state = () => page.evaluate(id => (JSON.parse(localStorage.getItem('catpyq.times.v1') || '{}')[id] || {}).state, id1);
      // 1. card leaves the screen (section switch) -> the clock pauses
      await btn().click();
      await page.click('[data-act=sec][data-sec=VARC]');
      if (await state() !== 'paused') throw new Error('edges: section switch left the clock running');
      await page.click('[data-act=sec][data-sec=QA]');
      if ((await btn().innerText()).trim() !== 'Resume') throw new Error('edges: no Resume after section switch');
      // 2. page hidden (app/tab switch) -> pauses and shows Resume
      await btn().click();
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'});
        document.dispatchEvent(new Event('visibilitychange'));
      });
      if (await state() !== 'paused') throw new Error('edges: hidden page left the clock running');
      if ((await btn().innerText()).trim() !== 'Resume') throw new Error('edges: no Resume after hiding');
      if (await page.locator('[data-timer]').count()) throw new Error('edges: a running display is left on screen');
      // 3. Done only appears once a question in the set is answered
      await page.reload();
      await page.click('[data-act=sec][data-sec=DILR]');
      const head = () => page.locator('.list > article.card.set').first().locator('.set-head');
      await head().locator('[data-act=t-start]').click();
      if (await head().locator('[data-act=t-done]').count()) throw new Error('edges: Done shown before any answer');
      await page.locator('.list > article.card.set').first().locator('.set-q').first().locator('button.opt[data-act=pick]').first().click();
      if (!(await head().locator('[data-act=t-done]').count())) throw new Error('edges: no Done after an answer');
    });
  },
  async practiceStats() {
    await withPage(async page => {
      await page.goto(BASE + '#practice');
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('catpyq.times.v1', '{}'); });
      await page.reload();
      await page.click('[data-act=sec][data-sec=QA]');
      const cell = (sec, k) => page.locator(`#secstats tr[data-sec=${sec}] [data-k=${k}]`).innerText().then(t => t.trim());
      const eq = async (sec, k, want) => {
        const got = await cell(sec, k);
        if (want instanceof RegExp ? !want.test(got) : got !== want) throw new Error(`practiceStats ${sec}.${k}: got "${got}"`);
      };
      await eq('QA', 'attempted', '0');
      await eq('QA', 'time', '—');
      const cards = page.locator('.list > article.card');
      const id1 = (await cards.nth(0).getAttribute('id')).slice(2), id2 = (await cards.nth(1).getAttribute('id')).slice(2);
      await page.locator(`#c-${id1} [data-act=t-start]`).click();
      await page.waitForTimeout(1200);
      await page.locator(`#c-${id1} button.opt[data-act=pick]`).first().click();
      await eq('QA', 'attempted', '1');
      await eq('QA', 'time', /^0:0[1-3] \/ question$/);
      await eq('Total', 'attempted', '1');
      const t1 = await cell('QA', 'time');
      await page.locator(`#c-${id2} button.opt[data-act=pick]`).first().click();
      await eq('QA', 'attempted', '2');
      await eq('QA', 'time', t1);
      // a DILR set timed and finished with Done
      await page.click('[data-act=sec][data-sec=DILR]');
      const set = page.locator('.list > article.card.set').first();
      await set.locator('.set-head [data-act=t-start]').click();
      await set.locator('.set-q').first().locator('button.opt[data-act=pick]').first().click();
      await page.locator('.list > article.card.set').first().locator('.set-head [data-act=t-done]').click();
      await eq('DILR', 'time', / \/ set · .* \/ question$/);
      await eq('DILR', 'attempted', '1');
    });
  },
  async practiceTimer() {
    await withPage(async page => {
      await page.goto(BASE + '#practice');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.click('[data-act=sec][data-sec=QA]');
      const cards = page.locator('.list > article.card');
      const c1 = cards.nth(0), c2 = cards.nth(1);
      const id1 = (await c1.getAttribute('id')).slice(2), id2 = (await c2.getAttribute('id')).slice(2);
      const timesOf = () => page.evaluate(() => JSON.parse(localStorage.getItem('catpyq.times.v1') || '{}'));
      const want = async (loc, re, what) => {
        const t = (await loc.innerText()).trim();
        if (!re.test(t)) throw new Error(`practiceTimer ${what}: got "${t}"`);
      };
      // start, tick
      await c1.locator('[data-act=t-start]').click();
      await page.waitForTimeout(1300);
      await want(page.locator(`[data-timer="${id1}"]`), /^0:0[1-2]$/, 'running');
      // starting another pauses the first
      await c2.locator('[data-act=t-start]').click();
      await want(c1.locator('[data-act=t-start]'), /^Resume$/, 'paused button');
      await want(c1.locator('.ptime'), /^0:0[1-2]$/, 'paused time');
      // answering stops it
      await c2.locator('button.opt[data-act=pick]').first().click();
      await want(page.locator(`#c-${id2} .ptimer`), /^Took 0:0\d$/, 'took');
      if (await page.locator('[data-timer]').count()) throw new Error('practiceTimer: a clock still runs');
      // reload while running -> paused
      await page.locator(`#c-${id1} [data-act=t-start]`).click();
      await page.reload();
      await want(page.locator(`#c-${id1} [data-act=t-start]`), /^Resume$/, 'after reload');
      if ((await timesOf())[id1].state !== 'paused') throw new Error('practiceTimer: not saved as paused');
      // retry clears the time of a single question
      await page.locator(`#c-${id2} [data-act=retry]`).click();
      await want(page.locator(`#c-${id2} [data-act=t-start]`), /^Start timer$/, 'after retry');
      if ((await timesOf())[id2]) throw new Error('practiceTimer: retry kept the time');
      // leaving Practice pauses
      await page.locator(`#c-${id2} [data-act=t-start]`).click();
      await page.goto(BASE + '#home');
      await page.waitForSelector('#home-QA');
      await page.goto(BASE + '#practice');
      await want(page.locator(`#c-${id2} [data-act=t-start]`), /^Resume$/, 'after leaving');
      // a DILR set: one timer, Done
      await page.click('[data-act=sec][data-sec=DILR]');
      const set = page.locator('.list > article.card.set').first();
      await set.locator('.set-head [data-act=t-start]').click();
      await set.locator('.set-q').first().locator('button.opt[data-act=pick]').first().click();
      await set.locator('.set-head [data-act=t-done]').click();
      await want(page.locator('.list > article.card.set').first().locator('.set-head .ptimer'), /^Took \d+:\d\d$/, 'set done');
    });
  },
  async calculator() {
    await withPage(async page => {
      await page.setViewportSize({width: 1280, height: 800});
      await page.goto(BASE + '#practice');
      await page.click('#calc-toggle');
      const val = () => page.locator('#calc-val').innerText();
      for (const k of ['1', '2', '+', '3', '=']) await page.click(`#calc [data-key="${k}"]`);
      if (await val() !== '15') throw new Error('clicks gave ' + await val());
      await page.keyboard.type('6*7');
      await page.keyboard.press('Enter');
      if (await val() !== '42') throw new Error('keyboard gave ' + await val());
      // typing into the calculator must not leak into the page
      if (await page.locator('#calc').evaluate(el => !el.contains(document.activeElement))) throw new Error('focus left the calculator');
      const head = page.locator('#calc .calc-head');
      const a = await head.boundingBox();
      await page.mouse.move(a.x + 40, a.y + 10);
      await page.mouse.down();
      await page.mouse.move(a.x - 260, a.y + 210, {steps: 6});
      await page.mouse.up();
      const b = await head.boundingBox();
      if (Math.abs(b.x - (a.x - 300)) > 2 || Math.abs(b.y - (a.y + 200)) > 2) throw new Error(`drag: ${a.x},${a.y} -> ${b.x},${b.y}`);
      await page.keyboard.press('Escape');
      if (await page.locator('#calc').isVisible()) throw new Error('Escape did not close');
      await page.reload();
      await page.click('#calc-toggle');
      const c = await head.boundingBox();
      if (Math.abs(c.x - b.x) > 2 || Math.abs(c.y - b.y) > 2) throw new Error('position not remembered');
      // dragging off-screen is clamped inside the window
      await page.mouse.move(c.x + 40, c.y + 10); await page.mouse.down();
      await page.mouse.move(5000, 5000, {steps: 4}); await page.mouse.up();
      const d = await page.locator('#calc').boundingBox();
      if (d.x + d.width > 1280 || d.y + d.height > 800) throw new Error('not clamped');
      // the button is also there during a timed test
      await page.goto(BASE + '#home');
      await page.locator('[data-act=start-test]').first().click();
      await page.waitForSelector('#t-timer');
      if (!(await page.locator('#calc-toggle').isVisible())) throw new Error('no calculator in timed test');
    });
  },
  async practiceAnswersMcq() {
    await withPage(async page => {
      await page.goto(BASE + '#practice');
      await page.click('[data-act=sec][data-sec=QA]');
      await page.locator('button.opt[data-act=pick]:not([disabled])').first().click();
      await page.waitForSelector('.chip.ok, .chip.bad', {timeout: 5000});
    });
  },
  async practiceStaleFilters() {
    await withPage(async page => {
      await page.goto(BASE);
      await page.evaluate(() => localStorage.setItem('catpyq.filters.v2',
        JSON.stringify({section: 'QA', topics: ['No Such Topic', 'Averages'], papers: ['ghost-paper'], status: 'all'})));
      await page.goto(BASE + '#practice');
      await page.reload();
      const q = await page.locator('#tally [data-k=questions] b').innerText();
      const lbl = (await page.locator('#f-topics').innerText()).trim();
      const pl = (await page.locator('#f-papers').innerText()).trim();
      if (q !== '24') throw new Error('stale: questions ' + q);
      if (lbl !== 'Averages') throw new Error('stale: topic label ' + lbl);
      if (pl !== 'All papers') throw new Error('stale: paper label ' + pl);
    });
  },
  async practiceMulti() {
    await withPage(async page => {
      await page.goto(BASE + '#practice');
      await page.click('[data-act=sec][data-sec=QA]');
      await page.click('#f-topics');
      await page.check('#f-topics-panel input[value="Percentages & Profit-Loss"]');
      await page.check('#f-topics-panel input[value="Averages"]');
      await page.keyboard.press('Escape');
      const val = n => page.locator('#tally [data-k=' + n + '] b').innerText();
      const eq = async (n, want) => {
        const got = await val(n);
        if (got !== want) throw new Error(`tally ${n}: expected ${want}, got ${got}`);
      };
      await eq('questions', '64');
      const card = page.locator('.list > *').first();
      await card.locator('button.opt[data-act=pick]').first().click();
      await page.waitForSelector('.chip.ok, .chip.bad', {timeout: 5000});
      if (await card.locator('.chip.ok').count()) { // first option was right: retry with the last one
        await card.locator('[data-act=retry]').click();
        await card.locator('button.opt[data-act=pick]').last().click();
        await card.locator('.chip.bad').waitFor();
      }
      await eq('attempted', '1'); await eq('wrong', '1');
      await eq('notAttempted', '63'); await eq('accuracy', '0%');
    });
  },
  async practiceReset() {
    await withPage(async page => {
      await page.goto(BASE + '#practice');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.click('[data-act=sec][data-sec=QA]');
      await page.click('#f-topics');
      await page.check('#f-topics-panel input[value="Averages"]');
      await page.keyboard.press('Escape');
      const val = n => page.locator('#tally [data-k=' + n + '] b').innerText();
      if (!(await page.locator('#reset-sel button').isDisabled())) throw new Error('reset: enabled with nothing attempted');
      await page.locator('.list button.opt[data-act=pick]').first().click();
      await page.waitForSelector('.chip.ok, .chip.bad', {timeout: 5000});
      if ((await val('attempted')) !== '1') throw new Error('reset: attempted not 1 before reset');
      await page.click('#reset-sel button[data-act=ask-reset-sel]');
      await page.click('#reset-sel button[data-act=do-reset-sel]');
      await page.waitForFunction(() => document.querySelector('#tally [data-k=attempted] b').textContent === '0');
      if ((await val('correct')) !== '0' || (await val('wrong')) !== '0') throw new Error('reset: correct/wrong not 0');
      if ((await val('notAttempted')) !== '24') throw new Error('reset: not attempted ' + await val('notAttempted'));
      if (await page.locator('.list .chip.ok, .list .chip.bad').count()) throw new Error('reset: a card still shows a result');
    });
  },
  async homeLayout() {
    await withPage(async page => {
      await page.goto(BASE + '#home');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.waitForSelector('#home-QA');
      if (await page.locator('.stats').count()) throw new Error('home: .stats present');
      for (const s of ['QA', 'DILR', 'VARC']) if (!(await page.locator('#home-' + s).count())) throw new Error('missing #home-' + s);
      const box = page.locator('.pbox', {hasText: 'Slot 1'}).filter({hasText: '2023'});
      const texts = await box.locator('button[data-act=start-test]').allInnerTexts();
      if (texts.join('|') !== 'Complete test|VARC test|DILR test|QA test') throw new Error('buttons: ' + texts.join('|'));
      const kinds = await box.locator('button[data-act=start-test]').evaluateAll(b => b.map(x => x.dataset.kind + ':' + x.dataset.paper));
      if (kinds.join('|') !== 'full:2023-1|VARC:2023-1|DILR:2023-1|QA:2023-1') throw new Error('kinds: ' + kinds.join('|'));
      const href = await box.locator('a', {hasText: 'Practise untimed'}).getAttribute('href');
      if (href !== '#paper-2023-1') throw new Error('untimed href ' + href);
      if (await page.locator('nav a', {hasText: 'Add questions'}).count()) throw new Error('nav has Add questions');
      const navTexts = (await page.locator('nav a').allInnerTexts()).join('|');
      if (navTexts !== 'Practice|Full papers') throw new Error('nav: ' + navTexts);
      if (await box.locator('.last-result').count()) throw new Error('last result shown without data');
      await page.evaluate(() => localStorage.setItem('catpyq.result.2023-1.full', JSON.stringify({score: {total: 92, max: 198}, finishedAt: 1})));
      await page.reload();
      await page.waitForSelector('#home-QA');
      const lr = (await box.innerText());
      if (!lr.includes('Last full test: 92 / 198')) throw new Error('last result missing: ' + lr);
      // one link per kind with a result, newest first, under the test buttons, each opening its review
      await page.evaluate(() => localStorage.setItem('catpyq.result.2023-1.QA', JSON.stringify({score: {total: 12, max: 66}, finishedAt: 0})));
      await page.reload();
      await page.waitForSelector('#home-QA');
      const links = await box.locator('a.last-result').evaluateAll(as => as.map(a => a.getAttribute('href') + '=' + a.textContent.trim()));
      if (links.join('|') !== '#review-2023-1-full=Last full test: 92 / 198|#review-2023-1-QA=Last QA test: 12 / 66')
        throw new Error('last result links: ' + links.join('|'));
      const below = await box.evaluate(b => !!(b.querySelector('.tests').compareDocumentPosition(b.querySelector('.last-result')) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (!below) throw new Error('last result is not under the buttons');
      await page.selectOption('#home-QA', 'Averages');
      await page.waitForSelector('#tally');
      if (!page.url().endsWith('#practice')) throw new Error('url ' + page.url());
      const q = await page.locator('#tally [data-k=questions] b').innerText();
      if (q !== '24') throw new Error('tally questions ' + q);
      await page.goto(BASE + '#add');
      await page.reload();
      await page.waitForSelector('#home-QA');
    });
  },
  async timedFlow() {
    await withPage(async page => {
      const eq = (what, got, want) => { if (got !== want) throw new Error(`timedFlow ${what}: expected ${want}, got ${got}`); };
      const PROG = JSON.stringify({sentinel: {v: 1, ok: true}});
      await page.goto(BASE + '#home');
      await page.evaluate(p => { localStorage.clear(); localStorage.setItem('catpyq.progress.v1', p); }, PROG);
      await page.reload();
      const box = page.locator('.pbox', {hasText: 'Slot 1'}).filter({hasText: '2023'});
      await box.locator('button[data-act=start-test][data-kind=full]').click();
      await page.waitForSelector('#tscreen');
      eq('url', page.url().split('#')[1], 'test-2023-1-full');
      const active = () => page.locator('.t-strip .active').innerText();
      eq('active section', await active(), 'VARC');
      const t0 = (await page.locator('#t-timer').innerText()).trim();
      if (!/^(40:00|39:5\d)$/.test(t0)) throw new Error('timedFlow timer start ' + t0);
      await page.waitForFunction(t => document.getElementById('t-timer').textContent.trim() !== t, t0, {timeout: 4000});
      const pal = page.locator('#t-palette button');
      eq('VARC palette', await pal.count(), 24);
      await page.locator('#t-q button.opt[data-act=t-pick][data-v="1"]').click();
      await page.click('[data-act=t-next]');
      await page.click('[data-act=t-mark]');
      await pal.nth(4).click();
      const states = async n => (await pal.evaluateAll((bs, n) => bs.slice(0, n).map(b => b.dataset.state), n)).join(',');
      eq('palette states', await states(5), 'answered,marked,not-visited,not-visited,not-answered');
      if (await page.locator('#tscreen .correct, #tscreen .wrong, #tscreen .solution, #tscreen [data-act=reveal]').count())
        throw new Error('timedFlow: correctness shown during test');
      const prog = () => page.evaluate(() => localStorage.getItem('catpyq.progress.v1'));
      eq('practice progress', await prog(), PROG);
      await page.reload();
      await page.waitForSelector('#tscreen');
      eq('active after reload', await active(), 'VARC');
      eq('states after reload', await states(5), 'answered,marked,not-visited,not-visited,not-answered');
      await page.click('[data-act=t-submit]');
      const conf = await page.locator('.t-confirm').innerText();
      if (!conf.includes("Submit VARC? You can't come back to it.")) throw new Error('timedFlow confirm text ' + conf);
      await page.click('[data-act=t-submit-yes]');
      await page.waitForFunction(() => (document.querySelector('.t-strip .active') || {}).textContent === 'DILR');
      eq('DILR palette', await pal.count(), 20);
      if (await page.locator('.t-strip button, .t-strip a, [data-act=t-back]').count()) throw new Error('timedFlow: a way back to VARC');
      await page.click('a.brand');
      await box.locator('button[data-act=start-test][data-kind=full]').click();
      await page.waitForSelector('.t-modal');
      const resume = await page.locator('.t-modal [data-act=t-resume]').innerText();
      if (!/DILR/.test(resume) || !/\d\d:\d\d/.test(resume)) throw new Error('timedFlow resume label ' + resume);
      if (!(await page.locator('.t-modal [data-act=t-cancel]').count())) throw new Error('timedFlow: no Cancel');
      await page.click('.t-modal [data-act=t-restart]');
      await page.waitForSelector('#tscreen');
      eq('active after restart', await active(), 'VARC');
      eq('fresh palette', await pal.count(), 24);
      const all = await pal.evaluateAll(bs => bs.map(b => b.dataset.state));
      eq('fresh states', all[0] + '|' + all.slice(1).every(s => s === 'not-visited'), 'not-answered|true');
      eq('practice progress at end', await prog(), PROG);
      // answer Q1 (B), submit all three sections -> review
      await page.locator('#t-q button.opt[data-act=t-pick][data-v="1"]').click();
      const want = await page.evaluate(() => { const q = Core.sectionQuestions(App.items, '2023-1', 'VARC')[0]; return Core.isCorrect(q, 1) ? 3 : -1; });
      for (let i = 0; i < 3; i++) {
        await page.click('[data-act=t-submit]');
        await page.click('[data-act=t-submit-yes]');
        if (i < 2) await page.waitForFunction(n => document.querySelector('.t-strip .active').textContent !== n, ['VARC', 'DILR'][i]);
      }
      await page.waitForSelector('.t-review h1');
      eq('review url', page.url().split('#')[1], 'review-2023-1-full');
      const sum = await page.locator('.t-review .r-summary').innerText();
      if (!sum.includes(`${want} / 198`)) throw new Error('timedFlow summary total ' + sum);
      const row = async s => (await page.locator(`.r-table tr[data-sec=${s}]`).innerText()).split(/\s+/).join(' ');
      const vt = (await row('VARC')).split(' ');
      const acc = want === 3 ? '100%' : '0%';
      if (vt[0] !== 'VARC' || vt[2] !== '/' || vt[3] !== '72' || vt[4] !== '1' || Number(vt[5]) + Number(vt[6]) !== 1 || vt[7] !== '23' || vt[8] !== acc || !/^\d\d:\d\d$/.test(vt[9])) throw new Error('timedFlow VARC row ' + vt.join(' '));
      for (const s of ['DILR', 'QA']) if (!(await row(s)).startsWith(s + ' 0 / ') || !(await row(s)).includes(' \u2014 ')) throw new Error('timedFlow ' + s + ' row ' + await row(s));
      const heads = (await page.locator('.r-table thead th').allInnerTexts()).map(t => t.trim().toLowerCase());
      eq('columns', heads.join('|'), 'section|score|attempted|correct|wrong|unanswered|accuracy|time used');
      const tot = (await page.locator('.r-table tfoot tr').innerText()).split(/\s+/);
      if (tot[0] !== 'Total' || tot[1] !== String(want) || tot[3] !== '198' || tot[4] !== '1' || Number(tot[5]) + Number(tot[6]) !== 1 || tot[7] !== '65' || tot[8] !== acc || !/^\d\d:\d\d$/.test(tot[9])) throw new Error('timedFlow total row ' + tot.join(' '));
      await page.click('.r-filters button[data-f=unanswered]');
      eq('unanswered count', await page.locator('.r-q:not([hidden])').count(), 65);
      const first = await page.locator('.r-q:not([hidden])').first().innerText();
      if (!first.includes('Not attempted') || !first.includes('Correct answer:')) throw new Error('timedFlow first unanswered ' + first.slice(0, 200));
      eq('pressed', await page.locator('.r-filters button[data-f=unanswered]').getAttribute('aria-pressed'), 'true');
      await page.click('.r-filters button[data-f=all]');
      eq('all count', await page.locator('.r-q:not([hidden])').count(), 66);
      await page.click('a.brand');
      const lastLink = page.locator('.pbox', {hasText: 'Slot 1'}).filter({hasText: '2023'}).locator('a.last-result');
      eq('last result', (await lastLink.innerText()).trim(), `Last full test: ${want} / 198`);
      // the review can be reopened from the paper box
      await lastLink.click();
      await page.waitForSelector('.t-review h1');
      eq('reopened review url', page.url().split('#')[1], 'review-2023-1-full');
      if (!(await page.locator('.t-review .r-summary').innerText()).includes(`${want} / 198`)) throw new Error('timedFlow: reopened review summary');
      // and from the test route once nothing is in progress
      await page.goto(BASE + '#test-2023-1-full');
      await page.waitForSelector('.t-panel');
      eq('view last review', await page.locator('.t-panel a', {hasText: 'View last review'}).getAttribute('href'), '#review-2023-1-full');
      // a damaged result gives a friendly panel, not a crash
      await page.evaluate(() => localStorage.setItem('catpyq.result.2023-1.full', '{"attempt":{"x":1},"score":"<img src=x onerror=alert(1)>"}'));
      await page.goto(BASE + '#review-2023-1-full');
      await page.reload();
      await page.waitForSelector('.t-review a[href="#papers"]');
      if (await page.locator('.r-q').count()) throw new Error('timedFlow: damaged result rendered questions');
    });
  },
  async timedTita() {
    await withPage(async page => {
      await page.goto(BASE + '#home');
      await page.waitForSelector('#home-QA');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.locator('.pbox', {hasText: 'Slot 1'}).filter({hasText: '2023'}).locator('button[data-act=start-test][data-kind=QA]').click();
      await page.waitForSelector('#tscreen');
      const tita = await page.evaluate(() => Core.sectionQuestions(App.items, '2023-1', 'QA').findIndex(q => q.type === 'TITA'));
      if (tita < 1) throw new Error('timedTita: no TITA question after index 0');
      const pal = page.locator('#t-palette button');
      const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('catpyq.attempt.2023-1.QA')));
      // typed (no Enter) then a palette click: the answer is saved AND the jump happens
      await pal.nth(tita).click();
      await page.fill('#t-tita', '42');
      await pal.nth(0).click();
      let a = await stored();
      const qid = await page.evaluate(i => Core.sectionQuestions(App.items, '2023-1', 'QA')[i].id, tita);
      if (a.answers[qid] !== '42') throw new Error('timedTita: answer not saved ' + JSON.stringify(a.answers));
      const cur = await page.locator('#t-palette button.cur').getAttribute('data-i');
      if (cur !== '0') throw new Error('timedTita: palette click lost, current index ' + cur);
      if (await pal.nth(tita).getAttribute('data-state') !== 'answered') throw new Error('timedTita: palette state not answered');
      // typed (no Enter) then Submit section: the answer is saved AND the confirm appears
      await pal.nth(tita).click();
      await page.fill('#t-tita', '43');
      await page.click('[data-act=t-submit]');
      if (!(await page.locator('.t-confirm').count())) throw new Error('timedTita: Submit click lost, no confirm');
      a = await stored();
      if (a.answers[qid] !== '43') throw new Error('timedTita: second answer not saved ' + JSON.stringify(a.answers));
    });
  },
  async timedExpiry() {
    await withPage(async page => {
      await page.goto(BASE + '#home');
      await page.waitForSelector('#home-QA');
      const seed = (kind, msLeft) => page.evaluate(([kind, msLeft]) => {
        localStorage.clear();
        const now = Date.now();
        const a = Core.createAttempt('2023-1', kind, now - Core.SECTION_MS + msLeft);
        localStorage.setItem('catpyq.attempt.2023-1.' + kind, JSON.stringify(a));
      }, [kind, msLeft]);
      // a section that expired while away is submitted on return
      await seed('full', -5000);
      await page.goto(BASE + '#test-2023-1-full');
      await page.reload();
      await page.waitForSelector('#tscreen');
      const active = await page.locator('.t-strip .active').innerText();
      if (active !== 'DILR') throw new Error('expiry: active ' + active);
      // the clock running out submits the section live (last section -> result + review)
      await seed('QA', 1500);
      await page.goto(BASE + '#test-2023-1-QA');
      await page.reload();
      await page.waitForSelector('#tscreen');
      await page.waitForFunction(() => location.hash === '#review-2023-1-QA', null, {timeout: 6000});
      await page.waitForSelector('.t-review h1');
      const st = await page.evaluate(() => ({
        a: localStorage.getItem('catpyq.attempt.2023-1.QA'),
        r: JSON.parse(localStorage.getItem('catpyq.result.2023-1.QA') || 'null')
      }));
      if (st.a !== null) throw new Error('expiry: attempt key not removed');
      if (!st.r || st.r.score.max !== 66 || st.r.score.total !== 0 || !st.r.attempt.finished || !st.r.finishedAt) throw new Error('expiry: result ' + JSON.stringify(st.r && st.r.score));
      const txt = await page.locator('.t-review').innerText();
      if (!txt.includes('0 / 66')) throw new Error('expiry: review text ' + txt);
      if (await page.locator('.r-table tfoot').count()) throw new Error('expiry: total row on a sectional test');
    });
  },
  async reviewSetExpl() {
    await withPage(async page => {
      await page.goto(BASE + '#home');
      await page.waitForSelector('#home-QA');
      await page.evaluate(() => {
        localStorage.clear();
        const now = Date.now(), a = Object.assign(Core.createAttempt('2022-1', 'DILR', now - 60000), {finished: true, submittedAt: [now]});
        const score = Core.scoreAttempt(a, {DILR: Core.sectionQuestions(App.items, '2022-1', 'DILR')});
        localStorage.setItem('catpyq.result.2022-1.DILR', JSON.stringify({attempt: a, score, finishedAt: now}));
      });
      await page.goto(BASE + '#review-2022-1-DILR');
      await page.waitForSelector('.t-review h1');
      // set 2022-1-s25 has a set solution and no per-question ones
      const q25 = page.locator('.r-q', {hasText: 'Q25 in the paper'});
      const sol = await q25.locator('.solution').innerText();
      if (/no worked explanation/.test(sol)) throw new Error('reviewSetExpl: Q25 claims no explanation: ' + sol);
      if (!/set explanation/i.test(sol)) throw new Error('reviewSetExpl: Q25 does not point to the set explanation: ' + sol);
      const det = q25.locator('details.r-setsol');
      if ((await det.locator('summary').innerText()).trim() !== 'Set explanation') throw new Error('reviewSetExpl: no Set explanation toggle');
      await det.locator('summary').click();
      await det.locator('img[src^="data:"]').waitFor({timeout: 5000});
      // a later question of the set carries it too (filters can hide the first)
      if (!(await page.locator('.r-q', {hasText: 'Q27 in the paper'}).locator('details.r-setsol').count())) throw new Error('reviewSetExpl: Q27 lacks it');
      // set 2022-1-s40 has no set solution
      if (await page.locator('.r-q', {hasText: 'Q40 in the paper'}).locator('details.r-setsol').count()) throw new Error('reviewSetExpl: Q40 has one');
    });
  },
  async storageBlocked() {
    await withPage(async page => {
      // every localStorage call throws, as with blocked site data or some private windows
      await page.addInitScript(() => {
        const deny = () => { throw new DOMException('denied', 'SecurityError'); };
        for (const m of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[m] = deny;
      });
      await page.goto(BASE + '#home');
      await page.waitForSelector('#home-QA');
      await page.locator('.pbox', {hasText: 'Slot 1'}).filter({hasText: '2023'}).locator('button[data-act=start-test][data-kind=QA]').click();
      await page.waitForSelector('#tscreen', {timeout: 5000});
      const note = await page.locator('#tscreen .t-nosave').innerText();
      if (!/can\u2019t save progress/.test(note)) throw new Error('storageBlocked: no warning, got ' + note);
      const pal = page.locator('#t-palette button');
      await page.locator('#t-q button.opt[data-act=t-pick][data-v="0"]').first().click();
      await page.click('[data-act=t-next]');
      const st = await pal.evaluateAll(bs => bs.slice(0, 2).map(b => b.dataset.state).join(','));
      if (st !== 'answered,not-answered') throw new Error('storageBlocked: palette ' + st);
      await page.click('[data-act=t-submit]');
      await page.click('[data-act=t-submit-yes]');
      await page.waitForSelector('.t-review h1');
      if (!(await page.locator('.r-table tr[data-sec=QA]').innerText()).split(/\s+/).includes('1')) throw new Error('storageBlocked: review row');
      // practice keeps working too
      await page.goto(BASE + '#practice');
      await page.click('[data-act=sec][data-sec=QA]');
      await page.locator('button.opt[data-act=pick]:not([disabled])').first().click();
      await page.waitForSelector('.chip.ok, .chip.bad', {timeout: 5000});
      // and so do practice timers (kept in memory)
      const c2 = page.locator('.list > article.card').nth(1), id2 = (await c2.getAttribute('id')).slice(2);
      await c2.locator('[data-act=t-start]').click();
      await page.locator(`#c-${id2} button.opt[data-act=pick]`).first().click();
      const took = (await page.locator(`#c-${id2} .ptimer`).innerText()).trim();
      if (!/^Took /.test(took)) throw new Error('storageBlocked: timer got ' + took);
    });
  },
  // Needs a PUBLIC build served at BASE_URL (e.g. BASE_URL=http://localhost:8766/ node tests/e2e/smoke.js publicBuild).
  // Skipped in the default run because the default BASE_URL serves the private build.
  async publicBuild() {
    await withPage(async page => {
      const bad = [];
      page.on('request', r => { if (/\/data\/(q|s)\//.test(r.url())) bad.push(r.url()); });
      await page.goto(BASE);
      await page.waitForSelector('#home-QA');
      const dilr = await page.evaluate(() => fetch('data/meta.json').then(r => r.json()).then(m => !!(m.features && m.features.dilr)));
      const box = page.locator('.pbox', {hasText: /CAT 2023.*Slot 1/});
      const btns = (await box.locator('.tests button').allInnerTexts()).map(t => t.trim());
      if (dilr) {
        // DILR retyped: everything is on, and set directions render from text + the site's own images.
        if (!(await page.locator('#home-DILR').count())) throw new Error('public: #home-DILR missing');
        if (btns.join('|') !== 'Complete test|VARC test|DILR test|QA test') throw new Error('public: buttons ' + btns.join('|'));
        await page.goto(BASE + '#practice');
        await page.click('[data-act=sec][data-sec=DILR]');
        await page.waitForSelector('.set .directions');
        const dirImgs = await page.$$eval('.set .directions img', els => els.map(e => e.getAttribute('src')));
        if (dirImgs.some(s => !/^data\/dimg\//.test(s))) throw new Error('public: directions image src ' + dirImgs.join(', '));
        // Lazy images only load once on screen: scroll to the first set that has one, then wait (bounded) for it.
        const firstImg = page.locator('.set .directions img').first();
        await firstImg.scrollIntoViewIfNeeded();
        await page.waitForFunction(el => el.complete && el.naturalWidth > 0, await firstImg.elementHandle(), {timeout: 10000})
          .catch(() => { throw new Error('public: first directions image did not load'); });
      } else {
        if (await page.locator('#home-DILR').count()) throw new Error('public: #home-DILR present');
        if (btns.join('|') !== 'VARC test|QA test') throw new Error('public: buttons ' + btns.join('|'));
        await page.goto(BASE + '#test-2023-1-full');
        await page.waitForSelector('.t-panel');
        if (!(await page.locator('.t-panel').innerText()).includes('isn\u2019t available yet')) throw new Error('public: full route panel');
      }
      await page.goto(BASE + '#practice');
      await page.click('[data-act=sec][data-sec=QA]');
      if (!dilr && await page.locator('[data-act=sec][data-sec=DILR]').count()) throw new Error('public: DILR section switch');
      await page.locator('[data-act=reveal]').first().click();
      await page.waitForSelector('.solution .expl, .solution .empty-note');
      // Either an explanation has been written (it renders from data/x/ as real text) or the placeholder shows.
      await page.waitForFunction(() => {
        const s = document.querySelector('.solution'); if (!s) return false;
        const ex = s.querySelector('.expl');
        return /Explanation coming soon/.test(s.innerText) || (ex && ex.innerText.trim().length > 20);
      });
      await page.goto(BASE + '#paper-2023-1');
      await page.waitForSelector('.seg');
      if (!dilr && await page.locator('[data-act=psec][data-sec=DILR]').count()) throw new Error('public: paper DILR tab');
      if (await page.locator('details.orig').count()) throw new Error('public: original-paper link');
      if (bad.length) throw new Error('public: image requests ' + bad.join(', '));
    });
  },
  // Builds its own PUBLIC site (work/build_data.py --public --expl-dir <temp>) with a sample explanation
  // for one QA question and one VARC set, serves it on PUBLIC_EXPL_PORT (default 8767) and checks the
  // x/ render path: a failed fetch is not cached, the text renders, MathJax typesets $$x^2$$
  // (set MATHJAX_LOCAL when offline). Skipped in the default run, like publicBuild.
  async publicExpl() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catpyq-expl-'));
    const site = path.join(tmp, 'site'), ex = path.join(tmp, 'x');
    const port = process.env.PUBLIC_EXPL_PORT || '8767', PUB = `http://127.0.0.1:${port}/`;
    let server = null;
    try {
      fs.mkdirSync(site); fs.mkdirSync(ex);
      fs.cpSync(path.join(ROOT, 'js'), path.join(site, 'js'), {recursive: true});
      // the same document skeleton tools/sync_public.sh adds
      fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
        '<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n</head>\n<body>\n' +
        fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') + '\n</body>\n</html>\n');
      const build = (...a) => execFileSync('python3', ['-I', path.join(ROOT, 'work', 'build_data.py'), path.join(site, 'data'), '--public', ...a], {stdio: 'pipe'});
      build();
      const items = JSON.parse(fs.readFileSync(path.join(site, 'data', 'meta.json'), 'utf8')).items;
      const qa = items.filter(u => u.paper === '2023-1' && u.section === 'QA').sort((a, b) => a.n - b.n)[0];
      const rc = items.find(u => u.paper === '2023-1' && u.section === 'VARC' && u.kind === 'set');
      fs.writeFileSync(path.join(ex, '2023-1-QA.json'), JSON.stringify({[qa.id]: '<p>zqSample: square it, $$x^2$$.</p>'}));
      fs.writeFileSync(path.join(ex, '2023-1-VARC.json'), JSON.stringify({[rc.id]: '<p>zqSetSample: how to crack the passage.</p>'}));
      build('--expl-dir', ex);
      server = spawn('python3', ['-m', 'http.server', port, '--bind', '127.0.0.1'], {cwd: site, stdio: 'ignore'});
      for (let i = 0; ; i++) {
        try { if ((await fetch(PUB + 'data/meta.json')).ok) break; } catch (e) { if (i > 50) throw e; }
        await new Promise(r => setTimeout(r, 100));
      }
      await withPage(async page => {
        let fails = 1;
        await page.route('**/data/x/2023-1-QA.json', r => (fails-- > 0 ? r.abort() : r.continue()));
        await page.goto(PUB + '#paper-2023-1');
        await page.click(`[data-act=reveal][data-q="${qa.id}"]`);
        const sol = page.locator(`#c-${qa.id} .solution`);
        await sol.locator('text=Couldn\u2019t load the explanation. Check your connection and reopen it.').waitFor({timeout: 5000});
        // reopening fetches again: the failure was not cached
        await page.goto(PUB + '#home');
        await page.waitForSelector('#home-QA');
        await page.goto(PUB + '#paper-2023-1');
        await sol.locator('.expl', {hasText: 'zqSample'}).waitFor({timeout: 5000});
        await sol.locator('.expl mjx-container').waitFor({timeout: 10000});
        // the review shows the VARC set explanation
        await page.evaluate(() => {
          const now = Date.now(), a = Object.assign(Core.createAttempt('2023-1', 'VARC', now - 60000), {finished: true, submittedAt: [now]});
          const score = Core.scoreAttempt(a, {VARC: Core.sectionQuestions(App.items, '2023-1', 'VARC')});
          localStorage.setItem('catpyq.result.2023-1.VARC', JSON.stringify({attempt: a, score, finishedAt: now}));
        });
        await page.goto(PUB + '#review-2023-1-VARC');
        const det = page.locator('.r-q details.r-setsol').first();
        await det.locator('summary').click();
        await det.locator('.expl', {hasText: 'zqSetSample'}).waitFor({timeout: 5000});
      });
    } finally {
      if (server) server.kill();
      fs.rmSync(tmp, {recursive: true, force: true});
    }
  },
};

(async () => {
  const names = process.argv[2] ? [process.argv[2]] : Object.keys(checks).filter(n => n !== 'publicBuild' && n !== 'publicExpl');
  for (const n of names) {
    if (!checks[n]) throw new Error('unknown check ' + n);
    await checks[n]();
  }
  console.log('smoke ok');
})().catch(e => { console.error(e); process.exit(1); });
