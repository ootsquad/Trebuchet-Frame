import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import type { AppConfig } from "./config.js";
import { rankByKey, ranks, type RankKey } from "./ranks.js";
import type { PlayerProfile, ProgressionService } from "./services/progression.js";

export interface ConfirmedEvent {
  id: string;
  eventType: string;
  xpAmount: number;
  hostUsername: string;
  cohostUsername: string | null;
  durationMinutes: number;
  startsAt: string;
  placeId: number;
}

export function buildEventAnnouncement(event: ConfirmedEvent, roleId: string) {
  const startUnix = Math.floor(new Date(event.startsAt).getTime() / 1_000);
  const endUnix = startUnix + event.durationMinutes * 60;
  const gameUrl = `https://www.roblox.com/games/${event.placeId}`;
  const embed = new EmbedBuilder()
    .setColor(0x8b8b8b)
    .setAuthor({ name: "TREBUCHET EVENT OPERATIONS" })
    .setTitle(`${event.eventType.toUpperCase()} | EVENT CONFIRMED`)
    .setURL(gameUrl)
    .addFields(
      { name: "Host", value: event.hostUsername, inline: true },
      { name: "Co-Host", value: event.cohostUsername || "None", inline: true },
      { name: "XP", value: `${event.xpAmount} XP`, inline: true },
      { name: "Start Time", value: `<t:${startUnix}:F>\n<t:${startUnix}:R>`, inline: true },
      { name: "End Time", value: `<t:${endUnix}:F>\n<t:${endUnix}:R>`, inline: true },
      { name: "Event Length", value: `${event.durationMinutes} minutes`, inline: true },
      { name: "Roblox Place", value: `[Open game page](${gameUrl})\nPlace ID: \`${event.placeId}\``, inline: false },
    )
    .setFooter({ text: `Event ID: ${event.id}` })
    .setTimestamp(new Date(event.startsAt));

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("Open Roblox Game")
      .setStyle(ButtonStyle.Link)
      .setURL(gameUrl),
  );

  return {
    content: `<@&${roleId}>`,
    embeds: [embed],
    components: [buttons],
    allowedMentions: { roles: [roleId] },
  };
}

export async function announceConfirmedEvent(client: Client, config: AppConfig, event: ConfirmedEvent): Promise<void> {
  const channel = await client.channels.fetch(config.discordEventChannelId);
  if (!channel || !channel.isSendable()) {
    throw new Error(`Discord event channel ${config.discordEventChannelId} was not found or is not sendable.`);
  }
  await channel.send(buildEventAnnouncement(event, config.discordEventRoleId));
}

