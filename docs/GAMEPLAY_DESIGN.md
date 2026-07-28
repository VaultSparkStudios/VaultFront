# VaultFront Gameplay Design Reference

This document explains VaultFront's mechanics and reward intent. The executable
convoy tuning authority is `config/vaultfront-balance.v1.json`; the shared pure
formula is `src/core/execution/VaultFrontBalance.ts`; and every production build
self-verifies the deterministic grid published at `/balance-envelope.json`.

---

## Core loop summary

The canonical player-facing victory-loop copy lives in
`src/client/FirstExtractionQuest.ts → VAULTFRONT_VICTORY_LOOP`. Player surfaces
must reuse that authority rather than inventing a parallel explanation.

```
Vault site spawns on map
  └─ Player captures site (hold tile for 90 ticks / ~9s)
       └─ Convoy launches automatically toward player structure
            ├─ Player optionally reroutes or escorts convoy
            └─ Convoy delivers: player receives gold + troops
                 ├─ Vault Pressure advances
                 │    ├─ Deliveries 1–2: pressure builds
                 │    └─ Delivery 3: 90-second Breach Window opens
                 │         └─ Deliver once more before expiry → victory
                 └─ Site enters cooldown (650 ticks / ~65s)
                      └─ Site reopens → repeat
                           + Site also pays passive income every 600 ticks (~60s)
```

Player-facing summary: **Capture a vault, deliver or disrupt its convoy, build
Vault Pressure, then deliver during the Breach Window to win.**

### Vault Pressure victory

- Each delivered convoy advances its owner’s Vault Pressure.
- Three deliveries open a 900-tick (~90-second) Breach Window.
- One more delivery while that window is active wins the match.
- If the window expires, pressure falls to 2/3; the next delivery reopens it.
- Delivery, a successful shield/escort command, or an intercept all satisfy
  First Extraction’s introductory convoy-action step. Only deliveries advance
  Vault Pressure.

---

## Vault sites

| Constant                       | Value                       | Notes                                                                  |
| ------------------------------ | --------------------------- | ---------------------------------------------------------------------- |
| Sites per map                  | 2–5                         | `max(2, floor(landTiles / 180_000))` capped at 5                       |
| Min site spacing               | 35–varies                   | `max(35, floor(sqrt(landTiles) / 3))`                                  |
| Capture hold ticks             | 90                          | ~9 real-world seconds                                                  |
| Cooldown after capture         | 650 ticks                   | ~65s; 75% under Accelerated Cooldowns mutator                          |
| Early-reopen window            | `min(200, cooldown * 0.33)` | Enemy on tile skips remaining cooldown; next capture is reduced-reward |
| Reduced reward on early reopen | 0.72× reward scale          | Punishes the player who rushed an early recap                          |

### Passive income

| Constant                | Value                        |
| ----------------------- | ---------------------------- |
| Passive income interval | 600 ticks (~60s)             |
| Passive gold per tick   | 75,000 gold                  |
| Double Passive mutator  | 2× gold at half the interval |

Passive income accrues to `passiveOwnerID` — the last player who captured the
site — as long as they still own the site tile. If the tile changes hands,
passive income stops immediately.

---

## Convoys

A convoy launches automatically the moment a vault site capture completes.

### Travel time

```
travelTicks = clamp(floor(manhattanDistance / 2), 60, 320)
```

- Minimum: 60 ticks (6s)
- Maximum: 320 ticks (32s)

### Destination selection

Default: the player's preferred structure type (City by default, configurable
via reroute commands).

`reroute_safest` overrides the preference and picks the structure with the
lowest `routeRiskScore`, breaking ties by shortest distance.

---

## Reward formula

### Route risk score

Samples 9 equally-spaced points along the straight-line path from source to
destination. Counts how many are owned by hostile players:

```
routeRisk = hostileSamples / 9     (range: 0.0 – 1.0)
```

Under `lane_fog` mutator: `routeRisk = min(1, baseRisk + 0.08)`.

---

### Reward multiplier

```
rewardMultiplier = clamp(
  strengthMultiplier × phaseMultiplier × riskMultiplier × rewardScale,
  rewardMultiplierMin,   // 0.58
  rewardMultiplierMax    // 1.50
)
```

**strengthMultiplier** — rewards weaker players, taxes stronger ones:

```
ratio = playerStrength / avgStrength
strengthMultiplier = clamp(1.04 - (ratio - 1) × 0.34, 0.72, 1.22)
```

Where `playerStrength = tiles × 0.45 + troops × 0.35 + sqrt(gold) × 0.2`.

| Ratio (you vs avg)  | strengthMultiplier |
| ------------------- | ------------------ |
| 0.5 (much weaker)   | 1.22 (cap)         |
| 1.0 (average)       | 1.04               |
| 1.5 (much stronger) | 0.87               |
| 2.0                 | 0.72 (floor)       |

**phaseMultiplier** — bonus in early game, slight penalty late:

| Game phase          | phaseMultiplier |
| ------------------- | --------------- |
| < 4 min post-spawn  | 1.06            |
| 4–12 min post-spawn | 1.00            |
| > 12 min post-spawn | 0.97            |

