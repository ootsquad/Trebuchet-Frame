// Suggestions: anything posted in the suggestions channel (or sent with /suggest) becomes a vote card.
// When the upvote reaction reaches the configured count, the card is copied to the important suggestions channel once.
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { CONFIG } from './config.js';

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

function card(author, text, number) {
  return new EmbedBuilder()
    .setAuthor({ name: author.displayName || author.username, iconURL: author.displayAvatarURL() })
    .setTitle(`Suggestion #${number}`)
    .setDescription(clip(text, 4000))
    .setColor(CONFIG.brandColor)
    .setFooter({ text: `Vote with ${CONFIG.suggestions.upvote} or ${CONFIG.suggestions.downvote}. ${CONFIG.suggestions.upvotesNeeded} upvotes sends it to the important list.` })
    .setTimestamp();
}

export function createSuggestions({ client, store }) {
  const enabled = () => Boolean(CONFIG.channels.suggestions && CONFIG.channels.importantSuggestions);
  const promoting = new Set();

  async function post(author, text, attachmentUrl = null) {
    const channel = await client.channels.fetch(CONFIG.channels.suggestions);
    const number = Object.keys(store.data.suggestions).length + 1;
    const embed = card(author, text, number);
    if (attachmentUrl) embed.setImage(attachmentUrl);
    const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    await message.react(CONFIG.suggestions.upvote);
    await message.react(CONFIG.suggestions.downvote);
    store.setSuggestion(message.id, { number, authorId: author.id, text, promoted: false, at: new Date().toISOString() });
    if (CONFIG.suggestions.threads) {
      await message.startThread({ name: clip(`Suggestion #${number}: ${text.replace(/\s+/g, ' ')}`, 95) }).catch(() => {});
    }
    return message;
  }

  // A plain message in the channel is turned into a card, then removed.
  async function onMessage(message) {
    if (!enabled() || message.author.bot || message.channelId !== CONFIG.channels.suggestions) return false;
    const text = message.content.trim();
    const image = message.attachments.find((file) => file.contentType?.startsWith('image/'));
    if (!text && !image) return true;
    await post(message.author, text || '(see image)', image?.url || null);
    await message.delete().catch(() => {});
    return true;
  }

  async function onReaction(reaction) {
    if (!enabled()) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
    if (!message || message.channelId !== CONFIG.channels.suggestions) return;
    const record = store.suggestion(message.id);
    if (!record || record.promoted || promoting.has(message.id)) return;
    if ((reaction.emoji.name || reaction.emoji.toString()) !== CONFIG.suggestions.upvote) return;

    const users = await reaction.users.fetch();
    const votes = users.filter((user) => !user.bot && user.id !== record.authorId).size;
    if (votes < CONFIG.suggestions.upvotesNeeded) return;

    promoting.add(message.id);
    try {
      const target = await client.channels.fetch(CONFIG.channels.importantSuggestions);
      const original = message.embeds[0];
      const embed = EmbedBuilder.from(original)
        .setTitle(`Important: ${original?.title || 'Suggestion'}`)
        .setColor(0xfee75c)
        .setFooter({ text: `Reached ${votes} upvotes` })
        .setTimestamp();
      await target.send({ content: `[Jump to the vote](${message.url})`, embeds: [embed], allowedMentions: { parse: [] } });
      store.setSuggestion(message.id, { ...record, promoted: true, promotedAt: new Date().toISOString(), votes });
    } finally {
      promoting.delete(message.id);
    }
  }

  async function command(interaction) {
    if (!enabled()) {
      await interaction.reply({ content: 'Suggestions are not set up yet.', flags: MessageFlags.Ephemeral });
      return;
    }
    const text = interaction.options.getString('idea', true);
    const message = await post(interaction.user, text);
    await interaction.reply({ content: `Posted: ${message.url}`, flags: MessageFlags.Ephemeral });
  }

  return { onMessage, onReaction, command };
}
