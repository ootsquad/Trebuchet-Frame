import { randomUUID } from "node:crypto";
import {
  addXp,
  passGate,
  previousRank,
  rankByKey,
  removeXp,
  type GateType,
  type ProgressionResult,
  type RankKey,
} from "../ranks.js";
import { OpenCloudDataStore } from "./datastore.js";
import { RobloxService, type MemberIdentity } from "./roblox.js";

const MAX_PROCESSED_KEYS = 100;
const MAX_AUDIT_ENTRIES = 50;

export interface MutationContext {
  source: string;
  reason: string;
  actor: string;
  idempotencyKey: string;
}

export interface PlayerProfile {
  userId: number;
  username: string;
  rankKey: RankKey;
  rankName: string;
  xp: number;
  gate: GateType | null;
  tutorialCompleted: boolean;
  hostCount: number;
  cohostCount: number;
}

interface AuditEntry {
  id: string;
  idempotencyKey: string;
  source: string;
  reason: string;
  actor: string;
  requestedDelta: number;
  appliedDelta: number;
  rankBefore: RankKey;
  rankAfter: RankKey;
  xpBefore: number;
  xpAfter: number;
  at: string;
}

interface StoredPlayer {
  schemaVersion: 1;
  userId: number;
  username: string;
  rankKey: RankKey;
  xp: number;
  tutorialCompleted: boolean;
  hostCount: number;
  cohostCount: number;
  processedKeys: string[];
  audit: AuditEntry[];
  updatedAt: string;
}

