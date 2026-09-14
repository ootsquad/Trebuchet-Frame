import { createHash } from "node:crypto";
import { canCohost, canHost, type EventType } from "../ranks.js";
import { OpenCloudDataStore } from "./datastore.js";
import { ProgressionService } from "./progression.js";
import { RobloxService } from "./roblox.js";

export interface CreateEventInput {
  eventType: EventType;
  xpAmount: number;
  hostUserId: number;
  hostUsername: string;
  cohostUsername?: string;
  serverJobId: string;
  placeId: number;
  durationMinutes: number;
  requestId: string;
}

export interface AttendeeInput {
  userId: number;
  username: string;
  attendedSeconds: number;
}

interface AttendanceResult extends AttendeeInput {
  xpAwarded: number;
  result: string;
}

export interface StoredEvent {
  schemaVersion: 1;
  id: string;
  eventType: EventType;
  xpAmount: number;
  hostUserId: number;
  hostUsername: string;
  cohostUserId?: number;
  cohostUsername?: string;
  serverJobId: string;
  placeId: number;
  durationMinutes: number;
  startsAt: string;
  endsAt: string;
  requestId: string;
  status: "active" | "completed";
  completedAt?: string;
  attendance?: AttendanceResult[];
}

export function stableEventId(requestId: string): string {
  const hash = createHash("sha256").update(requestId).digest("hex");
  const variant = ((Number.parseInt(hash[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function eventKey(id: string): string {
  return `event_${id}`;
}

export class EventService {
  constructor(
    private readonly store: OpenCloudDataStore,
    private readonly roblox: RobloxService,
    private readonly progression: ProgressionService,
    private readonly maxEventXp: number,
  ) {}

  async create(input: CreateEventInput) {
    if (!Number.isInteger(input.xpAmount) || input.xpAmount < 0 || input.xpAmount > this.maxEventXp) {
      throw new Error(`Event XP must be an integer from 0 through ${this.maxEventXp}.`);
    }

    const host = await this.roblox.getMemberById(input.hostUserId, input.hostUsername);
    if (!canHost(host.rankKey, input.eventType)) {
      throw new Error(`${host.role.displayName} cannot host ${input.eventType}.`);
    }
    await this.progression.getProfileByUsername(host.name);

    let cohost;
    if (input.cohostUsername?.trim()) {
      cohost = await this.roblox.getMemberByUsername(input.cohostUsername);
      if (cohost.id === host.id) throw new Error("The host and co-host cannot be the same player.");
      if (!canCohost(cohost.rankKey)) {
        throw new Error("The co-host must be a Sergeant, Gunnery Sergeant, or officer.");
      }
      await this.progression.getProfileByUsername(cohost.name);
    }

    const id = stableEventId(input.requestId);
    const startsAt = new Date();
    const created: StoredEvent = {
      schemaVersion: 1,
      id,
      eventType: input.eventType,
      xpAmount: input.xpAmount,
      hostUserId: host.id,
      hostUsername: host.name,
      ...(cohost ? { cohostUserId: cohost.id, cohostUsername: cohost.name } : {}),
      serverJobId: input.serverJobId,
      placeId: input.placeId,
      durationMinutes: input.durationMinutes,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000).toISOString(),
      requestId: input.requestId,
      status: "active",
    };

    const saved = await this.store.update(eventKey(id), {
      defaultValue: () => created,
      transform: (current) => {
        if (current.requestId !== input.requestId) throw new Error("Event key collision detected.");
        return current;
      },
    });
    return this.publicEvent(saved);
  }

  async complete(eventId: string, attendees: AttendeeInput[]) {
    const entry = await this.store.get<StoredEvent>(eventKey(eventId));
    if (!entry) throw new Error("Event was not found.");
    const event = entry.value;
    if (event.status === "completed") {
      return { eventId, alreadyCompleted: true, awarded: 0, skipped: 0 };
    }

    const totalSeconds = event.durationMinutes * 60;
    const requiredSeconds = Math.min(totalSeconds, Math.max(300, Math.min(600, Math.ceil(totalSeconds * 0.5))));
    const unique = new Map<number, AttendeeInput>();
    for (const attendee of attendees) {
      if (attendee.userId === event.hostUserId || attendee.userId === event.cohostUserId) continue;
      const current = unique.get(attendee.userId);
      if (!current || attendee.attendedSeconds > current.attendedSeconds) unique.set(attendee.userId, attendee);
    }

    let awarded = 0;
    let skipped = 0;
    const attendance: AttendanceResult[] = [];
    for (const attendee of unique.values()) {
      const eligible = attendee.attendedSeconds >= requiredSeconds;
      let result = eligible ? "eligible" : "insufficient-time";
      let xpAwarded = 0;
      if (eligible && event.xpAmount > 0) {
        try {
          const before = await this.progression.getProfileByUsername(attendee.username);
          const after = await this.progression.addByUserId(attendee.userId, attendee.username, event.xpAmount, {
            source: "roblox-event",
            reason: `${event.eventType} attendance`,
            actor: `event:${event.id}`,
            idempotencyKey: `event:${event.id}:attendee:${attendee.userId}`,
          });
          xpAwarded = before.rankKey === after.rankKey ? Math.max(0, after.xp - before.xp) : 100 - before.xp;
          result = after.gate && after.xp === 99 ? `awarded-gate-${after.gate}` : "awarded";
          awarded += 1;
        } catch (error) {
          result = `error:${error instanceof Error ? error.message : String(error)}`.slice(0, 500);
          skipped += 1;
        }
      } else {
        skipped += 1;
      }
      attendance.push({ ...attendee, xpAwarded, result });
    }

    if (event.cohostUserId && event.cohostUsername && event.xpAmount > 0) {
      try {
        const profile = await this.progression.getProfileByUsername(event.cohostUsername);
        if (profile.rankKey === "sgt" || profile.rankKey === "gysgt") {
          await this.progression.addByUserId(event.cohostUserId, event.cohostUsername, event.xpAmount, {
            source: "roblox-event",
            reason: `Co-hosted ${event.eventType}`,
            actor: `event:${event.id}`,
            idempotencyKey: `event:${event.id}:cohost-xp:${event.cohostUserId}`,
          });
        }
      } catch (error) {
        console.error("Co-host XP failed", { eventId: event.id, error });
      }
    }

    await this.progression.incrementHostCount(
      event.hostUserId,
      event.hostUsername,
      false,
      `event:${event.id}:host-count`,
    );
    if (event.cohostUserId && event.cohostUsername) {
      await this.progression.incrementHostCount(
        event.cohostUserId,
        event.cohostUsername,
        true,
        `event:${event.id}:cohost-count`,
      );
    }

    let alreadyCompleted = false;
    await this.store.update(eventKey(event.id), {
      defaultValue: () => event,
      transform: (current) => {
        if (current.status === "completed") {
          alreadyCompleted = true;
          return current;
        }
        return {
          ...current,
          status: "completed" as const,
          completedAt: new Date().toISOString(),
          attendance,
        };
      },
    });

    return { eventId, alreadyCompleted, awarded, skipped, requiredSeconds };
  }

  private publicEvent(event: StoredEvent) {
    return {
      id: event.id,
      eventType: event.eventType,
      xpAmount: event.xpAmount,
      hostUsername: event.hostUsername,
      cohostUsername: event.cohostUsername ?? null,
      durationMinutes: event.durationMinutes,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      placeId: event.placeId,
      status: event.status,
    };
  }
}
