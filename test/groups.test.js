import test from 'node:test';
import assert from 'node:assert/strict';

const { marineTarget, unscTarget, earnedUnscRank, isManagerRank, groupByKey } = await import('../src/groups.js');

test('the Marine Corps hub shows the unit', () => {
  assert.equal(marineTarget('Marine Recruit', { mid: 'Marine Private' }), '1st Marine Infantry Division');
  assert.equal(marineTarget('Unassigned Marine Personnel', { odst: 'Orbital Drop Shock Trooper' }), '105th Orbital Drop Shock Troopers');
  assert.equal(marineTarget('3rd Marine Force Reconnaissance', { mfr: 'Recon Operator' }), null);
  assert.equal(marineTarget('1st Marine Infantry Division', { mid: 'Executive Officer' }), 'Military Command');
  assert.equal(marineTarget('Marine Recruit', { odst: 'ODST Commanding Officer' }), 'Military Command');
});

test('leaving every division makes you unassigned; ranks the bot does not own stay', () => {
  assert.equal(marineTarget('75th Armored Assault Regiment', {}), 'Unassigned Marine Personnel');
  assert.equal(marineTarget('Military Command', {}), 'Unassigned Marine Personnel');
  assert.equal(marineTarget('Marine Recruit', {}), null);
  assert.equal(marineTarget('UNSC Security Council', { odst: 'Trooper' }), null);
  assert.equal(marineTarget(null, { odst: 'Trooper' }), null);
});

test('UNSC rank comes from memberships, highest wins', () => {
  assert.equal(earnedUnscRank({ odst: 'ODST Fireteam | Alpha', marines: '105th Orbital Drop Shock Troopers' }), 'Special Operations Personnel');
  assert.equal(earnedUnscRank({ mid: 'Marine Private', marines: '1st Marine Infantry Division' }), 'Enlisted Marine Personnel');
  assert.equal(earnedUnscRank({ mid: 'Marine Lieutenant' }), 'Commissioned Military Personnel');
  assert.equal(earnedUnscRank({ mfr: 'Commanding Officer' }), 'Marine Corps Command');
  assert.equal(earnedUnscRank({ marines: 'Military Command' }), 'Marine Corps Command');
  assert.equal(earnedUnscRank({ mid: 'Marine Private', materials: 'Technician' }), 'Materials Group Personnel');
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
  assert.equal(isManagerRank(groupByKey('mid'), 'Marine Corps Command'), true);
  assert.equal(isManagerRank(groupByKey('marines'), 'Military Command'), false);
  assert.equal(isManagerRank(groupByKey('unsc'), 'Unified Ground Command'), true);
  assert.equal(isManagerRank(groupByKey('unsc'), 'Enlisted Marine Personnel'), false);
  assert.equal(isManagerRank(groupByKey('vehicles'), 'Certification Officer'), true);
  assert.equal(isManagerRank(groupByKey('project'), 'Waved'), false);
});
