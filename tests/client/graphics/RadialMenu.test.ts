import { vi } from "vitest";

vi.mock("../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  renderNumber: (num: number) => String(num),
  getSvgAspectRatio: async () => null,
}));

// vitest-canvas-mock's DOMMatrix polyfill only accepts numeric-array init
// (6 or 16 values), but d3-interpolate parses CSS transform strings like
// "scale(1)" through `new DOMMatrix(cssString)`. Without this shim, every
// menu-open transition throws asynchronously and pollutes unrelated tests.
const OriginalDOMMatrix = globalThis.DOMMatrix;
if (OriginalDOMMatrix) {
  (globalThis as any).DOMMatrix = function (init?: unknown) {
    if (Array.isArray(init) && (init.length === 6 || init.length === 16)) {
      return new OriginalDOMMatrix(init as number[]);
    }
    return new OriginalDOMMatrix([1, 0, 0, 1, 0, 0]);
  } as unknown as typeof DOMMatrix;
}

import { CloseViewEvent } from "../../../src/client/InputHandler";
import { RadialMenu } from "../../../src/client/graphics/layers/RadialMenu";
import type {
  CenterButtonElement,
  MenuElement,
  MenuElementParams,
} from "../../../src/client/graphics/layers/RadialMenuElements";
import { EventBus } from "../../../src/core/EventBus";

function makeParams(): MenuElementParams {
  return {
    myPlayer: {} as any,
    selected: null,
    tile: {} as any,
    playerActions: {} as any,
    game: { inSpawnPhase: () => false } as any,
    buildMenu: {} as any,
    emojiTable: {} as any,
    playerActionHandler: {} as any,
    playerPanel: {} as any,
    chatIntegration: {} as any,
    eventBus: {} as any,
    closeMenu: () => {},
  };
}

