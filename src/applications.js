import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { CONFIG } from './config.js';
import { checkPhrase, makePhrase } from './verify.js';
import { COLORS, buttons, card, note, profileUrl, verifyCard } from './ui.js';
import { groupByKey } from './groups.js';

const SECTION = 'Wave Application';
const TOTAL_STEPS = 17;
const step = (n) => `Step ${n} of ${TOTAL_STEPS}`;

async function getTextChannel(client, channelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error(`Channel ${channelId} is not a text channel I can see.`);
  return channel;
}

async function reportError(_client, context, error) {
  console.error(`[${context}]`, error);
}

// [key, short label for staff, the question]
const knowledgeQuestions = [
  ['coleProtocol', 'Cole Protocol', 'What is the Cole Protocol, and why was it implemented?'],
  ['covenantSpecies', 'Covenant species', 'Name the actual species that make up the Covenant.'],
  ['monitors', 'Monitors', 'What are Monitors in Halo lore, and what is their function?'],
  ['reach', 'Reach', 'How was Reach important to Humanity’s military and resources?'],
  ['mjolnir', 'Spartan armor', 'What name is given to the armored exoskeleton worn by Spartans?'],
  ['spartanIIs', 'Spartan IIs', "What were Spartan II's originally made to do?"],
  ['harvest', 'Harvest', 'What is the significance of the planet Harvest?'],
  ['earthDiscovery', 'Finding Earth', 'How did the Covenant originally discover Earth?'],
  ['permadeath', 'Perma-death', 'Do you understand perma-death and agree to abide by the rules for it?'],
  ['loreDriven', 'Lore-driven', 'Do you understand this community is heavily lore-driven and game events can change based on the results of lore events?']
];

const activeApplicants = new Set();
const processingMessages = new Set();

function trim(value, max = 350) {
  const text = String(value ?? '').trim();
  if (!text) return 'No answer';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

// Sends a question card and waits for a typed answer. "cancel" stops the application.
async function ask(dm, userId, prompt, { minWords = 1, validate = null, timeout = 15 * 60_000 } = {}) {
  const payload = typeof prompt === 'string' ? { embeds: [card({ section: SECTION, description: prompt })] } : prompt;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await dm.send(payload);
    const collected = await dm.awaitMessages({
      filter: (message) => message.author.id === userId,
      max: 1,
      time: timeout,
      errors: ['time']
    }).catch(() => { throw new Error('No answer in time. Start again with /wave-apply when you are ready.'); });
    const answer = collected.first()?.content?.trim() || '';
    if (answer.toLowerCase() === 'cancel') throw new Error('Application cancelled by user.');

    if (answer.split(/\s+/).filter(Boolean).length < minWords) {
      await dm.send({ embeds: [note(`Please give a fuller answer, at least **${minWords} words**.`, COLORS.warn)] });
      continue;
    }

    if (validate) {
      try {
        const result = await validate(answer);
        return { answer, result };
      } catch (error) {
        await dm.send({ embeds: [note(trim(error.message, 700), COLORS.warn)] });
        continue;
      }
    }

    return { answer, result: null };
  }
  throw new Error('Too many invalid answers. Start the application again when ready.');
}

