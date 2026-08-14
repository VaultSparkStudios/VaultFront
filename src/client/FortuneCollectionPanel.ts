/**
 * FortuneCollectionPanel — displays every Fortune Deck item a player has
 * won, with an equip action for title-type items.
 *
 * Usage: mount as a tab in CommandCenter, mirroring AchievementsPanel.
 * Call `loadForPlayer(persistentId)` to populate.
 */

import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  equipFortuneTitle,
  fetchFortuneCollection,
  type FortuneCollectionEntry,
} from "./Api";

@customElement("fortune-collection-panel")
export class FortuneCollectionPanel extends LitElement {
  @state() private items: FortuneCollectionEntry[] = [];
  @state() private equippedTitle: string | null = null;
  @state() private loading = false;
  @state() private equippingItemId: string | null = null;
  @state() private persistentId = "";
  @state() private equipStatus: {
    kind: "success" | "error";
    message: string;
  } | null = null;

  static styles = css`
    :host {
      display: block;
      font-family: "Overpass", sans-serif;
      color: var(--vf-panel-text, #f1f5f9);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .count-chip {
      background: color-mix(
        in srgb,
        var(--vf-accent, #60a5fa) 15%,
        transparent
      );
      border: 1px solid
        color-mix(in srgb, var(--vf-accent, #60a5fa) 35%, transparent);
      border-radius: 20px;
      padding: 3px 12px;
      font-size: 0.8rem;
      color: var(--vf-accent, #93c5fd);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 10px;
    }
    .card {
      background: color-mix(
        in srgb,
        var(--vf-bg-mid, #0f172a) 82%,
        transparent
      );
      border: 1px solid var(--vf-border-soft, rgba(71, 85, 105, 0.4));
      border-radius: 8px;
      padding: 14px;
      transition: border-color 0.2s;
    }
    .card.legendary {
      border-color: color-mix(
        in srgb,
        var(--vf-warm, #fbbf24) 55%,
        transparent
      );
      background: color-mix(
        in srgb,
        var(--vf-warm, #fbbf24) 12%,
        var(--vf-glass, #0f172a)
      );
    }
    .card.rare {
      border-color: color-mix(
        in srgb,
        var(--vf-accent, #818cf8) 52%,
        transparent
      );
      background: color-mix(
        in srgb,
        var(--vf-accent, #818cf8) 12%,
        var(--vf-glass, #0f172a)
      );
    }
    .card-name {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--vf-panel-text, #e2e8f0);
      margin-bottom: 4px;
    }
    .card.legendary .card-name {
      color: var(--vf-warm, #fbbf24);
    }
    .card.rare .card-name {
      color: var(--vf-accent, #a5b4fc);
    }
    .card-meta {
      font-size: 0.75rem;
      color: var(--vf-panel-muted, #94a3b8);
      text-transform: capitalize;
      margin-bottom: 10px;
    }
    .equip-button {
      font-size: 0.75rem;
      font-weight: 700;
      min-height: 44px;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid
        color-mix(in srgb, var(--vf-success, #34d399) 48%, transparent);
      background: color-mix(
        in srgb,
        var(--vf-success, #34d399) 12%,
        transparent
      );
      color: var(--vf-success, #6ee7b7);
      cursor: pointer;
    }
    .equip-button:focus-visible {
      outline: 3px solid var(--vf-warm, #fbbf24);
      outline-offset: 2px;
    }
    .equip-button:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .equipped-tag {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--vf-success, #6ee7b7);
    }
    .empty {
      color: var(--vf-panel-muted, #64748b);
      text-align: center;
      padding: 40px;
      font-size: 0.9rem;
    }
    .equip-status {
      margin: 0 0 16px;
      border: 1px solid var(--vf-border-soft, rgba(71, 85, 105, 0.4));
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 0.82rem;
      line-height: 1.4;
    }
    .equip-status.success {
      color: var(--vf-success, #6ee7b7);
      background: color-mix(
        in srgb,
        var(--vf-success, #34d399) 10%,
        var(--vf-bg-mid, #0f172a)
      );
    }
    .equip-status.error {
      color: var(--vf-danger, #fca5a5);
      background: color-mix(
        in srgb,
        var(--vf-danger, #ef4444) 10%,
        var(--vf-bg-mid, #0f172a)
      );
    }
  `;

  async loadForPlayer(persistentId: string): Promise<void> {
    this.persistentId = persistentId;
    this.equipStatus = null;
    this.loading = true;
    const data = await fetchFortuneCollection(persistentId);
    if (data) {
      this.items = data.items;
      this.equippedTitle = data.equippedTitle;
    }
    this.loading = false;
  }

  private async equip(entry: FortuneCollectionEntry): Promise<void> {
    if (this.equippingItemId) return;
    this.equipStatus = null;
    this.equippingItemId = entry.itemId;
    const result = await equipFortuneTitle(entry.itemId);
    if (result.ok) {
      this.equippedTitle = result.title;
      this.equipStatus = {
        kind: "success",
        message: `${result.title} equipped. Your title will appear in the next match.`,
      };
    } else {
      this.equipStatus = { kind: "error", message: result.error };
    }
    this.equippingItemId = null;
  }

  render() {
    if (this.loading) {
      return html`<div class="empty">Loading your Fortune collection…</div>`;
    }
    if (!this.persistentId) {
      return html`<div class="empty">
        Sign in to view your Fortune collection.
      </div>`;
    }
    if (this.items.length === 0) {
      return html`<div class="empty">
        Win a match to draw your first Fortune Deck item.
      </div>`;
    }

    return html`
      <div class="header">
        <span style="font-size:1rem;font-weight:700;">My Fortune</span>
        <span class="count-chip">${this.items.length} won</span>
      </div>
      ${
        this.equipStatus
          ? html`<p
              class="equip-status ${this.equipStatus.kind}"
              role=${this.equipStatus.kind === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              ${this.equipStatus.message}
            </p>`
          : ""
      }
      <div class="grid">
        ${this.items.map((entry) => {
          const isTitle = entry.type === "title";
          const isEquipped =
            isTitle &&
            entry.value !== null &&
            entry.value === this.equippedTitle;
          return html`
            <div class="card ${entry.rarity}">
              <div class="card-name">${entry.name}</div>
              <div class="card-meta">
                ${entry.rarity} · ${entry.type ?? "item"}
              </div>
              ${
                isTitle
                  ? isEquipped
                    ? html`<span class="equipped-tag">✓ Equipped</span>`
                    : html`<button
                        class="equip-button"
                        ?disabled=${this.equippingItemId === entry.itemId}
                        aria-busy=${this.equippingItemId === entry.itemId}
                        aria-label="Equip ${entry.name} title"
                        @click=${() => this.equip(entry)}
                      >
                        ${
                          this.equippingItemId === entry.itemId
                            ? "Equipping…"
                            : "Equip"
                        }
                      </button>`
                  : ""
              }
            </div>
          `;
        })}
      </div>
    `;
  }
}

if (!customElements.get("fortune-collection-panel")) {
  customElements.define("fortune-collection-panel", FortuneCollectionPanel);
}
