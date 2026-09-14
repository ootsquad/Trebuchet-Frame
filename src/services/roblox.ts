import type { AppConfig } from "../config.js";
import { rankKeys, roleNames, type RankKey } from "../ranks.js";

interface RobloxUser {
  id: number;
  name: string;
  displayName: string;
}

interface GroupRole {
  path: string;
  id: string;
  displayName: string;
  rank: number;
}

interface GroupMembership {
  path: string;
  user: string;
  role?: string;
  roles?: string[];
}

export interface MemberIdentity extends RobloxUser {
  rankKey: RankKey;
  role: GroupRole;
  membership: GroupMembership;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class RobloxService {
  private readonly groupId: number;
  private readonly apiKey: string;
  private readonly configuredRoleNames: Record<RankKey, string>;
  private rolesByKey = new Map<RankKey, GroupRole>();
  private keysByRolePath = new Map<string, RankKey>();

  constructor(config: AppConfig) {
    this.groupId = config.robloxGroupId;
    this.apiKey = config.robloxApiKey;
    this.configuredRoleNames = roleNames(config.roleOverrides);
  }

  async initialize(): Promise<void> {
    const allRoles: GroupRole[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ maxPageSize: "100" });
      if (pageToken) query.set("pageToken", pageToken);
      const response = await this.openCloud<{ groupRoles?: GroupRole[]; nextPageToken?: string }>(
        `/cloud/v2/groups/${this.groupId}/roles?${query.toString()}`,
      );
      allRoles.push(...(response.groupRoles ?? []));
      pageToken = response.nextPageToken || undefined;
    } while (pageToken);

    this.rolesByKey.clear();
    this.keysByRolePath.clear();

    for (const key of rankKeys) {
      const wanted = this.configuredRoleNames[key].trim().toLowerCase();
      const role = allRoles.find((candidate) => candidate.displayName.trim().toLowerCase() === wanted);
      if (role) {
        this.rolesByKey.set(key, role);
        this.keysByRolePath.set(role.path, key);
      }
    }

    const missing = rankKeys.filter((key) => !this.rolesByKey.has(key));
    if (missing.length > 0) {
      const details = missing.map((key) => `${key}=${this.configuredRoleNames[key]}`).join(", ");
      throw new Error(`Roblox group roles were not found: ${details}. Set ROBLOX_ROLE_MAP_JSON if the names differ.`);
    }
  }

  async resolveUsername(username: string): Promise<RobloxUser> {
    const clean = username.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{3,20}$/.test(clean)) throw new Error("Enter a valid Roblox username.");

    const response = await this.request<{ data?: RobloxUser[] }>(
      "https://users.roblox.com/v1/usernames/users",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ usernames: [clean], excludeBannedUsers: false }),
      },
      false,
    );
    const user = response.data?.[0];
    if (!user) throw new Error(`Roblox user ${clean} was not found.`);
    return user;
  }

  async getUser(userId: number, fallbackUsername?: string): Promise<RobloxUser> {
    const response = await this.request<{ data?: RobloxUser[] }>(
      "https://users.roblox.com/v1/users",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userIds: [userId], excludeBannedUsers: false }),
      },
      false,
    );
    return response.data?.[0] ?? { id: userId, name: fallbackUsername ?? String(userId), displayName: fallbackUsername ?? String(userId) };
  }

  async getMemberByUsername(username: string): Promise<MemberIdentity> {
    const user = await this.resolveUsername(username);
    return this.getMember(user);
  }

  async getMemberById(userId: number, fallbackUsername?: string): Promise<MemberIdentity> {
    const user = await this.getUser(userId, fallbackUsername);
    return this.getMember(user);
  }

  async setProgressionRole(member: MemberIdentity, targetKey: RankKey): Promise<void> {
    const target = this.rolesByKey.get(targetKey);
    if (!target) throw new Error(`Role ${targetKey} is not configured.`);
    if (member.rankKey === targetKey) return;

    const membershipId = String(member.id);
    await this.openCloud(
      `/cloud/v2/groups/${this.groupId}/memberships/${membershipId}:assignRole`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: target.path }),
      },
    );

    const oldManagedRoles = (member.membership.roles ?? [member.membership.role])
      .filter((path): path is string => Boolean(path && path !== target.path && this.keysByRolePath.has(path)));

    for (const oldRole of oldManagedRoles) {
      await this.openCloud(
        `/cloud/v2/groups/${this.groupId}/memberships/${membershipId}:unassignRole`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: oldRole }),
        },
      );
    }
  }

  private async getMember(user: RobloxUser): Promise<MemberIdentity> {
    const filter = `user == 'users/${user.id}'`;
    const query = new URLSearchParams({ maxPageSize: "10", filter });
    const response = await this.openCloud<{ groupMemberships?: GroupMembership[] }>(
      `/cloud/v2/groups/${this.groupId}/memberships?${query.toString()}`,
    );
    const membership = response.groupMemberships?.[0];
    if (!membership) throw new Error(`${user.name} is not a member of Roblox group ${this.groupId}.`);

    const rolePath = membership.role ?? membership.roles?.[membership.roles.length - 1];
    const rankKey = rolePath ? this.keysByRolePath.get(rolePath) : undefined;
    const role = rolePath ? [...this.rolesByKey.values()].find((item) => item.path === rolePath) : undefined;
    if (!rankKey || !role) {
      throw new Error(`${user.name}'s current group role is not managed by this progression system.`);
    }
    return { ...user, rankKey, role, membership };
  }

  private openCloud<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("x-api-key", this.apiKey);
    return this.request<T>(`https://apis.roblox.com${path}`, { ...init, headers }, true);
  }

  private async request<T>(url: string, init: RequestInit, authenticated: boolean): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        if (response.status === 204) return {} as T;
        return await response.json() as T;
      }

      const body = (await response.text()).slice(0, 1_500);
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) ? retryAfter * 1_000 : 500 * 2 ** attempt);
        continue;
      }
      const label = authenticated ? "Roblox Open Cloud" : "Roblox user lookup";
      throw new Error(`${label} returned ${response.status}: ${body || response.statusText}`);
    }
    throw new Error("Roblox request failed after retries.");
  }
}
