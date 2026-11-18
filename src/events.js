// Events: a host logs an event, checks the pay preview, confirms, and the bot sends merit and cR to each
// attendee's game save (their inbox, which the game pays out). Then it promotes anyone whose merit now reaches a
// new automatic rank.
import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { CONFIG } from './config.js';
import { EVENT_TYPES, attendeePay, dayKey, hostPay, parseNames } from './rewards.js';
import { GROUPS } from './groups.js';

const PREVIEW_MINUTES = 15;

export function canHost(member) {
  if (member?.permissions?.has('ManageGuild')) return true;
  return Boolean(CONFIG.roles.eventHost && member?.roles?.cache?.has(CONFIG.roles.eventHost));
}

const lines = (rows, max = 3900) => {
  let text = '';
  for (const row of rows) {
    if (text.length + row.length + 1 > max) return `${text}\n...and more`;
    text += `${text ? '\n' : ''}${row}`;
  }
  return text || 'None';
};

export function createEvents({ client, store, roblox, ranking }) {
  const pending = new Map();

  function enabled() {
    return Boolean(CONFIG.roblox.apiKey && CONFIG.roblox.universeId && CONFIG.channels.eventLogs);
  }

  async function command(interaction) {
    if (!enabled()) {
      await interaction.reply({ content: 'Events are not set up yet. Set ROBLOX_API_KEY, ROBLOX_UNIVERSE_ID and CHANNEL_EVENT_LOGS on Railway.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!canHost(interaction.member)) {
      await interaction.reply({ content: 'Only event hosts can log events.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const type = interaction.options.getString('type', true);
    const objective = interaction.options.getBoolean('objective_completed', true);
    const attendeeNames = parseNames(interaction.options.getString('attendees', true));
    const fallenNames = parseNames(interaction.options.getString('fallen') || '');
    const notes = interaction.options.getString('notes') || '';
    const names = parseNames([...attendeeNames, ...fallenNames].join(' '));
    if (!names.length) {
      await interaction.editReply('List at least one attendee by Roblox username.');
      return;
    }

    const accounts = await roblox.resolveUsernames(names);
    const byName = new Map(accounts.map((account) => [String(account.asked || account.name).toLowerCase(), account]));
    const unknown = names.filter((name) => !byName.has(name.toLowerCase()));
    const fallen = new Set(fallenNames.map((name) => byName.get(name.toLowerCase())?.id).filter(Boolean));
    const unique = [...new Map(accounts.map((account) => [account.id, account])).values()];

    const today = dayKey(new Date(), CONFIG.timeZone);
    const rows = unique.map((account) => {
      const pay = attendeePay(type, {
        objective,
        survived: !fallen.has(account.id),
        firstToday: !store.hadEventOn(account.id, today)
      });
      return { account, ...pay };
    });

    const hostLink = store.linkedRoblox(interaction.user.id);
    const cooldownMs = CONFIG.events.hostCooldownHours * 3600_000;
    const onCooldown = Date.now() - store.lastHostPay(interaction.user.id, type) < cooldownMs;
    const host = hostPay(rows.length, { onCooldown });
    if (!hostLink && host.credits > 0) host.reason = 'link your Roblox account with /link to get host pay';

    const id = crypto.randomBytes(4).toString('hex');
    pending.set(id, { id, type, objective, notes, rows, host, hostLink, hostId: interaction.user.id, today, expires: Date.now() + PREVIEW_MINUTES * 60_000 });

    const event = EVENT_TYPES[type];
    const totalCredits = rows.reduce((sum, row) => sum + row.credits, 0) + (hostLink && !host.reason ? host.credits : 0);
    const embed = new EmbedBuilder()
      .setTitle(`Preview: ${event.name}`)
      .setColor(0xfee75c)
      .setDescription(lines(rows.map((row) => `${row.account.name}: ${row.merit} merit, ${row.credits} cR${row.bonuses.length ? ` (${row.bonuses.join(', ')})` : ''}`)))
      .addFields(
        { name: 'Objective completed', value: objective ? 'Yes (+25%)' : 'No', inline: true },
        { name: 'Attendees', value: String(rows.length), inline: true },
        { name: 'Total cR', value: String(totalCredits), inline: true },
        { name: 'Host pay', value: host.reason ? `None: ${host.reason}` : `${host.credits} cR, ${host.merit} merit to ${hostLink?.name}` }
      )
      .setFooter({ text: `Confirm within ${PREVIEW_MINUTES} minutes. Only list people who stayed for at least 70% of the event.` });
    if (unknown.length) embed.addFields({ name: 'Not found on Roblox (left out)', value: lines(unknown, 1000) });
    if (notes) embed.addFields({ name: 'Notes', value: notes.slice(0, 1000) });

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`event:confirm:${id}`).setLabel('Confirm and pay').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:cancel:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    await interaction.editReply({ embeds: [embed], components: [buttons] });
  }

  async function confirm(interaction, id) {
    const plan = pending.get(id);
    if (!plan || plan.expires < Date.now()) {
      pending.delete(id);
      await interaction.update({ content: 'This preview ran out. Run /event again.', embeds: [], components: [] });
      return;
    }
    if (plan.hostId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the host who made this preview can confirm it.', flags: MessageFlags.Ephemeral });
      return;
    }
    pending.delete(id);
    await interaction.update({ content: 'Paying out...', components: [] });

    const event = EVENT_TYPES[plan.type];
    const key = `devent:${id}`;
    const paid = [];
    const failed = [];
    for (const row of plan.rows) {
      try {
        await roblox.sendAward(row.account.id, { key, merit: row.merit, credits: row.credits, reason: event.name, stat: 'Events' });
        store.markEventDay(row.account.id, plan.today);
        paid.push(row);
      } catch (error) {
        console.error(`[Event ${id}] Paying ${row.account.name}`, error);
        failed.push(`${row.account.name}: ${String(error.message).slice(0, 120)}`);
      }
    }
    let hostLine = `None: ${plan.host.reason || 'no pay'}`;
    if (plan.hostLink && !plan.host.reason) {
      try {
        await roblox.sendAward(plan.hostLink.id, { key: `${key}:host`, merit: plan.host.merit, credits: plan.host.credits, reason: `Hosting ${event.name}` });
        store.markHostPay(plan.hostId, plan.type, Date.now());
        hostLine = `${plan.host.credits} cR, ${plan.host.merit} merit to ${plan.hostLink.name}`;
      } catch (error) {
        failed.push(`Host ${plan.hostLink.name}: ${String(error.message).slice(0, 120)}`);
      }
    }
    store.recordEvent(id, {
      type: plan.type,
      host: plan.hostId,
      objective: plan.objective,
      at: new Date().toISOString(),
      attendees: paid.map((row) => ({ id: row.account.id, name: row.account.name, merit: row.merit, credits: row.credits }))
    });

    const promotions = [];
    if (CONFIG.events.autoPromote) {
      const people = [...paid.map((row) => row.account), ...(plan.hostLink && !plan.host.reason ? [plan.hostLink] : [])];
      for (const account of people) {
        try {
          const economy = await roblox.getEconomy(account.id);
          for (const result of await ranking.checkPromotions(account, economy.merit + economy.pendingMerit)) {
            promotions.push({ account, to: `${result.to} (${result.group.short})${result.pending ? ', waiting for approval' : ''}` });
          }
        } catch (error) {
          console.error(`[Event ${id}] Promotion check for ${account.name}`, error);
        }
      }
    }

    const log = new EmbedBuilder()
      .setTitle(`${event.name} logged`)
      .setColor(failed.length ? 0xed4245 : 0x57f287)
      .setDescription(lines(paid.map((row) => `${row.account.name}: +${row.merit} merit, +${row.credits} cR`)))
      .addFields(
        { name: 'Host', value: `<@${plan.hostId}>`, inline: true },
        { name: 'Objective completed', value: plan.objective ? 'Yes' : 'No', inline: true },
        { name: 'Host pay', value: hostLine }
      )
      .setFooter({ text: `Event ${id}. Pay reaches players within about 2 minutes in game, or when they next join.` })
      .setTimestamp();
    if (plan.notes) log.addFields({ name: 'Notes', value: plan.notes.slice(0, 1000) });
    if (promotions.length) log.addFields({ name: 'Promotions', value: lines(promotions.map((p) => `${p.account.name}: ${p.to}`), 1000) });
    if (failed.length) log.addFields({ name: 'Not paid (log it again for these)', value: lines(failed, 1000) });

    const channel = await client.channels.fetch(CONFIG.channels.eventLogs);
    await channel.send({ embeds: [log], allowedMentions: { parse: [] } });
    await interaction.editReply({ content: `Done. ${paid.length} paid${failed.length ? `, ${failed.length} failed (see the log)` : ''}.`, embeds: [log] });
  }

  async function button(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('event:')) return false;
    const [, action, id] = interaction.customId.split(':');
    if (action === 'cancel') {
      pending.delete(id);
      await interaction.update({ content: 'Cancelled. Nothing was paid.', embeds: [], components: [] });
      return true;
    }
    await confirm(interaction, id);
    return true;
  }

  // Merit and cR from the game save, and the rank they lead to.
  async function profile(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const typed = interaction.options.getString('roblox_user');
    const member = interaction.options.getUser('member') || interaction.user;
    let account = null;
    if (typed) account = await roblox.resolveUser(typed);
    else {
      const link = store.linkedRoblox(member.id);
      if (!link) {
        await interaction.editReply(member.id === interaction.user.id ? 'Link your Roblox account first with /link.' : 'That member has no linked Roblox account.');
        return;
      }
      account = link;
    }
    const [economy, ...groupRanks] = await Promise.all([
      roblox.getEconomy(account.id),
      ...GROUPS.map((group) => roblox.getRank(group.groupId, account.id).catch(() => null))
    ]);
    const total = economy.merit + economy.pendingMerit;
    const ranks = GROUPS.map((group, index) => groupRanks[index] && `**${group.short}:** ${groupRanks[index]}`).filter(Boolean);
    const steps = await ranking.nextSteps(account, total);
    const next = steps.length ? steps.join('\n') : null;
    const embed = new EmbedBuilder()
      .setTitle(`${account.name}'s service record`)
      .setColor(CONFIG.brandColor)
      .addFields(
        { name: 'Ranks', value: ranks.join('\n') || 'Not in any UNSC group' },
        { name: 'Merit', value: `${total}${economy.pendingMerit ? ` (${economy.pendingMerit} on the way)` : ''}`, inline: true },
        { name: 'Credits', value: `${economy.credits + economy.pendingCredits} cR${economy.pendingCredits ? ` (${economy.pendingCredits} on the way)` : ''}`, inline: true },
        { name: 'Next rank', value: next || 'No merit promotion waiting in their groups.' }
      );
    if (!economy.found) embed.setFooter({ text: 'No game save yet. It is made the first time they join the game.' });
    await interaction.editReply({ embeds: [embed] });
  }

  // Staff: give or take merit and cR by hand (taking is not supported by the game inbox, so only giving).
  async function grant(interaction) {
    const allowed = interaction.member?.permissions?.has('ManageGuild') || (CONFIG.roles.economyAdmin && interaction.member?.roles?.cache?.has(CONFIG.roles.economyAdmin));
    if (!allowed) {
      await interaction.reply({ content: 'Only economy admins can grant merit or cR.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const account = await roblox.resolveUser(interaction.options.getString('roblox_user', true));
    const merit = interaction.options.getInteger('merit') || 0;
    const credits = interaction.options.getInteger('credits') || 0;
    const reason = interaction.options.getString('reason', true);
    if (merit <= 0 && credits <= 0) {
      await interaction.editReply('Give some merit or cR.');
      return;
    }
    const id = crypto.randomBytes(4).toString('hex');
    await roblox.sendAward(account.id, { key: `dgrant:${id}`, merit, credits, reason: `Grant: ${reason}` });
    const log = new EmbedBuilder()
      .setTitle('Manual grant')
      .setColor(0x5865f2)
      .setDescription(`${account.name}: +${merit} merit, +${credits} cR`)
      .addFields({ name: 'By', value: `<@${interaction.user.id}>`, inline: true }, { name: 'Reason', value: reason.slice(0, 1000) })
      .setTimestamp();
    const channel = await client.channels.fetch(CONFIG.channels.eventLogs);
    await channel.send({ embeds: [log], allowedMentions: { parse: [] } });
    await interaction.editReply(`Sent to ${account.name}. It reaches them within about 2 minutes in game.`);
  }

  setInterval(() => {
    for (const [id, plan] of pending) if (plan.expires < Date.now()) pending.delete(id);
  }, 60_000).unref();

  return { command, button, profile, grant };
}
