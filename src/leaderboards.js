// Weekly leaderboards: most merit earned, most time played and most kills (from the game's weekly ordered data
// stores), and most events and operations attended (from the bot's event logs). Posted every week to the
// leaderboard channel for the week that just ended; /leaderboard shows this week or last week to anyone.
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { CONFIG } from './config.js';
import { formatPlaytime, weekIndex, weekStart, weeklyAttendance } from './stats.js';
import { COLORS } from './ui.js';

const MEDALS = ['🥇', '🥈', '🥉'];
const place = (index) => MEDALS[index] || `\`${String(index + 1).padStart(2, ' ')}.\``;

export function createLeaderboards({ client, store, roblox }) {
  store.data.leaderboardPosted ??= null;

  async function board(week) {
    const [merit, playtime, kills] = await Promise.all(['Merit', 'Playtime', 'Kills'].map((name) =>
      roblox.orderedTop(`TrebuchetWeekly_${week}_${name}`, 10).catch(() => [])));
    const attendance = [...weeklyAttendance(store, week).entries()].map(([id, entry]) => ({ id, ...entry }));
    const events = [...attendance].sort((a, b) => b.events - a.events).slice(0, 10);
    const operations = attendance.filter((entry) => entry.operations > 0).sort((a, b) => b.operations - a.operations).slice(0, 10);
    const ids = [...new Set([...merit, ...playtime, ...kills].map((entry) => entry.id))];
    const names = await roblox.usernames(ids).catch(() => new Map());
    const nameOf = (id, fallback) => names.get(String(id)) || fallback || id;

    const list = (entries, format) => (entries.length
      ? entries.map((entry, index) => `${place(index)} **${nameOf(entry.id, entry.name)}**  ·  ${format(entry)}`).join('\n')
      : '-# Nobody yet');

    const start = weekStart(week);
    const end = new Date(start.getTime() + 6 * 86400_000);
    const day = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return new EmbedBuilder()
      .setColor(0xd6b24a)
      .setAuthor({ name: `${CONFIG.brandName} · Weekly Leaderboard` })
      .setTitle(`Week of ${day(start)} – ${day(end)}`)
      .addFields(
        { name: '⭐ Merit earned', value: list(merit, (entry) => `${entry.value.toLocaleString()} merit`), inline: true },
        { name: '⏱️ Time played', value: list(playtime, (entry) => formatPlaytime(entry.value * 60)), inline: true },
        { name: '​', value: '​', inline: false },
        { name: '🎯 Kills', value: list(kills, (entry) => `${entry.value.toLocaleString()} kills`), inline: true },
        { name: '📅 Events attended', value: list(events, (entry) => `${entry.events} event${entry.events === 1 ? '' : 's'}`), inline: true },
        { name: '🪖 Operations', value: list(operations, (entry) => `${entry.operations} op${entry.operations === 1 ? '' : 's'}`), inline: true }
      )
      .setFooter({ text: 'Weeks run Monday to Sunday (UTC). Game numbers update every couple of minutes.' })
      .setTimestamp();
  }

  async function command(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const which = interaction.options.getString('week') || 'this';
    const week = weekIndex() - (which === 'last' ? 1 : 0);
    await interaction.editReply({ embeds: [await board(week)] });
  }

  // Posts last week's board once, at the configured day and hour.
  async function tick() {
    if (!CONFIG.channels.leaderboards) return;
    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.timeZone, weekday: 'short', hour: 'numeric', hour12: false })
      .formatToParts(now).map((part) => [part.type, part.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    if (weekday !== CONFIG.leaderboards.day || Number(parts.hour) < CONFIG.leaderboards.hour) return;
    const week = weekIndex(now) - 1;
    if (store.data.leaderboardPosted === week) return;
    const channel = await client.channels.fetch(CONFIG.channels.leaderboards).catch(() => null);
    if (!channel) return;
    await channel.send({ embeds: [await board(week)] });
    store.data.leaderboardPosted = week;
    store.save();
  }

  function start() {
    setInterval(() => tick().catch((error) => console.error('[Leaderboard]', error)), 10 * 60_000).unref();
    setTimeout(() => tick().catch(() => {}), 60_000).unref();
  }

  return { command, board, start };
}
