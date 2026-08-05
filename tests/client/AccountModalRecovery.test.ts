import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  sendMagicLink: vi.fn(),
  discordLogin: vi.fn(),
  logOut: vi.fn(),
}));
vi.mock("../../src/client/Auth", () => authMock);
vi.mock("../../src/client/Api", () => ({
  fetchPlayerById: vi.fn(),
  getUserMe: vi.fn(),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: { email?: string }) =>
    params?.email ? key + ":" + params.email : key,
}));

import { AccountModal } from "../../src/client/AccountModal";

describe("AccountModal recovery state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  test("reports missing email inline without a blocking browser alert", async () => {
    const alertSpy = vi
      .spyOn(window, "alert")
      .mockImplementation(() => undefined);
    const modal = new AccountModal() as any;
    await modal.handleSubmit();
    expect(modal.recoveryState).toBe("error");
    expect(modal.recoveryMessage).toContain("enter_email_address");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("guards duplicate submissions and exposes successful recovery inline", async () => {
    let finish: (value: boolean) => void = () => undefined;
    authMock.sendMagicLink.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    );
    const modal = new AccountModal() as any;
    modal.email = "captain@example.com";

    const first = modal.handleSubmit();
    const second = modal.handleSubmit();
    expect(modal.recoveryState).toBe("pending");
    expect(authMock.sendMagicLink).toHaveBeenCalledOnce();

    finish(true);
    await Promise.all([first, second]);
    expect(modal.recoveryState).toBe("success");
    expect(modal.recoveryMessage).toContain("captain@example.com");
  });
});
