// Ranking through Discord, scoped by Roblox rank:
//   /rank      change someone's rank in a group you manage (you only see that group's ranks below yours)
//   /pending   see who asked to join a group you manage, and accept or decline them
// Merit promotions (divisions): every MERIT_PER_RANK merit earned since the last promotion moves someone one rank
// up, as far as the division's earnable rank (rank 6: Sergeant Major, or ODST Fireteam | Alpha). ODST's Fireteam
// Leader (rank 7) can be earned too, but only when the Commanding or Executive Officer approves. Giving anything
// above the earnable rank by hand pings them. Every change is logged with who made it and in which group.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { CONFIG } from './config.js';
import { GROUPS, groupByKey, isManagerRank } from './groups.js';
import { COLORS, note } from './ui.js';

const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

export function createRanking({ client, store, roblox, access }) {
  store.data.meritBase ??= {};
  store.data.promotionRequests ??= {};

  // ---------- logs ----------

  async function send(channelId, embed, extra = {}) {
    if (!channelId) return null;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    return channel ? channel.send({ embeds: [embed], allowedMentions: { parse: [] }, ...extra }) : null;
  }

  // One rank change: who, where, from, to, by whom and why.
  async function logChange({ group, target, from, to, by, reason, color = COLORS.info, promotion = false, ping = [] }) {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: `${group.short} · ${promotion ? 'Promotion' : 'Rank change'}` })
      .setTitle(target.name)
      .setURL(`https://www.roblox.com/users/${target.id}/profile`)
      .addFields(
        { name: 'From', value: from || 'None', inline: true },
        { name: 'To', value: to, inline: true },
        { name: 'By', value: by, inline: true }
      )
      .setTimestamp();
    if (reason) embed.addFields({ name: 'Reason', value: String(reason).slice(0, 1000) });
    const content = ping.length ? ping.map((id) => `<@${id}>`).join(' ') : undefined;
    await send(promotion ? CONFIG.channels.promotions || CONFIG.channels.rankLogs : CONFIG.channels.rankLogs, embed, {
      content,
      allowedMentions: { users: ping }
    });
    if (promotion && CONFIG.channels.promotions && CONFIG.channels.rankLogs && CONFIG.channels.promotions !== CONFIG.channels.rankLogs) {
      await send(CONFIG.channels.rankLogs, embed);
    }
  }

  // Discord users linked to Roblox accounts that manage the group (to ping its commanders).
  async function commandersOf(group) {
    const members = await roblox.listMembers(group.groupId).catch(() => new Map());
    const ids = [];
    for (const [discordId, link] of Object.entries(store.data.links)) {
      const rank = members.get(String(link.id));
      if (rank && /commanding officer|executive officer/i.test(rank)) ids.push(discordId);
    }
    return ids;
  }

  // ---------- /rank ----------

  // fixedGroup: /license always works on the vehicle certification group.
  // Checks a target before ranking: in the group, and below the manager. Returns their current role.
  async function checkTarget(group, role, actor, target) {
    if (target.id === actor.id) throw new Error('You cannot change your own rank.');
    const current = (await roblox.getRoles(group.groupId, target.id))[0];
    if (!current) throw new Error(`${target.name} is not in ${group.short}. Check their join request first.`);
    if (current.rank >= role.rank) throw new Error(`${target.name} is ${current.name}, which is not below your rank. You cannot change them.`);
    return current;
  }

  // The one place ranks change by hand (/rank, /license and the rank panel).
  async function changeRank({ discordUserId, groupKey, target, rankName, reason = null }) {
    const { actor, group, role } = await access.requireManager(discordUserId, groupKey);
    const current = await checkTarget(group, role, actor, target);
    const allowed = await access.assignableRanks(group, role);
    const rank = allowed.find((entry) => same(entry.name, rankName));
    if (!rank) throw new Error(`"${rankName}" is not a rank you can give in ${group.short}.`);

    // Above the earnable rank, the division's Commanding and Executive Officers are told.
    const needsCommand = Boolean(group.earnable) && rank.rank > group.earnable;
    const result = await roblox.setRank(group.groupId, target.id, rank.name);
    access.forget(group, target.id);
    const ping = needsCommand ? (await commandersOf(group)).filter((id) => id !== discordUserId) : [];
    await logChange({
      group, target, from: result.before, to: result.rank, by: `<@${discordUserId}> (${actor.name}, ${role.name})`,
      reason: needsCommand ? `${reason ? `${reason}\n` : ''}⚠️ ${rank.name} is above the ranks earned by merit. Commanding and Executive Officers notified.` : reason,
      color: needsCommand ? COLORS.warn : COLORS.info,
      promotion: rank.rank > current.rank,
      ping
    });
    store.data.meritBase[`${group.key}:${target.id}`] = null; // the next merit step counts from their next check
    store.save();
    return { group, before: result.before, after: result.rank, needsCommand };
  }

  const changedNote = (target, result) => note(`✅ **${target.name}** in ${result.group.short}: ${result.before} → **${result.after}**${result.needsCommand ? '\nThe Commanding and Executive Officers were notified, because this rank is above what merit earns.' : ''}`, COLORS.good);

  // fixedGroup: /license always works on the vehicle certification group.
  async function rankCommand(interaction, fixedGroup = null) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // A rank picked from the list carries its group: "odst::ODST Fireteam Leader".
    const picked = String(interaction.options.getString('new_rank', true));
    const [pickedGroup, pickedRank] = picked.includes('::') ? picked.split('::') : [null, picked];
    const groupKey = fixedGroup || interaction.options.getString('group') || pickedGroup;
    if (!groupKey) throw new Error('Pick the rank from the list, or choose a group first.');
    const target = await roblox.resolveUser(interaction.options.getString('roblox_user', true));
    const result = await changeRank({ discordUserId: interaction.user.id, groupKey, target, rankName: pickedRank, reason: interaction.options.getString('reason') });
    await interaction.editReply({ embeds: [changedNote(target, result)] });
  }

  // Autocomplete: only groups you manage, and only that group's ranks below yours.
  async function autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const typed = String(focused.value || '').toLowerCase();
    try {
      if (focused.name === 'group') {
        const groups = await access.managedGroups(interaction.user.id);
        await interaction.respond(groups
          .filter(({ group }) => !typed || group.short.toLowerCase().includes(typed))
          .slice(0, 25)
          .map(({ group, role }) => ({ name: `${group.short} (you: ${role.name})`.slice(0, 100), value: group.key })));
        return;
      }
      // Ranks, each labelled with its group: "ODST  ›  ODST Fireteam Leader". Only groups you command, and only
      // ranks below yours. With a group already chosen, only that group.
      const groupKey = interaction.commandName === 'license' ? 'vehicles' : interaction.options.getString('group');
      const sources = groupKey
        ? [await access.requireManager(interaction.user.id, groupKey)]
        : await access.managedGroups(interaction.user.id);
      const choices = [];
      for (const { group, role } of sources) {
        for (const rank of await access.assignableRanks(group, role)) {
          const label = `${group.short}  ›  ${rank.name}`;
          if (typed && !label.toLowerCase().includes(typed)) continue;
          choices.push({ name: label.slice(0, 100), value: `${group.key}::${rank.name}`.slice(0, 100) });
        }
      }
      await interaction.respond(choices.slice(0, 25));
    } catch {
      await interaction.respond([]).catch(() => {});
    }
  }

  // ---------- /pending ----------

  function pendingRows(group, requests, names) {
    return requests.slice(0, 5).map((request) => new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`join:x:${group.key}:${request.userId}`).setLabel((names.get(request.userId) || request.userId).slice(0, 60)).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`join:accept:${group.key}:${request.userId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`join:decline:${group.key}:${request.userId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setLabel('Profile').setStyle(ButtonStyle.Link).setURL(`https://www.roblox.com/users/${request.userId}/profile`)
    ));
  }

  async function pendingView(group) {
    const requests = await roblox.listJoinRequests(group.groupId, { max: 25 });
    const names = await roblox.usernames(requests.map((request) => request.userId));
    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setAuthor({ name: `${group.short} · Join requests` })
      .setTitle(requests.length ? `${requests.length}${requests.length === 25 ? '+' : ''} waiting` : 'Nobody is waiting')
      .setDescription(requests.length
        ? requests.map((request, index) => `${index + 1}. **${names.get(request.userId) || request.userId}**${request.at ? ` · <t:${Math.floor(new Date(request.at).getTime() / 1000)}:R>` : ''}`).join('\n').slice(0, 4000)
        : 'There are no join requests right now.')
      .setFooter({ text: requests.length > 5 ? 'Buttons show the first 5. Handle them and run /pending again for more.' : 'Accepting adds them to the group at its lowest rank.' });
    return { embeds: [embed], components: pendingRows(group, requests, names) };
  }

  // Project: Trebuchet requests are for wave moderators; every other group for its managers.
  async function canHandleRequests(interaction, groupKey) {
    if (groupKey === 'project') {
      const allowed = interaction.member?.permissions?.has('ManageGuild') || (CONFIG.roles.waveModerator && interaction.member?.roles?.cache?.has(CONFIG.roles.waveModerator));
      if (!allowed) throw new Error('Only Wave Moderators handle Project: Trebuchet join requests.');
      return { actor: access.actorOf(interaction.user.id), group: groupByKey('project'), role: { name: 'Wave Moderator' } };
    }
    return access.requireManager(interaction.user.id, groupKey);
  }

  async function pendingCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { group } = await canHandleRequests(interaction, interaction.options.getString('group', true));
    await interaction.editReply(await pendingView(group));
  }

  async function pendingAutocomplete(interaction) {
    const typed = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = (await access.managedGroups(interaction.user.id).catch(() => [])).map(({ group }) => ({ name: group.short, value: group.key }));
    const waveMod = interaction.member?.permissions?.has('ManageGuild') || (CONFIG.roles.waveModerator && interaction.member?.roles?.cache?.has(CONFIG.roles.waveModerator));
    if (waveMod && groupByKey('project')) choices.unshift({ name: 'Project: Trebuchet', value: 'project' });
    await interaction.respond(choices.filter((choice) => !typed || choice.name.toLowerCase().includes(typed)).slice(0, 25));
  }

  async function joinButton(interaction) {
    const [, action, groupKey, userId] = interaction.customId.split(':');
    const { actor, group, role } = await canHandleRequests(interaction, groupKey);
    await interaction.deferUpdate();
    const names = await roblox.usernames([userId]);
    const target = { id: userId, name: names.get(userId) || userId };
    if (action === 'accept') {
      await roblox.acceptJoinRequest(group.groupId, userId);
      await logChange({ group, target, from: 'Join request', to: 'Accepted into the group', by: `<@${interaction.user.id}>${actor ? ` (${actor.name}, ${role.name})` : ''}`, color: COLORS.good });
    } else {
      await roblox.declineJoinRequest(group.groupId, userId);
      await logChange({ group, target, from: 'Join request', to: 'Declined', by: `<@${interaction.user.id}>${actor ? ` (${actor.name}, ${role.name})` : ''}`, color: COLORS.bad });
    }
    await interaction.editReply(await pendingView(group));
  }

  // ---------- merit promotions ----------

  // The division's ranks by number: [{ name, rank }] for ranks 1 and up, lowest first.
  async function ranksByNumber(group) {
    return (await roblox.listRoles(group.groupId))
      .map((role) => ({ name: String(role.displayName || role.name || ''), rank: Number(role.rank) || 0 }))
      .filter((role) => role.rank >= 1 && role.rank <= 10)
      .sort((a, b) => a.rank - b.rank);
  }

  // Checks each division the account is in. Call after merit is paid.
  async function checkPromotions(account, merit) {
    const results = [];
    for (const group of GROUPS) {
      if (!group.earnable) continue;
      const current = (await roblox.getRoles(group.groupId, account.id).catch(() => []))[0];
      if (!current || current.rank < 1) continue;
      const limit = group.approval || group.earnable;
      if (current.rank >= limit) continue;
      const baseKey = `${group.key}:${account.id}`;
      if (typeof store.data.meritBase[baseKey] !== 'number') {
        store.data.meritBase[baseKey] = merit;
        store.save();
        continue;
      }
      if (merit - store.data.meritBase[baseKey] < CONFIG.ranking.meritPerRank) continue;
      const next = (await ranksByNumber(group)).find((role) => role.rank > current.rank);
      if (!next || next.rank > limit) continue;
      if (next.rank > group.earnable) {
        await requestApproval(group, account, current.name, next.name, merit);
        results.push({ group, account, to: next.name, pending: true });
        continue;
      }
      const result = await roblox.setRank(group.groupId, account.id, next.name);
      store.data.meritBase[baseKey] = merit;
      store.save();
      await logChange({ group, target: account, from: result.before, to: result.rank, by: 'Merit', reason: `${merit} merit`, color: COLORS.good, promotion: true });
      results.push({ group, account, to: next.name, pending: false });
    }
    return results;
  }

  // For /profile: the next merit step in each division.
  async function nextSteps(account, merit) {
    const lines = [];
    for (const group of GROUPS) {
      if (!group.earnable) continue;
      const current = (await roblox.getRoles(group.groupId, account.id).catch(() => []))[0];
      if (!current || current.rank < 1 || current.rank >= (group.approval || group.earnable)) continue;
      const next = (await ranksByNumber(group)).find((role) => role.rank > current.rank);
      if (!next) continue;
      const base = store.data.meritBase[`${group.key}:${account.id}`];
      const earned = typeof base === 'number' ? merit - base : 0;
      lines.push(`**${group.short}:** ${next.name} in ${Math.max(0, CONFIG.ranking.meritPerRank - earned)} merit${next.rank > group.earnable ? ' (needs approval)' : ''}`);
    }
    return lines;
  }

  async function requestApproval(group, account, from, to, merit) {
    const key = `${group.key}:${account.id}:${to}`;
    if (store.data.promotionRequests[key]?.open) return;
    const ping = await commandersOf(group);
    const embed = new EmbedBuilder()
      .setColor(COLORS.warn)
      .setAuthor({ name: `${group.short} · Promotion needs approval` })
      .setTitle(account.name)
      .setURL(`https://www.roblox.com/users/${account.id}/profile`)
      .setDescription(`Reached the merit for **${to}**, which needs the Commanding or Executive Officer to approve.`)
      .addFields({ name: 'From', value: from, inline: true }, { name: 'To', value: to, inline: true }, { name: 'Merit', value: String(merit), inline: true })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`promo:approve:${group.key}:${account.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`promo:deny:${group.key}:${account.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
    );
    const channel = await client.channels.fetch(CONFIG.channels.promotions || CONFIG.channels.rankLogs).catch(() => null);
    if (!channel) return;
    await channel.send({ content: ping.map((id) => `<@${id}>`).join(' ') || undefined, embeds: [embed], components: [row], allowedMentions: { users: ping } });
    store.data.promotionRequests[key] = { open: true, from, to, merit, at: new Date().toISOString() };
    store.save();
  }

  async function promoButton(interaction) {
    const [, action, groupKey, userId] = interaction.customId.split(':');
    const { actor, group, role } = await access.requireManager(interaction.user.id, groupKey);
    const request = Object.entries(store.data.promotionRequests).find(([key, value]) => key.startsWith(`${groupKey}:${userId}:`) && value.open);
    if (!request) throw new Error('This request was already handled.');
    const [key, value] = request;
    await interaction.deferUpdate();
    const names = await roblox.usernames([userId]);
    const target = { id: userId, name: names.get(userId) || userId };
    const by = `<@${interaction.user.id}> (${actor.name}, ${role.name})`;
    if (action === 'approve') {
      const result = await roblox.setRank(group.groupId, userId, value.to);
      store.data.meritBase[`${groupKey}:${userId}`] = value.merit;
      await logChange({ group, target, from: result.before, to: result.rank, by, reason: 'Approved promotion request', color: COLORS.good, promotion: true });
    }
    store.data.promotionRequests[key] = { ...value, open: false, result: action, by: interaction.user.id };
    store.save();
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(action === 'approve' ? COLORS.good : COLORS.bad)
      .addFields({ name: action === 'approve' ? 'Approved by' : 'Denied by', value: by });
    await interaction.editReply({ embeds: [embed], components: [] });
  }

  // ---------- buttons ----------

  async function button(interaction) {
    if (!interaction.isButton()) return false;
    try {
      if (interaction.customId.startsWith('join:')) { await joinButton(interaction); return true; }
      if (interaction.customId.startsWith('promo:')) { await promoButton(interaction); return true; }
    } catch (error) {
      const content = `That failed: ${String(error.message).slice(0, 1500)}`;
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
    return false;
  }

  return { rankCommand, changeRank, checkTarget, changedNote, autocomplete, pendingCommand, pendingAutocomplete, checkPromotions, nextSteps, logChange, button, canHandleRequests, pendingView, commandersOf };
}
