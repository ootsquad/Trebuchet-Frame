// Roblox: user lookup, group ranks (Open Cloud v2), and the game's economy save (Open Cloud data stores v1).
import crypto from 'node:crypto';
import { CONFIG } from './config.js';

async function parseResponse(response) {
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    const error = new Error(`Roblox API ${response.status}: ${detail || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

const roleName = (role) => String(role?.displayName || role?.name || '').trim();
const roleId = (role) => String(role?.id || String(role?.path || '').split('/').pop());

export class RobloxService {
  constructor({ apiKey = CONFIG.roblox.apiKey, universeId = CONFIG.roblox.universeId, dataStoreKey = CONFIG.roblox.dataStoreKey } = {}) {
    this.apiKey = apiKey;
    this.dataStoreKey = dataStoreKey || apiKey;
    this.universeId = String(universeId);
    this.roleCache = new Map();
  }

  async openCloud(path, options = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`https://apis.roblox.com${path}`, {
        ...options,
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, ...(options.headers || {}) }
      });
      // Rate limited: wait and try again a few times.
      if (response.status === 429 && attempt < 4) {
        const wait = Number(response.headers.get('retry-after')) || 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        continue;
      }
      return parseResponse(response);
    }
  }

  // ---------- users ----------

  async resolveUser(input) {
    const value = String(input).trim().replace(/^@/, '');
    if (!value) throw new Error('A Roblox username or user ID is needed.');
    if (/^\d+$/.test(value)) {
      const user = await parseResponse(await fetch(`https://users.roblox.com/v1/users/${value}`));
      return { id: String(user.id), name: user.name, displayName: user.displayName };
    }
    const [user] = await this.resolveUsernames([value]);
    if (!user) throw new Error(`No Roblox account is called "${value}". Use the username, not the display name.`);
    return user;
  }

  // Many usernames at once. Returns the accounts found; unknown names are left out.
  async resolveUsernames(names) {
    const found = [];
    for (let index = 0; index < names.length; index += 100) {
      const body = await parseResponse(await fetch('https://users.roblox.com/v1/usernames/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usernames: names.slice(index, index + 100), excludeBannedUsers: true })
      }));
      for (const user of body?.data || []) {
        found.push({ id: String(user.id), name: user.name, displayName: user.displayName, asked: user.requestedUsername });
      }
    }
    return found;
  }

  // Public profile: name, display name, description and the date the account was made.
  async getProfile(robloxUserId) {
    return parseResponse(await fetch(`https://users.roblox.com/v1/users/${robloxUserId}`));
  }

  async headshotUrl(robloxUserId) {
    const body = await parseResponse(await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${robloxUserId}&size=150x150&format=Png&isCircular=false`));
    const entry = body?.data?.[0];
    return entry?.state === 'Completed' ? entry.imageUrl : null;
  }

  async usernames(ids) {
    const names = new Map();
    for (let index = 0; index < ids.length; index += 100) {
      const body = await parseResponse(await fetch('https://users.roblox.com/v1/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userIds: ids.slice(index, index + 100).map(Number), excludeBannedUsers: false })
      }));
      for (const user of body?.data || []) names.set(String(user.id), user.name);
    }
    return names;
  }

  // ---------- group ranks (every call names its group) ----------

  async listRoles(groupId, { force = false } = {}) {
    const cached = this.roleCache.get(String(groupId));
    if (!force && cached && Date.now() - cached.at < 10 * 60_000) return cached.roles;
    const roles = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({ maxPageSize: '20' });
      if (pageToken) query.set('pageToken', pageToken);
      const body = await this.openCloud(`/cloud/v2/groups/${groupId}/roles?${query}`);
      roles.push(...(body?.groupRoles || body?.roles || []));
      pageToken = body?.nextPageToken || '';
    } while (pageToken);
    this.roleCache.set(String(groupId), { at: Date.now(), roles });
    return roles;
  }

  async roleNameOf(groupId, rolePath) {
    const roles = await this.listRoles(groupId);
    const wanted = String(rolePath).split('/').pop();
    return roleName(roles.find((role) => role.path === rolePath || roleId(role) === wanted)) || wanted;
  }

  async findRole(groupId, name) {
    const wanted = String(name).trim().toLowerCase();
    const roles = await this.listRoles(groupId);
    const role = roles.find((entry) => roleName(entry).toLowerCase() === wanted);
    if (!role) {
      throw new Error(`Group ${groupId} has no rank called "${name}". Ranks: ${roles.map(roleName).filter(Boolean).join(', ') || 'none returned'}`);
    }
    return role;
  }

  // The member's rank name in the group, or null when they are not in it.
  async getRank(groupId, robloxUserId) {
    const filter = encodeURIComponent(`user == 'users/${robloxUserId}'`);
    const body = await this.openCloud(`/cloud/v2/groups/${groupId}/memberships?maxPageSize=10&filter=${filter}`);
    const membership = (body?.groupMemberships || body?.memberships || [])[0];
    if (!membership) return null;
    const rolePath = membership.role || (Array.isArray(membership.roles) ? membership.roles[0] : null);
    return rolePath ? this.roleNameOf(groupId, rolePath) : null;
  }

  // Every member of a group: Map of user id -> rank name.
  async listMembers(groupId) {
    const roles = await this.listRoles(groupId, { force: true });
    const names = new Map(roles.map((role) => [role.path || `groups/${groupId}/roles/${roleId(role)}`, roleName(role)]));
    const members = new Map();
    let pageToken = '';
    do {
      const query = new URLSearchParams({ maxPageSize: '100' });
      if (pageToken) query.set('pageToken', pageToken);
      const body = await this.openCloud(`/cloud/v2/groups/${groupId}/memberships?${query}`);
      for (const membership of body?.groupMemberships || []) {
        const userId = String(membership.user || '').split('/').pop();
        const rolePath = membership.role || (Array.isArray(membership.roles) ? membership.roles[0] : '');
        if (userId) members.set(userId, names.get(rolePath) || String(rolePath).split('/').pop());
      }
      pageToken = body?.nextPageToken || '';
    } while (pageToken);
    return members;
  }

  // Gives one rank in the group (Roblox swaps out the old one).
  async setRank(groupId, robloxUserId, rankName) {
    const before = await this.getRank(groupId, robloxUserId);
    if (!before) throw new Error(`Roblox user ${robloxUserId} is not in group ${groupId}. They need to join it first.`);
    const target = await this.findRole(groupId, rankName);
    if (before.toLowerCase() === roleName(target).toLowerCase()) return { before, rank: before, changed: false };
    const rolePath = target.path || `groups/${groupId}/roles/${roleId(target)}`;
    await this.openCloud(`/cloud/v2/groups/${groupId}/memberships/${robloxUserId}:assignRole`, {
      method: 'POST',
      body: JSON.stringify({ role: rolePath })
    });
    const after = await this.getRank(groupId, robloxUserId);
    if (String(after).toLowerCase() !== roleName(target).toLowerCase()) {
      throw new Error(`Roblox did not confirm "${roleName(target)}" in group ${groupId} for user ${robloxUserId}. The bot account's rank must be above it.`);
    }
    return { before, rank: after, changed: true };
  }

  // Wave applications: Undocumented Refugee -> Registered Civilian in the UNSC group.
  async waveMember(robloxUserId) {
    const { unsc, unWavedRank, wavedRank } = CONFIG.groups;
    const current = await this.getRank(unsc, robloxUserId);
    if (!current) throw new Error(`Roblox user ${robloxUserId} has not joined the UNSC group yet. They need to join it first.`);
    if (current.toLowerCase() === wavedRank.toLowerCase()) return { rank: wavedRank, alreadyWaved: true };
    if (current.toLowerCase() !== unWavedRank.toLowerCase()) {
      throw new Error(`Roblox user ${robloxUserId} is ${current} in the UNSC group, not ${unWavedRank}.`);
    }
    const result = await this.setRank(unsc, robloxUserId, wavedRank);
    return { rank: result.rank, alreadyWaved: false };
  }

  // ---------- the game's economy save (Open Cloud data stores v1) ----------

  #entryUrl(key, extra = {}) {
    const query = new URLSearchParams({ datastoreName: CONFIG.roblox.economyStore, entryKey: key, ...extra });
    return `https://apis.roblox.com/datastores/v1/universes/${this.universeId}/standard-datastores/datastore/entries/entry?${query}`;
  }

  async getEntry(key) {
    const response = await fetch(this.#entryUrl(key), { headers: { 'x-api-key': this.dataStoreKey } });
    if (response.status === 404) return { value: null, version: null };
    const value = await parseResponse(response);
    return { value, version: response.headers.get('roblox-entry-version') };
  }

  async #setEntry(key, value, version) {
    const body = JSON.stringify(value);
    const md5 = crypto.createHash('md5').update(body).digest('base64');
    const extra = version ? { matchVersion: version } : { exclusiveCreate: 'true' };
    const response = await fetch(this.#entryUrl(key, extra), {
      method: 'POST',
      headers: { 'x-api-key': this.dataStoreKey, 'content-type': 'application/json', 'content-md5': md5 },
      body
    });
    return parseResponse(response);
  }

  // Read-modify-write that retries when the game wrote in between (version mismatch).
  async updateEntry(key, change) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { value, version } = await this.getEntry(key);
      const next = change(value);
      if (next === undefined) return value;
      try {
        await this.#setEntry(key, next, version);
        return next;
      } catch (error) {
        if (![409, 412].includes(error.status)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw new Error(`Could not update ${key}: the game kept writing to it. Try again.`);
  }

  // Credits (cR) and Xp (merit) from the player's save.
  async getEconomy(robloxUserId) {
    const [{ value: save }, { value: inbox }] = await Promise.all([
      this.getEntry(`user_${robloxUserId}`),
      this.getEntry(`inbox_${robloxUserId}`)
    ]);
    const pending = Array.isArray(inbox) ? inbox : [];
    return {
      found: Boolean(save),
      merit: Number(save?.Xp) || 0,
      credits: Number(save?.Credits) || 0,
      pendingMerit: pending.reduce((sum, entry) => sum + (Number(entry?.Xp) || 0), 0),
      pendingCredits: pending.reduce((sum, entry) => sum + (Number(entry?.Credits) || 0), 0)
    };
  }

  // Adds an award to the player's inbox. The game pays it on its next autosave (online) or when they join.
  // The game ignores an award whose Key it has already paid, so a retry never pays twice.
  async sendAward(robloxUserId, { key, merit = 0, credits = 0, reason, stat = null }) {
    const entry = { Key: key, Xp: Math.max(0, Math.round(merit)), Credits: Math.max(0, Math.round(credits)), Reason: reason };
    if (stat) entry.Stat = stat;
    await this.updateEntry(`inbox_${robloxUserId}`, (current) => {
      const list = Array.isArray(current) ? current : [];
      if (list.some((other) => other?.Key === key)) return undefined;
      return [...list, entry];
    });
    return entry;
  }
}
