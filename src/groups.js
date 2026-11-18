// Every Roblox group the bot works in, who may manage each one, and the rules for ranks that follow from
// membership. Rank names must match the groups exactly (capital letters do not matter).
import { CONFIG } from './config.js';

const OFFICERS = /commanding officer|executive officer/i;

// kind: how membership counts toward the UNSC group (see unscTarget).
// managers: exact rank names that may manage the group through the bot. managerPattern: any rank whose name matches.
// marineRank: for divisions, the matching rank in the Marine Corps group.
export const GROUPS = Object.freeze([
  {
    key: 'project', name: 'Project: Trebuchet', short: 'Project: Trebuchet', groupId: CONFIG.groups.project, kind: 'project',
    managers: [] // only the Waved role, through wave applications and /unwave
  },
  {
    key: 'unsc', name: 'United Nations Space Command', short: 'UNSC', groupId: CONFIG.groups.unsc, kind: 'unsc',
    managers: ['De Facto Leader', 'Secretary-General', 'UNSC Security Council', 'Naval Command', 'Unified Ground Command', 'Marine Corps Command']
  },
  {
    key: 'marines', name: 'UNSC Marine Corps', short: 'Marine Corps', groupId: CONFIG.groups.marines, kind: 'marines',
    managers: ['Commandant of the Marine Corps', 'Assistant Commandant of the Marine Corps', 'Marine Aviation Command', 'Military Command']
  },
  {
    key: 'odst', name: 'UNSC Orbital Drop Shock Trooper', short: 'ODST', groupId: CONFIG.groups.divisions.odst, kind: 'division',
    managerPattern: OFFICERS, marineRank: '105th Orbital Drop Shock Troopers', unscRank: 'Special Operations Personnel'
  },
  {
    key: 'mid', name: 'UNSC 1st Marine Infantry Division', short: '1st MID', groupId: CONFIG.groups.divisions.mid, kind: 'division',
    managerPattern: OFFICERS, marineRank: '1st Marine Infantry Division', unscRank: 'Enlisted Marine Personnel'
  },
  {
    key: 'mfr', name: 'UNSC 3rd Marine Force Reconnaissance', short: '3rd MFR', groupId: CONFIG.groups.divisions.mfr, kind: 'division',
    managerPattern: OFFICERS, marineRank: '3rd Marine Force Reconnaissance', unscRank: 'Enlisted Marine Personnel'
  },
  {
    key: 'aar', name: 'UNSC 75th Armored Assault Regiment', short: '75th AAR', groupId: CONFIG.groups.divisions.aar, kind: 'division',
    managerPattern: OFFICERS, marineRank: '75th Armored Assault Regiment', unscRank: 'Enlisted Marine Personnel'
  },
  {
    key: 'mcsb', name: 'UNSC 7th Marine Combat Support Battalion', short: '7th MCSB', groupId: CONFIG.groups.divisions.mcsb, kind: 'division',
    managerPattern: OFFICERS, marineRank: '7th Marine Combat Support Battalion', unscRank: 'Enlisted Marine Personnel'
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
    key: 'vehicles', name: 'Office of Vehicle & Flight Certification', short: 'Vehicle Certification', groupId: CONFIG.groups.vehicles, kind: 'vehicles',
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
  // Never changed by the bot.
  protected: ['Artificial Intelligence', 'Commandant of the Marine Corps', 'Assistant Commandant of the Marine Corps', 'Marine Aviation Command', 'Military Command'],
  command: ['Commandant of the Marine Corps', 'Assistant Commandant of the Marine Corps', 'Marine Aviation Command', 'Military Command'],
  unassigned: 'Unassigned Marine Personnel'
});

// Pure: the Marine Corps rank someone should hold. null means leave it.
// divisionKeys: the divisions whose groups they are in (in GROUPS order, the first wins).
export function marineTarget(marineRank, divisionKeys) {
  if (!marineRank || has(MARINES.protected, marineRank)) return null;
  const division = DIVISIONS.find((entry) => divisionKeys.includes(entry.key));
  if (division) return same(marineRank, division.marineRank) ? null : division.marineRank;
  if (DIVISIONS.some((entry) => same(entry.marineRank, marineRank))) return MARINES.unassigned;
  return null;
}

// ---------- UNSC ----------

// Highest first: when several apply, the first one in this list wins.
export const UNSC_PRIORITY = Object.freeze([
  'Marine Corps Command',
  'Commissioned Military Personnel',
  'Special Operations Personnel',
  'Materials Group Personnel',
  'Enlisted Naval Personnel',
  'Enlisted Marine Personnel'
]);

export const UNSC = Object.freeze({
  groupId: CONFIG.groups.unsc,
  // The only UNSC ranks the bot ever changes. Leadership, ONI, Naval Command and Unified Ground Command are
  // never touched.
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
      if (/commanding officer/i.test(rank)) earned.add('Marine Corps Command');
      else if (/executive officer|company commander|operations officer/i.test(rank)) earned.add('Commissioned Military Personnel');
      else earned.add(group.unscRank);
    } else if (group.kind === 'marines') {
      if (has(MARINES.command, rank)) earned.add('Marine Corps Command');
      else if (!same(rank, 'Artificial Intelligence')) earned.add('Enlisted Marine Personnel');
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
