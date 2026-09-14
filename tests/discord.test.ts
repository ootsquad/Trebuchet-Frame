import { describe, expect, it } from "vitest";
import { buildEventAnnouncement } from "../src/discord.js";

describe("buildEventAnnouncement", () => {
  it("pings the configured role and displays None without a co-host", () => {
    const message = buildEventAnnouncement({
      id: "event-id",
      eventType: "Patrol",
      xpAmount: 5,
      hostUsername: "HostPlayer",
      cohostUsername: null,
      durationMinutes: 30,
      startsAt: "2026-09-13T17:00:00.000Z",
      placeId: 123456789,
    }, "1548802585467691049");

    expect(message.content).toBe("<@&1548802585467691049>");
    expect(message.allowedMentions.roles).toEqual(["1548802585467691049"]);
    const embed = message.embeds[0];
    expect(embed).toBeDefined();
    const fields = embed?.toJSON().fields ?? [];
    expect(fields.find((field) => field.name === "Co-Host")?.value).toBe("None");
    expect(fields.find((field) => field.name === "Event Length")?.value).toBe("30 minutes");
    expect(message.components[0]?.toJSON().components[0]).toMatchObject({
      url: "https://www.roblox.com/games/123456789",
    });
  });
});
