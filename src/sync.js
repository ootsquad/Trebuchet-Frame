// Rank sync across the groups. Every few minutes the bot reads the division groups, the Marine Corps group and the
// UNSC group, and fixes ranks by the rules in groups.js:
//   in a division group      -> that division's rank in the Marine Corps group
//   left every division      -> Unassigned Marine Personnel
//   Marine Corps member      -> Enlisted Marine Personnel in the UNSC group (Marine Corps Command for command ranks)
//   left the Marine Corps    -> UNSC_LEFT_MARINES_RANK in the UNSC group
// With SYNC_DRY_RUN=true it only posts what it would change.
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { CONFIG } from './config.js';
import { DIVISIONS, MARINES, UNSC, marineTarget, unscTarget } from './groups.js';

export function createSync({ client, roblox }) {
  let running = false;
  let lastRun = null;

  async function log(lines, title, color) {
    if (!CONFIG.channels.rankLogs || !lines.length) return;
    const channel = await client.channels.fetch(CONFIG.channels.rankLogs).catch(() => null);
    if (!channel) return;
    for (let index = 0; index < lines.length; index += 40) {
      await channel.send({
        embeds: [new EmbedBuilder().setTitle(title).setColor(color).setDescription(lines.slice(index, index + 40).join('\n').slice(0, 4000)).setTimestamp()],
        allowedMentions: { parse: [] }
      });
    }
  }

  // Works out the changes for everyone. Pure apart from the reads.
  async function plan() {
    const divisionMembers = new Map();
    for (const division of DIVISIONS) {
      for (const userId of (await roblox.listMembers(division.groupId)).keys()) {
        if (!divisionMembers.has(userId)) divisionMembers.set(userId, []);
        divisionMembers.get(userId).push(division.key);
      }
    }
    const marines = await roblox.listMembers(MARINES.groupId);
    const unsc = await roblox.listMembers(UNSC.groupId);
    const changes = [];
    const notInMarines = [];

    for (const [userId, keys] of divisionMembers) {
      if (!marines.has(userId)) notInMarines.push({ userId, keys });
    }
    const finalMarine = new Map();
    for (const [userId, rank] of marines) {
      const target = marineTarget(rank, divisionMembers.get(userId) || []);
      finalMarine.set(userId, target || rank);
      if (target) changes.push({ userId, groupId: MARINES.groupId, group: 'Marine Corps', from: rank, to: target });
    }
    for (const [userId, rank] of unsc) {
      const target = unscTarget(rank, finalMarine.get(userId) || null);
      if (target) changes.push({ userId, groupId: UNSC.groupId, group: 'UNSC', from: rank, to: target });
    }
    return { changes, notInMarines };
  }

  async function run({ dryRun = CONFIG.sync.dryRun, reason = 'scheduled' } = {}) {
    if (running) return { busy: true };
    running = true;
    try {
      const { changes, notInMarines } = await plan();
      const limited = changes.slice(0, CONFIG.sync.maxChangesPerRun);
      const names = await roblox.usernames([...new Set([...limited.map((c) => c.userId), ...notInMarines.map((n) => n.userId)])]);
      const who = (id) => names.get(id) || id;
      const done = [];
      const failed = [];
      for (const change of limited) {
        const line = `${who(change.userId)}: ${change.group} ${change.from} -> ${change.to}`;
        if (dryRun) { done.push(line); continue; }
        try {
          await roblox.setRank(change.groupId, change.userId, change.to);
          done.push(line);
        } catch (error) {
          failed.push(`${line} (${String(error.message).slice(0, 120)})`);
        }
      }
      if (changes.length > limited.length) done.push(`...and ${changes.length - limited.length} more next run (SYNC_MAX_CHANGES is ${CONFIG.sync.maxChangesPerRun}).`);
      await log(done, dryRun ? `Rank sync preview (${reason}, nothing changed)` : `Rank sync (${reason})`, dryRun ? 0xfee75c : 0x57f287);
      await log(failed, 'Rank sync failures', 0xed4245);
      if (notInMarines.length) {
        await log(notInMarines.slice(0, 40).map((n) => `${who(n.userId)} is in ${n.keys.join(', ')} but not in the Marine Corps group`), 'Needs to join the Marine Corps group', 0x5865f2);
      }
      lastRun = { at: new Date(), changes: changes.length, done: done.length, failed: failed.length, dryRun };
      return lastRun;
    } finally {
      running = false;
    }
  }

  // One person, right now (used by /sync).
  async function syncOne(robloxUserId, { dryRun = false } = {}) {
    const keys = [];
    for (const division of DIVISIONS) {
      if (await roblox.getRank(division.groupId, robloxUserId)) keys.push(division.key);
    }
    const marineRank = await roblox.getRank(MARINES.groupId, robloxUserId);
    const unscRank = await roblox.getRank(UNSC.groupId, robloxUserId);
    const lines = [];
    const marineWanted = marineTarget(marineRank, keys);
    if (marineWanted) {
      if (!dryRun) await roblox.setRank(MARINES.groupId, robloxUserId, marineWanted);
      lines.push(`Marine Corps: ${marineRank} -> ${marineWanted}`);
    } else if (!marineRank && keys.length) {
      lines.push('In a division group but not in the Marine Corps group. Join it first.');
    }
    const unscWanted = unscTarget(unscRank, marineWanted || marineRank);
    if (unscWanted) {
      if (!dryRun) await roblox.setRank(UNSC.groupId, robloxUserId, unscWanted);
      lines.push(`UNSC: ${unscRank} -> ${unscWanted}`);
    }
    return lines;
  }

  async function command(interaction) {
    const staff = interaction.member?.permissions?.has('ManageGuild') ||
      (CONFIG.roles.waveModerator && interaction.member?.roles?.cache?.has(CONFIG.roles.waveModerator));
    const typed = interaction.options.getString('roblox_user');
    if (!typed && !staff) {
      await interaction.reply({ content: 'Give a Roblox username. Only staff can run a full sync.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!typed) {
      const result = await run({ reason: `run by ${interaction.user.username}` });
      await interaction.editReply(result.busy ? 'A sync is already running.' : `Sync finished: ${result.done} ${result.dryRun ? 'previewed' : 'changed'}, ${result.failed} failed. Details are in the rank log.`);
      return;
    }
    const user = await roblox.resolveUser(typed);
    const lines = await syncOne(user.id, { dryRun: CONFIG.sync.dryRun });
    if (lines.length) await log(lines.map((line) => `${user.name}: ${line}`), CONFIG.sync.dryRun ? 'Rank sync preview (one person)' : 'Rank sync (one person)', 0x57f287);
    await interaction.editReply(lines.length ? `${user.name}${CONFIG.sync.dryRun ? ' (preview only, SYNC_DRY_RUN is on)' : ''}:\n${lines.join('\n')}` : `${user.name} is already right.`);
  }

  function start() {
    if (!CONFIG.roblox.apiKey) return;
    const tick = () => run().catch((error) => console.error('[Rank sync]', error));
    setTimeout(tick, 30_000).unref();
    setInterval(tick, CONFIG.sync.everyMinutes * 60_000).unref();
  }

  return { run, syncOne, command, start, status: () => lastRun };
}
