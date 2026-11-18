// Every Roblox group the bot works in, who may manage each one, and the rules for ranks that follow from
// membership. Rank names must match the groups exactly (capital letters do not matter).
import { CONFIG } from './config.js';

const OFFICERS = /commanding officer|executive officer/i;
// In every division group, these ranks may also manage it.
const DIVISION_MANAGERS = ['Marine Corps Command', 'De-Facto Leader', 'Admin'];

// kind: how membership counts toward the UNSC group (see unscTarget).
// managers: exact rank names that may manage the group through the bot. managerPattern: any rank whose name matches.
// marineRank: for divisions, the matching rank in the Marine Corps group.
// earnable: the highest rank number reached by merit alone (ranks are numbered 1 to 10 in the divisions).
// approval: a rank number that merit can reach only with the Commanding or Executive Officer's approval.
export const GROUPS = Object.freeze([
  {
    key: 'project', name: 'Project: Trebuchet', short: 'Project: Trebuchet', groupId: CONFIG.groups.project, kind: 'project',
    managers: [] // only the Waved role, through wave applications and /unwave
  },
  {
    key: 'unsc', name: 'United Nations Space Command', short: 'United Nations Space Command', groupId: CONFIG.groups.unsc, kind: 'unsc',
    managers: ['De Facto Leader', 'Secretary-General', 'UNSC Security Council', 'Naval Command', 'Unified Ground Command', 'Marine Corps Command']
  },
  {
    // A hub that shows which unit someone is in. Only the bot changes it; nobody ranks people here by hand.
    key: 'marines', name: 'UNSC Marine Corps', short: 'Marine Corps', groupId: CONFIG.groups.marines, kind: 'marines',
    managers: []
  },
  {
    key: 'odst', name: 'UNSC Orbital Drop Shock Trooper', short: 'Orbital Drop Shock Trooper', groupId: CONFIG.groups.divisions.odst, kind: 'division',
    managers: DIVISION_MANAGERS, managerPattern: OFFICERS, marineRank: '105th Orbital Drop Shock Troopers', unscRank: 'Special Operations Personnel',
    earnable: 6, approval: 7 // up to ODST Fireteam | Alpha by merit; Fireteam Leader needs the CO or XO
  },
  {
    key: 'mid', name: 'UNSC 1st Marine Infantry Division', short: '1st Marine Infantry Division', groupId: CONFIG.groups.divisions.mid, kind: 'division',
    managers: DIVISION_MANAGERS, managerPattern: OFFICERS, marineRank: '1st Marine Infantry Division', unscRank: 'Enlisted Marine Personnel',
    earnable: 6 // up to Sergeant Major by merit
  },
  {
    key: 'mfr', name: 'UNSC 3rd Marine Force Reconnaissance', short: '3rd Marine Force Reconnaissance', groupId: CONFIG.groups.divisions.mfr, kind: 'division',
    managers: DIVISION_MANAGERS, managerPattern: OFFICERS, marineRank: '3rd Marine Force Reconnaissance', unscRank: 'Enlisted Marine Personnel',
    earnable: 6 // up to Sergeant Major by merit
  },
  {
    key: 'aar', name: 'UNSC 75th Armored Assault Regiment', short: '75th Armored Assault Regiment', groupId: CONFIG.groups.divisions.aar, kind: 'division',
    managers: DIVISION_MANAGERS, managerPattern: OFFICERS, marineRank: '75th Armored Assault Regiment', unscRank: 'Enlisted Marine Personnel',
    earnable: 6 // up to Sergeant Major by merit
  },
  {
    key: 'mcsb', name: 'UNSC 7th Marine Combat Support Battalion', short: '7th Marine Combat Support Battalion', groupId: CONFIG.groups.divisions.mcsb, kind: 'division',
    managers: DIVISION_MANAGERS, managerPattern: OFFICERS, marineRank: '7th Marine Combat Support Battalion', unscRank: 'Enlisted Marine Personnel',
    earnable: 6 // up to Sergeant Major by merit
  },
  {
    key: 'navy', name: 'UNSC Navy', short: 'Navy', groupId: CONFIG.groups.navy, kind: 'navy',
    managerPattern: OFFICERS
  },
  {
    key: 'materials', name: 'UNSC Materials Group', short: 'Materials Group', groupId: CONFIG.groups.materials, kind: 'materials',
    managerPattern: OFFICERS
  },
  {
    key: 'vehicles', name: 'Office of Vehicle & Flight Certification', short: 'Office of Vehicle & Flight Certification', groupId: CONFIG.groups.vehicles, kind: 'vehicles',
    managers: ['Certification Officer', 'Director of Operational Standards', 'Materials Group Liaison Officer', 'Secretary General', 'De-Facto Leader']
  }
].filter((group) => group.groupId));

