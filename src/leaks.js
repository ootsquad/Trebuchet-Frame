// Leaks: a post with a picture in the leaks source channel is reposted to the leaks channel as a card.
// The first line is the headline (quote it if you want quotation marks), the rest is the body, shown as a quote.
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { CONFIG } from './config.js';

const isImage = (file) => file.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name || '');

// Pure: turns the post's text into the card's headline and body.
export function formatLeak(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const title = (lines.shift() || '').trim();
  const body = lines.join('\n').trim();
  return {
    title: title.slice(0, 256) || null,
    description: body ? body.split('\n').map((line) => `> ${line}`).join('\n').slice(0, 4096) : null
  };
}

export function createLeaks({ client, store }) {
  const enabled = () => Boolean(CONFIG.channels.leaksSource && CONFIG.channels.leaks);

  function allowed(member) {
    if (!member) return false;
    if (member.permissions?.has('ManageGuild')) return true;
    return CONFIG.roles.leaker ? member.roles.cache.has(CONFIG.roles.leaker) : true;
  }

  async function onMessage(message) {
    if (!enabled() || message.author.bot || message.channelId !== CONFIG.channels.leaksSource) return false;
    const images = [...message.attachments.values()].filter(isImage);
    if (!images.length || !allowed(message.member) || store.leakPosted(message.id)) return true;

    const { title, description } = formatLeak(message.content);
    // The images are uploaded again, so the card keeps working if the source post is deleted.
    const files = images.slice(0, 4).map((file, index) => new AttachmentBuilder(file.url, { name: `leak-${index + 1}${(file.name || '.png').match(/\.\w+$/)?.[0] || '.png'}` }));
    // Cards that share a link show their pictures together as one gallery.
    const shared = `https://discord.com/channels/${message.guildId}/${CONFIG.channels.leaks}`;
    const embeds = files.map((file, index) => {
      const embed = new EmbedBuilder().setImage(`attachment://${file.name}`);
      if (files.length > 1) embed.setURL(shared);
      if (index === 0) {
        embed.setColor(CONFIG.leaks.color);
        if (title) embed.setTitle(title);
        if (description) embed.setDescription(description);
        if (CONFIG.leaks.thumbnailUrl) embed.setThumbnail(CONFIG.leaks.thumbnailUrl);
      }
      return embed;
    });

    const channel = await client.channels.fetch(CONFIG.channels.leaks);
    const posted = await channel.send({ embeds, files, allowedMentions: { parse: [] } });
    store.markLeak(message.id, posted.id);
    if (CONFIG.leaks.reactWhenPosted) await message.react(CONFIG.leaks.reactWhenPosted).catch(() => {});
    return true;
  }

  return { onMessage };
}
