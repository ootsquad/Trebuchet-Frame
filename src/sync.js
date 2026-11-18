// Rank sync across the groups. Every few minutes the bot reads the groups and fixes ranks by the rules in
// groups.js:
//   Marine Corps:  in a division group -> that division's rank; left every division -> Unassigned Marine Personnel
//   UNSC:          the rank their memberships earn (Special Operations for ODST, Enlisted Marine, Commissioned for
//                  executive officers, Marine Corps Command for commanding officers, Materials Group, Naval)
// With SYNC_DRY_RUN=true it only posts what it would change.
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { CONFIG } from './config.js';
import { GROUPS, MARINES, UNSC, groupByKey, marineTarget, unscTarget } from './groups.js';

// Groups whose membership feeds the rules (not the project group or vehicle certification).
const SOURCES = GROUPS.filter((group) => ['marines', 'division', 'navy', 'materials'].includes(group.kind));

export function createSync({ client, roblox, ranking }) {
  let running = false;
  let lastRun = null;

  async function summary(lines, title, color) {
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

  // Everyone's top rank in each source group: Map userId -> { groupKey: rank }.
  async function memberships() {
    const byUser = new Map();
    for (const group of SOURCES) {
      for (const [userId, rank] of await roblox.listMembers(group.groupId)) {
        if (!byUser.has(userId)) byUser.set(userId, {});
        byUser.get(userId)[group.key] = rank;
      }
    }
    return byUser;
  }

  const divisionKeys = (ranks) => Object.keys(ranks).filter((key) => groupByKey(key)?.kind === 'division');

  async function plan() {
    const byUser = await memberships();
    const unsc = await roblox.listMembers(UNSC.groupId);
    const changes = [];
    const notInMarines = [];

    for (const [userId, ranks] of byUser) {
      const divisions = divisionKeys(ranks);
      if (divisions.length && !ranks.marines) notInMarines.push({ userId, divisions });
      const wanted = marineTarget(ranks.marines || null, divisions);
      if (wanted) {
        changes.push({ userId, group: groupByKey('marines'), from: ranks.marines, to: wanted });
        ranks.marines = wanted;
      }
    }
    for (const [userId, rank] of unsc) {
      const wanted = unscTarget(rank, byUser.get(userId) || {});
      if (wanted) changes.push({ userId, group: groupByKey('unsc'), from: rank, to: wanted });
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
      const previews = [];
      const failed = [];
      let done = 0;
      for (const change of limited) {
        const target = { id: change.userId, name: who(change.userId) };
        if (dryRun) { previews.push(`${target.name}: ${change.group.short} ${change.from} → ${change.to}`); continue; }
        try {
          await roblox.setRank(change.group.groupId, change.userId, change.to);
          await ranking.logChange({ group: change.group, target, from: change.from, to: change.to, by: 'Rank sync', reason: `Group membership (${reason})` });
          done += 1;
        } catch (error) {
          failed.push(`${target.name}: ${change.group.short} ${change.from} → ${change.to} (${String(error.message).slice(0, 120)})`);
        }
      }
      if (changes.length > limited.length) previews.push(`...and ${changes.length - limited.length} more next run (SYNC_MAX_CHANGES is ${CONFIG.sync.maxChangesPerRun}).`);
      await summary(previews, `Rank sync preview (${reason}, nothing changed)`, 0xfee75c);
      await summary(failed, 'Rank sync failures', 0xed4245);
      if (notInMarines.length) {
        await summary(notInMarines.slice(0, 40).map((n) => `${who(n.userId)} is in ${n.divisions.map((key) => groupByKey(key).short).join(', ')} but not in the Marine Corps group`), 'Needs to join the Marine Corps group', 0x5865f2);
      }
      lastRun = { at: new Date(), changes: changes.length, done: dryRun ? previews.length : done, failed: failed.length, dryRun };
      return lastRun;
    } finally {
      running = false;
    }
  }

  // One person, right now (used by /sync and after waving).
  async function syncOne(robloxUserId, { dryRun = CONFIG.sync.dryRun, by = 'Rank sync' } = {}) {
    const ranks = {};
    for (const group of SOURCES) {
      const rank = await roblox.getRank(group.groupId, robloxUserId).catch(() => null);
      if (rank) ranks[group.key] = rank;
    }
    const names = await roblox.usernames([robloxUserId]);
    const target = { id: robloxUserId, name: names.get(robloxUserId) || robloxUserId };
    const lines = [];
    const marineWanted = marineTarget(ranks.marines || null, divisionKeys(ranks));
    if (marineWanted) {
      if (!dryRun) {
        await roblox.setRank(MARINES.groupId, robloxUserId, marineWanted);
        await ranking.logChange({ group: groupByKey('marines'), target, from: ranks.marines, to: marineWanted, by });
      }
      lines.push(`Marine Corps: ${ranks.marines} → ${marineWanted}`);
      ranks.marines = marineWanted;
    } else if (!ranks.marines && divisionKeys(ranks).length) {
      lines.push('In a division group but not in the Marine Corps group. Join it first.');
    }
    const unscRank = await roblox.getRank(UNSC.groupId, robloxUserId).catch(() => null);
    const unscWanted = unscTarget(unscRank, ranks);
    if (unscWanted) {
      if (!dryRun) {
        await roblox.setRank(UNSC.groupId, robloxUserId, unscWanted);
        await ranking.logChange({ group: groupByKey('unsc'), target, from: unscRank, to: unscWanted, by });
      }
      lines.push(`UNSC: ${unscRank} → ${unscWanted}`);
    }
    return { target, lines };
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
    const { lines } = await syncOne(user.id, { by: `/sync by <@${interaction.user.id}>` });
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
