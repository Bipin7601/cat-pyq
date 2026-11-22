const test = require('node:test');
const assert = require('node:assert/strict');
const Calc = require('../js/calc.js');

// press a sequence of keys; tokens are space-separated
function run(keys, s = Calc.create()) {
  for (const k of keys.split(' ').filter(Boolean)) s = Calc.press(s, k);
  return s;
}
const show = (keys, s) => run(keys, s).display;

test('typing digits and decimals', () => {
  assert.equal(show('1 2 3'), '123');
  assert.equal(show('0 0 7'), '7');
  assert.equal(show('. 5'), '0.5');
  assert.equal(show('1 . . 5'), '1.5');
});

test('basic operations', () => {
  assert.equal(show('2 + 3 ='), '5');
  assert.equal(show('9 - 1 2 ='), '-3');
  assert.equal(show('6 * 7 ='), '42');
  assert.equal(show('1 / 4 ='), '0.25');
});

test('chains left to right like the CAT calculator', () => {
  assert.equal(show('2 + 3 * 4 ='), '20');
  const s = run('2 + 3 *');
  assert.equal(s.display, '5');
  assert.equal(s.expr, '5 ×');
});

test('changing the operator before typing the next number', () => {
  assert.equal(show('8 + - 3 ='), '5');
});

test('equals with no second number reuses the first', () => {
  assert.equal(show('5 * ='), '25');
});

test('a new number after equals starts over', () => {
  assert.equal(show('2 + 3 = 7'), '7');
  assert.equal(show('2 + 3 = * 2 ='), '10');
});

test('floating point noise is hidden', () => {
  assert.equal(show('0 . 1 + 0 . 2 ='), '0.3');
  assert.equal(show('1 / 3 ='), '0.333333333333');
});

test('backspace, clear and sign', () => {
  assert.equal(show('1 2 3 back'), '12');
  assert.equal(show('5 back'), '0');
  assert.equal(show('2 + 3 = back'), '5');
  assert.equal(show('1 2 + 3 C'), '0');
  assert.equal(show('1 2 + 3 C 4 ='), '4');
  assert.equal(show('5 neg'), '-5');
  assert.equal(show('5 neg neg'), '5');
  assert.equal(show('0 neg'), '0');
});

test('square root, reciprocal and percent', () => {
  assert.equal(show('8 1 sqrt'), '9');
  assert.equal(show('1 6 sqrt + 1 ='), '5');
  assert.equal(show('4 inv'), '0.25');
  assert.equal(show('2 0 0 + 1 0 pct'), '20');
  assert.equal(show('2 0 0 + 1 0 pct ='), '220');
  assert.equal(show('2 0 0 * 1 0 pct ='), '20');
  assert.equal(show('5 0 pct'), '0.5');
});

test('errors', () => {
  const z = run('5 / 0 =');
  assert.equal(z.error, true);
  assert.equal(z.display, 'Cannot divide by zero');
  assert.equal(show('5 / 0 = +'), 'Cannot divide by zero');
  assert.equal(show('5 / 0 = 7'), '7');
  assert.equal(show('5 / 0 = C'), '0');
  assert.equal(show('0 inv'), 'Cannot divide by zero');
  assert.equal(show('9 neg sqrt'), 'Invalid input');
});

test('memory keys', () => {
  let s = run('1 2 MS');
  assert.equal(s.mem, 12);
  assert.equal(show('3 MR', s), '12');
  s = run('5 M+', s);
  assert.equal(s.mem, 17);
  s = run('C 2 M-', s);
  assert.equal(s.mem, 15);
  assert.equal(show('1 + MR =', s), '16');
  s = run('MC', s);
  assert.equal(s.mem, 0);
  assert.equal(run('1 2 MS C').mem, 12, 'C keeps memory');
});

test('typing a new number after MS or M+ replaces the display', () => {
  assert.equal(show('1 2 MS 3'), '3');
});

test('long entries are capped', () => {
  assert.equal(show('1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8'), '1234567890123456');
});

test('press does not mutate the previous state', () => {
  const a = run('1 2');
  Calc.press(a, '3');
  assert.equal(a.display, '12');
});

test('keyFor maps the keyboard', () => {
  assert.equal(Calc.keyFor('7'), '7');
  assert.equal(Calc.keyFor('Enter'), '=');
  assert.equal(Calc.keyFor('='), '=');
  assert.equal(Calc.keyFor('x'), '*');
  assert.equal(Calc.keyFor('Backspace'), 'back');
  assert.equal(Calc.keyFor('Delete'), 'C');
  assert.equal(Calc.keyFor('%'), 'pct');
  assert.equal(Calc.keyFor('a'), null);
});
