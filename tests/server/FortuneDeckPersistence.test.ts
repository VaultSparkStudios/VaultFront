import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());

vi.mock("../../src/server/db/pool", () => ({ pool: { query } }));
vi.mock("../../src/server/Logger", () => {
  const log = {
    child: () => log,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { logger: log };
});

import { fortuneDeck } from "../../src/server/FortuneDeck";

describe("FortuneDeck certified persistence", () => {
  beforeEach(() => query.mockReset());

  it("awaits the unique write and reports database idempotency", async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockImplementationOnce(async (_sql: string, values: string[]) => ({
        rows: [
          {
            item_id: first.item.id,
            certificate_id: "certificate-a",
            receipt_digest: first.receipt.digest,
          },
        ],
        values,
      }));

    const first = await fortuneDeck.awardCertifiedWin(
      "persistent-a",
      "match-a",
      "certificate-a",
    );
    const replay = await fortuneDeck.awardCertifiedWin(
      "persistent-a",
      "match-a",
      "certificate-a",
    );

    expect(first.alreadyOwned).toBe(false);
    expect(replay.alreadyOwned).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT");
    expect(query.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["certificate-a", first.receipt.digest]),
    );
  });

  it("fails closed when the durable write fails", async () => {
    query.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      fortuneDeck.awardCertifiedWin("persistent-b", "match-b", "certificate-b"),
    ).rejects.toThrow("database unavailable");
  });

  it("rejects an old or conflicting row without certificate lineage", async () => {
    query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({
      rows: [
        {
          item_id: "legacy-item",
          certificate_id: null,
          receipt_digest: null,
        },
      ],
    });

    await expect(
      fortuneDeck.awardCertifiedWin("persistent-c", "match-c", "certificate-c"),
    ).rejects.toThrow("fortune-existing-receipt-mismatch");
  });
});
