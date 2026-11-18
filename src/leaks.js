// Leaks: a post with a picture in the leaks source channel is reposted to the leaks channel as a Materials Group
// test report from one of its facilities (set in the Insurrection era, before first contact).
//
// How developers write a post:
//   [ganymede]                  optional first line: which facility it comes from (default LEAKS_FACILITY)
//   Headline                    the bold title
//   Body text...                any further lines, shown as a quote
// Attach up to 4 pictures and up to 4 videos. Videos play under the card.
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { CONFIG } from './config.js';

export const FACILITIES = Object.freeze({
  damascus: { name: 'Damascus Materials Testing Facility', place: 'Vhalkem, Chi Ceti IV', code: 'DMTF' },
  swanbourne: { name: 'Facility 58-32/B5D', place: 'Swanbourne, Earth', code: 'B5D' },
  ganymede: { name: 'Low/Zero Gravity Testing Facility', place: 'Lister, Ganymede', code: 'LZG' },
  perihelion: { name: 'Perihelion Station', place: 'KC-59 orbit', code: 'PHS' }
});

const isImage = (file) => file.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file.name || '');
const isVideo = (file) => file.contentType?.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name || '');
const extension = (file, fallback) => (file.name || '').match(/\.\w+$/)?.[0] || fallback;

// What a bot may upload to a server, by its boost level (25, 50 or 100 MB).
const uploadLimit = (guild) => ({ 2: 50, 3: 100 }[guild?.premiumTier] || 25) * 1024 * 1024;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Today's real day and month, in the setting's year: 17 NOV 2524.
export function settingDate(date = new Date(), year = CONFIG.leaks.settingYear, timeZone = CONFIG.timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, day: '2-digit', month: 'numeric' }).formatToParts(date);
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  const month = Number(parts.find((part) => part.type === 'month')?.value || 1);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

// Pure: turns the post's text into the facility, headline and body.
export function formatLeak(text, fallbackFacility = 'damascus') {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  let facility = FACILITIES[fallbackFacility] ? fallbackFacility : 'damascus';
  const tag = /^\s*(?:\[([a-z]+)\]|from:\s*([a-z]+))\s*$/i.exec(lines[0] || '');
  if (tag) {
    const key = (tag[1] || tag[2]).toLowerCase();
    if (FACILITIES[key]) {
      facility = key;
      lines.shift();
    }
  }
  while (lines.length && !lines[0].trim()) lines.shift();
  const title = (lines.shift() || '').trim();
  const body = lines.join('\n').trim();
  return {
    facility,
    title: title.slice(0, 256) || null,
    description: body ? body.split('\n').map((line) => `> ${line}`).join('\n').slice(0, 3800) : null
  };
}

export function createLeaks({ client, store }) {
  const enabled = () => Boolean(CONFIG.channels.leaksSource && CONFIG.channels.leaks);

  function allowed(member) {
    if (!member) return false;
    if (member.permissions?.has('ManageGuild')) return true;
    return CONFIG.roles.leaker ? member.roles.cache.has(CONFIG.roles.leaker) : true;
  }

  function nextReport(facility) {
    store.data.leakNumbers ??= {};
    store.data.leakNumbers[facility] = (store.data.leakNumbers[facility] || 0) + 1;
    store.save();
    return `${FACILITIES[facility].code}-${String(store.data.leakNumbers[facility]).padStart(4, '0')}`;
  }

  async function onMessage(message) {
    if (!enabled() || message.author.bot || message.channelId !== CONFIG.channels.leaksSource) return false;
    const images = [...message.attachments.values()].filter(isImage).slice(0, 4);
    const videos = [...message.attachments.values()].filter(isVideo).slice(0, 4);
    if ((!images.length && !videos.length) || !allowed(message.member) || store.leakPosted(message.id)) return true;
    const channel = await client.channels.fetch(CONFIG.channels.leaks);
    const limit = uploadLimit(channel.guild);
    const tooBig = videos.filter((file) => file.size > limit);
    if (tooBig.length) {
      await message.reply({
        content: `Not posted: ${tooBig.map((file) => file.name).join(', ')} ${tooBig.length > 1 ? 'are' : 'is'} over the ${Math.round(limit / 1048576)} MB upload limit of the leaks server. Compress the video and post again.`,
        allowedMentions: { repliedUser: false }
      }).catch(() => {});
      return true;
    }

    const { facility, title, description } = formatLeak(message.content, CONFIG.leaks.facility);
    const site = FACILITIES[facility];
    const report = nextReport(facility);

    // The images are uploaded again, so the card keeps working if the source post is deleted.
    const files = images.map((file, index) => new AttachmentBuilder(file.url, { name: `report-${index + 1}${extension(file, '.png')}` }));
    const clips = videos.map((file, index) => new AttachmentBuilder(file.url, { name: `footage-${index + 1}${extension(file, '.mp4')}` }));
    // Cards that share a link show their pictures together as one gallery.
    const shared = `https://discord.com/channels/${CONFIG.guildId}/${CONFIG.channels.leaks}`;
    const slots = files.length ? files : [null];
    const embeds = slots.map((file, index) => {
      const embed = new EmbedBuilder();
      if (file) embed.setImage(`attachment://${file.name}`);
      if (files.length > 1) embed.setURL(shared);
      if (index === 0) {
        embed
          .setColor(CONFIG.leaks.color)
          .setAuthor({ name: `MATERIALS GROUP  ·  ${site.name}`, iconURL: CONFIG.leaks.iconUrl || undefined })
          .setDescription([
            `-# ${site.place}  ·  ${CONFIG.leaks.classification}`,
            title ? `## ${title}` : null,
            description
          ].filter(Boolean).join('\n'))
          .addFields(
            { name: 'Report', value: `\`${report}\``, inline: true },
            { name: 'Logged', value: `\`${settingDate()}\``, inline: true },
            { name: 'Exhibits', value: `\`${[files.length && `${files.length} image${files.length > 1 ? 's' : ''}`, clips.length && `${clips.length} video${clips.length > 1 ? 's' : ''}`].filter(Boolean).join(', ')}\``, inline: true }
          )
          .setFooter({ text: 'Materials Group  ·  A government-contracted technology firm', iconURL: CONFIG.leaks.iconUrl || undefined })
          .setTimestamp(message.createdAt);
        if (CONFIG.leaks.thumbnailUrl) embed.setThumbnail(CONFIG.leaks.thumbnailUrl);
      }
      return embed;
    });

    // Videos cannot play inside a card, so they go along as files and play under it.
    const posted = await channel.send({ embeds, files: [...files, ...clips], allowedMentions: { parse: [] } });
    store.markLeak(message.id, posted.id);
    if (CONFIG.leaks.reactWhenPosted) await message.react(CONFIG.leaks.reactWhenPosted).catch(() => {});
    return true;
  }

  return { onMessage };
}
