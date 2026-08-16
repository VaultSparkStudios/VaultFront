export interface FortuneAwardReceipt {
  schemaVersion: 1;
  kind: "vaultfront-certified-fortune-award";
  persistentId: string;
  matchId: string;
  certificateId: string;
  itemId: string;
  digest: string;
}

export interface CertifiedFortuneAwardResponse<TItem> {
  item: TItem;
  alreadyOwned: boolean;
  receipt: FortuneAwardReceipt;
}