function dispatchKey(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

describe("RadialMenu accessibility", () => {
  let radialMenu: RadialMenu;
  let eventBus: EventBus;
  let centerButtonElement: CenterButtonElement;

  afterEach(() => {
    radialMenu?.dispose();
    document.body.innerHTML = "";
  });

  describe("role/aria-label attributes (L1)", () => {
    let itemA: MenuElement;
    let itemDisabled: MenuElement;
    let itemSub: MenuElement;
    let childItem: MenuElement;
    let childSpy: (params: MenuElementParams) => void;

    beforeEach(() => {
      childSpy = vi.fn<(params: MenuElementParams) => void>();
      childItem = {
        id: "child_item",
        name: "child_item",
        ariaLabel: "Child Item",
        disabled: () => false,
        icon: "icon-child",
        action: childSpy,
      };
      itemA = {
        id: "item_a",
        name: "item_a",
        ariaLabel: "Item A",
        disabled: () => false,
        icon: "icon-a",
        action: vi.fn(),
      };
      itemDisabled = {
        id: "item_disabled",
        name: "item_disabled",
        ariaLabel: "Item Disabled",
        disabled: () => true,
        icon: "icon-disabled",
        action: vi.fn(),
      };
      itemSub = {
        id: "item_sub",
        name: "item_sub",
        ariaLabel: "Item Sub",
        disabled: () => false,
        icon: "icon-sub",
        subMenu: () => [childItem],
      };

      const rootMenu: MenuElement = {
        id: "root",
        name: "root",
        disabled: () => false,
        subMenu: () => [itemA, itemDisabled, itemSub],
      };

      centerButtonElement = { disabled: () => false, action: vi.fn() };
      eventBus = new EventBus();
      radialMenu = new RadialMenu(eventBus, rootMenu, centerButtonElement);
      radialMenu.init();
      radialMenu.setParams(makeParams());
      radialMenu.showRadialMenu(100, 100);
    });

    it("marks the menu root with role=menu", () => {
      const container = document.querySelector(".menu-container");
      expect(container?.getAttribute("role")).toBe("menu");
    });

    it("marks every generated item with role=menuitem and a descriptive aria-label", () => {
      const itemAPath = document.querySelector('path[data-id="item_a"]');
      const itemSubPath = document.querySelector('path[data-id="item_sub"]');
      const disabledPath = document.querySelector(
        'path[data-id="item_disabled"]',
      );

      expect(itemAPath?.getAttribute("role")).toBe("menuitem");
      expect(itemAPath?.getAttribute("aria-label")).toBe("Item A");
      expect(itemSubPath?.getAttribute("role")).toBe("menuitem");
      expect(itemSubPath?.getAttribute("aria-label")).toBe("Item Sub");
      expect(disabledPath?.getAttribute("role")).toBe("menuitem");
      expect(disabledPath?.getAttribute("aria-label")).toBe("Item Disabled");
    });

    it("reflects disabled state via aria-disabled", () => {
      const itemAPath = document.querySelector('path[data-id="item_a"]');
      const disabledPath = document.querySelector(
        'path[data-id="item_disabled"]',
      );

      expect(itemAPath?.getAttribute("aria-disabled")).toBe("false");
      expect(disabledPath?.getAttribute("aria-disabled")).toBe("true");
    });

    it("marks the center button with role=menuitem and a state-aware aria-label", () => {
      const centerHitbox = document.querySelector(".center-button-hitbox");
      expect(centerHitbox?.getAttribute("role")).toBe("menuitem");
      expect(centerHitbox?.getAttribute("aria-label")).toBe("Confirm");

      dispatchKey("ArrowRight"); // focus item_sub, which owns a submenu
      dispatchKey("Enter");

      expect(centerHitbox?.getAttribute("aria-label")).toBe("Back");
    });
  });

  describe("keyboard navigation (L2)", () => {
    let itemA: MenuElement;
    let itemDisabled: MenuElement;
    let itemSub: MenuElement;
    let childItem: MenuElement;
    let childSpy: (params: MenuElementParams) => void;
    let itemASpy: (params: MenuElementParams) => void;

    beforeEach(() => {
      childSpy = vi.fn<(params: MenuElementParams) => void>();
      itemASpy = vi.fn<(params: MenuElementParams) => void>();
      childItem = {
        id: "child_item",
        name: "child_item",
        ariaLabel: "Child Item",
        disabled: () => false,
        icon: "icon-child",
        action: childSpy,
      };
      itemA = {
        id: "item_a",
        name: "item_a",
        ariaLabel: "Item A",
        disabled: () => false,
        icon: "icon-a",
        action: itemASpy,
      };
      itemDisabled = {
        id: "item_disabled",
        name: "item_disabled",
        ariaLabel: "Item Disabled",
        disabled: () => true,
        icon: "icon-disabled",
        action: vi.fn(),
      };
      itemSub = {
        id: "item_sub",
        name: "item_sub",
        ariaLabel: "Item Sub",
        disabled: () => false,
        icon: "icon-sub",
        subMenu: () => [childItem],
      };

      const rootMenu: MenuElement = {
        id: "root",
        name: "root",
        disabled: () => false,
        subMenu: () => [itemA, itemDisabled, itemSub],
      };

      centerButtonElement = { disabled: () => false, action: vi.fn() };
      eventBus = new EventBus();
      radialMenu = new RadialMenu(eventBus, rootMenu, centerButtonElement);
      radialMenu.init();
      radialMenu.setParams(makeParams());
      radialMenu.showRadialMenu(100, 100);
    });

    it("focuses the first enabled item when the menu opens", () => {
      const itemAPath = document.querySelector('path[data-id="item_a"]');
      const disabledPath = document.querySelector(
        'path[data-id="item_disabled"]',
      );
      const itemSubPath = document.querySelector('path[data-id="item_sub"]');

      expect(itemAPath?.getAttribute("tabindex")).toBe("0");
      expect(disabledPath?.getAttribute("tabindex")).toBe("-1");
      expect(itemSubPath?.getAttribute("tabindex")).toBe("-1");
      expect(
        document.querySelector(".radial-menu-live-region")?.textContent,
      ).toBe("Item A. Available. Action. Item 1 of 2");
    });

    it("moves focus to the next enabled item on ArrowRight, skipping disabled items", () => {
      dispatchKey("ArrowRight");

      const itemAPath = document.querySelector('path[data-id="item_a"]');
      const itemSubPath = document.querySelector('path[data-id="item_sub"]');

      expect(itemAPath?.getAttribute("tabindex")).toBe("-1");
      expect(itemSubPath?.getAttribute("tabindex")).toBe("0");
      expect(
        document.querySelector(".radial-menu-live-region")?.textContent,
      ).toBe("Item Sub. Available. Opens submenu. Item 2 of 2");
    });

    it("wraps focus around with ArrowLeft, skipping disabled items", () => {
      dispatchKey("ArrowLeft");

      const itemAPath = document.querySelector('path[data-id="item_a"]');
      const itemSubPath = document.querySelector('path[data-id="item_sub"]');

      expect(itemAPath?.getAttribute("tabindex")).toBe("-1");
      expect(itemSubPath?.getAttribute("tabindex")).toBe("0");
    });

    it("activates the focused leaf item on Enter and closes the menu", () => {
      dispatchKey("Enter");

      expect(itemASpy).toHaveBeenCalledTimes(1);
      expect(radialMenu.isMenuVisible()).toBe(false);
    });

    it("activates the focused leaf item on Space", () => {
      dispatchKey("Space");

      expect(itemASpy).toHaveBeenCalledTimes(1);
    });

    it("opens a submenu on Enter and moves focus into it", () => {
      dispatchKey("ArrowRight"); // focus item_sub
      dispatchKey("Enter");

      expect(radialMenu.getCurrentLevel()).toBe(1);
      const childPath = document.querySelector('path[data-id="child_item"]');
      expect(childPath?.getAttribute("tabindex")).toBe("0");
      expect(
        document.querySelector(".radial-menu-live-region")?.textContent,
      ).toBe("Child Item. Available. Action. Item 1 of 1. Submenu level 1");

      // The submenu-open transition guards re-entrant activation until its
      // "end" event fires; settle it here rather than waiting on real CSS
      // transition timing under jsdom.
      (radialMenu as any).navigationInProgress = false;

      dispatchKey("Enter");
      expect(childSpy).toHaveBeenCalledTimes(1);
    });

    it("still closes the menu on Escape via the existing CloseViewEvent flow", () => {
      expect(radialMenu.isMenuVisible()).toBe(true);

      eventBus.emit(new CloseViewEvent());

      expect(radialMenu.isMenuVisible()).toBe(false);
    });

    it("does not react to keyboard input while the menu is closed", () => {
      radialMenu.hideRadialMenu();

      dispatchKey("ArrowRight");
      dispatchKey("Enter");

      expect(itemASpy).not.toHaveBeenCalled();
      expect(
        document.querySelector(".radial-menu-live-region")?.textContent,
      ).toBe("");
    });

    it("removes its owned status and tooltip nodes on dispose", () => {
      radialMenu.dispose();

      expect(document.querySelector(".radial-menu-live-region")).toBeNull();
      expect(document.querySelector(".radial-tooltip")).toBeNull();
      expect(document.querySelector(".radial-menu-container")).toBeNull();
    });
  });

  describe("traversal order for three enabled items", () => {
    it("moves right/left through items in angular (array) order", () => {
      const first: MenuElement = {
        id: "first",
        name: "first",
        ariaLabel: "First",
        disabled: () => false,
        icon: "icon-first",
        action: vi.fn(),
      };
      const second: MenuElement = {
        id: "second",
        name: "second",
        ariaLabel: "Second",
        disabled: () => false,
        icon: "icon-second",
        action: vi.fn(),
      };
      const third: MenuElement = {
        id: "third",
        name: "third",
        ariaLabel: "Third",
        disabled: () => false,
        icon: "icon-third",
        action: vi.fn(),
      };
      const rootMenu: MenuElement = {
        id: "root",
        name: "root",
        disabled: () => false,
        subMenu: () => [first, second, third],
      };

      centerButtonElement = { disabled: () => false, action: vi.fn() };
      eventBus = new EventBus();
      radialMenu = new RadialMenu(eventBus, rootMenu, centerButtonElement);
      radialMenu.init();
      radialMenu.setParams(makeParams());
      radialMenu.showRadialMenu(100, 100);

      const tabindexOf = (id: string) =>
        document
          .querySelector(`path[data-id="${id}"]`)
          ?.getAttribute("tabindex");

      expect(tabindexOf("first")).toBe("0");

      dispatchKey("ArrowRight");
      expect(tabindexOf("second")).toBe("0");
      expect(tabindexOf("first")).toBe("-1");

      dispatchKey("ArrowRight");
      expect(tabindexOf("third")).toBe("0");

      dispatchKey("ArrowLeft");
      expect(tabindexOf("second")).toBe("0");
    });
  });
});
