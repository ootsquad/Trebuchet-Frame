// Merit ladders, one per division group. Each rank is the exact rank name in that division's Roblox group and the
// merit needed to reach it. The bot promotes automatically only through ranks marked auto: true (up to NCO).
// Ranks above that are given by hand with /rank.
//
// EMPTY UNTIL THE DIVISION RANKS ARE SENT. While a ladder is empty, nobody in that division is promoted by merit.
export const LADDERS = Object.freeze({
  odst: [],
  aar: [],
  mru: [],
  mcsb: [],
  mid: []
});

const position = (ladder, name) => ladder.findIndex((rank) => rank.name.toLowerCase() === String(name || '').toLowerCase());

export function rankForMerit(ladder, merit) {
  let best = null;
  for (const rank of ladder) {
    if (rank.auto && merit >= rank.merit) best = rank;
  }
  return best;
}

export function nextRank(ladder, merit) {
  return ladder.find((rank) => rank.merit > merit) || null;
}

// Promotion only moves up, only inside the ladder, and never touches ranks outside it.
export function promotionFor(ladder, currentRank, merit) {
  const current = position(ladder, currentRank);
  if (current < 0) return null;
  const target = rankForMerit(ladder, merit);
  if (!target) return null;
  return position(ladder, target.name) > current ? target : null;
}
