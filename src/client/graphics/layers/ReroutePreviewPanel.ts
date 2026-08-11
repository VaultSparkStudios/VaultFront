import { html, type TemplateResult } from "lit";
import type { VaultFrontReroutePreview } from "../../../core/game/GameUpdates";

export type RerouteCommand = VaultFrontReroutePreview["command"];

export interface RerouteDecisionViewModel {
  compact: boolean;
  heading: string;
  selected: VaultFrontReroutePreview;
  options: Array<{
    command: RerouteCommand;
    label: string;
    selected: boolean;
  }>;
  description: string;
  applyLabel: string;
}

export function rerouteLaneLabel(command: RerouteCommand): string {
  if (command === "reroute_city") return "City";
  if (command === "reroute_port") return "Port";
  if (command === "reroute_factory") return "Factory";
  if (command === "reroute_silo") return "Silo";
  return "Safest";
}

function signed(value: number, digits?: number): string {
  const rendered =
    digits === undefined ? value.toLocaleString() : value.toFixed(digits);
  return `${value >= 0 ? "+" : ""}${rendered}`;
}

export function projectRerouteDecision(
  previews: readonly VaultFrontReroutePreview[],
  selectedCommand: RerouteCommand,
  compact: boolean,
): RerouteDecisionViewModel | null {
  const selected =
    previews.find((preview) => preview.command === selectedCommand) ??
    previews[0];
  if (!selected) return null;
  const troopCopy = compact
    ? ""
    : ` and ${selected.troopsReward.toLocaleString()} troops (${signed(selected.deltaTroops)})`;
  return {
    compact,
    heading: compact ? "Reroute Preview" : "Pre-Action Reroute Preview",
    selected,
    options: previews.map((preview) => ({
      command: preview.command,
      label: rerouteLaneLabel(preview.command),
      selected: preview.command === selected.command,
    })),
    description:
      `${rerouteLaneLabel(selected.command)} lane. ETA ${selected.etaSeconds}s (${signed(selected.deltaEtaSeconds)}s). ` +
      `Risk ${selected.routeRisk.toFixed(2)} (${signed(selected.deltaRisk, 2)}). ` +
      `Reward ${selected.goldReward.toLocaleString()} gold (${signed(selected.deltaGold)}g)${troopCopy}`,
    applyLabel: compact ? "Apply" : "Apply Previewed Reroute",
  };
}

export function nextRerouteCommand(
  previews: readonly VaultFrontReroutePreview[],
  selectedCommand: RerouteCommand,
  key: string,
): RerouteCommand | null {
  if (previews.length === 0) return null;
  const keys = new Set([
    "ArrowRight",
    "ArrowDown",
    "ArrowLeft",
    "ArrowUp",
    "Home",
    "End",
  ]);
  if (!keys.has(key)) return null;
  const current = Math.max(
    0,
    previews.findIndex((preview) => preview.command === selectedCommand),
  );
  const next =
    key === "Home"
      ? 0
      : key === "End"
        ? previews.length - 1
        : key === "ArrowRight" || key === "ArrowDown"
          ? (current + 1) % previews.length
          : (current - 1 + previews.length) % previews.length;
  return previews[next]?.command ?? null;
}

export function renderReroutePreviewPanel(input: {
  previews: readonly VaultFrontReroutePreview[];
  selectedCommand: RerouteCommand;
  compact: boolean;
  onSelect(command: RerouteCommand, moveFocus: boolean): void;
  onApply(command: RerouteCommand): void;
}): TemplateResult | string {
  const model = projectRerouteDecision(
    input.previews,
    input.selectedCommand,
    input.compact,
  );
  if (!model) return "";
  const onKeyDown = (event: KeyboardEvent) => {
    const command = nextRerouteCommand(
      input.previews,
      model.selected.command,
      event.key,
    );
    if (!command) return;
    event.preventDefault();
    input.onSelect(command, true);
  };
  return html`
    <div
      class="vf-reroute-panel mt-1 rounded border border-cyan-300/35 bg-cyan-950/20 ${
        model.compact ? "p-1" : "p-1.5"
      }"
    >
      <div
        id="reroute-decision-label"
        class="vf-reroute-label text-xs text-cyan-100/90"
      >
        ${model.heading}
      </div>
      <div
        class="mt-1 ${
          model.compact ? "grid grid-cols-3" : "flex flex-wrap"
        } gap-1"
        role="radiogroup"
        aria-labelledby="reroute-decision-label"
        aria-describedby="reroute-live-description"
        @keydown=${onKeyDown}
      >
        ${model.options.map(
          (option) => html`
            <button
              type="button"
              role="radio"
              aria-checked=${option.selected ? "true" : "false"}
              aria-pressed=${option.selected ? "true" : "false"}
              aria-describedby="reroute-live-description"
              tabindex=${option.selected ? "0" : "-1"}
              data-reroute-command=${option.command}
              class="vf-reroute-option min-h-11 min-w-11 rounded border px-2 py-1 text-xs ${
                option.selected
                  ? "border-cyan-200/70 bg-cyan-500/25 text-cyan-50"
                  : "border-cyan-300/35 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
              }"
              @focus=${() => input.onSelect(option.command, false)}
              @click=${() => input.onSelect(option.command, false)}
            >
              ${option.label}
            </button>
          `,
        )}
      </div>
      <div
        id="reroute-live-description"
        class="vf-reroute-status mt-1 text-xs text-cyan-50 tabular-nums"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        ${model.description}
      </div>
      <button
        type="button"
        class="vf-reroute-action mt-1 min-h-11 rounded border border-cyan-200/50 bg-cyan-500/25 px-3 py-1 text-xs text-cyan-50 hover:bg-cyan-500/35"
        @click=${() => input.onApply(model.selected.command)}
      >
        ${model.applyLabel}
      </button>
    </div>
  `;
}
