// Announcements: /announce opens a form; the bot posts it to the announcements channel as a card.
import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { CONFIG } from './config.js';

export function canAnnounce(member) {
  if (member?.permissions?.has('ManageGuild')) return true;
  return Boolean(CONFIG.roles.announcer && member?.roles?.cache?.has(CONFIG.roles.announcer));
}

const input = (id, label, style, required, max, value = '') => {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
  if (value) field.setValue(value.slice(0, max));
  return new ActionRowBuilder().addComponents(field);
};

export function createAnnouncements({ client }) {
  async function command(interaction) {
    if (!CONFIG.channels.announcements) {
      await interaction.reply({ content: 'Set CHANNEL_ANNOUNCEMENTS on Railway first.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!canAnnounce(interaction.member)) {
      await interaction.reply({ content: 'You need the announcer role to post announcements.', flags: MessageFlags.Ephemeral });
      return;
    }
    const ping = interaction.options.getString('ping') || 'none';
    const role = interaction.options.getRole('role');
    const editId = interaction.options.getString('edit_message_id') || '';
    let current = null;
    if (editId) {
      const channel = await client.channels.fetch(CONFIG.channels.announcements);
      const message = await channel.messages.fetch(editId).catch(() => null);
      if (!message || message.author.id !== client.user.id) {
        await interaction.reply({ content: 'That message is not one of my announcements.', flags: MessageFlags.Ephemeral });
        return;
      }
      current = message.embeds[0] || null;
    }
    const modal = new ModalBuilder()
      .setCustomId(`announce:${ping}:${role?.id || '0'}:${editId || '0'}`)
      .setTitle(editId ? 'Edit announcement' : 'New announcement')
      .addComponents(
        input('title', 'Title', TextInputStyle.Short, true, 256, current?.title || ''),
        input('body', 'Message', TextInputStyle.Paragraph, true, 4000, current?.description || ''),
        input('image', 'Image link (optional)', TextInputStyle.Short, false, 500, current?.image?.url || ''),
        input('footer', 'Footer (optional)', TextInputStyle.Short, false, 200, current?.footer?.text || '')
      );
    await interaction.showModal(modal);
  }

  async function submit(interaction) {
    if (!interaction.isModalSubmit() || !interaction.customId.startsWith('announce:')) return false;
    if (!canAnnounce(interaction.member)) {
      await interaction.reply({ content: 'You need the announcer role to post announcements.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const [, ping, roleId, editId] = interaction.customId.split(':');
    const value = (id) => interaction.fields.getTextInputValue(id).trim();
    const embed = new EmbedBuilder()
      .setTitle(value('title'))
      .setDescription(value('body'))
      .setColor(CONFIG.brandColor)
      .setAuthor({ name: `${CONFIG.brandName} Announcement`, iconURL: interaction.guild?.iconURL() || undefined })
      .setTimestamp();
    const image = value('image');
    if (image) {
      if (!/^https?:\/\/\S+$/i.test(image)) {
        await interaction.reply({ content: 'The image needs to be a full link starting with https://.', flags: MessageFlags.Ephemeral });
        return true;
      }
      embed.setImage(image);
    }
    embed.setFooter({ text: value('footer') || `Posted by ${interaction.member?.displayName || interaction.user.username}` });

    const channel = await client.channels.fetch(CONFIG.channels.announcements);
    if (editId !== '0') {
      const message = await channel.messages.fetch(editId);
      await message.edit({ embeds: [embed] });
      await interaction.reply({ content: `Updated: ${message.url}`, flags: MessageFlags.Ephemeral });
      return true;
    }
    const content = ping === 'everyone' ? '@everyone' : ping === 'here' ? '@here' : ping === 'role' && roleId !== '0' ? `<@&${roleId}>` : undefined;
    const allowedMentions = ping === 'everyone' || ping === 'here' ? { parse: ['everyone'] } : ping === 'role' ? { roles: [roleId] } : { parse: [] };
    const message = await channel.send({ content, embeds: [embed], allowedMentions });
    await interaction.reply({ content: `Posted: ${message.url}`, flags: MessageFlags.Ephemeral });
    return true;
  }

  return { command, submit };
}
