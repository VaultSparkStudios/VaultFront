#!/usr/bin/env node
// check-protocol-skill-parity.mjs — S280 [audit #1]
//
// THE PROBLEM THIS EXISTS FOR
//
// `docs/SESSION_PROTOCOL.md` is canonical: it is what gets audited, quoted in
// canon, and propagated to 41 repos. But it is not what RUNS. What runs is a
// SKILL.md living outside any repo (`~/.claude/skills/...`, `~/.agents/skills/...`)
// with a git-tracked snapshot under `plugins/studio-os/skills/`. Nothing compared
// the two, so the executable copy could quietly drop a mandated gate and every
// surface would keep reporting health — the omission is invisible from inside the
// session that commits it.
//
// It had. Measured on 2026-08-13 during S280's own `/start`:
//   · `start-canon-sync.mjs` — the protocol calls it a mandatory gate and says
//     "never rely on an agent's remembered canon". Absent from ALL THREE copies of
//     studio-start. That session's `/start` skipped Canon+Ark reconciliation
//     outright, and `tier2-start-canon-sync.mjs` had been failing on exactly this
//     assertion, naming the defect precisely, while the suite red was carried as
//     background noise.
//   · `frontier-capability-radar.mjs` — CANON-049 and AGENTS.md both say "at every
//     /start". Absent. Doctor's `source-fingerprint-court` had drifted to 14.9 days
//     against a 7-day promise.
//
// WHY IT UNDER-REPORTS ON PURPOSE
//
// The first cut of this checker flagged every `scripts/*.mjs` a protocol section
// mentioned. It produced 39 findings, 34 of which were noise: `studio-closeout`
// legitimately delegates by section number ("write-back in canonical order
// (§3.1–3.5)") instead of naming each script, and a skill that points at the
// protocol is not a skill that skips it. Shipping that version would have created
// precisely the over-reporting lint that gets muted — and a muted lint is worse
// than no lint (S275).
//
// So the default is inverted. Only scripts REGISTERED as unconditional gates can
// produce a `gap`, and each registration cites the protocol line that makes it
// unconditional. Everything else the protocol names is reported as `unclassified`:
// not a defect, just an honest statement of what this checker has not been taught
// to rule on. Publishing that denominator is the point — a lint that hides its own
// blind spot is the thing it was built to catch.
//
// CANON-039 INTERNAL-FIRST — checked against the existing `protocol` domain before
// building, and `check-tool-duplication.mjs` flagged all seven of these on the first
// full run, which is the guard working as designed. Each was read, not waved off:
//   · `protocol-doctor.mjs` — the near miss, and the one worth stating precisely. Its
//     line 52 hashes `~/.claude/skills/<n>/SKILL.md` against `~/.agents/skills/<n>/SKILL.md`,
//     i.e. it asks "do the two live copies AGREE WITH EACH OTHER". It never opens
//     SESSION_PROTOCOL. That is orthogonal, not overlapping: in the S280 defect all
//     three copies were byte-identical AND all three were missing both gates, so a
//     copy-vs-copy check reports perfect health on exactly the failure this exists
//     to catch. Agreement is not conformance.
//   · `propagate-protocol-scripts.mjs` — ships protocol scripts to sibling repos; it
//     moves files, it does not evaluate whether a skill invokes them.
//   · `check-protocol-faq-freshness.mjs` — dates a derived FAQ artifact.
//   · `update-protocol-changelog.mjs` — appends protocol history.
//   · `render-protocol-biography.mjs` — narrative rendering of protocol evolution.
//   · `ask-protocol.mjs` — interactive Q&A lookup over protocol text.
//   · `check-mobile-parity.mjs` — collides only on the word "parity"; it is desktop↔
//     mobile UI (CANON-041) and shares no subject with this.
// No existing tool computes protocol-mandate → skill-coverage, so this is a new
// domain rather than a second producer of an existing number (CANON-031).
//
// Usage:
//   node scripts/check-protocol-skill-parity.mjs [--json]
// Exit 0 when every REGISTERED gate is present in every skill copy; 1 otherwise.
// `unclassified` never fails the run — it is coverage debt, reported not enforced.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROTOCOL = path.join(ROOT, "docs", "SESSION_PROTOCOL.md");

// Which protocol section governs which skill, and where that skill's copies live.
// `snapshot` is the only durable copy (the live ones vanish with the machine), so
// it is checked alongside them rather than trusted as a proxy.
const BINDINGS = [
  {
    section: "§1",
    heading: /^## §1 — /,
    skill: "studio-start",
    command: "/start",
  },
  {
    section: "§3",
    heading: /^## §3 — /,
    skill: "studio-closeout",
    command: "/closeout",
  },
];

