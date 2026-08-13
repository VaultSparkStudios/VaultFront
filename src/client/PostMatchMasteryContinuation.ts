import type { Layer } from "./graphics/layers/Layer";

export const POST_MATCH_MASTERY_CONTINUE_EVENT =
  "vaultfront-mastery-rematch" as const;

export interface PostMatchMasteryContinuationDetail {
  sourceGameId: string;
  goal: string;
  evidence: string;
  doctrine: {
    id: string;
    name: string;
    role: string;
    brief: string;
    effectPolicy: "coaching-and-identity-only";
  } | null;
}

export interface PostMatchMasteryContinuationTarget {
  requestMasteryRematch(sourceGameId: string): void;
}

/** One match-scoped bridge into the existing participant-bound rematch owner. */
export class PostMatchMasteryContinuationCoordinator implements Layer {
  private active = false;
  private readonly handle = (event: Event) => {
    const detail = (event as CustomEvent<PostMatchMasteryContinuationDetail>)
      .detail;
    if (!detail?.sourceGameId) return;
    this.target.requestMasteryRematch(detail.sourceGameId);
  };

  constructor(
    private readonly source: EventTarget,
    private readonly target: PostMatchMasteryContinuationTarget,
  ) {}

  init(): void {
    if (this.active) return;
    this.active = true;
    this.source.addEventListener(
      POST_MATCH_MASTERY_CONTINUE_EVENT,
      this.handle,
    );
  }

  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.source.removeEventListener(
      POST_MATCH_MASTERY_CONTINUE_EVENT,
      this.handle,
    );
  }
}
