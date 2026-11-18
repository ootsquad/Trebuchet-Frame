import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { checkPhrase, makePhrase } from './verify.js';
import { COLORS, buttons, note, profileUrl, verifyCard } from './ui.js';

const linkButtons = (account) => buttons([
  { label: 'Open my profile', url: profileUrl(account.id) },
  { id: 'link:verify', label: 'Check my profile', style: ButtonStyle.Success }
]);

// Self-linking waits for the phrase check: Discord user id -> { account, phrase, expires }.
const pendingLinks = new Map();
import { CONFIG } from './config.js';
import { EVENT_TYPES } from './rewards.js';

const eventChoices = Object.entries(EVENT_TYPES).map(([value, event]) => ({ name: event.name, value }));

export const commandData = [
  new SlashCommandBuilder()
    .setName('wave-apply')
    .setDescription('Start or restart your wave application.'),

  new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Post a suggestion for the community to vote on.')
    .addStringOption((o) => o.setName('idea').setDescription('Your suggestion').setRequired(true).setMaxLength(3500)),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post or edit an announcement.')
    .addStringOption((o) => o.setName('ping').setDescription('Who to ping').addChoices(
      { name: 'Nobody', value: 'none' },
      { name: '@here', value: 'here' },
      { name: '@everyone', value: 'everyone' },
      { name: 'Event notifications role', value: 'events' },
      { name: 'A role', value: 'role' }
    ))
    .addRoleOption((o) => o.setName('role').setDescription('The role to ping, if ping is A role'))
    .addStringOption((o) => o.setName('edit_message_id').setDescription('Message ID of an earlier announcement to edit')),

  new SlashCommandBuilder()
    .setName('event')
    .setDescription('Log an event and pay merit and cR to the attendees.')
    .addStringOption((o) => o.setName('type').setDescription('Event type').setRequired(true).addChoices(...eventChoices))
    .addStringOption((o) => o.setName('attendees').setDescription('Roblox usernames, separated by spaces or commas').setRequired(true).setMaxLength(4000))
    .addBooleanOption((o) => o.setName('objective_completed').setDescription('Was the objective completed? (+25%)').setRequired(true))
    .addStringOption((o) => o.setName('fallen').setDescription('Roblox usernames of attendees who died (no survival bonus)').setMaxLength(2000))
    .addStringOption((o) => o.setName('notes').setDescription('Anything to note in the log').setMaxLength(1000)),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show merit, cR and rank.')
    .addUserOption((o) => o.setName('member').setDescription('A Discord member (uses their linked Roblox account)'))
    .addStringOption((o) => o.setName('roblox_user').setDescription('A Roblox username or user ID')),

  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link a Discord account to a Roblox account.')
    .addStringOption((o) => o.setName('roblox_user').setDescription('Roblox username or user ID').setRequired(true))
    .addUserOption((o) => o.setName('member').setDescription('Staff only: link someone else')),

  new SlashCommandBuilder()
    .setName('grant')
    .setDescription('Staff: give merit or cR by hand.')
    .addStringOption((o) => o.setName('roblox_user').setDescription('Roblox username or user ID').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(500))
    .addIntegerOption((o) => o.setName('merit').setDescription('Merit to give').setMinValue(0).setMaxValue(100000))
    .addIntegerOption((o) => o.setName('credits').setDescription('cR to give').setMinValue(0).setMaxValue(1000000)),

  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Change a rank in a group you command. You only see your own groups and ranks below yours.')
    .addStringOption((o) => o.setName('group').setDescription('A group you manage').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('roblox_user').setDescription('Roblox username or user ID').setRequired(true))
    .addStringOption((o) => o.setName('new_rank').setDescription('The new rank').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('reason').setDescription('Shown in the rank log').setMaxLength(500)),

  new SlashCommandBuilder()
    .setName('license')
    .setDescription('Vehicle & Flight Certification: give or change a driving or flying license.')
    .addStringOption((o) => o.setName('roblox_user').setDescription('Roblox username or user ID').setRequired(true))
    .addStringOption((o) => o.setName('new_rank').setDescription('The certification').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('reason').setDescription('Shown in the rank log').setMaxLength(500)),

  new SlashCommandBuilder()
    .setName('pending')
    .setDescription('See and accept or decline join requests for a group you manage.')
    .addStringOption((o) => o.setName('group').setDescription('A group you manage').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('ladder')
    .setDescription('View or set the merit ladder of a group you command.')
    .addStringOption((o) => o.setName('group').setDescription('A group you manage').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('ranks').setDescription('Lowest first, like: Private > Lance Corporal > Corporal. Leave empty to view.').setMaxLength(1000))
    .addStringOption((o) => o.setName('approval_rank').setDescription('The rank that needs a commander to approve (default: the last one)')),

  new SlashCommandBuilder()
    .setName('unwave')
    .setDescription('Wave Moderators: take the Waved role away in Project: Trebuchet and Discord.')
    .addUserOption((o) => o.setName('member').setDescription('The Discord member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Why').setRequired(true).setMaxLength(500)),

  new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Fix ranks across the UNSC, Marine Corps and division groups.')
    .addStringOption((o) => o.setName('roblox_user').setDescription('One person. Leave empty (staff) to sync everyone.'))
].map((command) => command.toJSON());

// Registered for every server the bot is in (each division can add it).
export async function registerCommands(client) {
  await client.application.commands.set(commandData);
}

const isStaff = (member) => member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
  Boolean(CONFIG.roles.waveModerator && member?.roles?.cache?.has(CONFIG.roles.waveModerator));

// The Verify button from /link.
export async function handleLinkButton(interaction, { store }) {
  if (!interaction.isButton() || interaction.customId !== 'link:verify') return false;
  const pending = pendingLinks.get(interaction.user.id);
  if (!pending || pending.expires < Date.now()) {
    pendingLinks.delete(interaction.user.id);
    await interaction.update({ embeds: [note('This check ran out. Run /link again.', COLORS.warn)], components: [] });
    return true;
  }
  const first = verifyCard(pending.account, pending.phrase, { section: 'Account Link' });
  await interaction.update({ embeds: [first, note(`Checking **${pending.account.name}**'s profile...`)], components: [] });
  if (!(await checkPhrase(pending.account.id, pending.phrase))) {
    await interaction.editReply({
      embeds: [first, note('I could not find the phrase on your profile yet. Check it is saved in **About** exactly as written, wait a few seconds, and try again.', COLORS.warn)],
      components: [linkButtons(pending.account)]
    });
    return true;
  }
  pendingLinks.delete(interaction.user.id);
  store.link(interaction.user.id, pending.account);
  await interaction.editReply({ embeds: [note(`✅ Linked to **${pending.account.name}**. You can delete the phrase from your profile now.`, COLORS.good)], components: [] });
  return true;
}

export async function handleAutocomplete(interaction, { ranking }) {
  if (!interaction.isAutocomplete()) return false;
  if (interaction.commandName === 'pending') await ranking.pendingAutocomplete(interaction).catch(() => interaction.respond([]).catch(() => {}));
  else await ranking.autocomplete(interaction);
  return true;
}

export async function handleCommand(interaction, { applications, suggestions, announcements, events, sync, ranking, roblox, store }) {
  if (!interaction.isChatInputCommand()) return false;
  const name = interaction.commandName;

  if (name === 'wave-apply') {
    await interaction.reply({ content: 'I sent you a DM to start the application.', flags: MessageFlags.Ephemeral });
    applications.start(interaction.member, 'the /wave-apply command').catch(() => {});
    return true;
  }
  if (name === 'suggest') return suggestions.command(interaction).then(() => true);
  if (name === 'announce') return announcements.command(interaction).then(() => true);
  if (name === 'event') return events.command(interaction).then(() => true);
  if (name === 'profile') return events.profile(interaction).then(() => true);
  if (name === 'grant') return events.grant(interaction).then(() => true);
  if (name === 'sync') return sync.command(interaction).then(() => true);

  if (name === 'link') {
    const other = interaction.options.getUser('member');
    const target = other || interaction.user;
    if (other && other.id !== interaction.user.id && !isStaff(interaction.member)) {
      await interaction.reply({ content: 'Only staff can link someone else.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!other && store.linkedRoblox(target.id) && !isStaff(interaction.member)) {
      await interaction.reply({ embeds: [note(`✅ You are already linked to **${store.linkedRoblox(target.id).name}**. Ask staff if you need to change it.`, COLORS.good)], flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const account = await roblox.resolveUser(interaction.options.getString('roblox_user', true));
    const owner = store.discordFor(account.id);
    if (owner === target.id) {
      await interaction.editReply({ embeds: [note(`✅ ${other ? `<@${target.id}> is` : 'You are'} already linked to **${account.name}**. No need to verify again.`, COLORS.good)] });
      return true;
    }
    if (owner && owner !== target.id && !isStaff(interaction.member)) {
      await interaction.editReply(`${account.name} is already linked to another Discord account. Ask staff if that is wrong.`);
      return true;
    }
    // Staff linking someone else: no check, they vouch for it.
    if (other && other.id !== interaction.user.id) {
      store.link(target.id, account);
      await interaction.editReply(`Linked <@${target.id}> to ${account.name} (${account.id}).`);
      return true;
    }
    const phrase = makePhrase();
    pendingLinks.set(interaction.user.id, { account, phrase, expires: Date.now() + 30 * 60_000 });
    await interaction.editReply({
      embeds: [verifyCard(account, phrase, { section: 'Account Link' }).setFooter({ text: 'This check runs out in 30 minutes. You can delete the phrase once you are linked.' })],
      components: [linkButtons(account)]
    });
    return true;
  }

  if (name === 'rank') return ranking.rankCommand(interaction).then(() => true);
  if (name === 'license') return ranking.rankCommand(interaction, 'vehicles').then(() => true);
  if (name === 'pending') return ranking.pendingCommand(interaction).then(() => true);
  if (name === 'ladder') return ranking.ladderCommand(interaction).then(() => true);
  if (name === 'unwave') return applications.unwave(interaction).then(() => true);
  return false;
}
