// Shared numbers: weeks (counted the same way as the game) and what the bot itself knows about events.

// Whole weeks since Monday 5 January 1970 00:00 UTC, the same count the game uses for its weekly stats.
export const weekIndex = (date = new Date()) => Math.floor((date.getTime() / 1000 - 345600) / 604800);
export const weekStart = (index) => new Date((index * 604800 + 345600) * 1000);

export function formatPlaytime(seconds) {
  const minutes = Math.floor((Number(seconds) || 0) / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

// Events a Roblox account attended, from the bot's own event logs: { events, operations, byType }.
export function attendance(store, robloxUserId, week = null) {
  const result = { events: 0, operations: 0, hosted: 0, byType: {} };
  for (const event of Object.values(store.data.events || {})) {
    if (week !== null && weekIndex(new Date(event.at)) !== week) continue;
    if (!(event.attendees || []).some((attendee) => String(attendee.id) === String(robloxUserId))) continue;
    result.events += 1;
    result.byType[event.type] = (result.byType[event.type] || 0) + 1;
    if (event.type === 'operations') result.operations += 1;
  }
  return result;
}

// Attendance totals for everyone in a week: Map robloxId -> { name, events, operations }.
export function weeklyAttendance(store, week) {
  const totals = new Map();
  for (const event of Object.values(store.data.events || {})) {
    if (weekIndex(new Date(event.at)) !== week) continue;
    for (const attendee of event.attendees || []) {
      const entry = totals.get(attendee.id) || { name: attendee.name, events: 0, operations: 0 };
      entry.events += 1;
      if (event.type === 'operations') entry.operations += 1;
      totals.set(attendee.id, entry);
    }
  }
  return totals;
}
