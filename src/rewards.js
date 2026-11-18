// Event pay: merit (rank progress) and cR (currency). Pure functions, so they are easy to test and change.

export const EVENT_TYPES = Object.freeze({
  basic_training: { name: 'Basic Training', credits: 75, merit: 25 },
  combat_training: { name: 'Combat Training', credits: 100, merit: 35 },
  planet_recon: { name: 'Planet Recon', credits: 150, merit: 50 },
  planetary_patrol: { name: 'Planetary Patrol', credits: 175, merit: 60 },
  operations: { name: 'Operations', credits: 300, merit: 100 }
});

export const BONUSES = Object.freeze({
  objective: 0.25, // the host marked the objective as completed
  survived: 0.15, // the attendee did not die during the event
  firstToday: 0.5 // the attendee's first paid event of the day
});

export const HOSTING = Object.freeze({
  creditsPerAttendee: 10,
  creditCap: 200,
  minimumAttendees: 5,
  merit: 40 // merit for hosting, on top of any merit for taking part
});

// Bonuses add to the base: an Operation with objective done, survived and first of the day pays 300 * 1.9 = 570.
export function attendeePay(type, { objective = false, survived = true, firstToday = false } = {}) {
  const event = EVENT_TYPES[type];
  if (!event) throw new Error(`Unknown event type ${type}`);
  let scale = 1;
  const parts = ['base'];
  if (objective) { scale += BONUSES.objective; parts.push('objective'); }
  if (survived) { scale += BONUSES.survived; parts.push('survived'); }
  if (firstToday) { scale += BONUSES.firstToday; parts.push('first today'); }
  return { credits: Math.round(event.credits * scale), merit: event.merit, bonuses: parts.slice(1) };
}

// Host pay needs MinimumAttendees qualifying attendees and is limited to one paid event of each type per cooldown.
export function hostPay(attendeeCount, { onCooldown = false } = {}) {
  if (attendeeCount < HOSTING.minimumAttendees) {
    return { credits: 0, merit: 0, reason: `needs at least ${HOSTING.minimumAttendees} attendees` };
  }
  if (onCooldown) return { credits: 0, merit: 0, reason: 'already paid for this event type recently' };
  return {
    credits: Math.min(attendeeCount * HOSTING.creditsPerAttendee, HOSTING.creditCap),
    merit: HOSTING.merit,
    reason: null
  };
}

// The calendar day in the community's time zone, like 2026-11-17.
export function dayKey(date = new Date(), timeZone = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Splits "name1, name2 name3" (also newlines) into unique names, keeping the first spelling.
export function parseNames(text) {
  const seen = new Set();
  const names = [];
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const name = raw.replace(/^@/, '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}
