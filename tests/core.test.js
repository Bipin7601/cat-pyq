const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');

test('isCorrect MCQ', () => {
  const q = {type: 'MCQ', answer: 2};
  assert.equal(Core.isCorrect(q, 2), true);
  assert.equal(Core.isCorrect(q, '2'), true);
  assert.equal(Core.isCorrect(q, 1), false);
});

test('isCorrect TITA normalisation', () => {
  const t = a => ({type: 'TITA', answer: a});
  assert.equal(Core.isCorrect(t('3142'), ' 3142 '), true);
  assert.equal(Core.isCorrect(t('1:1'), '1 : 1'), true);
  assert.equal(Core.isCorrect(t('20'), '20.0'), true);
  assert.equal(Core.isCorrect(t('20'), '21'), false);
  assert.equal(Core.isCorrect(t('4123'), '4132'), false);
});

test('normalizeFilters v1 migration', () => {
  assert.deepEqual(
    Core.normalizeFilters({section: 'QA', topic: 'Averages', paper: '2023-1', status: 'wrong'}),
    {section: 'QA', topics: ['Averages'], papers: ['2023-1'], status: 'wrong'});
  assert.deepEqual(Core.normalizeFilters(null), {section: 'QA', topics: [], papers: [], status: 'all'});
  assert.equal(Core.normalizeFilters({section: 'XYZ'}).section, 'QA');
});

const U = (id, topic, paper, n) => ({id, kind: 'single', section: 'QA', topic, paper, n, type: 'MCQ', answer: 1});
const units = [U('a', 'A', '2024-1', 1), U('b', 'B', '2023-1', 2), U('c', 'A', '2023-1', 1), U('d', 'C', '2024-1', 2)];

test('filterUnits multi-select', () => {
  const base = {section: 'QA', topics: [], papers: [], status: 'all'};
  assert.equal(Core.filterUnits(units, {...base, topics: ['A', 'C']}, {}).length, 3);
  assert.equal(Core.filterUnits(units, {...base, topics: ['A', 'C'], papers: ['2023-1']}, {}).length, 1);
  assert.deepEqual(Core.filterUnits(units, base, {}).map(u => u.id), ['a', 'd', 'c', 'b']);
});

test('filterUnits status', () => {
  const set = {id: 's', kind: 'set', section: 'QA', topic: 'A', paper: '2024-1', n: 1,
    questions: [{id: 's1'}, {id: 's2'}, {id: 's3'}]};
  const f = status => ({section: 'QA', topics: [], papers: [], status});
  const progress = {s1: {v: 1, ok: true}, s2: {v: 2, ok: false}};
  assert.equal(Core.filterUnits([set], f('wrong'), progress).length, 1);
  assert.equal(Core.filterUnits([set], f('new'), progress).length, 1);
  const all = {...progress, s3: {v: 1, ok: true}};
  assert.equal(Core.filterUnits([set], f('new'), all).length, 0);
});

test('tally', () => {
  const us = [
    {id: 'x', kind: 'set', questions: [{id: 'x1'}, {id: 'x2'}, {id: 'x3'}]},
    {id: 'y'}, {id: 'z'}];
  const p = {x1: {ok: true}, x2: {ok: true}, y: {ok: false}};
  assert.deepEqual(Core.tally(us, p),
    {questions: 5, attempted: 3, correct: 2, wrong: 1, notAttempted: 2, accuracy: 2 / 3});
  assert.equal(Core.tally(us, {}).accuracy, null);
});

// ---- Task 4: timed attempt engine ----
const MIN = 60000;
const T0 = 1000000;

test('createAttempt full and single section', () => {
  const a = Core.createAttempt('2023-1', 'full', T0);
  assert.deepEqual(a.sections, ['VARC', 'DILR', 'QA']);
  assert.equal(a.deadline, T0 + 2400000);
  assert.equal(a.secIndex, 0);
  assert.equal(a.current, null);
  assert.equal(a.startedAt, T0);
  assert.equal(a.finished, false);
  assert.deepEqual(Core.createAttempt('2023-1', 'QA', T0).sections, ['QA']);
});