// REGISTERED GATES — the only scripts whose absence is a defect.
//
// Each entry cites the protocol text that makes it unconditional. If you cannot
// write that citation, it does not belong here: an unjustified gate is how a lint
// starts asserting opinions instead of contracts.
const GATES = {
  "start-canon-sync": {
    section: "§1",
    because:
      'SESSION_PROTOCOL §1 step 2 (D-S259.5): "A stale/missing adoption posture or failed sync must be ' +
      "surfaced before work begins; never rely on an agent's remembered canon\" — reinforced at §1 hard rules: " +
      '"Every agent reconciles Studio Canon through start-canon-sync.mjs".',
  },
  "frontier-capability-radar": {
    section: "§1",
    because:
      'SESSION_PROTOCOL §1 step 2 (CANON-049): "This checks the machine radar every start" — and AGENTS.md ' +
      'restates it as "at every /start".',
  },
  "write-session-lock": {
    section: "§1",
    because:
      "SESSION_PROTOCOL §1 step 1 — the session lock is what makes cross-repo write safety and stale-session " +
      "detection possible; every downstream lock check reads a file only this writes.",
  },
  "context-meter": {
    section: "§1",
    because:
      'SESSION_PROTOCOL §1 hard rules: "Context-meter check runs before ANY file load. CLOSEOUT verdict = ' +
      'stop immediately, no exceptions."',
  },
  "check-secrets": {
    section: "§1",
    because:
      "SESSION_PROTOCOL §1 step 2 credentials-gateway health — CANON-019 forbids labelling anything blocked " +
      "before secrets discovery has run.",
  },
  // §3 gates — added S280 [SIL][S280 #1], closing the blind spot this checker
  // published about itself on its first run. Same bar as §1: each cites the
  // protocol text that makes it unconditional, and anything judgment-shaped
  // stays in EXEMPT rather than being promoted to look thorough.
  "scan-secrets": {
    section: "§3",
    because:
      'SESSION_PROTOCOL §3: "`node scripts/scan-secrets.mjs --staged`. Abort on any finding; fix before ' +
      'retry." An abort-on-finding step that does not run cannot abort.',
  },
  "closeout-autopilot": {
    section: "§3",
    because:
      "SESSION_PROTOCOL §3 — the autopilot performs the commit + push with no interactive gate (D-S177); " +
      "it carries the coherence commit gate, secret scan, and diff preview that are the closeout's safety net.",
  },
  "session-floor": {
    section: "§3",
    because:
      "SESSION_PROTOCOL §3 opens with `node scripts/session-floor.mjs --closeout-gate --shipped <N>` as an " +
      "explicit gate on whether the session may close at all.",
  },
  "render-state-vector": {
    section: "§3",
    because:
      "SESSION_PROTOCOL §3.6 intelligence refresh — listed unconditionally alongside doctor/entropy/genome, " +
      "with no conditional qualifier.",
  },
  "compute-entropy": {
    section: "§3",
    because:
      "SESSION_PROTOCOL §3.6 intelligence refresh — listed unconditionally.",
  },
  "append-genome-snapshot": {
    section: "§3",
    because:
      "SESSION_PROTOCOL §3.6 intelligence refresh — listed unconditionally; the genome series loses a point " +
      "permanently if a closeout skips it, and an append-only series cannot be backfilled honestly.",
  },
  "ignis-rescore-touched": {
    section: "§3",
    because:
      'SESSION_PROTOCOL §3: "Every closeout (S153 — auto-rescore on touch)" — the word is *every*, and the ' +
      "stated purpose is keeping coverage cumulative so the portfolio never re-ages.",
  },
  "validate-closeout-board-format": {
    section: "§3",
    because:
      "SESSION_PROTOCOL §3 — the rendered status board is validated via `--stdin` before it is published; " +
      "an unvalidated board is exactly the improvised-surface failure CANON-001/§3.7 exist to prevent.",
  },
};

