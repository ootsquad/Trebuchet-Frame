import { describe, expect, it } from "vitest";
import { stableEventId } from "../src/services/events.js";

describe("stableEventId", () => {
  it("returns the same UUID for a retried Roblox event request", () => {
    const first = stableEventId("job:123:1700000000");
    const second = stableEventId("job:123:1700000000");

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("uses a different UUID for a different request", () => {
    expect(stableEventId("event-a")).not.toBe(stableEventId("event-b"));
  });
});
