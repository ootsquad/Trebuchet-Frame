export const rankKeys = [
  "bmt",
  "pfc",
  "lcpl",
  "cpl",
  "sgt",
  "gysgt",
  "2lt",
  "1lt",
  "capt",
  "maj",
  "col",
  "bgen",
  "acom",
  "cmc",
  "secgen",
  "defacto",
] as const;

export type RankKey = (typeof rankKeys)[number];
export type GateType = "nco" | "officer";

export interface RankDefinition {
  key: RankKey;
  displayName: string;
  xpEnabled: boolean;
  next?: RankKey;
  gate?: GateType;
  officerTier: number;
}

export const ranks: readonly RankDefinition[] = [
  { key: "bmt", displayName: "Basic Military Training", xpEnabled: false, next: "pfc", officerTier: 0 },
  { key: "pfc", displayName: "Private First Class", xpEnabled: true, next: "lcpl", officerTier: 0 },
  { key: "lcpl", displayName: "Lance Corporal", xpEnabled: true, next: "cpl", officerTier: 0 },
  { key: "cpl", displayName: "Corporal", xpEnabled: true, next: "sgt", gate: "nco", officerTier: 0 },
  { key: "sgt", displayName: "Sergeant", xpEnabled: true, next: "gysgt", officerTier: 0 },
  { key: "gysgt", displayName: "Gunnery Sergeant", xpEnabled: true, next: "2lt", gate: "officer", officerTier: 0 },
  { key: "2lt", displayName: "2nd Lieutenant", xpEnabled: false, next: "1lt", officerTier: 1 },
  { key: "1lt", displayName: "1st Lieutenant", xpEnabled: false, next: "capt", officerTier: 2 },
  { key: "capt", displayName: "Captain", xpEnabled: false, next: "maj", officerTier: 3 },
  { key: "maj", displayName: "Major", xpEnabled: false, next: "col", officerTier: 4 },
  { key: "col", displayName: "Colonel", xpEnabled: false, next: "bgen", officerTier: 5 },
  { key: "bgen", displayName: "Brigadier General", xpEnabled: false, next: "acom", officerTier: 6 },
  { key: "acom", displayName: "Assistant Commander Of The Marine Corps", xpEnabled: false, next: "cmc", officerTier: 7 },
  { key: "cmc", displayName: "Commandant Of The Marine Corps", xpEnabled: false, officerTier: 8 },
  { key: "secgen", displayName: "Secretary General", xpEnabled: false, officerTier: 9 },
  { key: "defacto", displayName: "De-Facto Leader", xpEnabled: false, officerTier: 9 },
] as const;

export const rankByKey = new Map(ranks.map((rank) => [rank.key, rank]));

export function previousRank(currentRank: RankKey): RankKey | null {
  const index = ranks.findIndex((rank) => rank.key === currentRank);
  return index > 0 ? ranks[index - 1]?.key ?? null : null;
}

export const eventTypes = [
  "Patrol",
  "Inspection",
  "Combat Training",
  "Basic Training",
  "Platoon Formation",
  "NCO Training",
  "Officer Training",
] as const;

export type EventType = (typeof eventTypes)[number];

const eventTier: Record<EventType, number> = {
  Patrol: 1,
  Inspection: 4,
  "Combat Training": 1,
  "Basic Training": 3,
  "Platoon Formation": 1,
  "NCO Training": 2,
  "Officer Training": 4,
};

export function canHost(rankKey: RankKey, eventType: EventType): boolean {
  const rank = rankByKey.get(rankKey);
  return Boolean(rank && rank.officerTier >= eventTier[eventType]);
}

export function canCohost(rankKey: RankKey): boolean {
  return rankKey === "sgt" || rankKey === "gysgt" || (rankByKey.get(rankKey)?.officerTier ?? 0) > 0;
}

export interface ProgressionResult {
  previousXp: number;
  xp: number;
  previousRank: RankKey;
  rank: RankKey;
  promoted: boolean;
  cappedByGate: GateType | null;
  appliedDelta: number;
}

export function addXp(currentRank: RankKey, currentXp: number, amount: number): ProgressionResult {
  const rank = rankByKey.get(currentRank);
  if (!rank) throw new Error(`Unknown rank: ${currentRank}`);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("XP amount must be a positive integer.");
  if (!rank.xpEnabled) {
    const reason = currentRank === "bmt"
      ? "Basic Military Training requires tutorial completion, not XP."
      : "Officer ranks use hosted event counts, not XP.";
    throw new Error(reason);
  }

  const safeXp = Math.max(0, Math.min(99, Math.trunc(currentXp)));
  if (rank.gate) {
    const xp = Math.min(99, safeXp + amount);
    return {
      previousXp: safeXp,
      xp,
      previousRank: currentRank,
      rank: currentRank,
      promoted: false,
      cappedByGate: xp === 99 ? rank.gate : null,
      appliedDelta: xp - safeXp,
    };
  }

  if (safeXp + amount >= 100 && rank.next) {
    return {
      previousXp: safeXp,
      xp: 0,
      previousRank: currentRank,
      rank: rank.next,
      promoted: true,
      cappedByGate: null,
      appliedDelta: 100 - safeXp,
    };
  }

  const xp = Math.min(99, safeXp + amount);
  return {
    previousXp: safeXp,
    xp,
    previousRank: currentRank,
    rank: currentRank,
    promoted: false,
    cappedByGate: null,
    appliedDelta: xp - safeXp,
  };
}

export function removeXp(currentRank: RankKey, currentXp: number, amount: number): ProgressionResult {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("XP amount must be a positive integer.");
  const rank = rankByKey.get(currentRank);
  if (!rank) throw new Error(`Unknown rank: ${currentRank}`);
  if (!rank.xpEnabled) throw new Error("This rank does not use XP.");

  const safeXp = Math.max(0, Math.min(99, Math.trunc(currentXp)));
  const xp = Math.max(0, safeXp - amount);
  return {
    previousXp: safeXp,
    xp,
    previousRank: currentRank,
    rank: currentRank,
    promoted: false,
    cappedByGate: null,
    appliedDelta: xp - safeXp,
  };
}

export function passGate(currentRank: RankKey, currentXp: number, gate: GateType): ProgressionResult {
  const rank = rankByKey.get(currentRank);
  if (!rank || rank.gate !== gate || !rank.next) {
    throw new Error(`This player is not at the ${gate.toUpperCase()} Training gate.`);
  }
  if (currentXp < 99) {
    throw new Error(`This player needs 99 XP before passing ${gate.toUpperCase()} Training.`);
  }
  return {
    previousXp: currentXp,
    xp: 0,
    previousRank: currentRank,
    rank: rank.next,
    promoted: true,
    cappedByGate: null,
    appliedDelta: 0,
  };
}

export function roleNames(overrides: Record<string, string>): Record<RankKey, string> {
  return Object.fromEntries(
    ranks.map((rank) => [rank.key, overrides[rank.key] ?? rank.displayName]),
  ) as Record<RankKey, string>;
}
