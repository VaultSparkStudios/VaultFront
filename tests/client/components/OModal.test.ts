import { afterEach, describe, expect, test } from "vitest";
import "../../../src/client/components/baseComponents/Modal";
import type { OModal } from "../../../src/client/components/baseComponents/Modal";

describe("OModal accessibility authority", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.body.style.overflow = "";
  });

  test("owns dialog semantics, focus containment, inert background, and restoration", async () => {
    const opener = document.createElement("button");
    const background = document.createElement("main");
    const modal = document.createElement("o-modal") as OModal;
    modal.title = "Command settings";
    modal.innerHTML =
      '<button id="first">First</button><button id="last">Last</button>';
    document.body.append(opener, background, modal);
    opener.focus();

    modal.open();
    await modal.updateComplete;
    await Promise.resolve();
    const dialog =
      modal.shadowRoot!.querySelector<HTMLElement>("[role='dialog']")!;
    const close = modal.shadowRoot!.querySelector<HTMLButtonElement>(
      "button[aria-label='Close Command settings']",
    )!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(close.getBoundingClientRect).toBeTypeOf("function");
    expect(background.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(modal.shadowRoot!.activeElement).toBe(close);

    close.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(document.activeElement?.id).toBe("first");
    modal.close();
    await Promise.resolve();
    expect(background.inert).toBeFalsy();
    expect(document.activeElement).toBe(opener);
  });
});