// Declared exemptions — protocol-named scripts that are deliberately NOT gates.
// Each states WHY, because an unexplained exemption is indistinguishable from an
// oversight six months later.
const EXEMPT = {
  "session-beacon":
    'optional — AGENTS.md states the Hub beacon is "not required for normal operation"',
  "start-recovery-preflight":
    "conditional — recovery-only path, runs when a prior session was cut off",
  "install-git-window-guard":
    'conditional — Codex/CLI window-storm guard, marked "(Codex/CLI)" in the protocol',
  "render-startup-brief":
    "delegated — reached through check-brief-staleness, which re-renders on stale",
  "validate-brief-format":
    "delegated — reached through check-brief-staleness re-render+validate path",
  "compact-memory-index":
    "conditional — §1 step 5 memory remediation gate, fires only when memory/MEMORY.md exists",
  "run-doctor":
    "delegated — /start reads the doctor score from the brief; the full run belongs to /closeout",
  "detect-session-mode":
    "covered — named directly in the skill body; listed here so the denominator stays explicit",
  "compact-handoff": "covered — named directly in the skill body",
  // §3 exemptions — the honest half of [SIL][S280 #1]. These were NOT promoted to
  // gates just to drive the unruled count to zero; a registry padded to look
  // complete is the same lie as a lint that hides its blind spot.
  "render-closeout-checklist":
    'optional — SESSION_PROTOCOL §3 offers it as a "Token-lean entry" alternative to ' +
    'reading the section ("instead of re-reading this whole section"), and explicitly says to fall back to the ' +
    "full text on --check failure. An accelerator, not a gate.",
  "check-deploy-currency":
    "delegated — §3 mentions it as the producer behind doctor probe `deploy-currency`, which " +
    "the closeout already consults through the doctor run; the closeout step is writing an honest `Deploy:` field.",
  // Section-scoped by design: `context-meter` IS a §1 gate (see GATES) and reaches
  // this map only for §3, where its role is different.
  "context-meter":
    "suggestion-gate in §3 — it governs whether closeout should be SUGGESTED (CONSIDER_CLOSEOUT / " +
    "CLOSEOUT), not whether an invoked closeout may run. The skill is explicit that closeout is founder-invoked " +
    "and must never auto-invoke on context pressure, so requiring it as an execution gate would encode the " +
    "opposite rule. Remains an unconditional gate for §1.",
};

// S281 audit #3 — this checker propagates to every repo, so it must distinguish
// "a copy is missing" from "this repo was never supposed to hold that copy".
// The tracked snapshot lives ONLY in the control plane (studio-ops); a sibling
// has no plugins/studio-os tree by design. Reporting its absence as a gap would
// hand all 27 repos an unfixable red on the checker's first run — a propagated
// false positive is worse than no detector, because it teaches the fleet to
// ignore the probe. The live copies are machine-global and are checked everywhere.
function isControlPlane(root = ROOT) {
  return fs.existsSync(path.join(root, "plugins", "studio-os", "skills"));
}

function skillCopies(skill, { controlPlane = isControlPlane() } = {}) {
  const home = os.homedir();
  const copies = [
    {
      role: "claude-live",
      file: path.join(home, ".claude", "skills", skill, "SKILL.md"),
    },
    {
      role: "codex-live",
      file: path.join(home, ".agents", "skills", skill, "SKILL.md"),
    },
  ];
  if (controlPlane) {
    copies.push({
      role: "tracked-snapshot",
      file: path.join(
        ROOT,
        "plugins",
        "studio-os",
        "skills",
        skill,
        "SKILL.md",
      ),
    });
  }
  return copies;
}

