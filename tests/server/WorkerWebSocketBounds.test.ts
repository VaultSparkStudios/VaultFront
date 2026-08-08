import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../../src/server/Worker.ts"),
  "utf8",
);

describe("game WebSocket payload bound (S99 audit #172)", () => {
  test("the game socket sets maxPayload like its lobby/spectator siblings", () => {
    const wssDeclaration = source.match(
      /const wss = new WebSocketServer\(\{[\s\S]*?\}\);/u,
    );
    expect(wssDeclaration).not.toBeNull();
    expect(wssDeclaration?.[0]).toContain("maxPayload");
    expect(wssDeclaration?.[0]).toContain("LOBBY_WS_MAX_PAYLOAD_BYTES");
  });

  test("the payload bound is imported from the same authority as the lobby/spectator sockets", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*LOBBY_WS_MAX_PAYLOAD_BYTES[^}]*\}\s*from\s*"\.\/WorkerLobbyService"/u,
    );
  });
});
