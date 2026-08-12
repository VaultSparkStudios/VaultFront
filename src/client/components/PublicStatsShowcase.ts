import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

interface PublicMetric {
  id: string;
  label: string;
  value: string | number | null;
  computedAt: string;
  available: boolean;
}

interface PublicStatsFeed {
  generatedAt: string;
  refreshSeconds: number;
  showcase: string[];
  metrics: PublicMetric[];
}

export function normalizePublicStatsFeed(
  value: unknown,
): PublicStatsFeed | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.generatedAt !== "string" ||
    !Number.isInteger(input.refreshSeconds) ||
    Number(input.refreshSeconds) < 1 ||
    !Array.isArray(input.showcase) ||
    !Array.isArray(input.metrics)
  ) {
    return null;
  }
  const metrics = input.metrics.filter(
    (metric): metric is PublicMetric =>
      typeof metric === "object" &&
      metric !== null &&
      typeof (metric as PublicMetric).id === "string" &&
      typeof (metric as PublicMetric).label === "string" &&
      typeof (metric as PublicMetric).computedAt === "string" &&
      typeof (metric as PublicMetric).available === "boolean",
  );
  const showcase = input.showcase.filter(
    (id): id is string => typeof id === "string",
  );
  if (showcase.length < 3 || metrics.length < showcase.length) return null;
  return {
    generatedAt: input.generatedAt,
    refreshSeconds: Number(input.refreshSeconds),
    showcase,
    metrics,
  };
}

export function isPublicStatsFeedStale(
  feed: PublicStatsFeed,
  now = Date.now(),
): boolean {
  const generatedAt = Date.parse(feed.generatedAt);
  return (
    !Number.isFinite(generatedAt) ||
    now - generatedAt > feed.refreshSeconds * 2 * 1_000
  );
}

@customElement("public-stats-showcase")
export class PublicStatsShowcase extends LitElement {
  @state() private feed: PublicStatsFeed | null = null;
  @state() private unavailable = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  static styles = css`
    :host {
      display: block;
    }
    section {
      border: 1px solid var(--vf-border);
      border-radius: 0.75rem;
      padding: 0.6rem 0.75rem;
      background: color-mix(in srgb, var(--vf-surface) 86%, transparent);
      color: var(--vf-text);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.45rem;
    }
    h2 {
      margin: 0;
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--vf-text-muted);
    }
    a {
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      color: var(--vf-accent-blue);
      font-size: 0.76rem;
      font-weight: 750;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.4rem;
    }
    article {
      min-width: 0;
      padding: 0.5rem;
      border-radius: 0.55rem;
      background: color-mix(in srgb, var(--vf-surface-alt) 82%, transparent);
    }
    strong,
    span {
      display: block;
      overflow-wrap: anywhere;
    }
    strong {
      font-size: 0.9rem;
    }
    span {
      margin-top: 0.18rem;
      color: var(--vf-text-muted);
      font-size: 0.66rem;
      line-height: 1.25;
    }
    .stale {
      color: var(--vf-accent-orange);
    }
    @media (max-width: 600px) {
      section {
        border-radius: 0;
      }
      .grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      article {
        padding: 0.45rem 0.35rem;
      }
      strong {
        font-size: 0.78rem;
      }
      article span {
        font-size: 0.6rem;
      }
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    void this.refresh();
  }

  disconnectedCallback(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    super.disconnectedCallback();
  }

  private async refresh(): Promise<void> {
    try {
      const response = await fetch("/stats.json", {
        headers: { accept: "application/json" },
        cache: "no-cache",
      });
      const feed = response.ok
        ? normalizePublicStatsFeed(await response.json())
        : null;
      if (!feed) throw new Error("invalid public stats feed");
      this.feed = feed;
      this.unavailable = false;
      this.pollTimer ??= setInterval(
        () => void this.refresh(),
        feed.refreshSeconds * 1_000,
      );
    } catch {
      this.unavailable = true;
    }
  }

  render() {
    const feed = this.feed;
    const stale = feed ? isPublicStatsFeedStale(feed) : false;
    const metrics = feed
      ? feed.showcase
          .map((id) => feed.metrics.find((metric) => metric.id === id))
          .filter((metric): metric is PublicMetric => metric !== undefined)
      : [];
    return html`
      <section aria-labelledby="public-stats-title">
        <header>
          <h2 id="public-stats-title">Verified Alpha Pulse</h2>
          <a href="/stats/">Full evidence →</a>
        </header>
        ${
          this.unavailable && !feed
            ? html`<span role="status"
                >Stats feed unavailable—no value inferred.</span
              >`
            : nothing
        }
        ${
          metrics.length
            ? html`<div class="grid">
                  ${metrics.map(
                    (metric) =>
                      html`<article>
                        <strong
                          >${metric.available ? metric.value : "Unmeasured"}</strong
                        >
                        <span>${metric.label}</span>
                      </article>`,
                  )}
                </div>
                <span class=${stale ? "stale" : ""}>
                  ${stale ? "Feed is stale · " : ""}as of
                  ${new Date(feed!.generatedAt).toLocaleDateString()}
                </span>`
            : nothing
        }
      </section>
    `;
  }
}
