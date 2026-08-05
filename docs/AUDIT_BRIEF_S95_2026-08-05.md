```
╔═════════════════════════════════════════════════════════════════════════════════════════════╗
║  STUDIO OPS · AUDIT PRIORITY BRIEF                                                            ║
║  Session S95 · 2026-08-05 · agent: codex · repo: vaultfront                                   ║
╠═════════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                               ║
║  HEADLINE                                                                                     ║
║    Six live-code defects survived premise verification after the recovery ledger was          ║
║    exhausted.                                                                                 ║
║                                                                                               ║
║  COMBINED PRIORITY  ███████▌░░   75/100                                                       ║
║  INNOVATION DENSITY ██████▌░░░   67/100                                                       ║
║  VERIFIED TESTS     1165/1165                                                                 ║
║  REJECTED PREMISES  29                                                                        ║
║  EXTERNAL RELEASE   NO-GO                                                                     ║
║                                                                                               ║
╚═════════════════════════════════════════════════════════════════════════════════════════════╝

  ITEMS                                                       (sorted: left × right)
  ───────────────────────────────────────────────────────────────────────────────────────────

  [#147]  asset-aware-secret-signal                               COMB 8  ·  INNO 8
         ── security ────────────────────────────────────────────────────────────────────────
         The canonical full-tree scan emits 1,974 findings, all low-confidence matches inside
         existing base64 SVG, flag, cosmetic, and copied static assets, with zero medium/high
         findings. A signal this noisy is unusable for sanitization review and can hide the
         one real credential that matters.
         → scripts/scan-secrets.mjs; full-tree classification 1974 low / 0 medium-high

  [#149]  bounded-identity-introspection                          COMB 8  ·  INNO 7
         ── security ────────────────────────────────────────────────────────────────────────
         getUserMe directly awaits the issuer users/@me fetch with no deadline, abort signal,
         or focused test coverage. A slow or wedged identity provider can hold WebSocket
         admission indefinitely even though every subsequent authorization branch waits on
         this result.
         → src/server/jwt.ts; coverage 0%; src/server/Worker.ts admission awaits getUserMe

  [#145]  project-local-skill-bridge                              COMB 8  ·  INNO 7
         ── speed ───────────────────────────────────────────────────────────────────────────
         Both studio-start and audit required project-local skill-profile and sample-codebase
         commands, but each failed with MODULE_NOT_FOUND in the fresh Session 95 preflight
         even though the canonical implementations exist in Studio Ops. The missing bridge
         forces manual fallbacks and silently drops medium-specific success bars.
         → Session 95 MODULE_NOT_FOUND preflights; scripts/lib/control-plane-tool.mjs

  [#148]  retire-public-obelisk-broker-copy                       COMB 9  ·  INNO 6
         ── security ────────────────────────────────────────────────────────────────────────
         scripts/lib/obelisk-broker.mjs is tracked, unused, and copied from Studio Ops. It
         references private portfolio policy, receipt paths, grant issuer keys, and operator
         trust semantics that do not belong in this public deployable repository; the
         canonical filename sanitizer does not currently recognize this code-level boundary
         leak.
         → scripts/lib/obelisk-broker.mjs; rg found zero consumers

  [#146]  idempotent-doctor-closeout-format                       COMB 7  ·  INNO 6
         ── speed ───────────────────────────────────────────────────────────────────────────
         project-doctor writes audits/doctor-latest.json with JSON.stringify formatting,
         while closeout-autopilot formats only STARTUP_BRIEF and PROJECT_STATUS before
         staging. The pre-commit hook then rewrites the sidecar, so every closeout starts
         with avoidable byte churn and the closeout runner violates the Session 92 decision
         that it formats every generated truth surface itself.
         → scripts/closeout-autopilot.mjs; audits/doctor-latest.json

  [#150]  single-owner-static-assets                              COMB 5  ·  INNO 6
         ── speed ───────────────────────────────────────────────────────────────────────────
         The production and browser-proof builds emit thousands of warnings because resources
         is simultaneously Vite publicDir and an import source. The config comment claims
         public assets may be imported, but Vite explicitly rejects that ownership model;
         real warnings are buried under repeated path guidance.
         → vite.config.ts; production/E2E publicDir warning flood

  ───────────────────────────────────────────────────────────────────────────────────────────

  FOLLOW-UPS
    • Implement all six in descending risk/compounding order.
    • Re-run coverage, production build, warning capture, sanitizer, and rendered-pixel proof.

  BLOCKERS
    (none)

```

---

_Generated by `scripts/lib/skill-brief.mjs` · spec: `docs/SKILL_BRIEF_SPEC.md`_
