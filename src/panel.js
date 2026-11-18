// The rank panel: one message in the rank panel channel with buttons, so nobody has to remember commands.
//   Change a rank    pick a group you command, enter a Roblox user, pick their new rank
//   Join requests    pick a group, accept or decline who is waiting
//   Vehicle license  same as Change a rank, in the certification group
//   Look up          someone's ranks in every group, their link and blacklist status
// Everything is private to the person using it, permissions come from their Roblox ranks, and every change goes
// to the rank log. Messages people type in the channel are removed to keep the panel on top.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { CONFIG } from './config.js';
import { GROUPS, groupByKey } from './groups.js';
import { COLORS, note } from './ui.js';

const PANEL_TAG = 'Rank Panel';

export function createRankPanel({ client, store, roblox, access, ranking }) {
  const reasons = new Map(); // `${discordId}:${groupKey}:${targetId}` -> reason typed in the form

  function panelMessage() {
    const embed = new EmbedBuilder()
      .setColor(CONFIG.brandColor)
      .setAuthor({ name: `${CONFIG.brandName} · ${PANEL_TAG}` })
      .setTitle('Rank Panel')
      .setDescription([
        'Manage ranks for the groups you command. Only you see your menus.',
        '',
        '**Change a rank**: promote, demote or assign someone in one of your groups.',
        '**Join requests**: accept or decline people waiting to join.',
        '**Vehicle license**: give or change a driving or flying certification.',
        '**Look up**: see someone\'s ranks in every group.',
        '',
        '-# You only see groups where your verified Roblox account holds a command rank, and only ranks below yours. Every change is logged with your name.'
      ].join('\n'))
      .setFooter({ text: 'Not linked yet? Use /link first.' });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel:rank').setLabel('Change a rank').setEmoji('🎖️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('panel:pending').setLabel('Join requests').setEmoji('📥').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel:license').setLabel('Vehicle license').setEmoji('🚙').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel:lookup').setLabel('Look up').setEmoji('🔎').setStyle(ButtonStyle.Secondary)
    );
    return { embeds: [embed], components: [row] };
  }

  // Posts the panel, or updates the one already there.
  async function post() {
    if (!CONFIG.rankPanel) return;
    const channel = await client.channels.fetch(CONFIG.rankPanel).catch(() => null);
    if (!channel?.isTextBased()) return;
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const existing = recent?.find((message) => message.author.id === client.user.id && message.embeds[0]?.author?.name?.endsWith(PANEL_TAG));
    if (existing) await existing.edit(panelMessage());
    else await channel.send(panelMessage());
  }

  const groupMenu = (id, groups, placeholder) => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(
      groups.slice(0, 25).map(({ group, role }) => ({ label: group.short, value: group.key, description: role ? `You: ${role.name}`.slice(0, 100) : undefined }))
    )
  );

  function whoModal(groupKey) {
    const group = groupByKey(groupKey);
    return new ModalBuilder()
      .setCustomId(`panel:who:${groupKey}`)
      .setTitle(`${group.short}: who?`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user').setLabel('Roblox username or user ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason (shown in the rank log)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500))
      );
  }

  const lookupModal = () => new ModalBuilder()
    .setCustomId('panel:lookupform')
    .setTitle('Look someone up')
    .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('user').setLabel('Roblox username or user ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)));

  async function handle(interaction) {
    const id = interaction.customId || '';
    if (!id.startsWith('panel:')) return false;
    try {
      // ----- buttons on the panel -----
      if (interaction.isButton() && id === 'panel:rank') {
        const groups = (await access.managedGroups(interaction.user.id)).filter(({ group }) => group.key !== 'vehicles');
        if (!access.actorOf(interaction.user.id)) throw new Error('Link and verify your Roblox account with /link first.');
        if (!groups.length) throw new Error('Your Roblox account does not hold a command rank in any group, so there is nothing for you to manage.');
        if (groups.length === 1) return interaction.showModal(whoModal(groups[0].group.key)).then(() => true);
        await interaction.reply({ embeds: [note('Which group?')], components: [groupMenu('panel:group', groups, 'Pick a group you command')], flags: MessageFlags.Ephemeral });
        return true;
      }
      if (interaction.isButton() && id === 'panel:license') {
        await access.requireManager(interaction.user.id, 'vehicles');
        await interaction.showModal(whoModal('vehicles'));
        return true;
      }
      if (interaction.isButton() && id === 'panel:pending') {
        const groups = await access.managedGroups(interaction.user.id).catch(() => []);
        const waveMod = interaction.member?.permissions?.has('ManageGuild') || (CONFIG.roles.waveModerator && interaction.member?.roles?.cache?.has(CONFIG.roles.waveModerator));
        if (waveMod && groupByKey('project') && !groups.some(({ group }) => group.key === 'project')) groups.unshift({ group: groupByKey('project'), role: { name: 'Wave Moderator' } });
        if (!groups.length) throw new Error('You do not manage any group\'s join requests.');
        await interaction.reply({ embeds: [note('Which group\'s join requests?')], components: [groupMenu('panel:requests', groups, 'Pick a group')], flags: MessageFlags.Ephemeral });
        return true;
      }
      if (interaction.isButton() && id === 'panel:lookup') {
        await interaction.showModal(lookupModal());
        return true;
      }

      // ----- menus -----
      if (interaction.isStringSelectMenu() && id === 'panel:group') {
        await interaction.showModal(whoModal(interaction.values[0]));
        return true;
      }
      if (interaction.isStringSelectMenu() && id === 'panel:requests') {
        await interaction.deferUpdate();
        const { group } = await ranking.canHandleRequests(interaction, interaction.values[0]);
        await interaction.editReply(await ranking.pendingView(group));
        return true;
      }
      if (interaction.isStringSelectMenu() && id.startsWith('panel:pick:')) {
        const [, , groupKey, targetId] = id.split(':');
        await interaction.deferUpdate();
        const names = await roblox.usernames([targetId]);
        const target = { id: targetId, name: names.get(targetId) || targetId };
        const reasonKey = `${interaction.user.id}:${groupKey}:${targetId}`;
        const result = await ranking.changeRank({ discordUserId: interaction.user.id, groupKey, target, rankName: interaction.values[0], reason: reasons.get(reasonKey) || null });
        reasons.delete(reasonKey);
        await interaction.editReply({ embeds: [ranking.changedNote(target, result)], components: [] });
        return true;
      }

      // ----- forms -----
      if (interaction.isModalSubmit() && id.startsWith('panel:who:')) {
        const groupKey = id.split(':')[2];
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { actor, group, role } = await access.requireManager(interaction.user.id, groupKey);
        const target = await roblox.resolveUser(interaction.fields.getTextInputValue('user'));
        const current = await ranking.checkTarget(group, role, actor, target);
        const reason = interaction.fields.getTextInputValue('reason')?.trim();
        reasons.set(`${interaction.user.id}:${groupKey}:${target.id}`, reason || null);
        const project = group.kind === 'project';
        const held = project ? (await roblox.getRoles(group.groupId, target.id)).map((entry) => entry.name.toLowerCase()) : [];
        const ranks = (await access.assignableRanks(group, role)).filter((rank) => project || rank.name.toLowerCase() !== current.name.toLowerCase());
        if (!ranks.length) throw new Error('There is no other rank you can give them.');
        const headshot = await roblox.headshotUrl(target.id).catch(() => null);
        const embed = new EmbedBuilder()
          .setColor(COLORS.info)
          .setAuthor({ name: `${group.short} · Change a rank` })
          .setTitle(target.name)
          .setURL(`https://www.roblox.com/users/${target.id}/profile`)
          .addFields({ name: project ? 'Current roles' : 'Current rank', value: project ? held.map((name) => ranks.find((rank) => rank.name.toLowerCase() === name)?.name || name).join(', ') || current.name : current.name, inline: true }, { name: 'Reason', value: reason || 'None given', inline: true })
          .setFooter({ text: group.earnable ? `Ranks above rank ${group.earnable} notify the Commanding and Executive Officers.` : 'Pick the new rank below.' });
        if (headshot) embed.setThumbnail(headshot);
        const menu = new StringSelectMenuBuilder()
          .setCustomId(`panel:pick:${groupKey}:${target.id}`)
          .setPlaceholder(project ? 'Pick a role to give or take away' : 'Pick the new rank')
          .addOptions(ranks.slice(0, 25).map((rank) => {
            const has = held.includes(rank.name.toLowerCase());
            return {
              label: rank.name.slice(0, 100),
              value: rank.name.slice(0, 100),
              description: project ? (has ? 'Has it: take it away' : 'Give this role') : rank.rank > current.rank ? 'Promotion' : 'Demotion',
              emoji: project ? (has ? '➖' : '➕') : rank.rank > current.rank ? '⬆️' : '⬇️'
            };
          }));
        await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
        return true;
      }
      if (interaction.isModalSubmit() && id === 'panel:lookupform') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const target = await roblox.resolveUser(interaction.fields.getTextInputValue('user'));
        const ranks = await Promise.all(GROUPS.map((group) => roblox.getRank(group.groupId, target.id).catch(() => null)));
        const lines = GROUPS.map((group, index) => ranks[index] && `**${group.short}:** ${ranks[index]}`).filter(Boolean);
        const discordId = store.discordFor(target.id);
        const blacklisted = store.data.blacklist?.users?.[target.id];
        const headshot = await roblox.headshotUrl(target.id).catch(() => null);
        const embed = new EmbedBuilder()
          .setColor(blacklisted ? COLORS.bad : COLORS.info)
          .setAuthor({ name: 'Look up' })
          .setTitle(target.name)
          .setURL(`https://www.roblox.com/users/${target.id}/profile`)
          .addFields(
            { name: 'Ranks', value: lines.join('\n') || 'Not in any of our groups' },
            { name: 'Discord', value: discordId ? `<@${discordId}> (verified)` : 'Not linked', inline: true },
            { name: 'Blacklist', value: blacklisted ? `⛔ ${blacklisted.reason}` : 'Clear', inline: true }
          );
        if (headshot) embed.setThumbnail(headshot);
        await interaction.editReply({ embeds: [embed] });
        return true;
      }
    } catch (error) {
      const embeds = [note(String(error.message || error).slice(0, 1500), COLORS.bad)];
      if (interaction.deferred || interaction.replied) await interaction.editReply({ embeds, components: [] }).catch(() => {});
      else await interaction.reply({ embeds, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
    return false;
  }

  return { post, handle };
}
