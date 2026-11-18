// Every setting comes from Railway variables (or a local .env when testing). See .env.example.
import 'dotenv/config';
import path from 'node:path';

const env = (name, fallback = '') => String(process.env[name] ?? fallback).trim();
const num = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};
const bool = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const CONFIG = Object.freeze({
  discordToken: env('DISCORD_TOKEN'),
  guildId: env('DISCORD_GUILD_ID'),
  // The development server: leaks are posted there, important suggestions go there.
  devGuildId: env('DISCORD_DEV_GUILD_ID'),
  port: num('PORT', 3000),
  dataDir: path.resolve(env('DATA_DIR', './data')),
  timeZone: env('TIME_ZONE', 'America/New_York'),
  brandName: env('BRAND_NAME', 'UNSC'),
  brandColor: Number.parseInt(env('BRAND_COLOR', '5B8DEF').replace('#', ''), 16) || 0x5b8def,

  channels: Object.freeze({
    suggestions: env('CHANNEL_SUGGESTIONS'),
    importantSuggestions: env('CHANNEL_IMPORTANT_SUGGESTIONS'),
    leaksSource: env('CHANNEL_LEAKS_SOURCE'),
    leaks: env('CHANNEL_LEAKS'),
    announcements: env('CHANNEL_ANNOUNCEMENTS'),
    waveApplications: env('CHANNEL_WAVE_APPLICATIONS'),
    eventLogs: env('CHANNEL_EVENT_LOGS'),
    promotions: env('CHANNEL_PROMOTIONS'),
    rankLogs: env('CHANNEL_RANK_LOGS'),
    errors: env('CHANNEL_ERRORS')
  }),

  roles: Object.freeze({
    waveModerator: env('ROLE_WAVE_MODERATOR'),
    unWaved: env('ROLE_UNWAVED'),
    communityMember: env('ROLE_COMMUNITY_MEMBER'),
    eventHost: env('ROLE_EVENT_HOST'),
    announcer: env('ROLE_ANNOUNCER'),
    leaker: env('ROLE_LEAKER'),
    economyAdmin: env('ROLE_ECONOMY_ADMIN'),
    eventNotifications: env('ROLE_EVENT_NOTIFICATIONS')
  }),

  suggestions: Object.freeze({
    upvotesNeeded: Math.max(1, num('SUGGESTION_UPVOTES', 25)),
    upvote: env('SUGGESTION_UPVOTE_EMOJI', '✅'),
    downvote: env('SUGGESTION_DOWNVOTE_EMOJI', '❌'),
    threads: bool('SUGGESTION_THREADS', true)
  }),

  leaks: Object.freeze({
    thumbnailUrl: env('LEAKS_THUMBNAIL_URL'),
    // Small logo next to "MATERIALS GROUP" and in the footer.
    iconUrl: env('LEAKS_ICON_URL') || env('LEAKS_THUMBNAIL_URL'),
    color: Number.parseInt(env('LEAKS_COLOR', '8FA3AD').replace('#', ''), 16) || 0x8fa3ad,
    facility: env('LEAKS_FACILITY', 'damascus').toLowerCase(),
    settingYear: num('LEAKS_SETTING_YEAR', 2524),
    classification: env('LEAKS_CLASSIFICATION', 'RESTRICTED  ·  ONI SECTION THREE'),
    reactWhenPosted: env('LEAKS_DONE_EMOJI', '✅')
  }),

  roblox: Object.freeze({
    apiKey: env('ROBLOX_API_KEY') || env('ROBLOX_OPEN_CLOUD_API_KEY'),
    // Optional second key for the game's data store (for example a key made by the group that owns the game).
    dataStoreKey: env('ROBLOX_DATASTORE_API_KEY'),
    universeId: env('ROBLOX_UNIVERSE_ID'),
    economyStore: env('ROBLOX_ECONOMY_STORE', 'TrebuchetEconomyV1')
  }),

  // Roblox groups. The API key must be made by the account ranked Artificial Intelligence in every group.
  groups: Object.freeze({
    unsc: env('GROUP_UNSC_ID', '4615211'),
    marines: env('GROUP_MARINES_ID', '4615235'),
    divisions: Object.freeze({
      odst: env('GROUP_105TH_ODST_ID'),
      aar: env('GROUP_75TH_AAR_ID'),
      mfr: env('GROUP_3RD_MFR_ID') || env('GROUP_3RD_MRU_ID'),
      mcsb: env('GROUP_7TH_MCSB_ID'),
      mid: env('GROUP_1ST_MID_ID')
    }),
    leftMarinesRank: env('UNSC_LEFT_MARINES_RANK', 'Registered Civilian'),
    unWavedRank: env('UNSC_UNWAVED_RANK', 'Undocumented Refugee'),
    wavedRank: env('UNSC_WAVED_RANK', 'Registered Civilian')
  }),

  sync: Object.freeze({
    everyMinutes: Math.max(5, num('SYNC_EVERY_MINUTES', 15)),
    dryRun: bool('SYNC_DRY_RUN', true),
    maxChangesPerRun: Math.max(1, num('SYNC_MAX_CHANGES', 100))
  }),

  waves: Object.freeze({
    onJoin: bool('APPLICATION_ON_JOIN', true),
    minimumAge: num('APPLICATION_MIN_AGE', 13)
  }),

  events: Object.freeze({
    hostCooldownHours: num('HOST_COOLDOWN_HOURS', 3),
    autoPromote: bool('AUTO_PROMOTE', true)
  })
});

export function validateConfig() {
  const missing = [];
  for (const name of ['DISCORD_TOKEN', 'DISCORD_GUILD_ID']) {
    if (!env(name)) missing.push(name);
  }
  if (missing.length) {
    throw new Error(`Missing Railway variables: ${missing.join(', ')}`);
  }
}

// Parts that can't run without their settings switch themselves off and say why in the log.
export function featureProblems() {
  const problems = [];
  const need = (feature, names) => {
    const absent = names.filter((name) => !env(name));
    if (absent.length) problems.push(`${feature} is off until these are set: ${absent.join(', ')}`);
  };
  need('Suggestions', ['CHANNEL_SUGGESTIONS', 'CHANNEL_IMPORTANT_SUGGESTIONS']);
  need('Leaks', ['CHANNEL_LEAKS_SOURCE', 'CHANNEL_LEAKS']);
  need('Announcements', ['CHANNEL_ANNOUNCEMENTS']);
  need('Wave applications', ['CHANNEL_WAVE_APPLICATIONS', 'ROLE_WAVE_MODERATOR', 'ROLE_UNWAVED', 'ROLE_COMMUNITY_MEMBER']);
  need('Rank sync', ['CHANNEL_RANK_LOGS']);
  need('Events, merit and cR', ['CHANNEL_EVENT_LOGS', 'ROLE_EVENT_HOST', 'ROBLOX_UNIVERSE_ID']);
  if (!env('ROBLOX_API_KEY') && !env('ROBLOX_OPEN_CLOUD_API_KEY')) problems.push('Roblox features are off until ROBLOX_API_KEY is set.');
  return problems;
}
