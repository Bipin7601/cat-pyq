// Usage: node tests/e2e/smoke.js [checkName]   (does not start a server)
const {chromium} = require('playwright');
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
      if (navTexts !== 'Home|Practice by topic|Full papers') throw new Error('nav: ' + navTexts);
      if (await box.locator('.last-result').count()) throw new Error('last result shown without data');
      await page.evaluate(() => localStorage.setItem('catpyq.result.2023-1.full', JSON.stringify({score: {total: 92, max: 198}, finishedAt: 1})));
      await page.reload();
      await page.waitForSelector('#home-QA');
      const lr = (await box.innerText());
      if (!lr.includes('Last full test: 92 / 198')) throw new Error('last result missing: ' + lr);
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
      if (vt[0] !== 'VARC' || vt[2] !== '/' || vt[3] !== '72' || vt[4] !== '1' || Number(vt[5]) + Number(vt[6]) !== 1 || vt[7] !== '23') throw new Error('timedFlow VARC row ' + vt.join(' '));
      for (const s of ['DILR', 'QA']) if (!(await row(s)).startsWith(s + ' 0 / ')) throw new Error('timedFlow ' + s + ' row ' + await row(s));
      await page.click('.r-filters button[data-f=unanswered]');
      eq('unanswered count', await page.locator('.r-q:not([hidden])').count(), 65);
      const first = await page.locator('.r-q:not([hidden])').first().innerText();
      if (!first.includes('Not attempted') || !first.includes('Correct answer:')) throw new Error('timedFlow first unanswered ' + first.slice(0, 200));
      eq('pressed', await page.locator('.r-filters button[data-f=unanswered]').getAttribute('aria-pressed'), 'true');
      await page.click('.r-filters button[data-f=all]');
      eq('all count', await page.locator('.r-q:not([hidden])').count(), 66);
      await page.click('a.brand');
      const last = await page.locator('.pbox', {hasText: 'Slot 1'}).filter({hasText: '2023'}).locator('.last-result').innerText();
      eq('last result', last, `Last full test: ${want} / 198`);
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
      if (await page.locator('#home-DILR').count()) throw new Error('public: #home-DILR present');
      const box = page.locator('.pbox', {hasText: /CAT 2023.*Slot 1/});
      const btns = (await box.locator('.tests button').allInnerTexts()).map(t => t.trim());
      if (btns.join('|') !== 'VARC test|QA test') throw new Error('public: buttons ' + btns.join('|'));
      await page.goto(BASE + '#test-2023-1-full');
      await page.waitForSelector('.t-panel');
      if (!(await page.locator('.t-panel').innerText()).includes('isn\u2019t available yet')) throw new Error('public: full route panel');
      await page.goto(BASE + '#practice');
      await page.click('[data-act=sec][data-sec=QA]');
      if (await page.locator('[data-act=sec][data-sec=DILR]').count()) throw new Error('public: DILR section switch');
      await page.locator('[data-act=reveal]').first().click();
      await page.waitForSelector('.solution .expl, .solution .empty-note');
      await page.waitForFunction(() => /Explanation coming soon/.test(document.querySelector('.solution').innerText));
      await page.goto(BASE + '#paper-2023-1');
      await page.waitForSelector('.seg');
      if (await page.locator('[data-act=psec][data-sec=DILR]').count()) throw new Error('public: paper DILR tab');
      if (await page.locator('details.orig').count()) throw new Error('public: original-paper link');
      if (bad.length) throw new Error('public: image requests ' + bad.join(', '));
    });
  },
};

(async () => {
  const names = process.argv[2] ? [process.argv[2]] : Object.keys(checks).filter(n => n !== 'publicBuild');
  for (const n of names) {
    if (!checks[n]) throw new Error('unknown check ' + n);
    await checks[n]();
  }
  console.log('smoke ok');
})().catch(e => { console.error(e); process.exit(1); });
