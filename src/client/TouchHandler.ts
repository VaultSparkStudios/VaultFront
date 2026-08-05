// Mobile-specific gesture layer: long-press, double-tap, and two-finger swipe.
// Attaches to a canvas element and emits InputHandler events onto the shared EventBus.

import { EventBus } from "../core/EventBus";
import { AttackRatioEvent, ContextMenuEvent, ZoomEvent } from "./InputHandler";

const LONG_PRESS_MS = 480;
const DOUBLE_TAP_MS = 280;
const SWIPE_MIN_PX = 40;

export class TouchHandler {
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTapTime = 0;
  private lastTapX = 0;
  private lastTapY = 0;

  private twoFingerSwipeStartX: number | null = null;

  constructor(
    private readonly canvas: HTMLElement,
    private readonly eventBus: EventBus,
  ) {
    this.canvas.addEventListener(
      "touchstart",
      this.onTouchStart as EventListener,
      { passive: false },
    );
    this.canvas.addEventListener("touchend", this.onTouchEnd as EventListener, {
      passive: false,
    });
    this.canvas.addEventListener(
      "touchmove",
      this.onTouchMove as EventListener,
      { passive: true },
    );
    this.canvas.addEventListener(
      "touchcancel",
      this.onTouchCancel as EventListener,
      { passive: true },
    );
  }

  private onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        this.eventBus.emit(new ContextMenuEvent(t.clientX, t.clientY));
      }, LONG_PRESS_MS);
      this.twoFingerSwipeStartX = null;
    } else if (e.touches.length === 2) {
      this.clearLongPress();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      this.twoFingerSwipeStartX = cx;
    }
  };

  private onTouchEnd = (e: TouchEvent) => {
    this.clearLongPress();

    if (e.changedTouches.length === 1 && e.touches.length === 0) {
      const t = e.changedTouches[0];
      const now = Date.now();
      const dx = t.clientX - this.lastTapX;
      const dy = t.clientY - this.lastTapY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (now - this.lastTapTime < DOUBLE_TAP_MS && dist < 30) {
        e.preventDefault();
        this.eventBus.emit(new ZoomEvent(t.clientX, t.clientY, -120));
        this.lastTapTime = 0;
      } else {
        this.lastTapTime = now;
        this.lastTapX = t.clientX;
        this.lastTapY = t.clientY;
      }
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    if (this.twoFingerSwipeStartX === null) return;

    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const delta = cx - this.twoFingerSwipeStartX;
    if (Math.abs(delta) >= SWIPE_MIN_PX) {
      const sign = delta > 0 ? 1 : -1;
      this.eventBus.emit(new AttackRatioEvent(sign * 10));
      this.twoFingerSwipeStartX = cx;
    }
  };

  private onTouchCancel = () => {
    this.clearLongPress();
    this.twoFingerSwipeStartX = null;
  };

  private clearLongPress() {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  destroy() {
    this.clearLongPress();
    this.twoFingerSwipeStartX = null;
    this.canvas.removeEventListener(
      "touchstart",
      this.onTouchStart as EventListener,
    );
    this.canvas.removeEventListener(
      "touchend",
      this.onTouchEnd as EventListener,
    );
    this.canvas.removeEventListener(
      "touchmove",
      this.onTouchMove as EventListener,
    );
    this.canvas.removeEventListener(
      "touchcancel",
      this.onTouchCancel as EventListener,
    );
  }
}
