import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GROUP_75TH_AAR_ID = '111';
process.env.GROUP_105TH_ODST_ID = '222';
const { marineTarget, unscTarget } = await import('../src/groups.js');

test('joining a division sets the Marine Corps rank', () => {
  assert.equal(marineTarget('Marine Recruit', ['aar']), '75th Armored Assault Regiment');
  assert.equal(marineTarget('Unassigned Marine Personnel', ['aar']), '75th Armored Assault Regiment');
  assert.equal(marineTarget('75th Armored Assault Regiment', ['aar']), null);
});

test('the first division in the list wins when someone is in two', () => {
  assert.equal(marineTarget('Marine Recruit', ['aar', 'odst']), '105th Orbital Drop Shock Troopers');
});

test('leaving every division makes you unassigned', () => {
  assert.equal(marineTarget('75th Armored Assault Regiment', []), 'Unassigned Marine Personnel');
  assert.equal(marineTarget('Marine Recruit', []), null);
});

test('protected Marine Corps ranks are never touched', () => {
  assert.equal(marineTarget('Military Command', ['aar']), null);
  assert.equal(marineTarget('Artificial Intelligence', []), null);
  assert.equal(marineTarget(null, ['aar']), null);
});

test('UNSC rank follows the Marine Corps rank', () => {
  assert.equal(unscTarget('Registered Civilian', '75th Armored Assault Regiment'), 'Enlisted Marine Personnel');
  assert.equal(unscTarget('Enlisted Marine Personnel', 'Military Command'), 'Marine Corps Command');
  assert.equal(unscTarget('Enlisted Marine Personnel', null), 'Registered Civilian');
  assert.equal(unscTarget('Registered Civilian', null), null);
});

test('UNSC ranks outside the managed list are left alone', () => {
  assert.equal(unscTarget('Commissioned Military Personnel', 'Marine Recruit'), null);
  assert.equal(unscTarget('Office of Naval Intelligence', null), null);
  assert.equal(unscTarget('Enlisted Marine Personnel', 'Artificial Intelligence'), null);
});
