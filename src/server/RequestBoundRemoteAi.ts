import type Anthropic from "@anthropic-ai/sdk";
import type { Response } from "express";
import { createHash } from "node:crypto";
import { executeReservedRemoteAiCall } from "./RemoteAiPolicy";

export async function executeRequestBoundAi<T>(
  response: Response,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const abortDisconnectedRequest = () => {
    if (!response.writableEnded) {
      controller.abort(new Error("remote-ai-client-disconnected"));
    }
  };
  response.once("close", abortDisconnectedRequest);
  try {
    return await executeReservedRemoteAiCall(
      operation,
      timeoutMs,
      controller.signal,
    );
  } finally {
    response.removeListener("close", abortDisconnectedRequest);
  }
}

export function boundedProviderText(
  message: Anthropic.Message,
  maxChars: number,
  feature: string,
): string {
  const text =
    message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
  if (!text || text.length > maxChars) {
    throw new Error(`${feature}-provider-output-outside-bounds`);
  }
  return text;
}

export function buildProphecyCacheKey(
  mapName: unknown,
  playerCount: number,
  mutator: unknown,
): string {
  const pcBucket = playerCount <= 2 ? "2" : playerCount <= 4 ? "4" : "8+";
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        mapName: String(mapName).slice(0, 64),
        pcBucket,
        mutator: String(mutator).slice(0, 64),
      }),
    )
    .digest("hex");
  return `prophecy:${digest}`;
}