**riskMultiplier** — rewards dangerous routes:

```
riskMultiplier = riskMultiplierBase + routeRisk × riskMultiplierScale
               = 0.88 + routeRisk × 0.50
```

| routeRisk          | riskMultiplier |
| ------------------ | -------------- |
| 0.0 (safe)         | 0.88           |
| 0.5                | 1.13           |
| 1.0 (full hostile) | 1.38           |

**rewardScale** — applied before the clamp. Set to `0.72` for reduced-reward
captures (early reopen). Modified by execution streak (×1.2 bonus).

---

### Gold reward

```
baselineGold = max(minGoldReward, floor(
  (ownerStrength × 360 + avgStrength × 280) × (0.90 + routeRisk × 0.30)
))

distanceGold = max(320, floor(
  (ownerStrength × 1.9 + 260) × (0.65 + routeRisk × 0.60)
))

goldReward = floor((baselineGold + distance × distanceGold) × rewardMultiplier)
```

`minGoldReward = 120,000` — floor protecting low-strength players.

---

### Troops reward

```
troopsReward = max(minTroopsReward, floor(
  (sqrt(max(1, baselineGold)) × 2.2 + distance × (4 + routeRisk × 6))
  × rewardMultiplier
))
```

`minTroopsReward = 900`.

---

## Escort mechanic

Duration: 600 ticks (460 under Accelerated Cooldowns mutator).

While escort is active, the player's convoys carry `escortShield = 1`. On
interception, the shield absorbs the first intercept — the convoy survives but
loses its shield. Only one shield per convoy.

---

## Beacon / Defense Factory

| Constant       | Value                                             |
| -------------- | ------------------------------------------------- |
| Charge cap     | 100                                               |
| Trigger cost   | 72 charge                                         |
| Pulse duration | 95 ticks (~9.5s)                                  |
| Pulse cooldown | 320 ticks (~32s); 75% under Accelerated Cooldowns |
| Initial charge | random 15–45 (seeded per player)                  |

A beacon pulse **masks** all nearby enemy defense factories for
`beaconPulseDurationTicks`. Masking prevents their charge from being visible
to the player.

---

## Jam Breaker

| Constant            | Value                                                     |
| ------------------- | --------------------------------------------------------- |
| Gold cost           | 115,000                                                   |
| Cooldown            | 900 ticks (~90s); 75% under Accelerated Cooldowns         |
| Mask clamp          | Clamps active mask to `ticks + 20` (effectively kills it) |
| Beacon charge drain | -20 per hostile beacon                                    |

---

## Comeback Surge

Activates when a player's `strengthRatio < 0.85` for 3,600 consecutive ticks
(6 minutes). Lasts 1,200 ticks (2 minutes).

| Bonus                        | Value                 |
| ---------------------------- | --------------------- |
| Vault capture gold bonus     | +65,000 gold          |
| Interception gold multiplier | ×1.3 (→ ~39,000 gold) |
| Interception troops bonus    | +650 troops           |

Resets `behindSinceTick` on each new surge activation.

---

## Execution Chain

A hidden 3-step combo that rewards coordinated play in a single time window
(`cleanExecutionChainWindowTicks = 1,500 ticks / 2.5 min`):

1. **Step 1:** Capture a vault → chain opens
2. **Step 2:** Deliver the resulting convoy → chain advances
3. **Step 3:** Trigger a Jam Breaker that denies an enemy pulse → chain
   completes → **next convoy rewards +20%**

The chain resets if any step times out or is done out of order.

---

## Squad Objective

When a vault is captured, a squad objective window opens for 520 ticks (~52s)
centered on the vault tile (radius: 30).

If a **second** allied player issues an escort or jam-breaker command within
the window and within radius, both players receive:

| Reward       | Value   |
| ------------ | ------- |
| Gold bonus   | +35,000 |
| Troops bonus | +450    |

---

## Weekly Mutators

| Mutator                 | Effect                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `lane_fog`              | Convoy launch, reroute, and escort activities hidden from the feed; routeRisk +0.08 flat                                                   |
| `accelerated_cooldowns` | Vault cooldown ×0.75 (min 260), beacon pulse cooldown ×0.75 (min 180), jam-breaker cooldown ×0.75 (min 480), escort duration capped at 460 |
| `double_passive`        | Passive income ×2, passive income interval ×0.5 (min 300)                                                                                  |

---

## Tuning guidance

When adjusting constants, consider these invariants:

- A solo player with average strength on a safe route should earn
  ~120,000–180,000 gold per convoy.
- A high-risk route (routeRisk ≈ 0.8) should reward ~30–40% more gold
  than a safe route at the same distance.
- Passive income (~75,000/min per vault) should be supplementary, not
  dominant. It should represent ~20–30% of a player's total vault income
  in a typical game.
- `strengthMultiplier` range (0.72–1.22) means the strongest player gets
  at most a 41% penalty relative to the weakest player — avoid widening
  this range without playtesting.
- `rewardMultiplierMax = 1.50` is the absolute ceiling. No combination of
  bonuses should consistently yield 2× baseline without an active combo.
