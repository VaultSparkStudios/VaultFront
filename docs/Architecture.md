# Game Architecture

The game is split into four components:

1. **client** - Handles rendering and UI for the user

2. **core** - Deterministic simulation. It is pure TypeScript/JavaScript code with no external dependencies. It must be fully deterministic.

3. **server** - Handles coordination and relays of intents/requests

4. **api** - A closed source Cloudflare Worker that handles auth, stats, game data storage, cosmetics, and monetization

## Simulation Architecture

The game simulation logic does not run on the server. Instead, each client runs their own instance of core, which is why it must be deterministic. At the end of each tick, data is sent from core to client via GameUpdates. Core and client run in different threads - the core runs in a worker thread.

## Intents

When a user performs an action, it creates an "Intent" which is sent to the server. The server stores all intents for that tick/turn, and at the end, relays all intents to all clients in a bundle called a "turn". Each client receives the turn and sends it to its core simulation. The core then creates an "Execution" for each intent. Executions are the only thing that can modify the game state.

## Flow

1. Client sends intent to game server
2. Game server sends turn to client
3. Client forwards turn to core
4. Core creates an execution for each intent
5. Core calls `executeNextTick()`
6. All executions run
7. At the end of the tick core sends updates to client
8. Client renders the updates

---

## VaultFront-specific architecture

See `docs/VAULTFRONT_SOURCE_MAP.md` for the full list of VaultFront-owned and
VaultFront-modified files.

### VaultFront module map

```
src/core/execution/
  VaultFrontExecution.ts          ← main vault loop (sites, convoys, beacons)
  VaultConvoyCommandExecution.ts  ← processes convoy command intents
  VaultRolePingExecution.ts       ← processes role ping intents

src/client/graphics/layers/
  VaultFrontLayer.ts              ← dedicated canvas layer for vault HUD
```

Key modified upstream files:

```
src/core/game/Game.ts             ← vault methods on the Game contract
src/core/game/GameUpdates.ts      ← VaultFrontStatus / VaultFrontActivity types
src/core/execution/NationExecution.ts  ← bot vault-command scheduling
src/client/graphics/layers/ControlPanel.ts     ← main HUD panel
src/client/graphics/layers/GameRightSidebar.ts ← vault activity feed
src/client/graphics/layers/WinModal.ts         ← post-match vault recap
```

### Game update flow

```
VaultFrontExecution.publishStatusUpdate()
  └─ game.addUpdate(VaultFrontStatus, { sites, convoys, beacons })
  └─ game.addUpdate(VaultFrontActivity, { activity, tile, ... })
       │  WebSocket frame
       ▼
ControlPanel.consumeVaultFrontUpdates()     ← renders HUD panel
GameRightSidebar.appendVaultFeed()          ← renders activity feed
VaultFrontLayer.tick()                      ← renders canvas overlay
```

### Deployment topology

```
Hetzner VPS (shared studio)
  └─ Traefik (TLS termination + routing by Host label)
       ├─ vaultfront.io, www.vaultfront.io  → vaultfront-prod-main
       └─ staging.vaultfront.io             → vaultfront-staging-staging

GitHub Pages (frontend stub / eventual client)
  └─ vaultsparkstudios.com/vaultfront/  → pages-stub/ (manual deploy-pages.yml)
```

Docker images are built by `build.sh`, pushed to GHCR, and deployed via
`deploy.sh` → `update.sh` over SSH.

### Reward formula (brief)

```
goldReward = (baselineGold + distance × distanceGold) × rewardMultiplier
rewardMultiplier = clamp(strengthMult × phaseMult × riskMult × rewardScale, 0.58, 1.50)
```

Full formula with all constants: `docs/GAMEPLAY_DESIGN.md`.
