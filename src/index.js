import http from 'node:http';
import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import { CONFIG, featureProblems, validateConfig } from './config.js';
import { JsonStore } from './store.js';
import { RobloxService } from './roblox.js';
import { createApplicationService } from './applications.js';
import { createSuggestions } from './suggestions.js';
import { createLeaks } from './leaks.js';
import { createAnnouncements } from './announcements.js';
import { createEvents } from './events.js';
import { createSync } from './sync.js';
import { handleCommand, handleLinkButton, registerCommands } from './commands.js';

validateConfig();
for (const problem of featureProblems()) console.warn(`[Setup] ${problem}`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User]
});

const store = new JsonStore(CONFIG.dataDir);
const roblox = new RobloxService();
const applications = createApplicationService({ client, roblox, store });
const suggestions = createSuggestions({ client, store });
const leaks = createLeaks({ client, store });
const announcements = createAnnouncements({ client });
const events = createEvents({ client, store, roblox });
const sync = createSync({ client, roblox });

client.once(Events.ClientReady, async (ready) => {
  console.log(`Discord connected as ${ready.user.tag}`);
  try {
    await registerCommands(client);
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('[Registering slash commands]', error);
  }
  sync.start();
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (!CONFIG.waves.onJoin || member.guild.id !== CONFIG.guildId) return;
  await applications.start(member, 'joining the Discord server').catch((error) => console.error('[Wave on join]', error));
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild) return;
  try {
    // Leaks come from the development server; suggestions from the main one.
    if (message.guild.id === CONFIG.guildId && (await suggestions.onMessage(message))) return;
    if (message.guild.id === CONFIG.guildId || message.guild.id === CONFIG.devGuildId) await leaks.onMessage(message);
  } catch (error) {
    console.error(`[Message ${message.id}]`, error);
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  await suggestions.onReaction(reaction).catch((error) => console.error('[Suggestion vote]', error));
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (await applications.handleButton(interaction)) return;
    if (await events.button(interaction)) return;
    if (await handleLinkButton(interaction, { store })) return;
    if (await announcements.submit(interaction)) return;
    await handleCommand(interaction, { applications, suggestions, announcements, events, sync, roblox, store });
  } catch (error) {
    console.error(`[Interaction ${interaction.id}]`, error);
    if (!interaction.isRepliable()) return;
    const content = `That failed: ${String(error.message || error).slice(0, 1500)}`;
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch {}
  }
});

client.on(Events.Error, (error) => console.error('[Discord client]', error));
process.on('unhandledRejection', (error) => console.error('[Unhandled rejection]', error));

// Railway health check.
const server = http.createServer((request, response) => {
  const ok = client.isReady();
  response.writeHead(ok || request.url !== '/health' ? 200 : 503, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok, user: client.user?.tag || null }));
});
server.listen(CONFIG.port, () => console.log(`Health check on port ${CONFIG.port}`));

const stop = () => {
  try { client.destroy(); } catch {}
  server.close();
  setTimeout(() => process.exit(0), 250).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await client.login(CONFIG.discordToken);