function sectionBody(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Script basenames the protocol section actually instructs an agent to run. */
export function mandatedScripts(sectionText) {
  const found = new Set();
  for (const m of sectionText.matchAll(/scripts\/([a-z0-9][a-z0-9-]*)\.mjs/g))
    found.add(m[1]);
  return [...found].sort();
}

/**
 * A skill "covers" a script when it names it. The skill's own shorthand drops the
 * `scripts/` prefix on chained preflight commands (`· check-secrets --audit ·`), so
 * matching on the bare basename is what reflects real coverage — matching the full
 * path would manufacture findings for scripts that are plainly invoked.
 */
export function skillCovers(skillText, script) {
  return skillText.includes(script);
}

export function evaluate({
  protocolText,
  bindings = BINDINGS,
  readSkill,
  controlPlane = isControlPlane(),
}) {
  const results = [];
  for (const binding of bindings) {
    const body = sectionBody(protocolText, binding.heading);
    const mandated = mandatedScripts(body);
    for (const copy of skillCopies(binding.skill, { controlPlane })) {
      const text = readSkill(copy.file);
      if (text === null) {
        results.push({
          section: binding.section,
          skill: binding.skill,
          copy: copy.role,
          file: copy.file,
          script: null,
          status: "copy-missing",
          detail:
            "skill copy not found — cannot verify what this agent actually executes",
        });
        continue;
      }
      for (const script of mandated) {
        if (skillCovers(text, script)) continue;
        const gate = GATES[script];
        if (gate && gate.section === binding.section) {
          results.push({
            section: binding.section,
            skill: binding.skill,
            copy: copy.role,
            file: copy.file,
            script,
            status: "gap",
            because: gate.because,
            detail:
              `${binding.command} mandates scripts/${script}.mjs as an unconditional gate but this skill copy ` +
              "never names it — the agent executing this copy will silently skip it",
          });
          continue;
        }
        if (EXEMPT[script]) {
          results.push({
            section: binding.section,
            skill: binding.skill,
            copy: copy.role,
            script,
            status: "exempt",
            detail: EXEMPT[script],
          });
          continue;
        }
        // Neither ruled a gate nor ruled exempt. Reported, never enforced: this is
        // the checker stating what it has not been taught to judge.
        results.push({
          section: binding.section,
          skill: binding.skill,
          copy: copy.role,
          script,
          status: "unclassified",
          detail:
            `${binding.command} names scripts/${script}.mjs and this copy does not; no ruling exists on ` +
            "whether it is an unconditional gate. Classify it in GATES or EXEMPT.",
        });
      }
    }
  }
  const gaps = results.filter((r) => r.status === "gap");
  const missingCopies = results.filter((r) => r.status === "copy-missing");
  const exempt = results.filter((r) => r.status === "exempt");
  const unclassified = results.filter((r) => r.status === "unclassified");
  // Distinct script names, not per-copy rows — six copies of one unruled script is
  // one decision to make, and reporting it as six overstates the debt.
  const unclassifiedScripts = [
    ...new Set(unclassified.map((r) => `${r.section}:${r.script}`)),
  ].sort();
  return {
    ok: gaps.length === 0 && missingCopies.length === 0,
    gaps,
    exempt,
    unclassified,
    unclassifiedScripts,
    missingCopies,
    summary: {
      gapCount: gaps.length,
      exemptCount: exempt.length,
      missingCopyCount: missingCopies.length,
      // Published so a reader can tell "clean" from "checked almost nothing".
      registeredGates: Object.keys(GATES).length,
      unclassifiedScriptCount: unclassifiedScripts.length,
      // S281: derived from the copies actually inspected, never a hardcoded 3 —
      // outside the control plane there are two roles, and a count that claimed
      // three would overstate coverage in exactly the repos with the least of it.
      skillsChecked: bindings.reduce(
        (n, b) => n + skillCopies(b.skill, { controlPlane }).length,
        0,
      ),
      copyRoles: bindings.length
        ? skillCopies(bindings[0].skill, { controlPlane }).map((c) => c.role)
        : [],
      controlPlane,
    },
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const readSkill = (file) => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  };
  const report = evaluate({
    protocolText: fs.readFileSync(PROTOCOL, "utf8"),
    readSkill,
  });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      "Protocol ↔ skill parity (SESSION_PROTOCOL vs the SKILL.md that actually runs)",
    );
    console.log("─".repeat(72));
    if (report.ok) {
      console.log(
        `✓ every registered gate present · ${report.summary.registeredGates} gate(s) × ` +
          `${report.summary.skillsChecked} skill copies`,
      );
    } else {
      for (const c of report.missingCopies)
        console.log(`  ⛔ ${c.skill} [${c.copy}] — ${c.detail}`);
      for (const g of report.gaps) {
        console.log(
          `  ⛔ ${g.section} ${g.skill} [${g.copy}] · scripts/${g.script}.mjs — ${g.detail}`,
        );
        console.log(`       because: ${g.because}`);
      }
      console.log(
        `\n${report.summary.gapCount} gap(s) across ${report.summary.skillsChecked} skill copies.`,
      );
      console.log(
        "Fix by adding the gate to the skill body — in ALL copies (CANON-010 parity) — not by deleting it from the protocol.",
      );
    }
    // Always printed, pass or fail. The blind spot is part of the result.
    console.log(
      `\nCoverage: ${report.summary.registeredGates} registered gate(s) · ` +
        `${report.summary.exemptCount} exempt row(s) · ` +
        `${report.summary.unclassifiedScriptCount} protocol script(s) with NO ruling (reported, not enforced).`,
    );
    if (report.unclassifiedScripts.length) {
      console.log(`  unruled: ${report.unclassifiedScripts.join(", ")}`);
    }
  }
  process.exitCode = report.ok ? 0 : 1;
}