// Sends a card with buttons and waits for a press. The pressed button is greyed out with the rest.
async function choose(dm, userId, payload, options, { timeout = 15 * 60_000 } = {}) {
  const row = buttons([...options, { id: 'wavedm:cancel', label: 'Cancel application', style: ButtonStyle.Danger }]);
  const message = await dm.send({ ...payload, components: [row] });
  const pressed = await message.awaitMessageComponent({ filter: (i) => i.user.id === userId, time: timeout })
    .catch(() => { throw new Error('No answer in time. Start again with /wave-apply when you are ready.'); });
  const done = buttons([...options, { id: 'wavedm:cancel', label: 'Cancel application', style: ButtonStyle.Danger }].map((option) => ({
    ...option,
    style: option.id === pressed.customId ? (option.style === ButtonStyle.Danger ? ButtonStyle.Danger : ButtonStyle.Primary) : ButtonStyle.Secondary,
    disabled: !option.url
  })));
  await pressed.update({ components: [done] }).catch(() => {});
  if (pressed.customId === 'wavedm:cancel') throw new Error('Application cancelled by user.');
  return pressed.customId;
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

const STATUS = {
  PENDING: { color: 0xfee75c, label: '🟡 Pending review' },
  APPROVED: { color: 0x57f287, label: '🟢 Approved' },
  DENIED: { color: 0xed4245, label: '🔴 Denied' }
};

// The application's data rides in the title link (the Roblox profile), so nothing technical shows on the card.
function applicationUrl({ robloxUserId, discordUserId, status, agreed }) {
  return `https://www.roblox.com/users/${robloxUserId}/profile?wave=${discordUserId}&status=${status}&agreed=${agreed ? 1 : 0}`;
}

function parseApplication(message) {
  const embed = message.embeds?.[0];
  try {
    const url = new URL(embed?.url || '');
    const robloxUserId = url.pathname.split('/')[2];
    const discordUserId = url.searchParams.get('wave');
    if (robloxUserId && discordUserId) {
      return { discordUserId, robloxUserId, status: url.searchParams.get('status') || 'PENDING', agreed: url.searchParams.get('agreed') === '1' };
    }
  } catch {}
  // Applications posted before the new layout kept the data in the footer.
  const match = /^WAVE\|(\d+)\|(\d+)\|([A-Z_]+)$/.exec(embed?.footer?.text || '');
  if (!match) return null;
  const agreementEmbed = message.embeds.find((item) => item.title === 'Agreement Section');
  const agreed = Boolean(agreementEmbed?.fields?.every((field) => String(field.value || '').startsWith('✅')));
  return { discordUserId: match[1], robloxUserId: match[2], status: match[3], agreed };
}

function accountAge(created) {
  if (!created) return 'Unknown';
  const date = new Date(created);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  const span = days >= 365 ? `${Math.floor(days / 365)} yr` : days >= 30 ? `${Math.floor(days / 30)} mo` : `${days} days`;
  return `<t:${Math.floor(date.getTime() / 1000)}:D>\n${days < 30 ? '⚠️ ' : ''}${span} old`;
}

function buildApplicationEmbeds({ member, robloxUser, age, knowledge, agreements, projectStatus, profile, headshot }) {
  const agreedCount = Object.values(agreements).filter(Boolean).length;
  const agreed = agreedCount === 4;
  const missing = [
    ['discordTerms', 'Discord Terms'], ['discordPrivacy', 'Discord Privacy'], ['robloxTerms', 'Roblox Terms'], ['communityRules', 'Community rules']
  ].filter(([key]) => !agreements[key]).map(([, name]) => name);
  const answers = knowledgeQuestions.map(([key]) => String(knowledge[key] || '').trim().toLowerCase());
  const sameAnswers = answers.length - new Set(answers).size;

  const summary = new EmbedBuilder()
    .setColor(STATUS.PENDING.color)
    .setAuthor({ name: `Wave Application · ${STATUS.PENDING.label}`, iconURL: member.user.displayAvatarURL() })
    .setTitle(robloxUser.name)
    .setURL(applicationUrl({ robloxUserId: robloxUser.id, discordUserId: member.id, status: 'PENDING', agreed }))
    .setDescription(`<@${member.id}> applied with this Roblox account.`)
    .addFields(
      { name: 'Roblox', value: `${trim(robloxUser.name, 100)}\nID ${robloxUser.id}`, inline: true },
      { name: 'Discord', value: `${trim(member.user.username, 100)}\nID ${member.id}`, inline: true },
      { name: 'Age', value: trim(age, 20), inline: true },
      { name: 'Ownership', value: '✅ Verified', inline: true },
      { name: 'Agreements', value: agreed ? '✅ 4 of 4' : `❌ ${agreedCount} of 4\nMissing: ${missing.join(', ')}`, inline: true },
      { name: 'Roblox joined', value: accountAge(profile?.created), inline: true },
      { name: 'Project: Trebuchet group', value: projectStatus }
    )
    .setFooter({ text: 'Submitted' })
    .setTimestamp();
  if (headshot) summary.setThumbnail(headshot);
  if (sameAnswers >= 3) {
    const different = answers.length - sameAnswers;
    summary.addFields({ name: 'Heads up', value: different === 1 ? '⚠️ Every knowledge answer is the same text.' : `⚠️ Only ${different} different answers out of ${answers.length}.` });
  }

  const answersEmbed = new EmbedBuilder()
    .setColor(0x2b2d31)
    .setTitle('Knowledge answers')
    .addFields(knowledgeQuestions.map(([key, label, question], index) => ({
      name: `${index + 1}. ${label}`,
      value: `-# ${trim(question, 140)}\n> ${trim(knowledge[key], 330).replace(/\n/g, '\n> ')}`
    })));

  return [summary, answersEmbed];
}

function moderatorAllowed(member) {
  return member.roles.cache.has(CONFIG.roles.waveModerator) || member.permissions.has('ManageGuild');
}

async function updateApplicationStatus(message, { status, moderator, note = null }) {
  const parsed = parseApplication(message);
  if (!parsed) return;
  const look = STATUS[status] || STATUS.PENDING;
  const old = message.embeds[0];
  const first = EmbedBuilder.from(old)
    .setColor(look.color)
    .setAuthor({ name: `Wave Application · ${look.label}`, iconURL: old.author?.iconURL || undefined })
    .setURL(applicationUrl({ ...parsed, status }));
  if (moderator) first.addFields({ name: 'Reviewed by', value: `<@${moderator.id}> <t:${Math.floor(Date.now() / 1000)}:R>`, inline: true });
  if (note) first.addFields({ name: 'Result', value: trim(note, 900) });

  const remaining = message.embeds.slice(1).map((embed) => EmbedBuilder.from(embed));
  await message.edit({ embeds: [first, ...remaining], components: [buildDecisionRow(parsed.discordUserId, parsed.robloxUserId, true)] });
}

export function createApplicationService({ client, roblox, store, ranking = null, sync = null, blacklist = null }) {
  const project = () => groupByKey('project');

  // Project: Trebuchet: accept their join request if they have one, then give the Waved role.
  async function waveInProject(robloxUserId) {
    const group = project();
    if (!group) return { note: 'No Project: Trebuchet group set, so no Roblox role was given.' };
    let roles = await roblox.getRoles(group.groupId, robloxUserId);
    let accepted = false;
    if (!roles.length) {
      if (!(await roblox.hasJoinRequest(group.groupId, robloxUserId).catch(() => false))) {
        throw new Error('They are not in the Project: Trebuchet group and have not asked to join. Have them send a join request, then approve again.');
      }
      await roblox.acceptJoinRequest(group.groupId, robloxUserId);
      accepted = true;
      roles = await roblox.getRoles(group.groupId, robloxUserId);
    }
    const already = roles.some((role) => role.name.toLowerCase() === CONFIG.groups.wavedRole.toLowerCase());
    if (!already) await roblox.addRole(group.groupId, robloxUserId, CONFIG.groups.wavedRole);
    return { accepted, already };
  }
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
      await dm.send({ embeds: [card({
        section: SECTION,
        title: `Welcome to ${CONFIG.brandName}`,
        description: `Your wave application has started (${source}). Answer each question in this DM. It takes about 10 minutes.`,
        fields: [
          { name: 'What you will do', value: '**1.** Link and verify your Roblox account\n**2.** Tell us your age\n**3.** Answer 10 short knowledge questions\n**4.** Accept 4 agreements' },
          { name: 'Good to know', value: '• You have 15 minutes per question.\n• Knowledge answers need a short sentence.\n• Type `cancel` at any time to stop.' }
        ],
        footer: 'A Wave Moderator reviews every application.'
      })] });

      // Someone whose Discord is already linked (and so verified) can reuse that account and skip the check.
      const existing = store.linkedRoblox(member.id);
      let robloxUser = null;
      if (existing) {
        const pick = await choose(dm, member.id, { embeds: [card({
          section: SECTION,
          title: `${step(1)}  Roblox account`,
          description: `Your Discord is already linked to **${existing.name}**, and that account is verified. Apply with it?`
        })] }, [
          { id: 'wavedm:same', label: `Use ${existing.name}`.slice(0, 80), style: ButtonStyle.Success },
          { id: 'wavedm:other', label: 'Use a different account', style: ButtonStyle.Secondary }
        ]);
        if (pick === 'wavedm:same') robloxUser = await roblox.resolveUser(existing.id);
      }
      if (!robloxUser) {
        const robloxAnswer = await ask(dm, member.id, { embeds: [card({
          section: SECTION,
          title: `${step(1)}  Roblox account`,
          description: 'What is your **Roblox username** or **user ID**?',
          footer: 'Use your username, not your display name.'
        })] }, {
          validate: (answer) => roblox.resolveUser(answer)
        });
        robloxUser = robloxAnswer.result;
      }

      const owner = store.discordFor(robloxUser.id);
      if (owner && owner !== member.id) {
        throw new Error(`The Roblox account ${robloxUser.name} is already linked to another Discord account. Contact a Wave Moderator.`);
      }
      const blocked = blacklist ? await blacklist.reasonFor(robloxUser.id) : null;
      if (blocked) {
        await blacklist.ban(member.id, blocked);
        throw new Error('This Roblox account is blacklisted.');
      }
      if (owner === member.id) {
        await dm.send({ embeds: [note(`✅ **${robloxUser.name}** is already verified as yours, so ${step(2).toLowerCase()} is skipped.`, COLORS.good)] });
      } else {
        // Prove the account is theirs: a phrase in their Roblox profile's About section.
        const phrase = makePhrase();
        let verified = false;
        for (let tries = 1; tries <= 5 && !verified; tries += 1) {
          await choose(dm, member.id, { embeds: [tries === 1
            ? verifyCard(robloxUser, phrase, { section: SECTION, step: step(2) })
            : note(`I could not find the phrase on **${robloxUser.name}**'s profile yet. Check it is saved in **About** exactly as written, wait a few seconds, and try again. (${tries - 1} of 4 tries used)`, COLORS.warn)] }, [
            { label: 'Open my profile', url: profileUrl(robloxUser.id) },
            { id: 'wavedm:check', label: 'Check my profile', style: ButtonStyle.Success }
          ], { timeout: 30 * 60_000 });
          verified = await checkPhrase(robloxUser.id, phrase);
        }
        if (!verified) throw new Error(`The phrase never showed up on ${robloxUser.name}'s profile, so the account could not be verified.`);
        // Saved now, so a later application or /link does not ask again.
        store.link(member.id, robloxUser);
        await dm.send({ embeds: [note(`✅ **${robloxUser.name}** is verified. You can delete the phrase from your profile now.`, COLORS.good)] });
      }

      const ageAnswer = await ask(dm, member.id, { embeds: [card({
        section: SECTION,
        title: `${step(3)}  Age`,
        description: 'How old are you?',
        footer: 'Reply with a number.'
      })] }, {
        validate: async (answer) => {
          const age = Number(answer);
          if (!Number.isInteger(age) || age < CONFIG.waves.minimumAge || age > 99) throw new Error(`Enter a whole-number age from ${CONFIG.waves.minimumAge} to 99.`);
          return age;
        }
      });

      const knowledge = {};
      for (let index = 0; index < knowledgeQuestions.length; index += 1) {
        const [key, , question] = knowledgeQuestions[index];
        const minWords = index < 8 ? 5 : 2;
        const response = await ask(dm, member.id, { embeds: [card({
          section: SECTION,
          title: `${step(4 + index)}  Knowledge ${index + 1} of ${knowledgeQuestions.length}`,
          description: question,
          footer: `At least ${minWords} words.`
        })] }, { minWords });
        knowledge[key] = response.answer;
      }

      const agreementList = [
        ['discordTerms', 'Discord Terms of Service', '[Read them here](https://discord.com/terms)'],
        ['discordPrivacy', 'Discord Privacy Policy', '[Read it here](https://discord.com/privacy)'],
        ['robloxTerms', 'Roblox Terms of Use', '[Read them here](https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use)'],
        ['communityRules', `${CONFIG.brandName} community rules`, 'Posted in the Discord server.']
      ];
      const agreements = {};
      for (let index = 0; index < agreementList.length; index += 1) {
        const [key, name, where] = agreementList[index];
        const pressed = await choose(dm, member.id, { embeds: [card({
          section: SECTION,
          title: `${step(14 + index)}  Agreement ${index + 1} of 4`,
          description: `Do you agree to the **${name}**?\n${where}`
        })] }, [
          { id: 'wavedm:yes', label: 'I agree', style: ButtonStyle.Success },
          { id: 'wavedm:no', label: 'I do not agree', style: ButtonStyle.Secondary }
        ]);
        agreements[key] = pressed === 'wavedm:yes';
      }

      let projectStatus = 'Unknown';
      if (project()) {
        try {
          const roles = await roblox.getRoles(project().groupId, robloxUser.id);
          if (roles.length) projectStatus = `✅ Member (${roles.map((role) => role.name).join(', ')})`;
          else if (await roblox.hasJoinRequest(project().groupId, robloxUser.id)) projectStatus = '🕓 Join request waiting. Approving accepts it.';
          else projectStatus = '⚠️ Not in the group and no join request. Approval will fail until they ask to join.';
        } catch (error) { await reportError(client, 'Checking applicant Roblox membership', error); }
      }
      const [profile, headshot] = await Promise.all([
        roblox.getProfile(robloxUser.id).catch(() => null),
        roblox.headshotUrl(robloxUser.id).catch(() => null)
      ]);

      const embeds = buildApplicationEmbeds({
        member,
        robloxUser,
        age: ageAnswer.answer,
        knowledge,
        agreements,
        projectStatus,
        profile,
        headshot
      });

      const channel = await getTextChannel(client, CONFIG.channels.waveApplications);
      const application = await channel.send({
        content: `<@&${CONFIG.roles.waveModerator}> New wave application from <@${member.id}>`,
        embeds,
        components: [buildDecisionRow(member.id, robloxUser.id)],
        allowedMentions: { roles: [CONFIG.roles.waveModerator], users: [member.id] }
      });


      const allAgreed = Object.values(agreements).every(Boolean);
      await dm.send({ embeds: [card({
        section: SECTION,
        title: 'Application submitted',
        color: allAgreed ? COLORS.good : COLORS.warn,
        description: allAgreed
          ? 'Thank you. A Wave Moderator will review your application. I will message you here with the result.'
          : 'Your application was sent, but you did not accept every agreement. A Wave Moderator will review it, and it cannot be approved without them.',
        fields: [{ name: 'Roblox account', value: `${robloxUser.name} (verified)`, inline: true }]
      })] });
    } catch (error) {
      if (String(error.message).includes('Application cancelled by user')) {
        try { await member.send({ embeds: [note('Application cancelled. Use /wave-apply in the server whenever you want to start again.')] }); } catch {}
      } else {
        await reportError(client, `Wave application for Discord user ${member.id}`, error);
        try { await member.send({ embeds: [card({ section: SECTION, title: 'Application stopped', color: COLORS.bad, description: trim(error.message, 700), footer: 'Use /wave-apply in the server to start again.' })] }); } catch {}
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

    const parsed = parseApplication(message);
    if (!parsed || parsed.status !== 'PENDING') {
      if (interaction) await interaction.reply({ content: 'This application has already been reviewed.', flags: MessageFlags.Ephemeral });
      return;
    }

    processingMessages.add(message.id);
    try {
      if (action === 'approve') {
        if (interaction) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (!parsed.agreed) {
          throw new Error('This applicant did not accept every required agreement. Have them submit a new application before approving.');
        }

        const owner = store.discordFor(parsed.robloxUserId);
        if (owner && owner !== parsed.discordUserId) {
          throw new Error(`That Roblox account is already linked to <@${owner}>. Sort that out before approving.`);
        }
        const robloxResult = await waveInProject(parsed.robloxUserId);
        const guildMember = await message.guild.members.fetch(parsed.discordUserId);
        const linked = await roblox.resolveUser(parsed.robloxUserId).catch(() => ({ id: parsed.robloxUserId, name: parsed.robloxUserId }));
        store.link(parsed.discordUserId, linked);
        await guildMember.roles.add(CONFIG.roles.communityMember, `Wave application approved by ${moderator.user.tag}`);
        if (guildMember.roles.cache.has(CONFIG.roles.unWaved)) {
          await guildMember.roles.remove(CONFIG.roles.unWaved, `Wave application approved by ${moderator.user.tag}`);
        }

        await updateApplicationStatus(message, {
          status: 'APPROVED',
          moderator,
          note: robloxResult.note || `${robloxResult.accepted ? 'Join request accepted. ' : ''}${CONFIG.groups.wavedRole} role ${robloxResult.already ? 'already held' : 'given'} in Project: Trebuchet. Discord role given. Accounts linked.`
        });
        if (ranking && project()) {
          await ranking.logChange({
            group: project(), target: linked, kind: 'waved', from: robloxResult.accepted ? 'Join request' : 'Member', to: CONFIG.groups.wavedRole,
            by: { discordId: moderator.id, robloxName: store.linkedRoblox(moderator.id)?.name, authority: 'Wave Moderator' }, reason: 'Wave application approved'
          }).catch(() => {});
        }

        try { await guildMember.send({ embeds: [card({ section: SECTION, title: 'Application approved', color: COLORS.good, description: `Welcome to ${CONFIG.brandName}. You now have access to the rest of the server.` })] }); } catch {}
        if (interaction) await interaction.editReply('Approved. Roblox and Discord roles were updated.');
      } else {
        if (interaction) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guildMember = await message.guild.members.fetch(parsed.discordUserId).catch(() => null);
        await updateApplicationStatus(message, { status: 'DENIED', moderator, note: 'No rank changes were made.' });
        if (guildMember) {
          try { await guildMember.send({ embeds: [card({ section: SECTION, title: 'Application denied', color: COLORS.bad, description: 'Your application was not approved this time. Contact a Wave Moderator if you have questions.' })] }); } catch {}
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

  // /unwave: takes the Waved role away in Project: Trebuchet and Discord.
  async function unwave(interaction) {
    if (!moderatorAllowed(interaction.member)) throw new Error('Only Wave Moderators can unwave people.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('member', true);
    const reason = interaction.options.getString('reason', true);
    const link = store.linkedRoblox(user.id);
    const done = [];
    if (link && project()) {
      const roles = await roblox.getRoles(project().groupId, link.id);
      if (roles.some((role) => role.name.toLowerCase() === CONFIG.groups.wavedRole.toLowerCase())) {
        await roblox.removeRole(project().groupId, link.id, CONFIG.groups.wavedRole);
        done.push(`${CONFIG.groups.wavedRole} removed in Project: Trebuchet`);
      }
    }
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) {
      if (member.roles.cache.has(CONFIG.roles.communityMember)) await member.roles.remove(CONFIG.roles.communityMember, `Unwaved by ${interaction.user.tag}: ${reason}`);
      if (CONFIG.roles.unWaved && !member.roles.cache.has(CONFIG.roles.unWaved)) await member.roles.add(CONFIG.roles.unWaved, `Unwaved by ${interaction.user.tag}`);
      done.push('Discord role swapped back to Un-Waved');
    }
    if (ranking && project() && link) {
      await ranking.logChange({ group: project(), target: link, kind: 'unwaved', from: CONFIG.groups.wavedRole, to: 'Not waved', by: { discordId: interaction.user.id, robloxName: store.linkedRoblox(interaction.user.id)?.name, authority: 'Wave Moderator' }, reason }).catch(() => {});
    }
    await interaction.editReply(done.length ? `Unwaved <@${user.id}>: ${done.join('. ')}.` : 'Nothing to take away: they had no Waved role.');
  }

  return { start, handleButton, unwave };
}
