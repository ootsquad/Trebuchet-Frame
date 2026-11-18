// In-game events. When an event ends in game, the server writes a report (who attended, for how long, who died)
// to the data store TrebuchetEvents. The bot picks it up and sends the host a card in their DMs (or the event
// log channel when they have no linked Discord account or closed DMs). The host says whether the objective was
// completed, checks the usual pay preview and presses Confirm. Nothing is paid until then.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { CONFIG } from './config.js';
import { EVENT_TYPES } from './rewards.js';
import { canHost } from './events.js';

const STORE = 'TrebuchetEvents';
const KEY = 'reports';
const MAX_AGE_MS = 7 * 86400_000;

const list = (names, max = 1000) => {
  let text = '';
  for (const name of names) {
    if (text.length + name.length + 2 > max - 20) return `${text}, and ${names.length - text.split(', ').length} more`;
    text += `${text ? ', ' : ''}${name}`;
  }
  return text || 'None';
};

export function createGameEvents({ client, store, roblox, events }) {
  store.data.gameReports ??= {};
  const reports = store.data.gameReports;

  // A scheduled event by the same host, of the same type, that started within 3 hours of the in-game one.
  function matchSchedule(report, hostDiscordId) {
    if (!hostDiscordId) return null;
    const started = Number(report.Started) * 1000;
    return Object.values(store.data.schedule || {}).find((entry) => !entry.cancelled && !entry.logged &&
      entry.host === hostDiscordId && entry.type === report.Type && Math.abs(entry.at - started) < 3 * 3600_000) || null;
  }

  function card(entry) {
    const report = entry.report;
    const attendees = report.Attendees || [];
    const left = report.LeftEarly || [];
    const died = attendees.filter((row) => row.Died);
    const state = entry.status === 'paid' ? 'Paid' : entry.status === 'dismissed' ? 'Dismissed' : 'Waiting for the host';
    const embed = new EmbedBuilder()
      .setColor(entry.status === 'paid' ? 0x3ba55d : entry.status === 'dismissed' ? 0x4f545c : 0xfee75c)
      .setAuthor({ name: `${CONFIG.brandName} · In-Game Event Report` })
      .setTitle(report.TypeName || EVENT_TYPES[report.Type]?.name || 'Event')
      .setDescription(entry.status === 'new' || entry.status === 'sent'
        ? 'This event ended in game. Was the objective completed? You will see the pay before anything is sent.'
        : null)
      .addFields(
        { name: 'Host', value: `${report.HostName}${entry.hostDiscordId ? ` (<@${entry.hostDiscordId}>)` : ''}${report.CoHost ? `\nCo-host: ${report.CoHost}` : ''}`, inline: true },
        { name: 'When', value: `<t:${report.Started}:f>\n${report.Minutes} min`, inline: true },
        { name: 'Status', value: state, inline: true },
        { name: `Attendees (${attendees.length})`, value: list(attendees.map((row) => row.Name)) },
        { name: `Died during the event (${died.length})`, value: list(died.map((row) => row.Name)), inline: true },
        { name: `Left early (${left.length})`, value: list(left.map((row) => `${row.Name} ${row.Minutes}m`)), inline: true }
      )
      .setFooter({ text: `Counted as attending: in the server for ${CONFIG.events.gameAttendancePercent}% of the event. Ended by ${report.EndedBy || 'unknown'}. Report ${report.Id}` });
    if (entry.scheduleId) embed.addFields({ name: 'Scheduled event', value: 'Linked to the scheduled event. It will show as logged once paid.' });
    if (entry.eventId) embed.addFields({ name: 'Event log', value: `Paid as event ${entry.eventId}.` });
    const open = entry.status === 'new' || entry.status === 'sent';
    const components = open && attendees.length ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gev:yes:${report.Id}`).setLabel('Objective completed').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`gev:no:${report.Id}`).setLabel('Objective failed').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`gev:dismiss:${report.Id}`).setLabel('Do not pay').setStyle(ButtonStyle.Secondary)
    )] : [];
    if (open && !attendees.length) embed.setDescription('This event ended in game, but nobody stayed long enough to count as attending. Nothing to pay.');
    return { embeds: [embed], components };
  }

  async function deliver(entry) {
    const payload = card(entry);
    if (entry.hostDiscordId) {
      const user = await client.users.fetch(entry.hostDiscordId).catch(() => null);
      const message = await user?.send(payload).catch(() => null);
      if (message) {
        entry.channelId = message.channelId;
        entry.messageId = message.id;
        return;
      }
    }
    const channel = await client.channels.fetch(CONFIG.channels.eventLogs).catch(() => null);
    if (!channel) return;
    const message = await channel.send({
      content: entry.hostDiscordId
        ? `<@${entry.hostDiscordId}> your in-game event needs confirming (your DMs are closed).`
        : `In-game event by **${entry.report.HostName}**, who has no linked Discord account. An event host can confirm it.`,
      ...payload,
      allowedMentions: { users: entry.hostDiscordId ? [entry.hostDiscordId] : [] }
    });
    entry.channelId = message.channelId;
    entry.messageId = message.id;
  }

  async function refresh(entry) {
    if (!entry.channelId || !entry.messageId) return;
    const channel = await client.channels.fetch(entry.channelId).catch(() => null);
    const message = await channel?.messages.fetch(entry.messageId).catch(() => null);
    if (message) await message.edit(card(entry)).catch(() => {});
  }

  async function poll() {
    if (!CONFIG.roblox.apiKey || !CONFIG.roblox.universeId) return;
    const { value } = await roblox.getEntry(KEY, STORE);
    for (const report of Object.values(value || {})) {
      if (!report?.Id || reports[report.Id]) continue;
      if (Date.now() - Number(report.Ended) * 1000 > MAX_AGE_MS) continue;
      if (!EVENT_TYPES[report.Type]) {
        console.warn(`[Game events] Report ${report.Id} has an unknown type ${report.Type}`);
        continue;
      }
      const hostDiscordId = store.discordFor(report.HostId) || null;
      const entry = { report, status: 'new', hostDiscordId, scheduleId: matchSchedule(report, hostDiscordId)?.id || null, at: Date.now() };
      reports[report.Id] = entry;
      store.save();
      await deliver(entry).catch((error) => console.error(`[Game events] Sending report ${report.Id}`, error));
      entry.status = 'sent';
      store.save();
    }
    // Forget reports after a month.
    for (const [id, entry] of Object.entries(reports)) if (Date.now() - entry.at > 30 * 86400_000) delete reports[id];
  }

  async function button(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('gev:')) return false;
    const [, action, id] = interaction.customId.split(':');
    const entry = reports[id];
    if (!entry) {
      await interaction.reply({ content: 'That report is no longer kept.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const isHost = entry.hostDiscordId === interaction.user.id;
    if (!isHost && !(interaction.inGuild() && canHost(interaction.member))) {
      await interaction.reply({ content: 'Only the host or an event host can confirm this.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (entry.status === 'paid' || entry.status === 'dismissed') {
      await interaction.update(card(entry));
      return true;
    }
    if (action === 'dismiss') {
      entry.status = 'dismissed';
      entry.dismissedBy = interaction.user.id;
      store.save();
      await interaction.update(card(entry));
      return true;
    }
    const report = entry.report;
    const attendees = report.Attendees || [];
    await interaction.deferReply(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {});
    const left = (report.LeftEarly || []).length;
    const reply = await events.preview({
      hostDiscordId: entry.hostDiscordId || `roblox:${report.HostId}`,
      hostAccount: { id: String(report.HostId), name: report.HostName },
      confirmerId: interaction.user.id,
      type: report.Type,
      objective: action === 'yes',
      attendees: attendees.map((row) => row.Name).join(' '),
      fallen: attendees.filter((row) => row.Died).map((row) => row.Name).join(' '),
      notes: `In-game event, ${report.Minutes} min${report.CoHost ? `, co-host ${report.CoHost}` : ''}${left ? `, ${left} left early (not paid)` : ''}.`,
      scheduleId: entry.scheduleId,
      reportId: id
    });
    await interaction.editReply(reply);
    return true;
  }

  async function reported(reportId, eventId) {
    const entry = reports[reportId];
    if (!entry) return;
    entry.status = 'paid';
    entry.eventId = eventId;
    store.save();
    await refresh(entry);
  }

  function start() {
    const run = () => poll().catch((error) => console.error('[Game events]', error));
    setTimeout(run, 15_000).unref();
    setInterval(run, 60_000).unref();
  }

  return { start, poll, button, reported, matchSchedule };
}
