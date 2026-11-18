// Server status: one card in the server status channel, updated every minute. Running game servers report
// themselves through the data store TrebuchetStatus (the game's StatusService); the totals come from Roblox.
// The bot also remembers today's peak and when a player was last online.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { CONFIG } from './config.js';

const TAG = 'Server Status';
const WEATHER = {
  Clear: '☀️ Clear', Cloudy: '☁️ Cloudy', Overcast: '☁️ Overcast', Rain: '🌧️ Rain', HeavyRain: '🌧️ Heavy rain',
  FoggyRain: '🌫️ Foggy rain', Thunderstorm: '⛈️ Storm', Storm: '⛈️ Storm', Snow: '🌨️ Snow', Blizzard: '❄️ Blizzard',
  Fog: '🌫️ Fog', Windy: '💨 Windy', BloodMoon: '🩸 Blood moon'
};

const pad = (value) => String(value).padStart(2, '0');
const clock = (hour) => {
  const value = Number(hour) || 0;
  const h = Math.floor(value) % 24;
  return `${pad(h)}:${pad(Math.floor((value - Math.floor(value)) * 60))}`;
};
const sky = (hour) => (hour >= 6.5 && hour < 18 ? '☀️' : hour >= 18 && hour < 19.5 ? '🌇' : hour >= 5 && hour < 6.5 ? '🌅' : '🌙');
const bar = (count, max, width = 10) => {
  const filled = max > 0 ? Math.min(width, Math.round((count / max) * width)) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
};
const duration = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`);
const compact = (value) => Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0);
const dayKey = (date = new Date()) => date.toLocaleDateString('en-CA', { timeZone: CONFIG.timeZone });

export function createStatus({ client, roblox, store }) {
  let message = null;
  let art = { icon: null, thumbnail: null, at: 0 };
  store.data.status ??= { peak: { day: null, count: 0 }, lastOnline: null };
  const memory = store.data.status;

  function remember(online, now) {
    delete memory.history;
    const today = dayKey(new Date(now));
    if (memory.peak.day !== today) memory.peak = { day: today, count: 0 };
    memory.peak.count = Math.max(memory.peak.count, online);
    if (online > 0) memory.lastOnline = now;
    store.save();
  }

  async function card() {
    const now = Date.now();
    if (now - art.at > 6 * 3600_000) art = { ...(await roblox.gameArt().catch(() => ({ icon: null, thumbnail: null }))), at: now };
    const [info, entry] = await Promise.all([
      roblox.universeInfo().catch(() => null),
      roblox.getEntry('servers', 'TrebuchetStatus').catch(() => ({ value: null }))
    ]);
    const seconds = Math.floor(now / 1000);
    const servers = Object.entries(entry.value || {})
      .map(([id, server]) => ({ id, ...server }))
      .filter((server) => seconds - (Number(server.Updated) || 0) < 180)
      .sort((a, b) => (b.Players || 0) - (a.Players || 0));
    const reported = servers.reduce((sum, server) => sum + (Number(server.Players) || 0), 0);
    const online = Math.max(info?.playing || 0, reported);
    const up = online > 0 || servers.length > 0;
    remember(online, now);
    const placeId = info?.rootPlaceId;
    const gameUrl = placeId ? `https://www.roblox.com/games/${placeId}` : null;

    const headline = up
      ? `### 🟢  Online\n**${online}** ${online === 1 ? 'player' : 'players'} across **${servers.length || 1}** ${servers.length === 1 ? 'server' : 'servers'}`
      : `### ⚫  Offline\nNo servers are running right now.${memory.lastOnline ? `\nLast player online <t:${Math.floor(memory.lastOnline / 1000)}:R>.` : ''}`;

    const embed = new EmbedBuilder()
      .setColor(up ? 0x3ba55d : 0x2b2d31)
      .setAuthor({ name: TAG, iconURL: art.icon || undefined })
      .setTitle(info?.name || CONFIG.brandName)
      .setDescription(`${headline}\n-# Updated <t:${seconds}:R>`)
      .addFields(
        { name: 'Players', value: `\`${online}\``, inline: true },
        { name: 'Peak today', value: `\`${memory.peak.count}\``, inline: true },
        { name: 'Servers', value: `\`${servers.length}\``, inline: true },
        { name: 'Visits', value: `\`${compact(info?.visits)}\``, inline: true },
        { name: 'Favorites', value: `\`${compact(info?.favorites)}\``, inline: true },
        { name: 'Last update', value: info?.updated ? `<t:${Math.floor(Date.parse(info.updated) / 1000)}:R>` : '`Unknown`', inline: true }
      );
    if (gameUrl) embed.setURL(gameUrl);

    if (servers.length) {
      embed.addFields({
        name: 'Live servers',
        value: servers.slice(0, 8).map((server, index) => {
          const uptime = Math.max(0, Math.floor((seconds - (Number(server.Started) || seconds)) / 60));
          const max = Number(server.Max) || info?.maxPlayers || 0;
          return `**Server ${index + 1}**${server.Private ? '  🔒' : ''}\n\`${bar(server.Players || 0, max)}\` ${server.Players}/${max}\n-# ${sky(server.Hour)} ${clock(server.Hour)}  ·  ${WEATHER[server.Weather] || server.Weather || 'Unknown'}  ·  up ${duration(uptime)}`;
        }).join('\n').slice(0, 1024)
      });
    }
    if (art.thumbnail) embed.setImage(art.thumbnail);
    embed.setFooter({ text: `${CONFIG.brandName} · Refreshes every minute` });

    const row = new ActionRowBuilder();
    if (gameUrl) row.addComponents(new ButtonBuilder().setLabel('Play').setEmoji('🎮').setStyle(ButtonStyle.Link).setURL(gameUrl));
    servers.filter((server) => !server.Private && (server.Players || 0) < (server.Max || Infinity)).slice(0, 4).forEach((server) => {
      const index = servers.indexOf(server) + 1;
      row.addComponents(new ButtonBuilder().setLabel(`Join server ${index}`).setStyle(ButtonStyle.Link)
        .setURL(`https://www.roblox.com/games/start?placeId=${placeId}&gameInstanceId=${server.id}`));
    });
    return { embeds: [embed], components: row.components.length && placeId ? [row] : [] };
  }

  async function update() {
    if (!CONFIG.channels.status || !CONFIG.roblox.universeId) return;
    const channel = await client.channels.fetch(CONFIG.channels.status).catch(() => null);
    if (!channel?.isTextBased()) return;
    if (!message) {
      const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
      message = recent?.find((item) => item.author.id === client.user.id && item.embeds[0]?.author?.name?.endsWith(TAG)) || null;
    }
    const payload = await card();
    if (message) message = await message.edit(payload).catch(() => null);
    if (!message) message = await channel.send(payload);
  }

  function start() {
    update().catch((error) => console.error('[Server status]', error));
    setInterval(() => update().catch((error) => console.error('[Server status]', error)), 60_000).unref();
  }

  return { start, update };
}
