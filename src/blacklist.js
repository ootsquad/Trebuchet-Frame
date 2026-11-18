// Blacklist: a Roblox user, or a whole Roblox group and everyone in it, is kept out of the game and the Discord
// servers. Only the Roblox accounts in BLACKLIST_ADMIN_IDS (xaiver and sepernts by default) can change it.
//
// Game:    the list is saved in the game's data store (TrebuchetBlacklist / list). The game kicks anyone on it
//          when they join and checks running servers every minute; the bot also pings servers so it is immediate.
// Discord: linked Discord accounts of blacklisted users, and of members of blacklisted groups, are banned from the
//          main and development servers, now and whenever they join or link later.
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { CONFIG } from './config.js';
import { COLORS, note } from './ui.js';

export function createBlacklist({ client, store, roblox }) {
  store.data.blacklist ??= { users: {}, groups: {} };
  const list = () => store.data.blacklist;

  const isAdmin = (discordUserId) => {
    const link = store.linkedRoblox(discordUserId);
    return Boolean(link && CONFIG.blacklist.admins.includes(String(link.id)));
  };

  // Writes the list where the game reads it, then tells running servers.
  async function publish() {
    const value = {
      users: Object.fromEntries(Object.entries(list().users).map(([id, entry]) => [id, { reason: entry.reason }])),
      groups: Object.fromEntries(Object.entries(list().groups).map(([id, entry]) => [id, { reason: entry.reason }])),
      updated: new Date().toISOString()
    };
    await roblox.updateEntry(CONFIG.blacklist.entry, () => value, CONFIG.blacklist.store);
    await roblox.publish(CONFIG.blacklist.topic, 'refresh');
  }

  // Why a Roblox account is blacklisted, or null.
  async function reasonFor(robloxUserId) {
    const user = list().users[String(robloxUserId)];
    if (user) return `Blacklisted: ${user.reason}`;
    for (const [groupId, entry] of Object.entries(list().groups)) {
      const roles = await roblox.getRoles(groupId, robloxUserId).catch(() => []);
      if (roles.length) return `Member of blacklisted group ${entry.name}: ${entry.reason}`;
    }
    return null;
  }

  async function ban(discordUserId, reason) {
    const done = [];
    for (const guildId of [CONFIG.guildId, CONFIG.devGuildId].filter(Boolean)) {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;
      const ok = await guild.bans.create(discordUserId, { reason: `Blacklist: ${reason}`.slice(0, 500) }).then(() => true).catch(() => false);
      if (ok) done.push(guild.name);
    }
    return done;
  }

  // Bans every linked Discord account the list covers. Returns how many were banned.
  async function enforce() {
    let count = 0;
    const groupMembers = new Map();
    for (const groupId of Object.keys(list().groups)) {
      groupMembers.set(groupId, await roblox.listMembers(groupId).catch(() => new Map()));
    }
    for (const [discordId, link] of Object.entries(store.data.links)) {
      const id = String(link.id);
      let reason = list().users[id] ? list().users[id].reason : null;
      if (!reason) {
        for (const [groupId, members] of groupMembers) {
          if (members.has(id)) { reason = `Member of ${list().groups[groupId].name}: ${list().groups[groupId].reason}`; break; }
        }
      }
      if (reason && (await ban(discordId, reason)).length) count += 1;
    }
    return count;
  }

  async function log(title, fields, color) {
    if (!CONFIG.channels.rankLogs) return;
    const channel = await client.channels.fetch(CONFIG.channels.rankLogs).catch(() => null);
    await channel?.send({ embeds: [new EmbedBuilder().setColor(color).setAuthor({ name: 'Blacklist' }).setTitle(title).addFields(fields).setTimestamp()], allowedMentions: { parse: [] } });
  }

  async function command(interaction) {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ embeds: [note('Only the blacklist administrators can use this.', COLORS.bad)], flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const action = interaction.options.getSubcommand();
    const by = `<@${interaction.user.id}> (${store.linkedRoblox(interaction.user.id).name})`;

    if (action === 'list') {
      const users = Object.entries(list().users).map(([id, entry]) => `• **${entry.name}** (${id}): ${entry.reason}`);
      const groups = Object.entries(list().groups).map(([id, entry]) => `• **${entry.name}** (${id}): ${entry.reason}`);
      await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.bad).setAuthor({ name: 'Blacklist' })
        .addFields(
          { name: `Users (${users.length})`, value: users.join('\n').slice(0, 1024) || 'None' },
          { name: `Groups (${groups.length})`, value: groups.join('\n').slice(0, 1024) || 'None' }
        )] });
      return;
    }

    const type = interaction.options.getString('type', true);
    const input = interaction.options.getString('target', true).trim();
    const reason = interaction.options.getString('reason') || 'No reason given';

    if (type === 'user') {
      const user = await roblox.resolveUser(input);
      if (CONFIG.blacklist.admins.includes(user.id)) throw new Error('Blacklist administrators cannot be blacklisted.');
      if (action === 'add') {
        list().users[user.id] = { name: user.name, reason, by: interaction.user.id, at: new Date().toISOString() };
        store.save();
        await publish();
        const owner = store.discordFor(user.id);
        const banned = owner ? await ban(owner, reason) : [];
        await log(`User added: ${user.name}`, [{ name: 'Roblox', value: `${user.name} (${user.id})`, inline: true }, { name: 'By', value: by, inline: true }, { name: 'Reason', value: reason }, { name: 'Discord', value: banned.length ? `<@${owner}> banned from ${banned.join(', ')}` : 'No linked Discord account yet. They are banned if they ever link one.' }], COLORS.bad);
        await interaction.editReply({ embeds: [note(`⛔ **${user.name}** is blacklisted. They are kicked from the game${banned.length ? ` and banned from ${banned.join(', ')}` : ''}.`, COLORS.bad)] });
      } else {
        if (!list().users[user.id]) throw new Error(`${user.name} is not on the blacklist.`);
        delete list().users[user.id];
        store.save();
        await publish();
        await log(`User removed: ${user.name}`, [{ name: 'Roblox', value: `${user.name} (${user.id})`, inline: true }, { name: 'By', value: by, inline: true }, { name: 'Reason', value: reason }], COLORS.good);
        await interaction.editReply({ embeds: [note(`✅ **${user.name}** is off the blacklist and can join the game again. Discord bans are not lifted automatically: unban them in Server Settings if you want them back.`, COLORS.good)] });
      }
      return;
    }

    const groupId = (input.match(/(\d{3,})/) || [])[1];
    if (!groupId) throw new Error('Give the group ID or its Roblox link.');
    const protectedGroups = Object.values(CONFIG.groups).flatMap((value) => (typeof value === 'object' ? Object.values(value) : [value])).map(String);
    if (protectedGroups.includes(groupId)) throw new Error('That is one of our own groups.');
    const info = await roblox.groupInfo(groupId).catch(() => ({ id: groupId, name: `Group ${groupId}` }));
    if (action === 'add') {
      list().groups[groupId] = { name: info.name, reason, by: interaction.user.id, at: new Date().toISOString() };
      store.save();
      await publish();
      const banned = await enforce();
      await log(`Group added: ${info.name}`, [{ name: 'Group', value: `${info.name} (${groupId})`, inline: true }, { name: 'By', value: by, inline: true }, { name: 'Reason', value: reason }, { name: 'Discord', value: `${banned} linked member${banned === 1 ? '' : 's'} banned` }], COLORS.bad);
      await interaction.editReply({ embeds: [note(`⛔ Everyone in **${info.name}** is blacklisted. Members are kicked from the game, and ${banned} linked Discord account${banned === 1 ? ' was' : 's were'} banned.`, COLORS.bad)] });
    } else {
      if (!list().groups[groupId]) throw new Error(`${info.name} is not on the blacklist.`);
      delete list().groups[groupId];
      store.save();
      await publish();
      await log(`Group removed: ${info.name}`, [{ name: 'Group', value: `${info.name} (${groupId})`, inline: true }, { name: 'By', value: by, inline: true }, { name: 'Reason', value: reason }], COLORS.good);
      await interaction.editReply({ embeds: [note(`✅ **${info.name}** is off the blacklist.`, COLORS.good)] });
    }
  }

  // When someone joins a Discord server: ban them if their linked account is blacklisted.
  async function onJoin(member) {
    const link = store.linkedRoblox(member.id);
    if (!link) return false;
    const reason = await reasonFor(link.id);
    if (!reason) return false;
    await ban(member.id, reason);
    return true;
  }

  return { command, reasonFor, ban, enforce, onJoin, isAdmin };
}
