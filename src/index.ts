import { loadConfig } from "./config.js";
import { startDiscord } from "./discord.js";
import { createHttpApp } from "./http.js";
import { OpenCloudDataStore } from "./services/datastore.js";
import { EventService } from "./services/events.js";
import { ProgressionService } from "./services/progression.js";
import { RobloxService } from "./services/roblox.js";

async function main() {
  const config = loadConfig();
  const roblox = new RobloxService(config);
  await roblox.initialize();

  const store = new OpenCloudDataStore(config);
  const progression = new ProgressionService(store, roblox);
  const events = new EventService(store, roblox, progression, config.maxEventXp);
  const discord = await startDiscord(config, progression);
  console.log(`Discord bot logged in as ${discord.user?.tag ?? "unknown"}`);
  const app = createHttpApp(config, progression, events, discord);
  const server = app.listen(config.port, "0.0.0.0", () => {
    console.log(`Trebuchet API listening on port ${config.port}`);
  });

  const shutdown = async () => {
    server.close();
    discord.destroy();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((error) => {
  console.error("Trebuchet failed to start", error);
  process.exit(1);
});
