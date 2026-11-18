import test from 'node:test';
import assert from 'node:assert/strict';
import { attendeePay, dayKey, hostPay, parseNames } from '../src/rewards.js';
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

test('leak text becomes a facility, a headline and a quoted body', () => {
  const card = formatLeak('"You\'re exactly the kind of men I need."\nThe 501st Legion was elite.\nLed by Rex.');
  assert.equal(card.facility, 'damascus');
  assert.equal(card.title, '"You\'re exactly the kind of men I need."');
  assert.equal(card.description, '> The 501st Legion was elite.\n> Led by Rex.');
  assert.equal(formatLeak('Only a title').description, null);
  const tagged = formatLeak('[Ganymede]\nZero-g trials\nThrusters hold.');
  assert.equal(tagged.facility, 'ganymede');
  assert.equal(tagged.title, 'Zero-g trials');
  assert.equal(formatLeak('from: nowhere\nTitle').title, 'from: nowhere');
});

test('setting date uses the real day in the setting year', async () => {
  const { settingDate } = await import('../src/leaks.js');
  assert.equal(settingDate(new Date('2026-11-17T15:00:00Z'), 2524, 'America/New_York'), '17 NOV 2524');
});

test('profile phrase check ignores case, spacing and punctuation', async () => {
  const { makePhrase, profileHasPhrase } = await import('../src/verify.js');
  const phrase = makePhrase();
  assert.match(phrase, /^UNSC( [a-z]+){5}$/);
  assert.equal(profileHasPhrase(`Hi! ${phrase.toUpperCase().replace(/ /g, '  ')}. Semper fi`, phrase), true);
  assert.equal(profileHasPhrase('UNSC alpha bravo', 'UNSC alpha bravo charlie delta echo'), false);
  assert.equal(profileHasPhrase('xUNSC alpha bravo charlie delta echo', 'UNSC alpha bravo charlie delta echo'), false);
});
