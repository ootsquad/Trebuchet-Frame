# Trebuchet Frame Bot

Discord bot for the UNSC community. It handles:

- Rank sync across the Roblox groups.
- Roblox account proof: wave applications and `/link` give a phrase of plain words to put in the Roblox profile's About section, and the bot checks the profile before it links anything. One Roblox account can only be linked to one Discord account.
- Wave applications: a DM questionnaire, then Approve or Deny buttons for Wave Moderators. Approving moves the account from Undocumented Refugee to Registered Civilian in the UNSC group, gives the Discord role, and links the accounts.
- Suggestions: posts in the suggestions channel (or `/suggest`) become vote cards with ✅ and ❌ and a thread. At 25 upvotes (not counting the author or bots) the card is copied to the important suggestions channel, once.
- Leaks: a post with a picture in the leaks source channel is reposted to the leaks channel as a card. The first line is the headline, the rest is the quoted body, the picture is the big image, and `LEAKS_THUMBNAIL_URL` is the small picture in the corner.
- Announcements: `/announce` opens a form, with an optional @here, @everyone or role ping. `edit_message_id` edits an earlier one.
- Events, merit and cR: `/event` previews pay for every attendee, the host confirms, and the bot sends merit and cR into each player's game save. Then it promotes by merit inside the division groups.
- `/profile`, `/link`, `/grant` (staff), `/rank` (staff), `/sync`.

## Rank sync

Every `SYNC_EVERY_MINUTES` the bot reads the division groups, the Marine Corps group (4615235) and the UNSC group (4615211):

| Situation | Change |
| --- | --- |
| In a division group | Marine Corps rank becomes that division (105th ODST, 75th AAR, 3rd MFR, 7th MCSB, 1st MID) |
| In two divisions | The first in that list wins |
| Left every division | Marine Corps rank becomes Unassigned Marine Personnel |
| Marine Corps command rank | UNSC rank becomes Marine Corps Command |
| Any other Marine Corps rank | UNSC rank becomes Enlisted Marine Personnel |
| Left the Marine Corps | UNSC rank becomes `UNSC_LEFT_MARINES_RANK` |

It never changes Artificial Intelligence, Commandant, Assistant Commandant, Marine Aviation Command or Military Command in the Marine Corps. In the UNSC group it only changes Marine Corps Command, Enlisted Marine Personnel, UNSC Candidate, Person of Interest, Registered Civilian and Undocumented Refugee. Everyone else is left alone. The rules are in `src/groups.js`.

`SYNC_DRY_RUN=true` (the default) only posts what it would change to the rank log. Turn it off once the previews look right.

## Event pay

| Event | cR | Merit |
| --- | --- | --- |
| Basic Training | 75 | 25 |
| Combat Training | 100 | 35 |
| Planet Recon | 150 | 50 |
| Planetary Patrol | 175 | 60 |
| Operations | 300 | 100 |

Bonuses add to the base cR: +25% when the objective is completed, +15% for surviving (anyone listed under `fallen` misses this one), +50% for a player's first paid event of the day.

Hosting: 10 cR per attendee, up to 200, plus 40 merit. It needs at least 5 attendees and a linked Roblox account, and a host is paid for each event type at most once every `HOST_COOLDOWN_HOURS`.

Merit numbers are placeholders in `src/rewards.js`. The division merit ladders in `src/ranks.js` are empty until the division ranks are added, so nobody is promoted by merit yet.

## How pay reaches the game

Trebuchet Frame keeps an inbox per player in the `TrebuchetEconomyV1` data store (`inbox_<userId>`). The bot adds awards there through Roblox Open Cloud. The game pays them within about 2 minutes if the player is online, or when they next join, and never pays the same award twice. In game, Xp is shown as Merit.

## Setup on Railway

1. Discord Developer Portal > Bot: turn on Server Members Intent and Message Content Intent.
2. Invite the bot with: View Channels, Send Messages, Embed Links, Attach Files, Add Reactions, Read Message History, Manage Messages, Create Public Threads, Manage Roles. Commands work in every server the bot is in.
3. Sign in to Roblox as the Artificial Intelligence account (ranked in every group). Creator Hub > Open Cloud > API Keys: one key with Groups read and write for every group, and data store read and write for the game's universe.
4. Railway: deploy this repo, add a Volume at `/data`, set `DATA_DIR=/data`.
5. Railway > Variables: everything in `.env.example`.
