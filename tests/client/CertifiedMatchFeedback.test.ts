import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  postMatchRating: vi.fn(),
}));

vi.mock("../../src/client/Api", () => ({
  postMatchRating: apiMock.postMatchRating,
}));

import { CertifiedMatchFeedback } from "../../src/client/CertifiedMatchFeedback";

function receipt(duplicate = false) {
  return {
    status: duplicate ? ("duplicate" as const) : ("accepted" as const),
    receipt: {
      accepted: !duplicate,
      duplicate,
      gameId: "game-1",
      mapName: "World",
      durability: "postgres" as const,
      evidence: "certified-match-result" as const,
      retentionDays: 30 as const,
      signal: "decisive-convoy" as const,
    },
  };
}

async function mount() {
  const element = new CertifiedMatchFeedback();
  element.gameId = "game-1";
  document.body.append(element);
  element.requestUpdate();
  await element.updateComplete;
  return element;
}

function button(element: CertifiedMatchFeedback, label: string) {
  return element.querySelector(
    `button[aria-label="${label}"]`,
  ) as HTMLButtonElement;
}

describe("CertifiedMatchFeedback", () => {
  beforeEach(() => {
    apiMock.postMatchRating.mockResolvedValue(receipt());
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("keeps match and map ratings independent and submits both", async () => {
    const element = await mount();
    const submit = [...element.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Submit both ratings"),
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    button(element, "Match rating 4 out of 5").click();
    button(element, "Map rating 2 out of 5").click();
    button(element, "Feedback cause: Decisive convoy").click();
    await element.updateComplete;
    expect(
      button(element, "Match rating 4 out of 5").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      button(element, "Map rating 2 out of 5").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(submit.disabled).toBe(false);

    submit.click();
    await vi.waitFor(() =>
      expect(apiMock.postMatchRating).toHaveBeenCalledWith({
        gameId: "game-1",
        matchRating: 4,
        mapRating: 2,
        signal: "decisive-convoy",
      }),
    );
    await element.updateComplete;
    expect(element.textContent).toContain("certified match ledger");
    expect(element.textContent).toContain("World");
    expect(element.textContent).toContain("durable database receipt");
    expect(element.textContent).toContain("30-day retention");
    expect(element.textContent).toContain("cause: decisive-convoy");
  });

  it("acknowledges duplicate certified submissions without claiming a new write", async () => {
    apiMock.postMatchRating.mockResolvedValueOnce(receipt(true));
    const element = await mount();
    button(element, "Match rating 5 out of 5").click();
    button(element, "Map rating 5 out of 5").click();
    await element.updateComplete;
    (
      element.querySelector("button:not([aria-label])") as HTMLButtonElement
    ).click();
    await vi.waitFor(() =>
      expect(element.textContent).toContain("already rated"),
    );
  });

  it("surfaces an unavailable receipt and permits an explicit retry", async () => {
    apiMock.postMatchRating.mockResolvedValueOnce({
      status: "unavailable",
      detail: "Certified feedback is temporarily unavailable. Please retry.",
    });
    const element = await mount();
    button(element, "Match rating 3 out of 5").click();
    button(element, "Map rating 4 out of 5").click();
    await element.updateComplete;
    (
      element.querySelector("button:not([aria-label])") as HTMLButtonElement
    ).click();
    await vi.waitFor(() =>
      expect(element.querySelector('[role="alert"]')).toBeTruthy(),
    );
    await element.updateComplete;

    const retry = [...element.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Retry certified feedback"),
    ) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
  });

  it("does not attach a late receipt to a different match session", async () => {
    let resolveSubmission: (value: ReturnType<typeof receipt>) => void = () =>
      undefined;
    apiMock.postMatchRating.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubmission = resolve;
      }),
    );
    const element = await mount();
    button(element, "Match rating 4 out of 5").click();
    button(element, "Map rating 4 out of 5").click();
    await element.updateComplete;
    (
      element.querySelector("button:not([aria-label])") as HTMLButtonElement
    ).click();
    element.gameId = "game-2";
    await element.updateComplete;
    resolveSubmission(receipt());
    await Promise.resolve();
    await element.updateComplete;

    expect(element.textContent).not.toContain("Feedback saved");
    expect(
      button(element, "Match rating 4 out of 5").getAttribute("aria-pressed"),
    ).toBe("false");
  });
});
