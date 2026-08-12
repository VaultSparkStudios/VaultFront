import {
  attachCertifiedLoopAlphaEvidence,
  type VaultFrontPlaytestPulseSummary,
} from "./VaultFrontPlaytestPulse";

export interface PlaytestSummaryServiceOptions {
  now?: () => number;
  ttlMs?: number;
  loadPulse: () => Promise<VaultFrontPlaytestPulseSummary>;
  loadCertified: (
    observedAt: number,
  ) => Promise<Parameters<typeof attachCertifiedLoopAlphaEvidence>[1]>;
}

export class PlaytestSummaryService {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly loadPulse: () => Promise<VaultFrontPlaytestPulseSummary>;
  private readonly loadCertified: PlaytestSummaryServiceOptions["loadCertified"];
  private cached: {
    expiresAt: number;
    value: VaultFrontPlaytestPulseSummary;
  } | null = null;
  private inFlight: Promise<VaultFrontPlaytestPulseSummary> | null = null;

  constructor(options: PlaytestSummaryServiceOptions) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 5_000;
    this.loadPulse = options.loadPulse;
    this.loadCertified = options.loadCertified;
  }

  invalidate(): void {
    this.cached = null;
  }

  async summary(): Promise<VaultFrontPlaytestPulseSummary> {
    const now = this.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.value;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      const pulse = await this.loadPulse();
      const certified = await this.loadCertified(now);
      const value = attachCertifiedLoopAlphaEvidence(pulse, certified, now);
      this.cached = { expiresAt: now + this.ttlMs, value };
      return value;
    })();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }
}
