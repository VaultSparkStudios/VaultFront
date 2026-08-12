import { describe, expect, it } from "vitest";
import { buildLocalCoachDebrief } from "../../src/server/LocalCoachDebrief";

describe("local certified coach", () => {
  it("derives transparent phase moments only from the requester's certified intents", () => {
    const record = {
      info: { num_turns: 90 },
      turns: [
        {
          turnNumber: 5,
          intents: [
            { type: "attack", clientID: "other", targetID: "x", troops: 1 },
          ],
        },
        {
          turnNumber: 10,
          intents: [
            { type: "set_resource_focus", clientID: "me", focus: "balanced" },
          ],
        },
        {
          turnNumber: 50,
          intents: [
            { type: "vault_role_ping", clientID: "me", role: "escort" },
          ],
        },
      ],
    } as never;
    const moments = buildLocalCoachDebrief(record, "me");
    expect(moments).toHaveLength(3);
    expect(moments[0]).toMatchObject({ tick: 10 });
    expect(moments[0].decision).toContain("resource focus");
    expect(moments[1].decision).toContain("Vault role");
    expect(moments[2].why).toContain("no committed command");
    expect(JSON.stringify(moments)).not.toContain("other");
  });

  it("returns a deterministic baseline for a certified quiet replay", () => {
    const record = { info: { num_turns: 3 }, turns: [] } as never;
    expect(buildLocalCoachDebrief(record, "me")).toEqual(
      buildLocalCoachDebrief(record, "me"),
    );
  });
});
