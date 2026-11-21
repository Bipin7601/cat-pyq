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