test('submitSection advances and finishes', () => {
  const a = Core.createAttempt('p', 'full', T0);
  const t2 = T0 + 10 * MIN;
  const b = Core.submitSection(a, t2);
  assert.equal(b.secIndex, 1);
  assert.equal(b.deadline, t2 + 2400000);
  assert.equal(b.submittedAt[0], t2);
  const c = Core.submitSection(Core.submitSection(b, t2 + 1), t2 + 2);
  assert.equal(c.finished, true);
  assert.equal(Core.remainingMs(c, t2 + 3), 0);
});

test('submitSection does not mutate input', () => {
  const a = Core.createAttempt('p', 'full', T0);
  const snap = JSON.stringify(a);
  Core.submitSection(a, T0 + 5);
  assert.equal(JSON.stringify(a), snap);
});

test('applyTime one expiry', () => {
  const a = Core.createAttempt('p', 'full', T0);
  const b = Core.applyTime(a, a.deadline + 1);
  assert.equal(b.secIndex, 1);
  assert.equal(b.deadline, a.deadline + 2400000);
  assert.equal(b.submittedAt[0], a.deadline);
  assert.equal(Core.applyTime(a, a.deadline - 1).secIndex, 0);
});

test('applyTime after being away (VARC and DILR expired)', () => {
  const a = Core.createAttempt('p', 'full', T0);
  // 80 min + 1ms: both earlier sections expired, QA has 2399999 ms left
  const b = Core.applyTime(a, T0 + 4800001);
  assert.equal(b.secIndex, 2);
  assert.equal(b.finished, false);
  assert.equal(Core.remainingMs(b, T0 + 4800001), 2399999);
  // 90 min + 1ms: chained deadlines leave 1799999 ms
  const c = Core.applyTime(a, T0 + 5400001);
  assert.equal(c.secIndex, 2);
  assert.equal(Core.remainingMs(c, T0 + 5400001), 1799999);
});

test('applyTime past everything', () => {
  const a = Core.createAttempt('p', 'full', T0);
  const b = Core.applyTime(a, T0 + 7200001);
  assert.equal(b.finished, true);
  assert.equal(Core.remainingMs(b, T0 + 7200001), 0);
});

test('paletteState five states', () => {
  const a = {answers: {a1: 1, a2: 2, e: '  '}, marked: {a2: true, m: true}, visited: {v: true, e: true, a1: true}};
  assert.equal(Core.paletteState(a, 'x'), 'not-visited');
  assert.equal(Core.paletteState(a, 'v'), 'not-answered');
  assert.equal(Core.paletteState(a, 'e'), 'not-answered');
  assert.equal(Core.paletteState(a, 'a1'), 'answered');
  assert.equal(Core.paletteState(a, 'm'), 'marked');
  assert.equal(Core.paletteState(a, 'a2'), 'answered-marked');
});

test('sectionQuestions flattens and orders', () => {
  const us = [
    {id: 's1', kind: 'set', paper: 'p', section: 'DILR', n: 3, questions: [{id: 'q4', n: 4}, {id: 'q3', n: 3}]},
    {id: 'q1', kind: 'single', paper: 'p', section: 'DILR', n: 1, type: 'MCQ'},
    {id: 'z', kind: 'single', paper: 'other', section: 'DILR', n: 2},
    {id: 'y', kind: 'single', paper: 'p', section: 'QA', n: 2}
  ];
  const r = Core.sectionQuestions(us, 'p', 'DILR');
  assert.deepEqual(r.map(q => q.id), ['q1', 'q3', 'q4']);
  assert.deepEqual(r.map(q => q.unitId), ['q1', 's1', 's1']);
});

