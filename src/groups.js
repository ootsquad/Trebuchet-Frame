// The Roblox groups and the rules the bot ranks by. Rank names must match the groups exactly.
import { CONFIG } from './config.js';

// 《 UNSC 》Marine Corps
export const MARINES = Object.freeze({
  groupId: CONFIG.groups.marines,
  // Never changed by the bot. These are handed out by hand.
  protected: [
    'Artificial Intelligence',
    'Commandant of the Marine Corps',
    'Assistant Commandant of the Marine Corps',
    'Marine Aviation Command',
    'Military Command'
  ],
  command: ['Commandant of the Marine Corps', 'Assistant Commandant of the Marine Corps', 'Marine Aviation Command', 'Military Command'],
  unassigned: 'Unassigned Marine Personnel',
  recruit: 'Marine Recruit'
});

// Each division is its own Roblox group. Joining it sets your Marine Corps rank to the division's name.
// When someone is in more than one, the first one in this list wins.
export const DIVISIONS = Object.freeze([
  { key: 'odst', rank: '105th Orbital Drop Shock Troopers', groupId: CONFIG.groups.divisions.odst },
  { key: 'aar', rank: '75th Armored Assault Regiment', groupId: CONFIG.groups.divisions.aar },
  { key: 'mru', rank: '3rd Marine Reconnaissance Unit', groupId: CONFIG.groups.divisions.mru },
  { key: 'mcsb', rank: '7th Marine Combat Support Battalion', groupId: CONFIG.groups.divisions.mcsb },
  { key: 'mid', rank: '1st Marine Infantry Division', groupId: CONFIG.groups.divisions.mid }
].filter((division) => division.groupId));

// 《 United Nations Space Command 》
export const UNSC = Object.freeze({
  groupId: CONFIG.groups.unsc,
  // The only UNSC ranks the bot ever changes. Anyone holding any other UNSC rank (leadership, ONI, Materials
  // Group, Naval Command, Special Operations, Commissioned, Enlisted Naval and so on) is left alone.
  managed: [
    'Marine Corps Command',
    'Enlisted Marine Personnel',
    'UNSC Candidate',
    'Person of Interest',
    'Registered Civilian',
    'Undocumented Refugee'
  ],
  marineCommand: 'Marine Corps Command',
  enlistedMarine: 'Enlisted Marine Personnel',
  // Where a marine goes in the UNSC group after leaving the Marine Corps group.
  leftMarines: CONFIG.groups.leftMarinesRank,
  // Wave applications: from this rank to the next.
  unWaved: CONFIG.groups.unWavedRank,
  waved: CONFIG.groups.wavedRank
});

const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const has = (list, name) => list.some((entry) => same(entry, name));

// Pure: the Marine Corps rank someone should hold. Returns null for "leave it as it is".
// marineRank: their current Marine Corps rank, or null when they are not in the Marine Corps group.
// divisionKeys: the divisions (keys) whose groups they are in.
export function marineTarget(marineRank, divisionKeys) {
  if (!marineRank || has(MARINES.protected, marineRank)) return null;
  const division = DIVISIONS.find((entry) => divisionKeys.includes(entry.key));
  if (division) return same(marineRank, division.rank) ? null : division.rank;
  if (DIVISIONS.some((entry) => same(entry.rank, marineRank))) return MARINES.unassigned;
  return null;
}

// Pure: the UNSC rank someone should hold, from their Marine Corps rank (after the step above).
export function unscTarget(unscRank, marineRank) {
  if (!unscRank || !has(UNSC.managed, unscRank)) return null;
  let wanted = null;
  if (!marineRank) {
    // Not a marine: only undo ranks that came from being a marine.
    if (same(unscRank, UNSC.marineCommand) || same(unscRank, UNSC.enlistedMarine)) wanted = UNSC.leftMarines;
  } else if (same(marineRank, 'Artificial Intelligence')) {
    wanted = null;
  } else if (has(MARINES.command, marineRank)) {
    wanted = UNSC.marineCommand;
  } else {
    wanted = UNSC.enlistedMarine;
  }
  return wanted && !same(wanted, unscRank) ? wanted : null;
}
