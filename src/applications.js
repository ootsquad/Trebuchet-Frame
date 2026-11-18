import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { CONFIG } from './config.js';
import { checkPhrase, makePhrase } from './verify.js';

async function getTextChannel(client, channelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error(`Channel ${channelId} is not a text channel I can see.`);
  return channel;
}

async function reportError(_client, context, error) {
  console.error(`[${context}]`, error);
}

const knowledgeQuestions = [
  ['coleProtocol', 'What is the Cole Protocol, and why was it implemented?'],
  ['covenantSpecies', 'Name the actual species that make up the Covenant.'],
  ['monitors', 'What are Monitors in Halo lore, and what is their function?'],
  ['reach', 'How was Reach important to Humanity’s military and resources?'],
  ['mjolnir', 'What name is given to the armored exoskeleton worn by Spartans?'],
  ['spartanIIs', "What were Spartan II's originally made to do?"],
  ['harvest', 'What is the significance of the planet Harvest?'],
  ['earthDiscovery', 'How did the Covenant originally discover Earth?'],
  ['permadeath', 'Do you understand perma-death and agree to abide by the rules for it?'],
  ['loreDriven', 'Do you understand this community is heavily lore-driven and game events can change based on the results of lore events?']
];

const activeApplicants = new Set();
const processingMessages = new Set();

function trim(value, max = 350) {
  const text = String(value ?? '').trim();
  if (!text) return 'No answer';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function normalizeAgreement(value) {
  const cleaned = String(value).trim().toLowerCase();
  return ['yes', 'y', 'i agree', 'agree', 'agreed', 'accepted', 'accept'].includes(cleaned);
}

async function ask(dm, userId, prompt, { minWords = 1, validate = null, timeout = 15 * 60_000 } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dm.send(prompt);
    const collected = await dm.awaitMessages({
      filter: (message) => message.author.id === userId,
      max: 1,
      time: timeout,
      errors: ['time']
    });
    const answer = collected.first()?.content?.trim() || '';
    if (answer.toLowerCase() === 'cancel') throw new Error('Application cancelled by user.');

    if (answer.split(/\s+/).filter(Boolean).length < minWords) {
      await dm.send(`Please give a fuller answer. This question requires at least ${minWords} words.`);
      continue;
    }

    if (validate) {
      try {
        const result = await validate(answer);
        return { answer, result };
      } catch (error) {
        await dm.send(`I could not accept that answer: ${trim(error.message, 700)}`);
        continue;
      }
    }

    return { answer, result: null };
  }
  throw new Error('Too many invalid answers. Start the application again when ready.');
}