function playerKey(userId: number): string {
  return `user_${userId}`;
}

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export class ProgressionService {
  constructor(
    private readonly store: OpenCloudDataStore,
    private readonly roblox: RobloxService,
  ) {}

  async getProfileByUsername(username: string): Promise<PlayerProfile> {
    const member = await this.roblox.getMemberByUsername(username);
    return this.syncProfile(member);
  }

  async addByUsername(username: string, amount: number, context: MutationContext): Promise<PlayerProfile> {
    return this.apply(await this.roblox.getMemberByUsername(username), amount, "add", context);
  }

  async addByUserId(userId: number, username: string, amount: number, context: MutationContext): Promise<PlayerProfile> {
    return this.apply(await this.roblox.getMemberById(userId, username), amount, "add", context);
  }

  async removeByUsername(username: string, amount: number, context: MutationContext): Promise<PlayerProfile> {
    return this.apply(await this.roblox.getMemberByUsername(username), amount, "remove", context);
  }

  async completeTutorialByUsername(username: string, context: MutationContext): Promise<PlayerProfile> {
    return this.completeTutorial(await this.roblox.getMemberByUsername(username), context);
  }

  async completeTutorialByUserId(userId: number, username: string, context: MutationContext): Promise<PlayerProfile> {
    return this.completeTutorial(await this.roblox.getMemberById(userId, username), context);
  }

  async passTraining(username: string, gate: GateType, context: MutationContext): Promise<PlayerProfile> {
    const member = await this.roblox.getMemberByUsername(username);
    return this.mutate(member, context, 0, (player) => passGate(player.rankKey, player.xp, gate));
  }

  async demoteByUsername(username: string, context: MutationContext): Promise<PlayerProfile> {
    const member = await this.roblox.getMemberByUsername(username);
    const targetRank = previousRank(member.rankKey);
    if (!targetRank) throw new Error("Basic Military Training is already the lowest managed rank.");
    return this.setRank(member, targetRank, context);
  }

  async setRankByUsername(username: string, targetRank: RankKey, context: MutationContext): Promise<PlayerProfile> {
    const member = await this.roblox.getMemberByUsername(username);
    if (!rankByKey.has(targetRank)) throw new Error(`Unknown managed rank: ${targetRank}`);
    return this.setRank(member, targetRank, context);
  }

  async incrementHostCount(
    userId: number,
    username: string,
    asCohost: boolean,
    idempotencyKey: string,
  ): Promise<void> {
    const member = await this.roblox.getMemberById(userId, username);
    await this.store.update(playerKey(member.id), {
      defaultValue: () => this.defaultPlayer(member),
      userId: member.id,
      transform: (raw) => {
        const player = this.normalizePlayer(raw, member);
        if (player.processedKeys.includes(idempotencyKey)) return player;
        if (asCohost) player.cohostCount += 1;
        else player.hostCount += 1;
        this.remember(player, idempotencyKey);
        player.updatedAt = new Date().toISOString();
        return player;
      },
    });
  }

  private async syncProfile(member: MemberIdentity): Promise<PlayerProfile> {
    const saved = await this.store.update(playerKey(member.id), {
      defaultValue: () => this.defaultPlayer(member),
      userId: member.id,
      transform: (raw) => this.normalizePlayer(raw, member),
    });
    return this.toProfile(saved);
  }

  private async apply(
    member: MemberIdentity,
    amount: number,
    operation: "add" | "remove",
    context: MutationContext,
  ): Promise<PlayerProfile> {
    return this.mutate(member, context, operation === "add" ? amount : -amount, (player) => (
      operation === "add"
        ? addXp(player.rankKey, player.xp, amount)
        : removeXp(player.rankKey, player.xp, amount)
    ));
  }

  private async completeTutorial(member: MemberIdentity, context: MutationContext): Promise<PlayerProfile> {
    return this.mutate(member, context, 0, (player) => {
      if (player.rankKey !== "bmt") {
        return {
          previousXp: player.xp,
          xp: player.xp,
          previousRank: player.rankKey,
          rank: player.rankKey,
          promoted: false,
          cappedByGate: null,
          appliedDelta: 0,
        };
      }
      return {
        previousXp: player.xp,
        xp: 0,
        previousRank: "bmt",
        rank: "pfc",
        promoted: true,
        cappedByGate: null,
        appliedDelta: 0,
      };
    }, true);
  }

  private async setRank(member: MemberIdentity, targetRank: RankKey, context: MutationContext): Promise<PlayerProfile> {
    if (member.rankKey === targetRank) {
      const rank = rankByKey.get(targetRank);
      throw new Error(`${member.name} is already ${rank?.displayName ?? targetRank}.`);
    }

    return this.mutate(member, context, 0, (player) => {
      const previousRankKey = player.rankKey;
      const previousXp = player.xp;
      player.tutorialCompleted = targetRank !== "bmt";
      return {
        previousXp,
        xp: 0,
        previousRank: previousRankKey,
        rank: targetRank,
        promoted: false,
        cappedByGate: null,
        appliedDelta: -previousXp,
      };
    });
  }

  private async mutate(
    member: MemberIdentity,
    context: MutationContext,
    requestedDelta: number,
    calculate: (player: StoredPlayer) => ProgressionResult,
    tutorialCompleted = false,
  ): Promise<PlayerProfile> {
    const key = context.idempotencyKey.slice(0, 300);
    const saved = await this.store.update(playerKey(member.id), {
      defaultValue: () => this.defaultPlayer(member),
      userId: member.id,
      transform: (raw) => {
        const player = this.normalizePlayer(raw, member);
        if (player.processedKeys.includes(key)) return player;

        const result = calculate(player);
        player.rankKey = result.rank;
        player.xp = result.xp;
        if (tutorialCompleted) player.tutorialCompleted = true;
        player.audit.push({
          id: randomUUID(),
          idempotencyKey: key,
          source: context.source.slice(0, 100),
          reason: context.reason.slice(0, 500),
          actor: context.actor.slice(0, 200),
          requestedDelta,
          appliedDelta: result.appliedDelta,
          rankBefore: result.previousRank,
          rankAfter: result.rank,
          xpBefore: result.previousXp,
          xpAfter: result.xp,
          at: new Date().toISOString(),
        });
        player.audit = player.audit.slice(-MAX_AUDIT_ENTRIES);
        this.remember(player, key);
        player.updatedAt = new Date().toISOString();
        return player;
      },
      beforeCommit: async (_current, next) => {
        if (next.rankKey !== member.rankKey) {
          await this.roblox.setProgressionRole(member, next.rankKey);
        }
      },
    });
    return this.toProfile(saved);
  }

  private defaultPlayer(member: MemberIdentity): StoredPlayer {
    return {
      schemaVersion: 1,
      userId: member.id,
      username: member.name,
      rankKey: member.rankKey,
      xp: 0,
      tutorialCompleted: member.rankKey !== "bmt",
      hostCount: 0,
      cohostCount: 0,
      processedKeys: [],
      audit: [],
      updatedAt: new Date().toISOString(),
    };
  }

  private normalizePlayer(raw: StoredPlayer, member: MemberIdentity): StoredPlayer {
    const player = raw && typeof raw === "object" ? raw : this.defaultPlayer(member);
    const storedRank = this.validRank(player.rankKey);
    const rankChanged = storedRank !== member.rankKey;
    return {
      schemaVersion: 1,
      userId: member.id,
      username: member.name,
      rankKey: member.rankKey,
      xp: rankChanged ? 0 : Math.min(99, finiteCount(player.xp)),
      tutorialCompleted: Boolean(player.tutorialCompleted) || member.rankKey !== "bmt",
      hostCount: finiteCount(player.hostCount),
      cohostCount: finiteCount(player.cohostCount),
      processedKeys: Array.isArray(player.processedKeys)
        ? player.processedKeys.filter((item): item is string => typeof item === "string").slice(-MAX_PROCESSED_KEYS)
        : [],
      audit: Array.isArray(player.audit) ? player.audit.slice(-MAX_AUDIT_ENTRIES) : [],
      updatedAt: new Date().toISOString(),
    };
  }

  private validRank(value: unknown): RankKey | null {
    return typeof value === "string" && rankByKey.has(value as RankKey) ? value as RankKey : null;
  }

  private remember(player: StoredPlayer, key: string): void {
    player.processedKeys.push(key);
    player.processedKeys = player.processedKeys.slice(-MAX_PROCESSED_KEYS);
  }

  private toProfile(player: StoredPlayer): PlayerProfile {
    const rank = rankByKey.get(player.rankKey);
    if (!rank) throw new Error(`Unknown stored rank: ${player.rankKey}`);
    return {
      userId: player.userId,
      username: player.username,
      rankKey: player.rankKey,
      rankName: rank.displayName,
      xp: player.xp,
      gate: rank.gate ?? null,
      tutorialCompleted: player.tutorialCompleted,
      hostCount: player.hostCount,
      cohostCount: player.cohostCount,
    };
  }
}
