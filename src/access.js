// Who may do what, worked out from Roblox ranks, never from Discord roles. Someone manages a group only while
// their verified Roblox account holds a manager rank in it, and they only see and hand out ranks below their own.
import { CONFIG } from './config.js';
import { GROUPS, groupByKey, isManagerRank } from './groups.js';

// Full Access accounts act as if they held the top rank the bot can work with in every group.
const SUPER_ROLE = Object.freeze({ name: 'Full Access', rank: 200 });

export function createAccess({ roblox, store }) {
  const cache = new Map(); // `${groupId}:${userId}` -> { at, roles }

  async function rolesIn(group, robloxUserId) {
    const key = `${group.groupId}:${robloxUserId}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.roles;
    const roles = await roblox.getRoles(group.groupId, robloxUserId).catch(() => []);
    cache.set(key, { at: Date.now(), roles });
    return roles;
  }

  const forget = (group, robloxUserId) => cache.delete(`${group.groupId}:${robloxUserId}`);

  // The verified Roblox account behind a Discord user, or null.
  const actorOf = (discordUserId) => store.linkedRoblox(discordUserId);
  const isSuper = (discordUserId) => {
    const actor = actorOf(discordUserId);
    return Boolean(actor && CONFIG.superAdmins.includes(String(actor.id)));
  };

  // The groups this Discord user may manage, with their own top role in each.
  async function managedGroups(discordUserId) {
    const actor = actorOf(discordUserId);
    if (!actor) return [];
    if (isSuper(discordUserId)) return GROUPS.map((group) => ({ group, role: SUPER_ROLE }));
    const result = [];
    for (const group of GROUPS) {
      if (group.kind === 'project') continue;
      const roles = await rolesIn(group, actor.id);
      const top = roles.find((role) => isManagerRank(group, role.name));
      if (top) result.push({ group, role: top });
    }
    return result;
  }

  // Throws with a plain reason unless the Discord user manages the group. Returns their manager role.
  async function requireManager(discordUserId, groupKey) {
    const actor = actorOf(discordUserId);
    if (!actor) throw new Error('Link and verify your Roblox account with /link first. Ranking permissions come from your Roblox ranks.');
    const group = groupByKey(groupKey);
    if (!group) throw new Error('Unknown group.');
    if (isSuper(discordUserId)) return { actor, group, role: SUPER_ROLE };
    const roles = await rolesIn(group, actor.id);
    const role = roles.find((entry) => isManagerRank(group, entry.name));
    if (!role) throw new Error(`You do not hold a rank in ${group.short} that can manage it.`);
    return { actor, group, role };
  }

  // The ranks a manager may hand out in the group: below their own, never the bot's.
  async function assignableRanks(group, managerRole) {
    const roles = await roblox.listRoles(group.groupId);
    return roles
      .map((role) => ({ name: String(role.displayName || role.name || ''), rank: Number(role.rank) || 0 }))
      .filter((role) => role.name && role.rank > 0 && role.rank < managerRole.rank && !/artificial intelligence/i.test(role.name))
      .sort((a, b) => b.rank - a.rank);
  }

  return { rolesIn, forget, actorOf, isSuper, managedGroups, requireManager, assignableRanks };
}
