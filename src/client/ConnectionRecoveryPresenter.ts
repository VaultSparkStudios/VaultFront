import { EventBus } from "../core/EventBus";
import {
  TransportConnectionStateEvent,
  TransportOutboxOverflowEvent,
} from "./Transport";

export interface ConnectionRecoveryView {
  visible: boolean;
  state:
    | "connecting"
    | "waiting"
    | "synchronizing"
    | "restored"
    | "fatal"
    | "overflow"
    | "hidden";
  role: "status" | "alert";
  title: string;
  detail: string;
  autoHideMs: number | null;
}

const hidden = (): ConnectionRecoveryView => ({
  visible: false,
  state: "hidden",
  role: "status",
  title: "",
  detail: "",
  autoHideMs: null,
});

function protectedCommands(depth: number): string {
  return depth === 1 ? "1 command protected" : `${depth} commands protected`;
}

export function projectConnectionRecoveryView(
  event: TransportConnectionStateEvent,
  hadInterruption: boolean,
): ConnectionRecoveryView {
  switch (event.state) {
    case "connecting":
      return {
        visible: true,
        state: "connecting",
        role: "status",
        title: event.reconnectAttempt > 0 ? "Reconnecting…" : "Connecting…",
        detail:
          event.outboxDepth > 0
            ? protectedCommands(event.outboxDepth)
            : "Opening a secure match connection.",
        autoHideMs: null,
      };
    case "waiting": {
      const seconds = Math.max(1, Math.ceil((event.retryInMs ?? 0) / 1_000));
      return {
        visible: true,
        state: "waiting",
        role: "status",
        title: "Connection interrupted",
        detail: `Retrying in ${seconds}s · ${protectedCommands(event.outboxDepth)}`,
        autoHideMs: null,
      };
    }
    case "synchronizing":
      return {
        visible: true,
        state: "synchronizing",
        role: "status",
        title: "Rejoining match…",
        detail:
          event.outboxDepth > 0
            ? `Synchronizing server turns before replaying ${protectedCommands(event.outboxDepth).toLowerCase()}.`
            : "Synchronizing authoritative server turns.",
        autoHideMs: null,
      };
    case "open":
      return hadInterruption
        ? {
            visible: true,
            state: "restored",
            role: "status",
            title: "Connection restored",
            detail:
              event.outboxDepth === 0
                ? "Match synchronized. Protected commands delivered in order."
                : protectedCommands(event.outboxDepth),
            autoHideMs: 2_500,
          }
        : hidden();
    case "closed":
      return event.reason === "intentional-shutdown" || !event.reason
        ? hidden()
        : {
            visible: true,
            state: "fatal",
            role: "alert",
            title: "Connection refused",
            detail:
              "The server declined this game connection. Return to the lobby and try again.",
            autoHideMs: null,
          };
    case "idle":
    default:
      return hidden();
  }
}

export function projectOutboxOverflowView(
  event: TransportOutboxOverflowEvent,
): ConnectionRecoveryView {
  return {
    visible: true,
    state: "overflow",
    role: "alert",
    title: "Command queue full",
    detail: `The newest ${event.rejectedMessageType} command was not sent. Wait for reconnection before issuing more commands.`,
    autoHideMs: 6_000,
  };
}

export class ConnectionRecoveryPresenter {
  private readonly element: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private hadInterruption = false;

  private readonly onConnectionState = (
    event: TransportConnectionStateEvent,
  ) => {
    if (event.state === "waiting") this.hadInterruption = true;
    const view = projectConnectionRecoveryView(event, this.hadInterruption);
    this.present(view);
    if (event.state === "open") this.hadInterruption = false;
  };

  private readonly onOverflow = (event: TransportOutboxOverflowEvent) => {
    this.hadInterruption = true;
    this.present(projectOutboxOverflowView(event));
  };

  constructor(private readonly eventBus: EventBus) {
    this.element = document.createElement("section");
    this.element.id = "connection-recovery-status";
    this.element.hidden = true;
    this.element.setAttribute("aria-atomic", "true");
    this.element.className =
      "fixed left-1/2 top-3 z-[10020] w-[min(92vw,34rem)] -translate-x-1/2 rounded-xl border border-cyan-300/35 bg-slate-950/95 px-4 py-3 text-center text-slate-100 shadow-2xl shadow-slate-950/60 backdrop-blur-md sm:top-5";
    document.body.append(this.element);
    eventBus.on(TransportConnectionStateEvent, this.onConnectionState);
    eventBus.on(TransportOutboxOverflowEvent, this.onOverflow);
  }

  private present(view: ConnectionRecoveryView): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.element.hidden = !view.visible;
    this.element.dataset.state = view.state;
    this.element.setAttribute("role", view.role);
    this.element.setAttribute(
      "aria-live",
      view.role === "alert" ? "assertive" : "polite",
    );
    this.element.replaceChildren();
    if (view.visible) {
      const title = document.createElement("strong");
      title.className = "block text-sm font-bold text-cyan-100";
      title.textContent = view.title;
      const detail = document.createElement("span");
      detail.className = "mt-1 block text-xs text-slate-300";
      detail.textContent = view.detail;
      this.element.append(title, detail);
    }
    if (view.autoHideMs !== null) {
      this.hideTimer = setTimeout(() => {
        this.element.hidden = true;
        this.element.dataset.state = "hidden";
      }, view.autoHideMs);
    }
  }

  dispose(): void {
    this.eventBus.off(TransportConnectionStateEvent, this.onConnectionState);
    this.eventBus.off(TransportOutboxOverflowEvent, this.onOverflow);
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.element.remove();
  }
}
