// Ranking through Discord, scoped by Roblox rank:
//   /rank      change someone's rank in a group you manage (you only see that group's ranks below yours)
//   /pending   see who asked to join a group you manage, and accept or decline them
//   /ladder    set the merit ladder for a group you manage
// Merit promotions: every MERIT_PER_RANK merit earned since the last promotion moves someone one step up their
// group's ladder. The ladder's approval rank (the top NCO rank) is never automatic: the group's commanders get a
// request to approve or deny. Every change is logged with who made it and in which group.
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
  store.data.ladders ??= {};
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
      if (rank && isManagerRank(group, rank)) ids.push(discordId);
    }
    return ids;
  }

  // ---------- /rank ----------

  // fixedGroup: /license always works on the vehicle certification group.
  async function rankCommand(interaction, fixedGroup = null) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { actor, group, role } = await access.requireManager(interaction.user.id, fixedGroup || interaction.options.getString('group', true));
    const target = await roblox.resolveUser(interaction.options.getString('roblox_user', true));
    if (target.id === actor.id) throw new Error('You cannot change your own rank.');
    const current = (await roblox.getRoles(group.groupId, target.id))[0];
    if (!current) throw new Error(`${target.name} is not in ${group.short}. Check /pending if they asked to join.`);
    if (current.rank >= role.rank) throw new Error(`${target.name} is ${current.name}, which is not below your rank. You cannot change them.`);
    const wanted = interaction.options.getString('new_rank', true);
    const allowed = await access.assignableRanks(group, role);
    const rank = allowed.find((entry) => same(entry.name, wanted));
    if (!rank) throw new Error(`"${wanted}" is not a rank you can give in ${group.short}. Pick one from the list.`);

    // The top NCO rank and above need the commanders, unless a commander is the one doing it.
    const ladder = store.data.ladders[group.key];
    const approval = ladder?.approval ? allowed.find((entry) => same(entry.name, ladder.approval)) || null : null;
    const needsCommand = approval && rank.rank >= approval.rank && !/commanding officer/i.test(role.name);

    const result = await roblox.setRank(group.groupId, target.id, rank.name);
    access.forget(group, target.id);
    const reason = interaction.options.getString('reason') || null;
    const ping = needsCommand ? (await commandersOf(group)).filter((id) => id !== interaction.user.id) : [];
    await logChange({
      group, target, from: result.before, to: result.rank, by: `<@${interaction.user.id}> (${actor.name}, ${role.name})`,
      reason: needsCommand ? `${reason ? `${reason}\n` : ''}⚠️ ${rank.name} is at or above ${ladder.approval}. Commanders notified.` : reason,
      color: needsCommand ? COLORS.warn : COLORS.info,
      promotion: rank.rank > current.rank,
      ping
    });
    store.data.meritBase[`${group.key}:${target.id}`] = null; // next merit step counts from their next check
    store.save();
    await interaction.editReply({ embeds: [note(`✅ **${target.name}** in ${group.short}: ${result.before} → **${result.rank}**${needsCommand ? '\nThe commanders were notified, because this is at or above the approval rank.' : ''}`, COLORS.good)] });
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
      const groupKey = interaction.commandName === 'license' ? 'vehicles' : interaction.options.getString('group');
      if (!groupKey) return interaction.respond([]);
      const { group, role } = await access.requireManager(interaction.user.id, groupKey);
      const ranks = await access.assignableRanks(group, role);
      await interaction.respond(ranks
        .filter((rank) => !typed || rank.name.toLowerCase().includes(typed))
        .slice(0, 25)
        .map((rank) => ({ name: rank.name.slice(0, 100), value: rank.name.slice(0, 100) })));
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

  // ---------- /ladder ----------

  async function ladderCommand(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { group, role } = await access.requireManager(interaction.user.id, interaction.options.getString('group', true));
    const text = interaction.options.getString('ranks');
    if (!text) {
      const ladder = store.data.ladders[group.key];
      await interaction.editReply({ embeds: [new EmbedBuilder()
        .setColor(COLORS.info)
        .setAuthor({ name: `${group.short} · Merit ladder` })
        .setDescription(ladder?.ranks?.length
          ? ladder.ranks.map((name, index) => `${index + 1}. ${name}${same(name, ladder.approval) ? '  ·  needs commander approval' : ''}`).join('\n')
          : 'No ladder yet, so nobody in this group is promoted by merit. Set one with `/ladder ranks:` like `Private > Lance Corporal > Corporal`.')
        .setFooter({ text: `Each step takes ${CONFIG.ranking.meritPerRank} merit earned since the last promotion.` })] });
      return;
    }
    const allowed = await access.assignableRanks(group, role);
    const names = text.split('>').map((part) => part.trim()).filter(Boolean);
    const ranks = [];
    for (const name of names) {
      const found = allowed.find((entry) => same(entry.name, name));
      if (!found) throw new Error(`"${name}" is not a rank below yours in ${group.short}.`);
      ranks.push(found.name);
    }
    if (ranks.length < 2) throw new Error('A ladder needs at least two ranks, lowest first, separated by >.');
    const approvalInput = interaction.options.getString('approval_rank');
    const approval = approvalInput ? ranks.find((name) => same(name, approvalInput)) : ranks[ranks.length - 1];
    if (!approval) throw new Error('The approval rank must be one of the ladder ranks.');
    store.data.ladders[group.key] = { ranks, approval, by: interaction.user.id, at: new Date().toISOString() };
    store.save();
    await interaction.editReply({ embeds: [note(`✅ ${group.short} ladder saved:\n${ranks.map((name) => (same(name, approval) ? `**${name}** (needs approval)` : name)).join(' → ')}`, COLORS.good)] });
  }

  // ---------- merit promotions ----------

  // Checks every group with a ladder that the account is in. Call after merit is paid.
  async function checkPromotions(account, merit) {
    const results = [];
    for (const group of GROUPS) {
      const ladder = store.data.ladders[group.key];
      if (!ladder?.ranks?.length) continue;
      const current = await roblox.getRank(group.groupId, account.id).catch(() => null);
      const index = ladder.ranks.findIndex((name) => same(name, current));
      if (index < 0 || index >= ladder.ranks.length - 1) continue;
      const baseKey = `${group.key}:${account.id}`;
      if (typeof store.data.meritBase[baseKey] !== 'number') {
        store.data.meritBase[baseKey] = merit;
        store.save();
        continue;
      }
      if (merit - store.data.meritBase[baseKey] < CONFIG.ranking.meritPerRank) continue;
      const next = ladder.ranks[index + 1];
      if (same(next, ladder.approval)) {
        await requestApproval(group, account, current, next, merit);
        results.push({ group, account, to: next, pending: true });
        continue;
      }
      const result = await roblox.setRank(group.groupId, account.id, next);
      store.data.meritBase[baseKey] = merit;
      store.save();
      await logChange({ group, target: account, from: result.before, to: result.rank, by: 'Merit', reason: `${merit} merit`, color: COLORS.good, promotion: true });
      results.push({ group, account, to: next, pending: false });
    }
    return results;
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
      .setDescription(`Reached the merit for **${to}**, which needs a commander's approval.`)
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

  return { rankCommand, autocomplete, pendingCommand, pendingAutocomplete, ladderCommand, checkPromotions, logChange, button };
}
