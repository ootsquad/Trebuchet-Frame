import test from 'node:test';
import assert from 'node:assert/strict';
import { attendeePay, dayKey, hostPay, parseNames } from '../src/rewards.js';
import { promotionFor, rankForMerit } from '../src/ranks.js';
import { formatLeak } from '../src/leaks.js';

test('base pay with no bonuses', () => {
  assert.equal(attendeePay('basic_training', { survived: false }).credits, 75);
  assert.equal(attendeePay('operations', { survived: false }).credits, 300);
});

test('bonuses add to the base', () => {
  assert.equal(attendeePay('operations', { objective: true, survived: true, firstToday: true }).credits, 570);
  assert.equal(attendeePay('combat_training', { objective: true, survived: false }).credits, 125);
  assert.equal(attendeePay('planet_recon', { survived: true }).credits, 173);
});

test('host pay needs 5 attendees, caps at 200 and respects cooldown', () => {
  assert.equal(hostPay(4).credits, 0);
  assert.equal(hostPay(5).credits, 50);
  assert.equal(hostPay(30).credits, 200);
  assert.equal(hostPay(10, { onCooldown: true }).credits, 0);
});

test('names split on spaces, commas and newlines without duplicates', () => {
  assert.deepEqual(parseNames('Alpha, bravo\nCharlie alpha @Delta'), ['Alpha', 'bravo', 'Charlie', 'Delta']);
});

test('day key uses the community time zone', () => {
  assert.equal(dayKey(new Date('2026-11-18T03:00:00Z'), 'America/New_York'), '2026-11-17');
});

test('promotion only moves up the ladder', () => {
  const ladder = [
    { name: 'Private', merit: 0, auto: true },
    { name: 'Corporal', merit: 500, auto: true },
    { name: 'Sergeant', merit: 1000, auto: true },
    { name: 'Lieutenant', merit: 5000, auto: false }
  ];
  assert.equal(promotionFor(ladder, 'Private', 650)?.name, 'Corporal');
  assert.equal(promotionFor(ladder, 'Sergeant', 650), null);
  assert.equal(promotionFor(ladder, 'Sergeant', 99999), null);
  assert.equal(promotionFor(ladder, 'Unknown', 99999), null);
  assert.equal(rankForMerit(ladder, 0).name, 'Private');
});

test('leak text becomes a headline and a quoted body', () => {
  const card = formatLeak('"You\'re exactly the kind of men I need."\nThe 501st Legion was elite.\nLed by Rex.');
  assert.equal(card.title, '"You\'re exactly the kind of men I need."');
  assert.equal(card.description, '> The 501st Legion was elite.\n> Led by Rex.');
  assert.equal(formatLeak('Only a title').description, null);
});
