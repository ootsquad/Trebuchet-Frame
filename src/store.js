// Small JSON files on disk. On Railway, mount a volume at DATA_DIR so they survive redeploys.
import fs from 'node:fs';
import path from 'node:path';

export class JsonStore {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'bot.json');
    this.data = this.#read();
    for (const key of ['links', 'suggestions', 'events', 'firstEvent', 'hostPaid', 'leaks']) {
      this.data[key] ??= {};
    }
  }

  #read() {
    try {
      if (!fs.existsSync(this.file)) return {};
      const text = fs.readFileSync(this.file, 'utf8');
      return text.trim() ? JSON.parse(text) : {};
    } catch (error) {
      console.error('[Store] Could not read bot.json, starting empty:', error);
      return {};
    }
  }

  save() {
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temp, this.file);
  }

  // Discord user <-> Roblox account, set by wave applications and /link.
  link(discordId, robloxUser) {
    this.data.links[String(discordId)] = { id: String(robloxUser.id), name: robloxUser.name, at: new Date().toISOString() };
    this.save();
  }

  // The Discord account a Roblox account is linked to, if any.
  discordFor(robloxId) {
    const found = Object.entries(this.data.links).find(([, link]) => String(link.id) === String(robloxId));
    return found ? found[0] : null;
  }

  linkedRoblox(discordId) {
    return this.data.links[String(discordId)] || null;
  }

  suggestion(messageId) {
    return this.data.suggestions[String(messageId)] || null;
  }

  setSuggestion(messageId, value) {
    this.data.suggestions[String(messageId)] = value;
    this.save();
  }

  // The first paid event of the day, per Roblox user, by the configured time zone's calendar day.
  hadEventOn(robloxId, day) {
    return this.data.firstEvent[String(robloxId)] === day;
  }

  markEventDay(robloxId, day) {
    this.data.firstEvent[String(robloxId)] = day;
  }

  lastHostPay(hostDiscordId, eventType) {
    return this.data.hostPaid[`${hostDiscordId}:${eventType}`] || 0;
  }

  markHostPay(hostDiscordId, eventType, when) {
    this.data.hostPaid[`${hostDiscordId}:${eventType}`] = when;
  }

  recordEvent(id, value) {
    this.data.events[id] = value;
    this.save();
  }

  leakPosted(sourceMessageId) {
    return Boolean(this.data.leaks[String(sourceMessageId)]);
  }

  markLeak(sourceMessageId, postedId) {
    this.data.leaks[String(sourceMessageId)] = postedId;
    this.save();
  }
}
