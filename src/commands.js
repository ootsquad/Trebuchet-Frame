import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { CONFIG } from './config.js';
import { EVENT_TYPES } from './rewards.js';
import { UNSC } from './groups.js';

const eventChoices = Object.entries(EVENT_TYPES).map(([value, event]) => ({ name: event.name, value }));

function groupChoices() {
  const choices = [{ name: 'UNSC', value: CONFIG.groups.unsc }, { name: 'Marine Corps', value: CONFIG.groups.marines }];
  const names = { odst: '105th ODST', aar: '75th AAR', mru: '3rd MRU', mcsb: '7th MCSB', mid: '1st MID' };
  for (const [key, id] of Object.entries(CONFIG.groups.divisions)) if (id) choices.push({ name: names[key], value: id });
  return choices;
}

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
    .setDescription('Staff: set a rank in one of the groups.')
    .addStringOption((o) => o.setName('roblox_user').setDescription('Roblox username or user ID').setRequired(true))
    .addStringOption((o) => o.setName('new_rank').setDescription('Exact rank name').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('group').setDescription('Which group (default UNSC)').addChoices(...groupChoices())),

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

export async function handleCommand(interaction, { applications, suggestions, announcements, events, sync, roblox, store }) {
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
      await interaction.reply({ content: `You are already linked to ${store.linkedRoblox(target.id).name}. Ask staff to change it.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const account = await roblox.resolveUser(interaction.options.getString('roblox_user', true));
    store.link(target.id, account);
    await interaction.editReply(`Linked <@${target.id}> to ${account.name} (${account.id}).`);
    return true;
  }

  if (name === 'rank') {
    if (!isStaff(interaction.member)) {
      await interaction.reply({ content: 'You need the Wave Moderator role or Manage Server to set ranks.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = await roblox.resolveUser(interaction.options.getString('roblox_user', true));
    const groupId = interaction.options.getString('group') || UNSC.groupId;
    const result = await roblox.setRank(groupId, user.id, interaction.options.getString('new_rank', true));
    await interaction.editReply(`${user.name}: ${result.before} -> ${result.rank}${result.changed ? '' : ' (no change)'}.`);
    return true;
  }
  return false;
}