test('scoreAttempt marking', () => {
  const qs = [
    {id: 'a', type: 'MCQ', answer: 1}, {id: 'b', type: 'MCQ', answer: 1},
    {id: 'c', type: 'TITA', answer: '5'}, {id: 'd', type: 'TITA', answer: '7'},
    {id: 'e', type: 'MCQ', answer: 2}
  ];
  const a = {answers: {a: 1, b: 2, c: '6', d: '7'}};
  const r = Core.scoreAttempt(a, {QA: qs});
  assert.deepEqual(r.sections.QA, {score: 5, max: 15, attempted: 4, correct: 2, wrong: 2, unanswered: 1});
  assert.equal(r.total, 5);
  assert.equal(r.max, 15);
});

test('isAnswered', () => {
  for (const v of [undefined, null, "", "  "]) assert.equal(Core.isAnswered(v), false);
  for (const v of [0, "0", "3142"]) assert.equal(Core.isAnswered(v), true);
});

test('fmtDur', () => {
  assert.equal(Core.fmtDur(0), '0:00');
  assert.equal(Core.fmtDur(7999), '0:07');
  assert.equal(Core.fmtDur(108000), '1:48');
  assert.equal(Core.fmtDur(860000), '14:20');
  assert.equal(Core.fmtDur(3723000), '1:02:03');
});

test('timer start, elapsed, stop', () => {
  let r = Core.timerStart(null, {}, 'a', 1000);
  assert.deepEqual(r.clock, {unitId: 'a', startedAt: 1000, baseMs: 0});
  assert.equal(Core.timerElapsed(r.clock, r.times, 'a', 4000), 3000);
  r = Core.timerStop(r.clock, r.times, 'a', 6000);
  assert.equal(r.clock, null);
  assert.deepEqual(r.times.a, {ms: 5000, state: 'done'});
  assert.equal(Core.timerElapsed(null, r.times, 'a', 9999), 5000);
  assert.equal(Core.timerElapsed(null, r.times, 'zz', 9999), null);
});

test('starting another timer pauses the first; resume keeps time', () => {
  let r = Core.timerStart(null, {}, 'a', 0);
  r = Core.timerStart(r.clock, r.times, 'b', 2000);
  assert.deepEqual(r.times.a, {ms: 2000, state: 'paused'});
  assert.equal(r.clock.unitId, 'b');
  r = Core.timerStart(r.clock, r.times, 'a', 5000);
  assert.deepEqual(r.times.b, {ms: 3000, state: 'paused'});
  assert.deepEqual(r.clock, {unitId: 'a', startedAt: 5000, baseMs: 2000});
  assert.equal(Core.timerElapsed(r.clock, r.times, 'a', 6000), 3000);
});

test('timerPause and no-ops', () => {
  let r = Core.timerStart(null, {}, 'a', 0);
  r = Core.timerPause(r.clock, r.times, 1500);
  assert.equal(r.clock, null);
  assert.deepEqual(r.times.a, {ms: 1500, state: 'paused'});
  const same = Core.timerPause(null, r.times, 9);
  assert.equal(same.times, r.times);
  const done = {a: {ms: 10, state: 'done'}};
  assert.equal(Core.timerStart(null, done, 'a', 0).clock, null);
  assert.equal(Core.timerStop(null, {}, 'x', 0).times.x, undefined);
});

test('timerStop finishes a paused unit', () => {
  let r = Core.timerStart(null, {}, 'set1', 0);
  r = Core.timerStart(r.clock, r.times, 'q9', 4000);   // set1 paused at 4000
  r = Core.timerStop(r.clock, r.times, 'set1', 7000);
  assert.deepEqual(r.times.set1, {ms: 4000, state: 'done'});
  assert.equal(r.clock.unitId, 'q9', 'the running clock is untouched');
});

