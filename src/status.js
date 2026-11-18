// Server status: one card in the server status channel, updated every minute. Running game servers report
// themselves through the data store TrebuchetStatus (the game's StatusService); the totals come from Roblox.
import { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } from 'discord.js';
import { CONFIG } from './config.js';
import { COLORS } from './ui.js';

const TAG = 'Server Status';
const hourText = (hour) => {
  const value = Number(hour) || 0;
  const h = Math.floor(value);
  const m = Math.round((value - h) * 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
const phase = (hour) => (hour >= 6.5 && hour < 18 ? '☀️' : hour >= 18 && hour < 19.5 ? '🌇' : hour >= 5 && hour < 6.5 ? '🌅' : '🌙');
const WEATHER = { Clear: '☀️ Clear', Cloudy: '☁️ Cloudy', Rain: '🌧️ Rain', HeavyRain: '🌧️ Heavy rain', FoggyRain: '🌫️ Foggy rain', Thunderstorm: '⛈️ Thunderstorm', Snow: '🌨️ Snow', Blizzard: '❄️ Blizzard', Fog: '🌫️ Fog', Windy: '💨 Windy' };

export function createStatus({ client, roblox }) {
  let message = null;

  async function card() {
    const [info, entry] = await Promise.all([
      roblox.universeInfo().catch(() => null),
      roblox.getEntry('servers', 'TrebuchetStatus').catch(() => ({ value: null }))
    ]);
    const now = Math.floor(Date.now() / 1000);
    const servers = Object.entries(entry.value || {})
      .map(([id, server]) => ({ id, ...server }))
      .filter((server) => now - (Number(server.Updated) || 0) < 180)
      .sort((a, b) => (b.Players || 0) - (a.Players || 0));
    const reported = servers.reduce((sum, server) => sum + (Number(server.Players) || 0), 0);
    const online = Math.max(info?.playing || 0, reported);
    const up = online > 0 || servers.length > 0;

    const embed = new EmbedBuilder()
      .setColor(up ? COLORS.good : 0x4f545c)
      .setAuthor({ name: `${CONFIG.brandName} · ${TAG}` })
      .setTitle(up ? '🟢  Online' : '⚫  No servers running')
      .addFields(
        { name: 'Players', value: `**${online}**`, inline: true },
        { name: 'Servers', value: `**${servers.length || (online ? '1+' : 0)}**`, inline: true },
        { name: 'Visits', value: info ? `**${Number(info.visits || 0).toLocaleString()}**` : 'Unknown', inline: true }
      );
    if (servers.length) {
      embed.addFields({
        name: 'Servers',
        value: servers.slice(0, 10).map((server, index) => {
          const uptime = Math.max(0, Math.floor((now - (Number(server.Started) || now)) / 60));
          return `**${index + 1}.** ${server.Players}/${server.Max} players  ·  ${phase(server.Hour)} ${hourText(server.Hour)}  ·  ${WEATHER[server.Weather] || server.Weather}${server.Private ? '  ·  🔒 private' : ''}\n-# up ${uptime >= 60 ? `${Math.floor(uptime / 60)}h ${uptime % 60}m` : `${uptime}m`}`;
        }).join('\n').slice(0, 1024)
      });
    }
    embed.setFooter({ text: 'Updates every minute' }).setTimestamp();
    const components = info?.rootPlaceId
      ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Play').setStyle(ButtonStyle.Link).setURL(`https://www.roblox.com/games/${info.rootPlaceId}`))]
      : [];
    return { embeds: [embed], components };
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
