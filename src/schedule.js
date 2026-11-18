// Event scheduling: a host posts an upcoming event with /schedule. Members answer Attending, Maybe or Can't
// with buttons. 30 minutes before the start the bot pings the event role and everyone attending. When it is over,
// the host presses Log attendance, which opens the usual pay preview with the attending members filled in.
import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { CONFIG } from './config.js';
import { EVENT_TYPES } from './rewards.js';
import { canHost } from './events.js';

const REMIND_MINUTES = 30;
const ANSWERS = { yes: 'Attending', maybe: 'Maybe', no: "Can't make it" };

// Minutes between UTC and the time zone at a given moment (positive east of UTC).
function zoneOffset(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

// Reads "2026-11-20 19:30", "11/20 19:30", "19:30" (today, or tomorrow if passed), "in 2h", "in 90m" or "in 1h30m".
export function parseWhen(text, { now = new Date(), timeZone = CONFIG.timeZone } = {}) {
  const value = String(text || '').trim().toLowerCase();
  const relative = value.match(/^in\s+(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/);
  if (relative && (relative[1] || relative[2])) {
    return new Date(now.getTime() + ((Number(relative[1]) || 0) * 60 + (Number(relative[2]) || 0)) * 60_000);
  }
  const local = (year, month, day, hour, minute) => {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    const first = guess - zoneOffset(new Date(guess), timeZone) * 60_000;
    return new Date(guess - zoneOffset(new Date(first), timeZone) * 60_000);
  };
  const clock = (h, m, ampm) => {
    let hour = Number(h);
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    return [hour, Number(m || 0)];
  };
  const today = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(now).map((part) => [part.type, Number(part.value)]));

  let match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ t]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (match) return local(+match[1], +match[2], +match[3], ...clock(match[4], match[5], match[6]));
  match = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (match) return local(+(match[3] || today.year), +match[1], +match[2], ...clock(match[4], match[5], match[6]));
  match = value.match(/^(?:(today|tomorrow)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (match && (match[3] || match[4] || match[1])) {
    let date = local(today.year, today.month, today.day, ...clock(match[2], match[3], match[4]));
    if (match[1] === 'tomorrow' || (!match[1] && date < now)) date = new Date(date.getTime() + 86400_000);
    return date;
  }
  return null;
}

export function createSchedule({ client, store, events }) {
  store.data.schedule ??= {};

  const channelId = () => CONFIG.channels.schedule;

  function card(entry) {
    const type = EVENT_TYPES[entry.type];
    const unix = Math.floor(entry.at / 1000);
    const people = (answer) => Object.entries(entry.answers || {}).filter(([, value]) => value === answer).map(([id]) => `<@${id}>`);
    const list = (ids) => (ids.length ? ids.slice(0, 40).join(' ') + (ids.length > 40 ? ` +${ids.length - 40}` : '') : '-# Nobody yet');
    const status = entry.cancelled ? '❌ Cancelled' : entry.logged ? '✅ Logged' : Date.now() > entry.at ? '🟢 Started' : `Starts <t:${unix}:R>`;
    const embed = new EmbedBuilder()
      .setColor(entry.cancelled ? 0x4f545c : entry.logged ? 0x57f287 : CONFIG.brandColor)
      .setAuthor({ name: `${CONFIG.brandName} · Scheduled Event` })
      .setTitle(`📅  ${entry.title || type?.name || 'Event'}`)
      .setDescription(entry.description || null)
      .addFields(
        { name: 'When', value: `<t:${unix}:F>\n${status}`, inline: true },
        { name: 'Type', value: type?.name || entry.type, inline: true },
        { name: 'Host', value: `<@${entry.host}>`, inline: true },
        { name: `✅ Attending (${people('yes').length})`, value: list(people('yes')) },
        { name: `❔ Maybe (${people('maybe').length})`, value: list(people('maybe')), inline: true },
        { name: `❌ Can't (${people('no').length})`, value: String(people('no').length), inline: true }
      )
      .setFooter({ text: `Times show in your own time zone. Event ${entry.id}` });
    const open = !entry.cancelled && !entry.logged;
    const rows = [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sched:yes:${entry.id}`).setLabel('Attending').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(!open),
      new ButtonBuilder().setCustomId(`sched:maybe:${entry.id}`).setLabel('Maybe').setEmoji('❔').setStyle(ButtonStyle.Secondary).setDisabled(!open),
      new ButtonBuilder().setCustomId(`sched:no:${entry.id}`).setLabel("Can't").setEmoji('❌').setStyle(ButtonStyle.Secondary).setDisabled(!open)
    )];
    if (open) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sched:log:${entry.id}`).setLabel('Log attendance').setEmoji('📝').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`sched:cancel:${entry.id}`).setLabel('Cancel event').setStyle(ButtonStyle.Danger)
      ));
    }
    return { embeds: [embed], components: rows };
  }

  async function refresh(entry) {
    const channel = await client.channels.fetch(entry.channelId).catch(() => null);
    const message = await channel?.messages.fetch(entry.messageId).catch(() => null);
    if (message) await message.edit(card(entry)).catch(() => {});
  }

  async function command(interaction) {
    if (!canHost(interaction.member)) {
      await interaction.reply({ content: 'Only event hosts can schedule events.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!channelId()) {
      await interaction.reply({ content: 'Set CHANNEL_EVENT_SCHEDULE (or CHANNEL_ANNOUNCEMENTS) on Railway first.', flags: MessageFlags.Ephemeral });
      return;
    }
    const when = parseWhen(interaction.options.getString('when', true));
    if (!when || Number.isNaN(when.getTime())) {
      await interaction.reply({ content: `I could not read that time. Try \`2026-11-20 19:30\`, \`7:30pm\`, \`tomorrow 19:00\` or \`in 2h\` (${CONFIG.timeZone}).`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (when.getTime() < Date.now() - 5 * 60_000) {
      await interaction.reply({ content: `That time has already passed (<t:${Math.floor(when / 1000)}:F>).`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const entry = {
      id: crypto.randomBytes(4).toString('hex'),
      type: interaction.options.getString('type', true),
      title: interaction.options.getString('title') || null,
      description: interaction.options.getString('description') || null,
      at: when.getTime(),
      host: interaction.user.id,
      answers: { [interaction.user.id]: 'yes' },
      reminded: when.getTime() - Date.now() < REMIND_MINUTES * 60_000,
      channelId: channelId()
    };
    const channel = await client.channels.fetch(entry.channelId);
    const ping = interaction.options.getBoolean('ping') !== false && CONFIG.roles.eventNotifications;
    const message = await channel.send({
      content: ping ? `<@&${CONFIG.roles.eventNotifications}>` : undefined,
      ...card(entry),
      allowedMentions: { roles: ping ? [CONFIG.roles.eventNotifications] : [] }
    });
    entry.messageId = message.id;
    store.data.schedule[entry.id] = entry;
    store.save();
    await interaction.editReply(`Scheduled for <t:${Math.floor(entry.at / 1000)}:F>: ${message.url}`);
  }

  function attendeeNames(entry) {
    const names = [];
    for (const [discordId, answer] of Object.entries(entry.answers || {})) {
      if (answer !== 'yes' || discordId === entry.host) continue;
      const link = store.linkedRoblox(discordId);
      if (link) names.push(link.name);
    }
    return names;
  }

  async function button(interaction) {
    if (interaction.isModalSubmit() && interaction.customId.startsWith('schedlog:')) {
      const entry = store.data.schedule[interaction.customId.split(':')[1]];
      if (!entry) return interaction.reply({ content: 'That event no longer exists.', flags: MessageFlags.Ephemeral }).then(() => true);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const objective = /^(y|yes|true|1)/i.test(interaction.fields.getTextInputValue('objective').trim());
      await interaction.editReply(await events.preview({
        hostDiscordId: interaction.user.id,
        type: entry.type,
        objective,
        attendees: interaction.fields.getTextInputValue('attendees'),
        fallen: interaction.fields.getTextInputValue('fallen') || '',
        notes: interaction.fields.getTextInputValue('notes') || (entry.title ? `Scheduled: ${entry.title}` : ''),
        scheduleId: entry.id
      }));
      return true;
    }
    if (!interaction.isButton() || !interaction.customId.startsWith('sched:')) return false;
    const [, action, id] = interaction.customId.split(':');
    const entry = store.data.schedule[id];
    if (!entry) {
      await interaction.reply({ content: 'That event no longer exists.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const isHost = interaction.user.id === entry.host || interaction.member?.permissions?.has('ManageGuild');

    if (action in ANSWERS) {
      entry.answers ??= {};
      if (entry.answers[interaction.user.id] === action) delete entry.answers[interaction.user.id];
      else entry.answers[interaction.user.id] = action;
      store.save();
      await interaction.update(card(entry));
      if (action === 'yes' && !store.linkedRoblox(interaction.user.id)) {
        await interaction.followUp({ content: 'You are marked as attending. Link your Roblox account with /link so the host can pay you without typing your name.', flags: MessageFlags.Ephemeral });
      }
      return true;
    }
    if (!isHost) {
      await interaction.reply({ content: 'Only the host can do that.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action === 'cancel') {
      entry.cancelled = true;
      store.save();
      await interaction.update(card(entry));
      const going = Object.entries(entry.answers || {}).filter(([user, answer]) => answer === 'yes' && user !== entry.host).map(([user]) => `<@${user}>`);
      if (going.length) await interaction.followUp({ content: `${going.join(' ')} The event **${entry.title || EVENT_TYPES[entry.type]?.name}** was cancelled.`, allowedMentions: { users: going.map((m) => m.slice(2, -1)) } }).catch(() => {});
      return true;
    }
    if (action === 'log') {
      const names = attendeeNames(entry);
      const modal = new ModalBuilder().setCustomId(`schedlog:${entry.id}`).setTitle('Log attendance').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('attendees').setLabel('Attendees (Roblox usernames)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(names.join(', ').slice(0, 4000) || '').setPlaceholder('Add anyone who came without pressing Attending')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('objective').setLabel('Objective completed? (yes or no)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue('yes')),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fallen').setLabel('Fallen (usernames, optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('notes').setLabel('Notes (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000))
      );
      if (!names.length) modal.components[0].components[0].setValue('');
      await interaction.showModal(modal);
      return true;
    }
    return false;
  }

  // Called by events.js once a scheduled event's pay is confirmed.
  async function markLogged(scheduleId, eventId) {
    const entry = store.data.schedule[scheduleId];
    if (!entry) return;
    entry.logged = eventId;
    store.save();
    await refresh(entry);
  }

  async function tick() {
    const now = Date.now();
    for (const entry of Object.values(store.data.schedule)) {
      if (entry.cancelled || entry.logged) continue;
      // Old events nobody logged: close them after two days.
      if (now - entry.at > 2 * 86400_000) {
        entry.logged = 'expired';
        store.save();
        await refresh(entry);
        continue;
      }
      if (!entry.reminded && entry.at - now <= REMIND_MINUTES * 60_000) {
        entry.reminded = true;
        store.save();
        const channel = await client.channels.fetch(entry.channelId).catch(() => null);
        const going = Object.entries(entry.answers || {}).filter(([, answer]) => answer === 'yes').map(([user]) => user);
        const role = CONFIG.roles.eventNotifications;
        await channel?.send({
          content: `${role ? `<@&${role}> ` : ''}${going.map((user) => `<@${user}>`).join(' ')}\n**${entry.title || EVENT_TYPES[entry.type]?.name}** starts <t:${Math.floor(entry.at / 1000)}:R>. Hosted by <@${entry.host}>.`,
          reply: { messageReference: entry.messageId, failIfNotExists: false },
          allowedMentions: { roles: role ? [role] : [], users: going }
        }).catch((error) => console.error('[Schedule reminder]', error));
      }
      if (!entry.started && now >= entry.at) {
        entry.started = true;
        store.save();
        await refresh(entry);
      }
    }
  }

  function start() {
    setInterval(() => tick().catch((error) => console.error('[Schedule]', error)), 60_000).unref();
  }

  async function upcoming(interaction) {
    const list = Object.values(store.data.schedule)
      .filter((entry) => !entry.cancelled && !entry.logged && entry.at > Date.now() - 3 * 3600_000)
      .sort((a, b) => a.at - b.at).slice(0, 10);
    const embed = new EmbedBuilder().setColor(CONFIG.brandColor).setAuthor({ name: `${CONFIG.brandName} · Upcoming Events` })
      .setDescription(list.length
        ? list.map((entry) => `**${entry.title || EVENT_TYPES[entry.type]?.name}**  ·  <t:${Math.floor(entry.at / 1000)}:F> (<t:${Math.floor(entry.at / 1000)}:R>)\n-# Host <@${entry.host}>  ·  ${Object.values(entry.answers || {}).filter((a) => a === 'yes').length} attending  ·  [Open](https://discord.com/channels/${CONFIG.guildId}/${entry.channelId}/${entry.messageId})`).join('\n\n')
        : 'No events are scheduled.');
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  return { command, upcoming, button, markLogged, start };
}