const commands = [
  new SlashCommandBuilder()
    .setName("xp")
    .setDescription("Check or change Roblox progression XP.")
    .addSubcommand((sub) => sub
      .setName("check")
      .setDescription("Check a Roblox player's XP and rank.")
      .addStringOption((option) => option.setName("username").setDescription("Roblox username").setRequired(true)))
    .addSubcommand((sub) => sub
      .setName("add")
      .setDescription("Give XP to a Roblox player.")
      .addStringOption((option) => option.setName("username").setDescription("Roblox username").setRequired(true))
      .addIntegerOption((option) => option.setName("amount").setDescription("XP to give").setMinValue(1).setMaxValue(100).setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Audit reason").setMaxLength(300).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName("remove")
      .setDescription("Remove XP from a Roblox player without demoting them.")
      .addStringOption((option) => option.setName("username").setDescription("Roblox username").setRequired(true))
      .addIntegerOption((option) => option.setName("amount").setDescription("XP to remove").setMinValue(1).setMaxValue(100).setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Audit reason").setMaxLength(300).setRequired(true))),
  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Demote a Roblox player or assign a managed rank.")
    .addSubcommand((sub) => sub
      .setName("demote")
      .setDescription("Move a Roblox player down one managed rank and reset their XP.")
      .addStringOption((option) => option.setName("username").setDescription("Roblox username").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Reason for the demotion").setMaxLength(300).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName("set")
      .setDescription("Assign a specific managed Roblox rank and reset XP.")
      .addStringOption((option) => option.setName("username").setDescription("Roblox username").setRequired(true))
      .addStringOption((option) => option
        .setName("rank")
        .setDescription("Rank to assign")
        .setRequired(true)
        .addChoices(...ranks.map((rank) => ({ name: rank.displayName, value: rank.key }))))
      .addStringOption((option) => option.setName("reason").setDescription("Reason for the rank change").setMaxLength(300).setRequired(true))),
  new SlashCommandBuilder()
    .setName("training")
    .setDescription("Record a required training pass.")
    .addSubcommand((sub) => sub
      .setName("pass")
      .setDescription("Pass a player through an NCO or Officer Training gate.")
      .addStringOption((option) => option.setName("username").setDescription("Roblox username").setRequired(true))
      .addStringOption((option) => option
        .setName("type")
        .setDescription("Training type")
        .setRequired(true)
        .addChoices({ name: "NCO Training", value: "nco" }, { name: "Officer Training", value: "officer" }))),
  new SlashCommandBuilder()
    .setName("tutorial")
    .setDescription("Manage Basic Military Training tutorial completion.")
    .addSubcommand((sub) => sub
      .setName("pass")
      .setDescription("Manually record tutorial completion.")
      .addStringOption((option) => option.setName("username").setDescription("Roblox username").setRequired(true))),
  new SlashCommandBuilder()
    .setName("events")
    .setDescription("Check a player's hosting record.")
    .addSubcommand((sub) => sub
      .setName("stats")
      .setDescription("Check hosted and co-hosted event totals.")
      .addStringOption((option) => option.setName("username").setDescription("Roblox username").setRequired(true))),
].map((command) => command.setDMPermission(false));

function profileText(profile: PlayerProfile): string {
  const lines = [
    `Roblox: ${profile.username} (${profile.userId})`,
    `Rank: ${profile.rankName}`,
  ];
  if (profile.rankKey === "bmt") lines.push("XP: Disabled, tutorial completion required");
  else if ((rankByKey.get(profile.rankKey)?.officerTier ?? 0) > 0) {
    lines.push(`Hosted: ${profile.hostCount}`, `Co-hosted: ${profile.cohostCount}`);
  } else {
    lines.push(`XP: ${profile.xp}/100`);
    if (profile.gate && profile.xp === 99) lines.push(`Locked: Must pass ${profile.gate === "nco" ? "NCO Training" : "Officer Training"}`);
  }
  return lines.join("\n");
}

function isStaff(interaction: ChatInputCommandInteraction, config: AppConfig): boolean {
  if (!interaction.inCachedGuild()) return false;
  if (interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return true;
  return interaction.member.roles.cache.some((role) => config.discordStaffRoleIds.has(role.id));
}

export async function startDiscord(config: AppConfig, progression: ProgressionService): Promise<Client> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  await rest.put(
    Routes.applicationGuildCommands(config.discordApplicationId, config.discordGuildId),
    { body: commands.map((command) => command.toJSON()) },
  );

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const username = interaction.options.getString("username", true);
      const actor = `discord:${interaction.user.id}:${interaction.user.tag}`;
      const contextBase = {
        actor,
        idempotencyKey: `discord:${interaction.id}`,
      };
      let profile: PlayerProfile;

      if (interaction.commandName === "xp") {
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === "check") {
          profile = await progression.getProfileByUsername(username);
        } else {
          if (!isStaff(interaction, config)) throw new Error("You do not have a configured staff role for this command.");
          const amount = interaction.options.getInteger("amount", true);
          const reason = interaction.options.getString("reason", true);
          profile = subcommand === "add"
            ? await progression.addByUsername(username, amount, { ...contextBase, source: "discord", reason })
            : await progression.removeByUsername(username, amount, { ...contextBase, source: "discord", reason });
        }
      } else if (interaction.commandName === "rank") {
        if (!isStaff(interaction, config)) throw new Error("You do not have a configured staff role for this command.");
        const subcommand = interaction.options.getSubcommand();
        const reason = interaction.options.getString("reason", true);
        profile = subcommand === "demote"
          ? await progression.demoteByUsername(username, {
            ...contextBase,
            source: "discord-rank",
            reason,
          })
          : await progression.setRankByUsername(
            username,
            interaction.options.getString("rank", true) as RankKey,
            { ...contextBase, source: "discord-rank", reason },
          );
      } else if (interaction.commandName === "training") {
        if (!isStaff(interaction, config)) throw new Error("You do not have a configured staff role for this command.");
        const gate = interaction.options.getString("type", true) as "nco" | "officer";
        profile = await progression.passTraining(username, gate, {
          ...contextBase,
          source: "training",
          reason: `Passed ${gate.toUpperCase()} Training`,
        });
      } else if (interaction.commandName === "tutorial") {
        if (!isStaff(interaction, config)) throw new Error("You do not have a configured staff role for this command.");
        profile = await progression.completeTutorialByUsername(username, {
          ...contextBase,
          source: "tutorial",
          reason: "Manual tutorial completion",
        });
      } else if (interaction.commandName === "events") {
        profile = await progression.getProfileByUsername(username);
      } else {
        throw new Error("Unknown command.");
      }

      await interaction.editReply(profileText(profile));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply(`Request failed: ${message.slice(0, 1_800)}`);
    }
  });

  await client.login(config.discordToken);
  return client;
}
