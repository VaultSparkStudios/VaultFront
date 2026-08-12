import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  obeliskLogin: vi.fn(),
  logOut: vi.fn(),
}));
vi.mock("../../src/client/Auth", () => authMock);
vi.mock("../../src/client/Api", () => ({
  fetchPlayerById: vi.fn(),
  getUserMe: vi.fn(),
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: { account_name?: string }) =>
    params?.account_name ? `${key}:${params.account_name}` : key,
}));

import { AccountModal } from "../../src/client/AccountModal";

describe("AccountModal Obelisk handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  test("delegates sign-in, account creation, and recovery to Obelisk", () => {
    const modal = new AccountModal() as any;
    const markup = String(modal.renderLoginOptions().strings.join(""));

    expect(markup).toContain("Continue with Obelisk");
    expect(markup).toContain("VaultFront never");
    expect(markup).not.toContain('type="email"');
    expect(markup).not.toContain("Discord");

    modal.handleObeliskLogin();
    expect(authMock.obeliskLogin).toHaveBeenCalledOnce();
  });
});