export const groupByKey = (key) => GROUPS.find((group) => group.key === key) || null;
export const groupById = (id) => GROUPS.find((group) => String(group.groupId) === String(id)) || null;
export const DIVISIONS = GROUPS.filter((group) => group.kind === 'division');

const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const has = (list, name) => list.some((entry) => same(entry, name));

// Pure: may someone holding this rank manage the group?
export function isManagerRank(group, rankName) {
  if (!group || !rankName) return false;
  if (has(group.managers || [], rankName)) return true;
  return Boolean(group.managerPattern && group.managerPattern.test(rankName));
}

// ---------- Marine Corps ----------

export const MARINES = Object.freeze({
  groupId: CONFIG.groups.marines,
  // The only Marine Corps ranks the bot sets or replaces. Everything else (command ranks and above) is left alone.
  unassigned: 'Unassigned Marine Personnel',
  recruit: 'Marine Recruit',
  military: 'Military Command'
});

const marineManaged = () => [MARINES.unassigned, MARINES.recruit, MARINES.military, ...DIVISIONS.map((group) => group.marineRank)];

// Pure: the Marine Corps rank someone should hold. null means leave it.
// divisionRanks: { divisionKey: their rank there } for the divisions they are in (GROUPS order, the first wins).
// A Commanding or Executive Officer of any division is Military Command.
export function marineTarget(marineRank, divisionRanks) {
  if (!marineRank || !has(marineManaged(), marineRank)) return null;
  const keys = Array.isArray(divisionRanks) ? divisionRanks : Object.keys(divisionRanks || {});
  const ranks = Array.isArray(divisionRanks) ? {} : divisionRanks || {};
  let wanted = null;
  if (keys.some((key) => OFFICERS.test(ranks[key] || ''))) wanted = MARINES.military;
  else {
    const division = DIVISIONS.find((entry) => keys.includes(entry.key));
    if (division) wanted = division.marineRank;
    else if (!same(marineRank, MARINES.recruit) && !same(marineRank, MARINES.unassigned)) wanted = MARINES.unassigned;
  }
  return wanted && !same(wanted, marineRank) ? wanted : null;
}

// ---------- UNSC ----------

// The UNSC group's order (1 Undocumented Refugee up to 15 Secretary-General). When several apply, the highest wins.
export const UNSC_PRIORITY = Object.freeze([
  'Materials Group Personnel', // 12
  'Marine Corps Command', // 9
  'Enlisted Naval Personnel', // 8
  'Special Operations Personnel', // 7
  'Commissioned Military Personnel', // 6
  'Enlisted Marine Personnel' // 5
]);

export const UNSC = Object.freeze({
  groupId: CONFIG.groups.unsc,
  // The only UNSC ranks the bot ever changes. Unified Ground Command, Naval Command, ONI, the Security Council,
  // the Secretary-General and the De Facto Leader are never touched.
  managed: [...UNSC_PRIORITY, 'UNSC Candidate', 'Person of Interest', 'Registered Civilian', 'Undocumented Refugee'],
  leftEverything: CONFIG.groups.leftMarinesRank
});

// Pure: the UNSC rank someone's other memberships earn them.
// ranks: { [groupKey]: their top rank name in that group } for the groups they are in.
export function earnedUnscRank(ranks) {
  const earned = new Set();
  for (const group of GROUPS) {
    const rank = ranks[group.key];
    if (!rank) continue;
    if (group.kind === 'division') {
      if (/commanding officer|marine corps command/i.test(rank)) earned.add('Marine Corps Command');
      else if (/executive officer|operations officer|captain|lieutenant/i.test(rank)) earned.add('Commissioned Military Personnel');
      else earned.add(group.unscRank);
    } else if (group.kind === 'marines') {
      if (same(rank, MARINES.military)) earned.add('Marine Corps Command');
      else if (has([MARINES.recruit, MARINES.unassigned, ...DIVISIONS.map((entry) => entry.marineRank)], rank)) earned.add('Enlisted Marine Personnel');
    } else if (group.kind === 'navy') {
      earned.add('Enlisted Naval Personnel');
    } else if (group.kind === 'materials') {
      earned.add('Materials Group Personnel');
    }
  }
  return UNSC_PRIORITY.find((rank) => earned.has(rank)) || null;
}

// Pure: the UNSC rank to set, or null to leave it.
export function unscTarget(unscRank, ranks) {
  if (!unscRank || !has(UNSC.managed, unscRank)) return null;
  const earned = earnedUnscRank(ranks);
  let wanted = earned;
  if (!earned) wanted = has(UNSC_PRIORITY, unscRank) ? UNSC.leftEverything : null;
  return wanted && !same(wanted, unscRank) ? wanted : null;
}
