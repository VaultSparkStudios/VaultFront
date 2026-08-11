export interface RadialMenuAnnouncement {
  label: string;
  disabled: boolean;
  hasSubmenu: boolean;
  position: number;
  count: number;
  level: number;
}

export class RadialMenuAnnouncer {
  private element: HTMLDivElement | null = null;

  init() {
    this.element = document.createElement("div");
    this.element.className = "radial-menu-live-region";
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
    this.element.setAttribute("aria-atomic", "true");
    this.element.style.cssText =
      "position:fixed;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
    document.body.appendChild(this.element);
  }

  announce(input: RadialMenuAnnouncement) {
    if (!this.element) return;
    const parts = [
      input.label,
      input.disabled ? "Unavailable" : "Available",
      input.hasSubmenu ? "Opens submenu" : "Action",
      input.position >= 0
        ? `Item ${input.position + 1} of ${input.count}`
        : null,
      input.level > 0 ? `Submenu level ${input.level}` : null,
    ];
    this.element.textContent = parts.filter(Boolean).join(". ");
  }

  clear() {
    if (this.element) this.element.textContent = "";
  }

  dispose() {
    this.element?.remove();
    this.element = null;
  }
}
