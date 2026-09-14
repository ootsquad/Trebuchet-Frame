# Trebuchet Discord Bot

This folder is a standalone Railway project for the Discord, Roblox group, XP, rank, and event backend. It stores progression in the Roblox `TrebuchetProgressionV1` DataStore and does not require PostgreSQL.

## Push to GitHub

Push the contents of this folder as the root of `ootsquad/Trebuchet-Frame`. The repository root should contain `package.json`, `Dockerfile`, `railway.toml`, `src`, and `tests`.

## Railway services

1. Create a Railway project from the GitHub repository.
2. Generate a public domain for the bot service.
3. Add the variables below to the bot service.

## Required Railway variables

```env
NODE_ENV=production

DISCORD_TOKEN=
DISCORD_APPLICATION_ID=1548771479850713260
DISCORD_GUILD_ID=
DISCORD_STAFF_ROLE_IDS=
DISCORD_EVENT_CHANNEL_ID=1548802232328396801
DISCORD_EVENT_ROLE_ID=1548802585467691049

ROBLOX_GROUP_ID=4615235
ROBLOX_OPEN_CLOUD_API_KEY=
ROBLOX_UNIVERSE_ID=
ROBLOX_DATASTORE_NAME=TrebuchetProgressionV1
ROBLOX_GAME_SECRET=

PLAYTIME_MINUTES=30
PLAYTIME_XP=5
MAX_EVENT_XP=25
```

`ROBLOX_GAME_SECRET` must contain at least 32 random characters. Use the same value for the Roblox experience secret named `TREBUCHET_GAME_SECRET`.

`DISCORD_STAFF_ROLE_IDS` accepts Discord role IDs separated by commas. Members with one of these roles can add XP, remove XP, and pass trainings.

Staff rank commands:

- `/rank demote username reason` moves a player down one managed rank and resets XP to 0.
- `/rank set username rank reason` assigns a selected managed rank and resets XP to 0.

Both commands update the Roblox group role and save the supplied reason in the progression audit history.

`DISCORD_EVENT_CHANNEL_ID` is where confirmed Roblox events are posted. `DISCORD_EVENT_ROLE_ID` is pinged in each confirmation. The bot needs View Channel, Send Messages, and Embed Links in that channel. The role must be mentionable by the bot, or the bot must have permission to mention roles.

Add `ROBLOX_ROLE_MAP_JSON` only if the names in your Roblox group differ from the names in `.env.example`.

## Discord bot setup

1. Open your Discord application with ID `1548771479850713260`.
2. Create or reset the bot token and place it in `DISCORD_TOKEN`.
3. Invite the bot with the `bot` and `applications.commands` scopes.
4. Give it View Channels and Send Messages permissions where commands will run.
5. Put your Discord server ID in `DISCORD_GUILD_ID`.

## Roblox Open Cloud setup

1. Add the automation account to group `4615235`.
2. Place its group role above every role the bot needs to assign.
3. Create an Open Cloud API key with read and write access to group `4615235`.
4. Give it `universe-datastores.objects:read` and `universe-datastores.objects:update` access to your experience and the `TrebuchetProgressionV1` DataStore.
5. Put the key in `ROBLOX_OPEN_CLOUD_API_KEY`.
6. Put the experience universe ID in `ROBLOX_UNIVERSE_ID`. This is not a place ID.
7. Never place a `.ROBLOSECURITY` cookie in Railway.

## Local checks

```bash
npm install
npm run build
npm test
```

Railway builds from `Dockerfile`, starts the service, and registers the guild slash commands.
