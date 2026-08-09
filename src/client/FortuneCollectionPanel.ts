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

  static styles = css`
    :host {
      display: block;
      font-family: "Overpass", sans-serif;
      color: #f1f5f9;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
    }
    .count-chip {
      background: rgba(96, 165, 250, 0.15);
      border: 1px solid rgba(96, 165, 250, 0.3);
      border-radius: 20px;
      padding: 3px 12px;
      font-size: 0.8rem;
      color: #93c5fd;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 10px;
    }
    .card {
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(71, 85, 105, 0.4);
      border-radius: 8px;
      padding: 14px;
      transition: border-color 0.2s;
    }
    .card.legendary {
      border-color: rgba(251, 191, 36, 0.5);
      background: rgba(20, 16, 0, 0.8);
    }
    .card.rare {
      border-color: rgba(129, 140, 248, 0.5);
      background: rgba(15, 15, 40, 0.85);
    }
    .card-name {
      font-size: 0.95rem;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 4px;
    }
    .card.legendary .card-name {
      color: #fbbf24;
    }
    .card.rare .card-name {
      color: #a5b4fc;
    }
    .card-meta {
      font-size: 0.75rem;
      color: #94a3b8;
      text-transform: capitalize;
      margin-bottom: 10px;
    }
    .equip-button {
      font-size: 0.75rem;
      font-weight: 700;
      padding: 5px 12px;
      border-radius: 6px;
      border: 1px solid rgba(52, 211, 153, 0.4);
      background: rgba(52, 211, 153, 0.12);
      color: #6ee7b7;
      cursor: pointer;
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
      color: #6ee7b7;
    }
    .empty {
      color: #64748b;
      text-align: center;
      padding: 40px;
      font-size: 0.9rem;
    }
  `;

  async loadForPlayer(persistentId: string): Promise<void> {
    this.persistentId = persistentId;
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
    this.equippingItemId = entry.itemId;
    const result = await equipFortuneTitle(entry.itemId);
    if (result.ok) {
      this.equippedTitle = result.title;
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
