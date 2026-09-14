import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { Client } from "discord.js";
import { announceConfirmedEvent } from "./discord.js";
import { eventTypes } from "./ranks.js";
import { EventService } from "./services/events.js";
import { ProgressionService } from "./services/progression.js";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createHttpApp(config: AppConfig, progression: ProgressionService, events: EventService, discord: Client) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "trebuchet-progression" });
  });

  app.use("/v1/roblox", (request, response, next) => {
    const supplied = request.header("x-trebuchet-secret") ?? "";
    if (!safeEqual(supplied, config.robloxGameSecret)) {
      response.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    next();
  });

  const playerSchema = z.object({
    userId: z.number().int().positive(),
    username: z.string().min(3).max(20),
  });

  app.post("/v1/roblox/playtime", asyncRoute(async (request, response) => {
    const body = playerSchema.extend({
      grantId: z.string().min(8).max(250),
      minutes: z.number().int().min(config.playtimeMinutes).max(config.playtimeMinutes + 5),
    }).parse(request.body);
    const profile = await progression.addByUserId(body.userId, body.username, config.playtimeXp, {
      source: "roblox-playtime",
      reason: `${config.playtimeMinutes} minutes played`,
      actor: "roblox-server",
      idempotencyKey: `playtime:${body.grantId}`,
    });
    response.json({ success: true, profile });
  }));

  app.post("/v1/roblox/tutorial", asyncRoute(async (request, response) => {
    const body = playerSchema.extend({ universeId: z.number().int().positive() }).parse(request.body);
    const profile = await progression.completeTutorialByUserId(body.userId, body.username, {
      source: "tutorial",
      reason: "Completed the in-game tutorial",
      actor: `roblox-universe:${body.universeId}`,
      idempotencyKey: `tutorial:${body.universeId}:${body.userId}`,
    });
    response.json({ success: true, profile });
  }));

  app.post("/v1/roblox/events", asyncRoute(async (request, response) => {
    const body = z.object({
      eventType: z.enum(eventTypes),
      xpAmount: z.number().int().min(0).max(config.maxEventXp),
      hostUserId: z.number().int().positive(),
      hostUsername: z.string().min(3).max(20),
      cohostUsername: z.string().max(20).optional(),
      serverJobId: z.string().min(1).max(200),
      placeId: z.number().int().positive(),
      durationMinutes: z.number().int().min(5).max(180),
      requestId: z.string().min(8).max(200),
    }).parse(request.body);
    const event = await events.create(body);
    try {
      await announceConfirmedEvent(discord, config, event);
    } catch (error) {
      console.error("Confirmed event could not be announced in Discord", { eventId: event.id, error });
    }
    response.status(201).json({ success: true, event });
  }));

  app.post("/v1/roblox/events/:eventId/complete", asyncRoute(async (request, response) => {
    const eventId = z.string().uuid().parse(request.params.eventId);
    const body = z.object({
      attendees: z.array(playerSchema.extend({ attendedSeconds: z.number().int().min(0).max(24 * 60 * 60) })).max(200),
    }).parse(request.body);
    const result = await events.complete(eventId, body.attendees);
    response.json({ success: true, result });
  }));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof z.ZodError
      ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
      : error instanceof Error ? error.message : "Unknown error";
    console.error("HTTP request failed", error);
    response.status(error instanceof z.ZodError ? 400 : 422).json({ success: false, error: message.slice(0, 1_800) });
  });

  return app;
}

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}
