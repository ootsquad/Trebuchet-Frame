// Shared look for the bot's DMs and private replies: cards with a colored edge, and buttons instead of typed words.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { CONFIG } from './config.js';

export const COLORS = Object.freeze({
  brand: CONFIG.brandColor,
  good: 0x57f287,
  warn: 0xfee75c,
  bad: 0xed4245,
  info: 0x5865f2
});

export function card({ title, description, fields = [], color = COLORS.brand, footer, section, url }) {
  const embed = new EmbedBuilder().setColor(color);
  if (section) embed.setAuthor({ name: `${CONFIG.brandName} · ${section}` });
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (fields.length) embed.addFields(fields);
  if (footer) embed.setFooter({ text: footer });
  if (url) embed.setURL(url);
  return embed;
}

export const note = (text, color = COLORS.info) => new EmbedBuilder().setColor(color).setDescription(text);

export function buttons(list) {
  return new ActionRowBuilder().addComponents(list.map((item) => {
    const button = new ButtonBuilder().setLabel(item.label).setStyle(item.url ? ButtonStyle.Link : item.style || ButtonStyle.Secondary);
    if (item.url) button.setURL(item.url);
    else button.setCustomId(item.id);
    if (item.emoji) button.setEmoji(item.emoji);
    if (item.disabled) button.setDisabled(true);
    return button;
  }));
}

export const profileUrl = (robloxUserId) => `https://www.roblox.com/users/${robloxUserId}/profile`;

// The card that asks someone to put the phrase in their Roblox profile.
export function verifyCard(robloxUser, phrase, { section, step } = {}) {
  return card({
    section,
    title: step ? `${step}  Verify your Roblox account` : 'Verify your Roblox account',
    description: `Prove that **${robloxUser.name}** is yours. Copy the phrase below into the **About** section of your Roblox profile and save it.`,
    fields: [
      { name: 'Your phrase', value: `\`\`\`\n${phrase}\n\`\`\`` },
      { name: 'Steps', value: '1. Press **Open my profile**.\n2. Paste the phrase into **About** and save.\n3. Wait a few seconds, then press **Check my profile**.' }
    ],
    footer: 'You can delete the phrase once you are verified.'
  });
}
