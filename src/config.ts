import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().regex(/^\d+$/).default("1548771479850713260"),
  DISCORD_GUILD_ID: z.string().regex(/^\d+$/),
  DISCORD_STAFF_ROLE_IDS: z.string().default(""),
  DISCORD_EVENT_CHANNEL_ID: z.string().regex(/^\d+$/).default("1548802232328396801"),
  DISCORD_EVENT_ROLE_ID: z.string().regex(/^\d+$/).default("1548802585467691049"),
  ROBLOX_GROUP_ID: z.coerce.number().int().positive().default(4615235),
  ROBLOX_OPEN_CLOUD_API_KEY: z.string().min(1),
  ROBLOX_UNIVERSE_ID: z.coerce.number().int().positive(),
  ROBLOX_DATASTORE_NAME: z.string().min(1).max(50).default("TrebuchetProgressionV1"),
  ROBLOX_GAME_SECRET: z.string().min(32),
  ROBLOX_ROLE_MAP_JSON: z.string().optional(),
  PLAYTIME_MINUTES: z.coerce.number().int().min(5).max(180).default(30),
  PLAYTIME_XP: z.coerce.number().int().min(1).max(25).default(5),
  MAX_EVENT_XP: z.coerce.number().int().min(1).max(100).default(25),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  let roleOverrides: Record<string, string> = {};

  if (parsed.ROBLOX_ROLE_MAP_JSON) {
    const value: unknown = JSON.parse(parsed.ROBLOX_ROLE_MAP_JSON);
    roleOverrides = z.record(z.string(), z.string().min(1)).parse(value);
  }

  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    discordToken: parsed.DISCORD_TOKEN,
    discordApplicationId: parsed.DISCORD_APPLICATION_ID,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    discordStaffRoleIds: new Set(
      parsed.DISCORD_STAFF_ROLE_IDS.split(",").map((id) => id.trim()).filter(Boolean),
    ),
    discordEventChannelId: parsed.DISCORD_EVENT_CHANNEL_ID,
    discordEventRoleId: parsed.DISCORD_EVENT_ROLE_ID,
    robloxGroupId: parsed.ROBLOX_GROUP_ID,
    robloxApiKey: parsed.ROBLOX_OPEN_CLOUD_API_KEY,
    robloxUniverseId: parsed.ROBLOX_UNIVERSE_ID,
    robloxDataStoreName: parsed.ROBLOX_DATASTORE_NAME,
    robloxGameSecret: parsed.ROBLOX_GAME_SECRET,
    roleOverrides,
    playtimeMinutes: parsed.PLAYTIME_MINUTES,
    playtimeXp: parsed.PLAYTIME_XP,
    maxEventXp: parsed.MAX_EVENT_XP,
  };
}
