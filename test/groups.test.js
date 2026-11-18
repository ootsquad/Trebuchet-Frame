import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GROUP_75TH_AAR_ID = '111';
process.env.GROUP_NAVY_ID = '222';
const { marineTarget, unscTarget, earnedUnscRank, isManagerRank, groupByKey } = await import('../src/groups.js');

test('joining a division sets the Marine Corps rank', () => {
  assert.equal(marineTarget('Marine Recruit', ['mid']), '1st Marine Infantry Division');
  assert.equal(marineTarget('Unassigned Marine Personnel', ['odst']), '105th Orbital Drop Shock Troopers');
  assert.equal(marineTarget('3rd Marine Force Reconnaissance', ['mfr']), null);
});

test('leaving every division makes you unassigned, protected ranks stay', () => {
  assert.equal(marineTarget('75th Armored Assault Regiment', []), 'Unassigned Marine Personnel');
  assert.equal(marineTarget('Marine Recruit', []), null);
  assert.equal(marineTarget('Military Command', ['odst']), null);
  assert.equal(marineTarget(null, ['odst']), null);
});

test('UNSC rank comes from memberships, highest wins', () => {
  assert.equal(earnedUnscRank({ odst: 'ODST Fireteam | Alpha', marines: '105th Orbital Drop Shock Troopers' }), 'Special Operations Personnel');
  assert.equal(earnedUnscRank({ mid: 'Rifleman', marines: '1st Marine Infantry Division' }), 'Enlisted Marine Personnel');
  assert.equal(earnedUnscRank({ odst: 'ODST Executive Officer' }), 'Commissioned Military Personnel');
  assert.equal(earnedUnscRank({ mfr: '3rd MFR Commanding Officer' }), 'Marine Corps Command');
  assert.equal(earnedUnscRank({ navy: 'Crewman' }), 'Enlisted Naval Personnel');
  assert.equal(earnedUnscRank({ materials: 'Technician' }), 'Materials Group Personnel');
  assert.equal(earnedUnscRank({}), null);
});

test('UNSC changes only touch managed ranks', () => {
  assert.equal(unscTarget('Registered Civilian', { odst: 'Trooper' }), 'Special Operations Personnel');
  assert.equal(unscTarget('Enlisted Marine Personnel', {}), 'Registered Civilian');
  assert.equal(unscTarget('Registered Civilian', {}), null);
  assert.equal(unscTarget('Office of Naval Intelligence', { odst: 'Trooper' }), null);
  assert.equal(unscTarget('Naval Command', { navy: 'Crewman' }), null);
});

test('managers come from Roblox ranks', () => {
  assert.equal(isManagerRank(groupByKey('odst'), 'ODST Commanding Officer'), true);
  assert.equal(isManagerRank(groupByKey('odst'), 'ODST Executive Officer'), true);
  assert.equal(isManagerRank(groupByKey('odst'), 'ODST Fireteam Leader'), false);
  assert.equal(isManagerRank(groupByKey('unsc'), 'Unified Ground Command'), true);
  assert.equal(isManagerRank(groupByKey('unsc'), 'Enlisted Marine Personnel'), false);
  assert.equal(isManagerRank(groupByKey('vehicles'), 'Certification Officer'), true);
  assert.equal(isManagerRank(groupByKey('project'), 'Waved'), false);
});