test('timer functions do not mutate inputs', () => {
  const times = {a: {ms: 5, state: 'paused'}};
  const clock = {unitId: 'b', startedAt: 0, baseMs: 0};
  Core.timerStart(clock, times, 'a', 10);
  assert.deepEqual(times, {a: {ms: 5, state: 'paused'}});
  assert.deepEqual(clock, {unitId: 'b', startedAt: 0, baseMs: 0});
});

test('clearTimes', () => {
  const times = {a: {ms: 5, state: 'done'}, b: {ms: 6, state: 'paused'}};
  let r = Core.clearTimes(null, times, ['a']);
  assert.deepEqual(Object.keys(r.times), ['b']);
  r = Core.clearTimes({unitId: 'c', startedAt: 0, baseMs: 0}, times, ['c']);
  assert.equal(r.clock, null, 'clearTimes stops the clock');
  r = Core.clearTimes({unitId: 'c', startedAt: 0, baseMs: 0}, times, ['a']);
  assert.equal(r.clock.unitId, 'c');
});

test('setFinished', () => {
  const s = {kind: 'set', questions: [{id: 'x1'}, {id: 'x2'}]};
  assert.equal(Core.setFinished(s, {x1: {v: 0, ok: true}}), false);
  assert.equal(Core.setFinished(s, {x1: {v: 0, ok: true}, x2: {v: 1, ok: false}}), true);
});

test('sectionStats', () => {
  const q = (id, sec) => ({id, kind: 'q', section: sec, type: 'MCQ', answer: 0});
  const units = [
    q('q1', 'QA'), q('q2', 'QA'), q('q3', 'QA'),
    {id: 'd1', kind: 'set', section: 'DILR', questions: [{id: 'd1a'}, {id: 'd1b'}, {id: 'd1c'}, {id: 'd1d'}]},
    {id: 'd2', kind: 'set', section: 'DILR', questions: [{id: 'd2a'}, {id: 'd2b'}]},
    {id: 'r1', kind: 'set', section: 'VARC', questions: [{id: 'r1a'}, {id: 'r1b'}]},
    q('v1', 'VARC'),
  ];
  const progress = {
    q1: {ok: true}, q2: {ok: false}, q3: {ok: true},
    d1a: {ok: true}, d1b: {ok: false}, d2a: {ok: true},
    r1a: {ok: true}, r1b: {ok: true}, v1: {ok: false},
  };
  const times = {
    q1: {ms: 60000, state: 'done'}, q2: {ms: 120000, state: 'done'}, q3: {ms: 999, state: 'paused'},
    d1: {ms: 600000, state: 'done'},          // 2 answered -> 300000 per question
    d2: {ms: 50000, state: 'paused'},         // not finished: excluded
    r1: {ms: 240000, state: 'done'}, v1: {ms: 60000, state: 'done'},
  };
  const s = Core.sectionStats(units, progress, times, ['QA', 'DILR', 'VARC']);
  assert.deepEqual(s.rows.QA, {attempted: 3, correct: 2, wrong: 1, accuracy: 2 / 3, perQuestionMs: 90000, perSetMs: null});
  assert.deepEqual(s.rows.DILR, {attempted: 3, correct: 2, wrong: 1, accuracy: 2 / 3, perQuestionMs: 300000, perSetMs: 600000});
  assert.equal(s.rows.VARC.perQuestionMs, 100000);  // (240000 + 60000) / 3
  assert.equal(s.rows.VARC.perSetMs, 240000);
  assert.deepEqual(s.total, {attempted: 9, correct: 6, wrong: 3, accuracy: 6 / 9, perQuestionMs: (180000 + 600000 + 300000) / 7, perSetMs: null});
  // a set marked done with nothing answered is ignored; empty sections give nulls
  const e = Core.sectionStats(units, {}, {d2: {ms: 5, state: 'done'}}, ['QA', 'DILR']);
  assert.deepEqual(e.rows.DILR, {attempted: 0, correct: 0, wrong: 0, accuracy: null, perQuestionMs: null, perSetMs: null});
  assert.equal(Object.keys(e.rows).join(), 'QA,DILR');
});