function buildDecisionRow(discordUserId, robloxUserId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`wave:approve:${discordUserId}:${robloxUserId}`)
      .setLabel('Approve / Wave')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`wave:deny:${discordUserId}:${robloxUserId}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

function buildApplicationEmbeds({ member, robloxUser, age, knowledge, agreements, robloxRoles }) {
  const roleText = robloxRoles.length ? robloxRoles.join(', ') : 'No group membership detected';

  const first = new EmbedBuilder()
    .setTitle('Wave Application: PENDING')
    .setColor(0xFEE75C)
    .addFields(
      { name: 'Roblox Username / UserID', value: `${trim(robloxUser.name, 200)} / ${robloxUser.id}` },
      { name: 'Account ownership', value: '✅ Verified with a phrase in their Roblox profile' },
      { name: 'Discord Username / Discord UserID', value: `${trim(member.user.tag, 200)} / ${member.id}` },
      { name: 'User Age', value: trim(age, 100), inline: true },
      { name: 'Current Roblox Group Role(s)', value: trim(roleText, 500), inline: true }
    )
    .setFooter({ text: `WAVE|${member.id}|${robloxUser.id}|PENDING` })
    .setTimestamp();

  const second = new EmbedBuilder()
    .setTitle('User Knowledge Section 1/2')
    .setColor(0x5865F2)
    .addFields(
      ...knowledgeQuestions.slice(0, 5).map(([key, question]) => ({ name: question, value: trim(knowledge[key]) }))
    );

  const third = new EmbedBuilder()
    .setTitle('User Knowledge Section 2/2')
    .setColor(0x5865F2)
    .addFields(
      ...knowledgeQuestions.slice(5).map(([key, question]) => ({ name: question, value: trim(knowledge[key]) }))
    );

  const fourth = new EmbedBuilder()
    .setTitle('Agreement Section')
    .setColor(0x5865F2)
    .addFields(
      { name: 'Discord Terms of Service', value: agreements.discordTerms ? '✅ Agreed' : '❌ Did not agree' },
      { name: 'Discord Privacy Policy', value: agreements.discordPrivacy ? '✅ Agreed' : '❌ Did not agree' },
      { name: 'Roblox Terms of Use', value: agreements.robloxTerms ? '✅ Agreed' : '❌ Did not agree' },
      { name: `${CONFIG.brandName} Community Rules`, value: agreements.communityRules ? '✅ Agreed' : '❌ Did not agree' }
    );

  return [first, second, third, fourth];
}

function parseFooter(message) {
  const footer = message.embeds?.[0]?.footer?.text || '';
  const match = /^WAVE\|(\d+)\|(\d+)\|([A-Z_]+)$/.exec(footer);
  if (!match) return null;
  return { discordUserId: match[1], robloxUserId: match[2], status: match[3] };
}

function moderatorAllowed(member) {
  return member.roles.cache.has(CONFIG.roles.waveModerator) || member.permissions.has('ManageGuild');
}

async function updateApplicationStatus(message, { status, moderator, note = null }) {
  const parsed = parseFooter(message);
  if (!parsed) return;

  const color = status === 'APPROVED' ? 0x57F287 : status === 'DENIED' ? 0xED4245 : 0xFEE75C;
  const first = EmbedBuilder.from(message.embeds[0])
    .setTitle(`Wave Application: ${status}`)
    .setColor(color)
    .setFooter({ text: `WAVE|${parsed.discordUserId}|${parsed.robloxUserId}|${status}` });

  if (moderator) {
    first.addFields({ name: 'Reviewed By', value: `${moderator.user.tag} (${moderator.id})` });
  }
  if (note) first.addFields({ name: 'Review Note', value: trim(note, 900) });

  const remaining = message.embeds.slice(1).map((embed) => EmbedBuilder.from(embed));
  await message.edit({ embeds: [first, ...remaining], components: [buildDecisionRow(parsed.discordUserId, parsed.robloxUserId, true)] });
}

export function createApplicationService({ client, roblox, store }) {
  async function start(member, source = 'join') {
    if (!member || member.user.bot || activeApplicants.has(member.id)) return;
    if (member.roles.cache.has(CONFIG.roles.communityMember)) return;

    activeApplicants.add(member.id);
    try {
      if (!member.roles.cache.has(CONFIG.roles.unWaved) && !member.roles.cache.has(CONFIG.roles.communityMember)) {
        try {
          await member.roles.add(CONFIG.roles.unWaved, `New member started the ${CONFIG.brandName} wave process`);
        } catch (error) {
          await reportError(client, `Assigning Un-Waved role to Discord user ${member.id}`, error);
        }
      }

      const dm = await member.createDM();
      await dm.send([
        `Welcome to ${CONFIG.brandName}. I am starting your wave application because of: ${source}.`,
        'Reply to each question in this DM. Type `cancel` at any time to stop.',
        'Knowledge answers require at least one short sentence.',
        'Discord Terms: https://discord.com/terms',
        'Discord Privacy: https://discord.com/privacy',
        'Roblox Terms of Use: https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use'
      ].join('\n'));

      const robloxAnswer = await ask(dm, member.id, 'User Information 1/2: What is your Roblox username or Roblox UserID?', {
        validate: (answer) => roblox.resolveUser(answer)
      });
      const robloxUser = robloxAnswer.result;

      // Prove the account is theirs: a phrase in their Roblox profile's About section.
      const owner = store.discordFor(robloxUser.id);
      if (owner && owner !== member.id) {
        throw new Error(`The Roblox account ${robloxUser.name} is already linked to another Discord account. Contact a Wave Moderator.`);
      }
      const phrase = makePhrase();
      await dm.send([
        `To prove **${robloxUser.name}** is your account, put this phrase in your Roblox profile's About section:`,
        `\`${phrase}\``,
        `Edit it here: https://www.roblox.com/users/${robloxUser.id}/profile`,
        'Then reply `done`. You can remove it once you are verified.'
      ].join('\n'));
      let verified = false;
      for (let tries = 1; tries <= 3 && !verified; tries += 1) {
        await ask(dm, member.id, tries === 1 ? 'Reply `done` when the phrase is saved on your profile.' : 'Reply `done` to check again.', { timeout: 30 * 60_000 });
        await dm.send('Checking your profile...');
        verified = await checkPhrase(robloxUser.id, phrase);
        if (!verified && tries < 3) {
          await dm.send(`I could not find \`${phrase}\` on ${robloxUser.name}'s profile. Make sure it is saved in About exactly as written, with nothing hidden by Roblox's filter.`);
        }
      }
      if (!verified) throw new Error(`The phrase never showed up on ${robloxUser.name}'s profile, so the account could not be verified.`);
      await dm.send(`Verified: ${robloxUser.name} is yours. You can remove the phrase from your profile now.`);

      const ageAnswer = await ask(dm, member.id, 'User Information 2/2: What is your age?', {
        validate: async (answer) => {
          const age = Number(answer);
          if (!Number.isInteger(age) || age < CONFIG.waves.minimumAge || age > 99) throw new Error(`Enter a whole-number age from ${CONFIG.waves.minimumAge} to 99.`);
          return age;
        }
      });

      const knowledge = {};
      for (let index = 0; index < knowledgeQuestions.length; index += 1) {
        const [key, question] = knowledgeQuestions[index];
        const response = await ask(dm, member.id, `Knowledge ${index + 1}/${knowledgeQuestions.length}: ${question}`, {
          minWords: index < 8 ? 5 : 2
        });
        knowledge[key] = response.answer;
      }

      const terms = await ask(dm, member.id, 'Agreement 1/4: Do you agree to the Discord Terms of Service at https://discord.com/terms ? Reply yes or no.');
      const privacy = await ask(dm, member.id, 'Agreement 2/4: Do you agree to the Discord Privacy Policy at https://discord.com/privacy ? Reply yes or no.');
      const robloxTerms = await ask(dm, member.id, 'Agreement 3/4: Do you agree to the Roblox Terms of Use at https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use ? Reply yes or no.');
      const rules = await ask(dm, member.id, `Agreement 4/4: Do you agree to follow the ${CONFIG.brandName} community rules posted in the Discord server? Reply yes or no.`);

      const agreements = {
        discordTerms: normalizeAgreement(terms.answer),
        discordPrivacy: normalizeAgreement(privacy.answer),
        robloxTerms: normalizeAgreement(robloxTerms.answer),
        communityRules: normalizeAgreement(rules.answer)
      };

      let robloxRoles = [];
      try { const unscRank = await roblox.getRank(CONFIG.groups.unsc, robloxUser.id); robloxRoles = unscRank ? [`UNSC: ${unscRank}`] : []; } catch (error) { await reportError(client, 'Checking applicant Roblox membership', error); }

      const embeds = buildApplicationEmbeds({
        member,
        robloxUser,
        age: ageAnswer.answer,
        knowledge,
        agreements,
        robloxRoles
      });

      const channel = await getTextChannel(client, CONFIG.channels.waveApplications);
      const application = await channel.send({
        content: `<@&${CONFIG.roles.waveModerator}> New wave application from <@${member.id}>. Use the buttons below to approve or deny.`,
        embeds,
        components: [buildDecisionRow(member.id, robloxUser.id)],
        allowedMentions: { roles: [CONFIG.roles.waveModerator], users: [member.id] }
      });


      if (!agreements.discordTerms || !agreements.discordPrivacy || !agreements.robloxTerms || !agreements.communityRules) {
        await dm.send('Your application was submitted, but one or more required agreements were not accepted. A moderator will review it.');
      } else {
        await dm.send('Your wave application was submitted. A Wave Moderator will review it.');
      }
    } catch (error) {
      if (!String(error.message).includes('Application cancelled by user')) {
        await reportError(client, `Wave application for Discord user ${member.id}`, error);
        try { await member.send(`Your wave application stopped: ${trim(error.message, 700)}\nUse /wave-apply in the server to start again.`); } catch {}
      }
    } finally {
      activeApplicants.delete(member.id);
    }
  }

  async function decide(message, action, moderator, interaction = null) {
    if (processingMessages.has(message.id)) {
      if (interaction) await interaction.reply({ content: 'This application is already being processed.', flags: MessageFlags.Ephemeral });
      return;
    }

    const parsed = parseFooter(message);
    if (!parsed || parsed.status !== 'PENDING') {
      if (interaction) await interaction.reply({ content: 'This application has already been reviewed.', flags: MessageFlags.Ephemeral });
      return;
    }

    processingMessages.add(message.id);
    try {
      if (action === 'approve') {
        if (interaction) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const agreementEmbed = message.embeds.find((embed) => embed.title === 'Agreement Section');
        const agreementsAccepted = agreementEmbed?.fields?.every((field) => String(field.value || '').startsWith('✅'));
        if (!agreementsAccepted) {
          throw new Error('This applicant did not accept every required agreement. Have them submit a new application before approving.');
        }

        const robloxResult = await roblox.waveMember(parsed.robloxUserId);
        const guildMember = await message.guild.members.fetch(parsed.discordUserId);
        const linked = await roblox.resolveUser(parsed.robloxUserId).catch(() => ({ id: parsed.robloxUserId, name: parsed.robloxUserId }));
        const owner = store.discordFor(parsed.robloxUserId);
        if (owner && owner !== parsed.discordUserId) {
          throw new Error(`That Roblox account is already linked to <@${owner}>. Sort that out before approving.`);
        }
        store.link(parsed.discordUserId, linked);
        await guildMember.roles.add(CONFIG.roles.communityMember, `Wave application approved by ${moderator.user.tag}`);
        if (guildMember.roles.cache.has(CONFIG.roles.unWaved)) {
          await guildMember.roles.remove(CONFIG.roles.unWaved, `Wave application approved by ${moderator.user.tag}`);
        }

        await updateApplicationStatus(message, {
          status: 'APPROVED',
          moderator,
          note: `UNSC rank: ${robloxResult.rank}${robloxResult.alreadyWaved ? ' (already had it)' : ''}. Discord member role given. Discord and Roblox accounts linked.`
        });

        try { await guildMember.send(`Your ${CONFIG.brandName} wave application was approved. Welcome aboard.`); } catch {}
        if (interaction) await interaction.editReply('Approved. Roblox and Discord roles were updated.');
      } else {
        if (interaction) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guildMember = await message.guild.members.fetch(parsed.discordUserId).catch(() => null);
        await updateApplicationStatus(message, { status: 'DENIED', moderator, note: 'No rank changes were made.' });
        if (guildMember) {
          try { await guildMember.send(`Your ${CONFIG.brandName} wave application was denied. Contact a Wave Moderator if you need clarification.`); } catch {}
        }
        if (interaction) await interaction.editReply('Denied. No Roblox or Discord rank changes were made.');
      }
    } catch (error) {
      await reportError(client, `Wave ${action} for application message ${message.id}`, error);
      if (interaction) {
        if (interaction.deferred || interaction.replied) await interaction.editReply(`The action failed and the application remains pending: ${trim(error.message, 1000)}`);
        else await interaction.reply({ content: `The action failed and the application remains pending: ${trim(error.message, 1000)}`, flags: MessageFlags.Ephemeral });
      } else {
        try { await moderator.send(`Wave action failed for application ${message.url}: ${trim(error.message, 1000)}`); } catch {}
      }
    } finally {
      processingMessages.delete(message.id);
    }
  }

  async function handleButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('wave:')) return false;
    const [, action] = interaction.customId.split(':');
    const moderator = interaction.member;
    if (!moderatorAllowed(moderator)) {
      await interaction.reply({ content: 'Only Wave Moderators or server managers can review wave applications.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await decide(interaction.message, action, moderator, interaction);
    return true;
  }

  return { start, handleButton };
}
