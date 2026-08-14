/**
 * model-router.mjs
 *
 * Centralised Claude model selection for all Studio Ops scripts.
 * Prevents hardcoded model IDs scattered across scripts and enables
 * studio-wide model upgrades in one place.
 *
 * Rules:
 *   COMPLEX  → claude-opus-4-8    (strategy, deep analysis, extended thinking)
 *   MODERATE → claude-sonnet-5    (implementation, code, Q&A, most work — 1M ctx,
 *                                  $2/$10 intro through 2026-08-31, then $3/$15)
 *   SIMPLE   → claude-haiku-4-5-20251001  (validations, lookups, quick checks)
 *
 * Model currency (verified 2026-07-01, S219 — docs/FRONTIER_CAPABILITIES_2026-07.md):
 *   Sonnet 5 launched 2026-06-30 (1M ctx native, default in Claude Code).
 *   Retired/retiring: Sonnet 4 + Opus 4 (retired 2026-06-15) · Opus 4.1 (2026-08-05).
 *
 * Usage:
 *   import { selectModel, MODELS, buildCacheHeaders } from './lib/model-router.mjs';
 *   const model = selectModel('complex');
 *
 * This file is the SINGLE allowed chokepoint for Anthropic API access.
 * The `studio-os-enforcer.yml` CI workflow greps `scripts/` for direct
 * `api.anthropic.com` / `@anthropic-ai/sdk` / hardcoded claude-* model IDs
 * and fails the build if they appear in any file other than this one.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { classifyTurn as _classifyTurn } from "./turn-classifier.mjs";

// S121 G3: file-based active-skill fallback for cross-process attribution.
function readActiveSkillFile() {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const cache = path.resolve(
      __dirname,
      "..",
      "..",
      ".cache",
      "active-skill.json",
    );
    const j = JSON.parse(fs.readFileSync(cache, "utf8"));
    if (j.skill && Date.now() - new Date(j.at).getTime() < 2 * 60 * 60 * 1000)
      return j.skill;
  } catch {}
  return null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_DEFAULT = path.resolve(
  __dirname,
  "..",
  "..",
  "docs",
  "cache-ledger.ndjson",
);

export const MODELS = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
};

/**
 * S244 (D-S244.3) — models that run ADAPTIVE thinking when the `thinking`
 * param is omitted (a silent default change with the sonnet-5 tier). Small
 * extraction-style requests on these models must disable thinking explicitly,
 * or the whole max_tokens budget can burn inside thinking blocks and return
 * ZERO text (stop_reason max_tokens) — 16/23 of the S244 genius batch failed
 * exactly this way. Fable/Mythos tier is adaptive-ALWAYS but rejects an
 * explicit disabled with a 400 — never route it through this predicate.
 * Model-behavior knowledge lives HERE (the chokepoint), never in callers.
 */
export function adaptiveThinkingByDefault(model) {
  return String(model || "").startsWith("claude-sonnet-5");
}

/**
 * Context window sizes (tokens), keyed by resolved model ID or agent name.
 * Kept here — alongside MODELS — so the chokepoint remains the single place
 * that knows anything model-specific. Consumers (e.g. scripts/context-meter.mjs)
 * import this instead of hardcoding their own map.
 */
export const CONTEXT_WINDOWS = {
  [MODELS.opus]: 1_000_000, // Opus 4.8: 1M ctx (verified 2026-07-01)
  [MODELS.sonnet]: 1_000_000, // Sonnet 5: 1M ctx native (verified 2026-07-01)
  [MODELS.haiku]: 200_000,
  "opus-1m": 1_000_000,
  // Codex CLI 0.144.6 corrected GPT-5.6 Sol/Terra/Luna context metadata to
  // 272K (official changelog, 2026-07-18). Keep this provider-specific: a
  // Claude extended-context setting must never silently recalibrate Codex.
  "codex-272k": 272_000,
  default: 200_000,
};

export function contextWindowForAgent(agent) {
  // Studio Ops founder runs Opus 4.8 (1M context) exclusively across Claude Code sessions.
  // Set CLAUDE_CONTEXT_LIMIT=200000 to pin to the legacy 200K window.
  if (agent === "claude-code") {
    if (process.env.CLAUDE_CONTEXT_LIMIT)
      return parseInt(process.env.CLAUDE_CONTEXT_LIMIT, 10);
    return CONTEXT_WINDOWS["opus-1m"];
  }
  if (agent === "codex") {
    if (process.env.CODEX_CONTEXT_LIMIT)
      return parseInt(process.env.CODEX_CONTEXT_LIMIT, 10);
    return CONTEXT_WINDOWS["codex-272k"];
  }
  return CONTEXT_WINDOWS.default;
}

/**
 * Anthropic list-price per 1M tokens, keyed by resolved model ID.
 * Kept here — alongside MODELS — so the chokepoint remains the single place
 * in scripts/ that references claude-* model IDs verbatim.
 */
// Sonnet 5 intro pricing ($2/$10) runs through 2026-08-31; list price after is $3/$15.
// Date-aware so the ledger never silently overstates or understates (CANON-031).
const SONNET5_INTRO_ENDS = Date.UTC(2026, 7, 31, 23, 59, 59); // 2026-08-31 UTC
const SONNET5_PRICE =
  Date.now() <= SONNET5_INTRO_ENDS
    ? { input: 2.0, cacheWrite: 2.5, cacheRead: 0.2, output: 10.0 }
    : { input: 3.0, cacheWrite: 3.75, cacheRead: 0.3, output: 15.0 };

export const PRICING_PER_MTOK = {
  [MODELS.opus]: { input: 5.0, cacheWrite: 6.25, cacheRead: 0.5, output: 25.0 }, // Opus 4.8 (verified 2026-07-01)
  [MODELS.sonnet]: SONNET5_PRICE,
  [MODELS.haiku]: { input: 1.0, cacheWrite: 1.25, cacheRead: 0.1, output: 5.0 },
};

// Exact-prefix per-generation overrides (single source of truth — consumers use
// priceForModel(), never their own tables). Legacy generations keep their own price.
export const PRICING_BY_ID = {
  "claude-fable-5": {
    input: 10.0,
    cacheWrite: 12.5,
    cacheRead: 1.0,
    output: 50.0,
  },
  "claude-opus-4-8": PRICING_PER_MTOK[MODELS.opus],
  "claude-opus-4-1": {
    input: 15.0,
    cacheWrite: 18.75,
    cacheRead: 1.5,
    output: 75.0,
  }, // retires 2026-08-05
  "claude-sonnet-5": PRICING_PER_MTOK[MODELS.sonnet],
  "claude-sonnet-4-6": {
    input: 3.0,
    cacheWrite: 3.75,
    cacheRead: 0.3,
    output: 15.0,
  },
  "claude-haiku-4-5": PRICING_PER_MTOK[MODELS.haiku],
};

/** Resolve price for any model ID: exact-prefix override first, tier substring fallback. */
export function priceForModel(modelId) {
  if (!modelId) return PRICING_PER_MTOK[MODELS.sonnet];
  for (const [prefix, p] of Object.entries(PRICING_BY_ID)) {
    if (modelId.startsWith(prefix)) return p;
  }
  if (modelId.includes("fable")) return PRICING_BY_ID["claude-fable-5"];
  if (modelId.includes("opus")) return PRICING_PER_MTOK[MODELS.opus];
  if (modelId.includes("haiku")) return PRICING_PER_MTOK[MODELS.haiku];
  return PRICING_PER_MTOK[MODELS.sonnet];
}

// Batch API pricing: 50% discount on input/output (cache pricing unchanged)
export const BATCH_PRICING_PER_MTOK = Object.fromEntries(
  Object.entries(PRICING_PER_MTOK).map(([model, p]) => [
    model,
    { ...p, input: p.input * 0.5, output: p.output * 0.5 },
  ]),
);
export const FALLBACK_PRICE = PRICING_PER_MTOK[MODELS.sonnet];

/**
 * Short human-friendly name for a model ID ("opus" / "sonnet" / "haiku").
 */
export function shortModelName(id) {
  if (id?.startsWith("claude-opus")) return "opus";
  if (id?.startsWith("claude-sonnet")) return "sonnet";
  if (id?.startsWith("claude-haiku")) return "haiku";
  return id || "unknown";
}

/**
 * Select model by task complexity tier.
 * @param {'complex'|'moderate'|'simple'} complexity
 * @returns {string} model ID
 */
export function selectModel(complexity = "moderate") {
  switch (complexity) {
    case "complex":
      return MODELS.opus;
    case "moderate":
      return MODELS.sonnet;
    case "simple":
      return MODELS.haiku;
    default:
      return MODELS.sonnet;
  }
}

/**
 * Infer complexity from question/task text.
 * @param {string} text
 * @returns {'complex'|'moderate'|'simple'}
 */
export function inferComplexity(text) {
  const lower = text.toLowerCase();
  if (
    /\b(design|architect|strategy|refactor|plan|analyse|analyze|review|compare|synthesize|cross-project|portfolio|predict)\b/.test(
      lower,
    )
  ) {
    return "complex";
  }
  if (
    /\b(validate|check|verify|status|list|count|is there|does it|find|show)\b/.test(
      lower,
    )
  ) {
    return "simple";
  }
  return "moderate";
}

/**
 * Build extended thinking config for Opus calls.
 * @param {number} budgetTokens — max thinking tokens (default 8000)
 * @returns {object} thinking config block
 */
export function buildThinkingConfig(budgetTokens = 8000) {
  return { type: "enabled", budget_tokens: budgetTokens };
}

/**
 * Add cache_control to a content block (for prompt caching).
 * Minimum cacheable block is 1024 tokens. Mark the LAST large block in a
 * multi-block system prompt to cache everything up to and including it.
 *
 * @param {object} block - message content block
 * @param {object} [opts]
 * @param {'5m'|'1h'} [opts.ttl='5m'] - cache TTL; 1h uses extended-cache-ttl beta
 * @returns {object} block with cache_control added
 */
export function withCache(block, opts = {}) {
  const ttl = opts.ttl || "5m";
  const cc =
    ttl === "1h" ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
  return { ...block, cache_control: cc };
}

/**
 * Shorthand for 1-hour cached blocks (stable context that rarely changes).
 */
export function withLongCache(block) {
  return withCache(block, { ttl: "1h" });
}

/**
 * Build standard API request headers (no SDK required).
 * @param {string} apiKey
 * @param {object} [opts]
 * @param {boolean} [opts.useThinking=false]   - interleaved-thinking-2025-05-14
 * @param {boolean} [opts.longCache=false]     - extended-cache-ttl-2025-04-11
 * @param {boolean} [opts.files=false]         - files-api-2025-04-14
 * @param {boolean} [opts.compaction=false]    - compact-2026-01-12 (G5)
 * @param {boolean} [opts.contextEditing=false]- context-management-2025-06-27 (G9)
 * @param {boolean} [opts.mcpServers=false]    - mcp-client-2025-11-20 (G2)
 * @param {boolean} [opts.managedAgents=false] - managed-agents-2026-04-01
 * @returns {object} headers
 */
export function buildHeaders(apiKey, opts = {}) {
  const {
    useThinking = false,
    longCache = false,
    files = false,
    compaction = false,
    contextEditing = false,
    mcpServers = false,
    managedAgents = false,
    // S114 additions
    memory = false,
    citations = false,
    webSearch = false,
    codeExecution = false,
    outputConfig = false,
  } = opts;
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
  const betas = [];
  if (useThinking) betas.push("interleaved-thinking-2025-05-14");
  if (longCache) betas.push("extended-cache-ttl-2025-04-11");
  if (files) betas.push("files-api-2025-04-14");
  if (compaction) betas.push("compact-2026-01-12");
  if (contextEditing) betas.push("context-management-2025-06-27");
  if (mcpServers) betas.push("mcp-client-2025-11-20");
  if (managedAgents) betas.push("managed-agents-2026-04-01");
  // S114 betas
  if (memory) betas.push("context-management-2025-06-27"); // memory tool ships under context-management beta
  if (citations) betas.push("citations-2025-04-01");
  if (webSearch) betas.push("web-search-2025-03-13");
  if (codeExecution) betas.push("code-execution-2025-05-22");
  if (outputConfig) betas.push("output-config-2025-02-19");
  if (betas.length) headers["anthropic-beta"] = [...new Set(betas)].join(",");
  return headers;
}

/**
 * G5 — Build a server-side compaction config block for long-running calls.
 * The Compaction API (beta `compact-2026-01-12`) summarises older turns when
 * the input window crosses `triggerTokens`. Replaces our handoff-trim heuristic
 * for `/go` passes and any multi-step agent loop.
 *
 * Only effective on Opus 4.6 / 4.7 + Sonnet 4.6. No-op on other models.
 *
 * @param {object} [opts]
 * @param {number} [opts.triggerTokens=50000] - min input tokens before compaction triggers (>=50k required)
 * @param {string} [opts.strategy='compact_20260112'] - server strategy identifier
 * @returns {{ context_management: object }} request-body fragment to spread into the call body
 */
export function buildCompactionConfig({
  triggerTokens = 50_000,
  strategy = "compact_20260112",
} = {}) {
  return {
    context_management: {
      edits: [
        {
          type: strategy,
          trigger: {
            type: "input_tokens",
            value: Math.max(50_000, triggerTokens),
          },
        },
      ],
    },
  };
}

/**
 * G9 — Build a context-editing config block.
 * Selectively clears tool_use / tool_result / thinking blocks from older turns
 * to keep the working window fresh on probe-heavy scripts (doctor, IGNIS rescore,
 * audit sweeps) without losing system prompt or recent messages.
 *
 * Pairs with the `context-management-2025-06-27` beta header (set via
 * `buildHeaders({ contextEditing: true })`).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.clearToolUses=true]  - clear_tool_uses_20250919
 * @param {boolean} [opts.clearThinking=true]  - clear_thinking_20251015
 * @param {number}  [opts.keepLast=4]          - preserve N most-recent turns intact
 * @returns {{ context_management: object }} request-body fragment to spread into the call body
 */
export function buildContextEditingConfig({
  clearToolUses = true,
  clearThinking = true,
  keepLast = 4,
} = {}) {
  const edits = [];
  if (clearToolUses)
    edits.push({
      type: "clear_tool_uses_20250919",
      keep: { type: "turns", value: keepLast },
    });
  if (clearThinking)
    edits.push({
      type: "clear_thinking_20251015",
      keep: { type: "turns", value: keepLast },
    });
  return { context_management: { edits } };
}

/**
 * G1 — Build a Managed-Agents Outcome rubric for a unit of work.
 *
 * The Outcomes API (public beta May 6 2026, managed-agents-2026-04-01) runs a
 * separate Claude grader against the agent's final output, with the rubric as
 * its evaluation prompt. On failure the grader's feedback loops back to the
 * agent for another attempt.
 *
 * This is the canonical Anthropic surface for "success criteria" / "goals" on
 * agent work. We use it to wrap each genius-list item with a measurable rubric
 * that /go can pass when invoking an Outcomes-aware managed-agent session.
 *
 * @param {object} args
 * @param {string} args.title            - short identifier (e.g. genius-list item title)
 * @param {string} args.intent           - one-line description of what success looks like
 * @param {string[]} [args.successCriteria=[]] - bullet criteria the grader must verify
 * @param {string[]} [args.disallow=[]]  - explicit anti-patterns the grader must reject
 * @param {number} [args.maxAttempts=2]  - retry budget before giving up
 * @param {string} [args.graderModel]    - override grader model (defaults to Sonnet 4.6)
 * @returns {{ outcome: object }} request-body fragment for managed-agents session.create
 */
export function buildOutcome({
  title,
  intent,
  successCriteria = [],
  disallow = [],
  maxAttempts = 2,
  graderModel,
} = {}) {
  const rubricLines = [];
  rubricLines.push(`# Success rubric — ${title}`);
  rubricLines.push("");
  rubricLines.push(`## Intent`);
  rubricLines.push(intent || "(unspecified)");
  if (successCriteria.length) {
    rubricLines.push("");
    rubricLines.push(`## Must satisfy ALL`);
    for (const c of successCriteria) rubricLines.push(`- ${c}`);
  }
  if (disallow.length) {
    rubricLines.push("");
    rubricLines.push(`## Must NOT do`);
    for (const d of disallow) rubricLines.push(`- ${d}`);
  }
  rubricLines.push("");
  rubricLines.push(`## Verdict`);
  rubricLines.push(
    `Emit exactly one of: PASS, FAIL, NEEDS_REVISION — followed by 1-3 sentences of evidence.`,
  );
  return {
    outcome: {
      name: title,
      max_attempts: maxAttempts,
      evaluator: {
        model: graderModel || MODELS.sonnet,
        rubric: rubricLines.join("\n"),
      },
    },
  };
}

/**
 * G2 — Build the `mcp_servers` API param for remote MCP without a local client.
 * Anthropic forwards tool calls to the remote MCP server with OAuth token
 * refresh handled server-side; credentials live in the Anthropic vault.
 *
 * Pairs with the `mcp-client-2025-11-20` beta header (set via
 * `buildHeaders({ mcpServers: true })`).
 *
 * @param {Array<{name:string,url:string,vaultId?:string,authToken?:string,toolAllowlist?:string[]}>} servers
 * @returns {{ mcp_servers: object[] }} request-body fragment
 */
// ─────────────────────────────────────────────────────────────────────────────
// S114 — Anthropic capability builders (Files API · Memory tool · Citations · Web Search · Code Execution)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S114 G11 — Build a content block referencing an uploaded file by ID.
 * Use with Files API beta. Upload via `uploadFile()` (separate helper)
 * or pre-upload manually; pass file_id here.
 *
 * @param {string} fileId - id returned by Files API upload (file_*)
 * @param {string} [type='document'] - 'document' | 'image' | 'container_upload'
 * @returns {object} content block to push into messages[].content[]
 */
export function fileBlock(fileId, type = "document") {
  return { type, source: { type: "file", file_id: fileId } };
}

/**
 * S114 G12 — Build a memory tool definition for the request body.
 * Beta `context-management-2025-06-27`. The model can call `memory_*` tools
 * to persist between turns. Storage is per-agent; agent supplies a memory
 * backend via tool-result.
 *
 * @returns {object} tool definition to push into body.tools[]
 */
export function memoryTool() {
  return {
    type: "memory_20250818",
    name: "memory",
  };
}

/**
 * S114 G13 — Build a citations request fragment. When enabled, document
 * blocks gain `citations: { enabled: true }` and the model's text output
 * contains citation references back to the source documents.
 *
 * @param {Array} documents - array of {fileId|source, title?}
 * @returns {object[]} content blocks ready to push into messages[0].content[]
 */
export function citedDocuments(documents) {
  if (!Array.isArray(documents) || documents.length === 0) return [];
  return documents.map((d) => ({
    type: "document",
    source: d.fileId
      ? { type: "file", file_id: d.fileId }
      : d.source || {
          type: "text",
          media_type: "text/plain",
          data: d.text || "",
        },
    title: d.title,
    citations: { enabled: true },
  }));
}

/**
 * S114 G14 — Build a web_search server-side tool block.
 * Beta `web-search-2025-03-13`. Model can issue queries; results are
 * fetched server-side and returned as tool_result content blocks.
 *
 * @param {object} [opts]
 * @param {number} [opts.maxUses=5] - max number of search queries per turn
 * @param {Array<string>} [opts.allowedDomains] - allowlist; if set, only these domains return results
 * @param {Array<string>} [opts.blockedDomains] - denylist
 * @returns {object} tool definition for body.tools[]
 */
export function webSearchTool({
  maxUses = 5,
  allowedDomains,
  blockedDomains,
} = {}) {
  const tool = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: maxUses,
  };
  if (allowedDomains) tool.allowed_domains = allowedDomains;
  if (blockedDomains) tool.blocked_domains = blockedDomains;
  return tool;
}

/**
 * S114 G15 — Build a code_execution server-side tool block.
 * Beta `code-execution-2025-05-22`. Python sandbox attached to a container.
 * Returns tool_result with stdout/stderr/file outputs.
 *
 * @returns {object} tool definition for body.tools[]
 */
export function codeExecutionTool() {
  return {
    type: "code_execution_20250825",
    name: "code_execution",
  };
}

export function buildMcpServers(servers) {
  if (!Array.isArray(servers) || servers.length === 0) return {};
  return {
    mcp_servers: servers.map((s) => {
      const entry = { type: "url", url: s.url, name: s.name };
      if (s.vaultId) entry.authorization_token = { vault_id: s.vaultId };
      else if (s.authToken)
        entry.authorization_token = { type: "bearer", token: s.authToken };
      if (Array.isArray(s.toolAllowlist) && s.toolAllowlist.length) {
        entry.tool_configuration = { allowed_tools: s.toolAllowlist };
      }
      return entry;
    }),
  };
}

/**
 * Make a Claude API messages call via raw https (no SDK dependency).
 * Returns the parsed response or throws on error.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {number} opts.maxTokens
 * @param {string|Array} opts.system
 * @param {Array} opts.messages
 * @param {object} [opts.thinking] - extended thinking config
 * @param {boolean|object} [opts.compaction]   - true → defaults, or buildCompactionConfig() result (G5)
 * @param {boolean|object} [opts.contextEditing] - true → defaults, or buildContextEditingConfig() result (G9)
 * @param {Array} [opts.mcpServers] - array of {name,url,vaultId|authToken,toolAllowlist} (G2)
 * @param {string} [opts.cachePrefix] - S178: stable canon/system prefix to prompt-cache.
 *   When set, it is prepended to `system` as a cache_control'd text block (the stable
 *   prefix is cached; any string `system` becomes a non-cached per-call tail). Use for
 *   the byte-identical canon/rubric preamble shared across many calls (~90% input savings
 *   on repeat). `cachePrefixTtl` ('5m'|'1h', default '1h') picks the cache window.
 * @param {'5m'|'1h'} [opts.cachePrefixTtl='1h']
 * @param {boolean|object} [opts.memory=false] - S178: enable the native memory tool
 *   (memory_20250818, ships under context-management beta). true → default tool def;
 *   object → reserved for future per-tool config. No-op for callers that don't set it.
 * @returns {Promise<object>} parsed API response
 */
export function callClaude(
  {
    apiKey,
    model,
    maxTokens,
    system,
    messages,
    thinking,
    longCache = false,
    logAs = null,
    compaction = false,
    contextEditing = false,
    mcpServers = null,
    tools = null,
    memory = false,
    citations = false,
    webSearch = false,
    codeExecution = false,
    outputConfig = false,
    files = false,
    turnClassify = true,
    cachePrefix = null,
    cachePrefixTtl = "1h",
  },
  httpsModule,
) {
  // S120 #3 — turn-classifier wire (SIL #612). Auto-route haiku-able turns
  // to haiku when classifier confidently identifies pure transform/short
  // transactional work. Caller can disable with turnClassify:false.
  let routedModel = model;
  let classifyTag = null;
  if (turnClassify && process.env.TURN_CLASSIFY_DISABLED !== "1") {
    try {
      const lastUserMsg = Array.isArray(messages)
        ? messages.filter((m) => m.role === "user").slice(-1)[0]
        : null;
      const prompt = lastUserMsg
        ? typeof lastUserMsg.content === "string"
          ? lastUserMsg.content
          : JSON.stringify(lastUserMsg.content)
        : system || "";
      const verdict = _classifyTurn({ prompt });
      if (verdict.model === "haiku" && /opus|sonnet/i.test(model)) {
        routedModel = "claude-haiku-4-5-20251001";
        classifyTag = `routing:turn-classifier-v1:${verdict.reason}`;
      } else if (verdict.model === "opus" && /haiku|sonnet/i.test(model)) {
        routedModel = MODELS.opus;
        classifyTag = `routing:turn-classifier-v1:${verdict.reason}`;
      }
    } catch {
      /* classifier optional — never break callers */
    }
  }
  const body = { model: routedModel, max_tokens: maxTokens, messages };
  // S178 — prompt-caching on a stable canon/system prefix. The prefix is emitted
  // as a cache_control'd block (cached across calls); a string `system` is kept as
  // a non-cached per-call tail. An array `system` is preserved as-is after the prefix.
  if (cachePrefix) {
    const prefixBlock =
      cachePrefixTtl === "1h"
        ? withCache({ type: "text", text: cachePrefix }, { ttl: "1h" })
        : withCache(
            { type: "text", text: cachePrefix },
            { ttl: cachePrefixTtl || "5m" },
          );
    const tail = system
      ? typeof system === "string"
        ? [{ type: "text", text: system }]
        : Array.isArray(system)
          ? system
          : [system]
      : [];
    body.system = [prefixBlock, ...tail];
  } else if (system) {
    body.system = system;
  }
  if (thinking) body.thinking = thinking;

  // G5/G9 — merge context_management edits (compaction + clear_tool_uses + clear_thinking)
  const cm = { edits: [] };
  if (compaction) {
    const c = compaction === true ? buildCompactionConfig() : compaction;
    if (c?.context_management?.edits)
      cm.edits.push(...c.context_management.edits);
  }
  if (contextEditing) {
    const e =
      contextEditing === true ? buildContextEditingConfig() : contextEditing;
    if (e?.context_management?.edits)
      cm.edits.push(...e.context_management.edits);
  }
  if (cm.edits.length) body.context_management = cm;

  // G2 — mcp_servers param
  if (Array.isArray(mcpServers) && mcpServers.length) {
    Object.assign(body, buildMcpServers(mcpServers));
  }

  // S114 G11-G15 — auto-assemble tools array from opt-in flags
  const toolsList = Array.isArray(tools) ? [...tools] : [];
  if (memory) toolsList.push(memoryTool());
  if (webSearch)
    toolsList.push(
      typeof webSearch === "object"
        ? webSearchTool(webSearch)
        : webSearchTool(),
    );
  if (codeExecution) toolsList.push(codeExecutionTool());
  if (toolsList.length) body.tools = toolsList;
  if (outputConfig) body.output_config = outputConfig;

  // Auto-detect 1h cache usage in system/messages to flip the beta header on
  const detectLong = (blocks) =>
    Array.isArray(blocks) && blocks.some((b) => b?.cache_control?.ttl === "1h");
  const autoLong =
    longCache ||
    (!!cachePrefix && cachePrefixTtl === "1h") ||
    detectLong(body.system) ||
    detectLong(system) ||
    detectLong(messages?.flatMap?.((m) => m?.content || []) || []);

  const useThinking = !!thinking;
  const headers = buildHeaders(apiKey, {
    useThinking,
    longCache: autoLong,
    files,
    compaction: !!compaction,
    contextEditing: !!contextEditing,
    mcpServers: Array.isArray(mcpServers) && mcpServers.length > 0,
    memory: !!memory,
    citations: !!citations,
    webSearch: !!webSearch,
    codeExecution: !!codeExecution,
    outputConfig: !!outputConfig,
  });
  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const https = httpsModule;
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error)
              reject(new Error(`API error: ${parsed.error.message}`));
            else {
              // Auto-log to ledger. Script identifier from explicit logAs,
              // then env (OPS_SCRIPT_NAME), else 'unknown'. Never throws.
              try {
                logMetrics({
                  script: logAs || process.env.OPS_SCRIPT_NAME || "unknown",
                  model: routedModel,
                  usage: parsed.usage,
                  mode: useThinking ? "think" : autoLong ? "long-cache" : null,
                  routing: classifyTag || undefined,
                });
              } catch {
                /* metrics must never break callers */
              }
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Call Claude with a JSON schema and return parsed JSON.
 * Keeps schema-guaranteed JSON callers on the model-router chokepoint instead
 * of duplicating fragile content-block parsing across scripts.
 */
export async function callClaudeJson(opts, httpsModule) {
  const { schema, outputConfig, ...callOpts } = opts;
  if (!schema && !outputConfig?.schema)
    throw new Error("callClaudeJson requires schema or outputConfig.schema");
  const config = outputConfig || { type: "json_schema", schema };
  const response = await callClaude(
    { ...callOpts, outputConfig: config },
    httpsModule,
  );
  return extractJsonOutput(response);
}

export function extractJsonOutput(response) {
  for (const block of response?.content || []) {
    if (block?.type === "json" && block.json != null) return block.json;
    if (block?.type === "input_json" && block.input_json != null)
      return block.input_json;
    if (block?.json != null) return block.json;
    if (block?.input_json != null) return block.input_json;
    if (typeof block?.text === "string") {
      const text = block.text.trim();
      if (!text) continue;
      try {
        return JSON.parse(text);
      } catch {}
    }
  }
  throw new Error("Claude response did not contain parseable JSON output");
}
/**
 * Call Claude with Haiku-first escalation.
 *
 * Token-reduction pattern (v3.1): start at Haiku for ~10-15x cost savings;
 * if the response contains the user-provided `escalationSignal` (e.g. "UNCERTAIN"),
 * retry with Sonnet. A second retry with Opus is possible for extended tasks.
 *
 * Cheaper than picking Opus upfront for tasks where Haiku would have sufficed.
 *
 * @param {object} opts - same shape as callClaude plus:
 * @param {string} [opts.escalationSignal='UNCERTAIN'] - text Haiku should emit when out of depth
 * @param {string} [opts.ceiling='sonnet'] - max model to escalate to: 'sonnet' | 'opus'
 * @param {function} [opts.onEscalate] - callback(model) when escalation triggers
 * @returns {Promise<{response, escalated: boolean, finalModel: string}>}
 */
export async function callWithEscalation(opts, httpsModule) {
  const {
    escalationSignal = "UNCERTAIN",
    ceiling = "sonnet",
    onEscalate,
  } = opts;
  const order =
    ceiling === "opus" ? ["haiku", "sonnet", "opus"] : ["haiku", "sonnet"];

  let last;
  for (let i = 0; i < order.length; i++) {
    const model = MODELS[order[i]];
    const resp = await callClaude({ ...opts, model }, httpsModule);
    const text = resp.content?.map((c) => c.text || "").join("") || "";
    last = { response: resp, escalated: i > 0, finalModel: model };
    if (!text.includes(escalationSignal) || i === order.length - 1) return last;
    if (onEscalate) onEscalate(order[i + 1]);
  }
  return last;
}

/**
 * Semantic response cache — dedupes repeat calls with identical system+user hash.
 * Stored under `.ops-cache/semantic/<sha256>.json` (gitignored).
 * Returns cached response if hash matches and is under `ttlSec` old.
 */
export function semanticCacheKey(system, messages, model) {
  const normalized = JSON.stringify({
    m: model,
    s: typeof system === "string" ? system : JSON.stringify(system),
    u: messages,
  });
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function loadSemanticCache(key, ttlSec = 3600) {
  const cacheDir = path.resolve(
    __dirname,
    "..",
    "..",
    ".ops-cache",
    "semantic",
  );
  const file = path.join(cacheDir, `${key}.json`);
  try {
    const stat = fs.statSync(file);
    if ((Date.now() - stat.mtimeMs) / 1000 > ttlSec) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function storeSemanticCache(key, response) {
  const cacheDir = path.resolve(
    __dirname,
    "..",
    "..",
    ".ops-cache",
    "semantic",
  );
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, `${key}.json`),
      JSON.stringify(response),
    );
  } catch {
    /* cache never breaks callers */
  }
}

/**
 * Upload a file to the Anthropic Files API; returns file_id.
 * Use for static context that's re-sent across many calls (SOUL.md, CANON, rubrics).
 *
 * NOTE: requires `anthropic-beta: files-api-2025-04-14` and multipart/form-data.
 * Minimal implementation below uses raw https; pass `filename`, `content`, `mimeType`.
 */
export function uploadFile(
  { apiKey, filename, content, mimeType = "text/plain" },
  httpsModule,
) {
  const boundary = "----studio-ops-" + Date.now();
  const payloadParts = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    "",
    content,
    `--${boundary}--`,
    "",
  ];
  const payload = payloadParts.join("\r\n");
  const headers = {
    ...buildHeaders(apiKey, { files: true }),
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": Buffer.byteLength(payload),
  };
  // Files API doesn't use x-api-key; it uses anthropic-version + auth via key in the same header style
  return new Promise((resolve, reject) => {
    const req = httpsModule.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/files",
        method: "POST",
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Session budget tracker — lightweight dollar cap per session.
 * Writes running total to `.ops-cache/session-budget.json` (gitignored).
 * Returns `{ spent, remaining, overBudget }`.
 */
export function trackSessionBudget({ usage, model, cap = 5.0 }) {
  const price = PRICING_PER_MTOK[model] || FALLBACK_PRICE;
  const cost =
    ((usage.input_tokens || 0) * price.input) / 1_000_000 +
    ((usage.output_tokens || 0) * price.output) / 1_000_000 +
    ((usage.cache_read_input_tokens || 0) * price.cacheRead) / 1_000_000 +
    ((usage.cache_creation_input_tokens || 0) * price.cacheWrite) / 1_000_000;

  const file = path.resolve(
    __dirname,
    "..",
    "..",
    ".ops-cache",
    "session-budget.json",
  );
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    state = { session: null, spent: 0, cap };
  }
  state.spent = (state.spent || 0) + cost;
  state.cap = cap;
  state.lastUpdated = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
  } catch {
    /* budget never breaks callers */
  }
  return {
    spent: state.spent,
    remaining: cap - state.spent,
    overBudget: state.spent > cap,
  };
}

/**
 * Append a single NDJSON metrics line for a Claude call.
 *
 * Writes to `docs/cache-ledger.ndjson` by default. Override with the
 * `OPS_CACHE_LEDGER` env var or the `logPath` option. Silently no-ops on
 * filesystem errors — metrics must never break a primary API call path.
 *
 * @param {object} opts
 * @param {string} opts.script    - caller identifier (e.g. "ask-protocol")
 * @param {string} opts.model     - resolved model ID
 * @param {object} opts.usage     - parsed.usage from Claude response
 * @param {string} [opts.mode]    - optional sub-mode (e.g. "think", "search")
 * @param {string} [opts.logPath] - override path
 */
export function logMetrics({
  script,
  model,
  usage,
  mode = null,
  logPath = null,
}) {
  if (!usage) return;
  const target = logPath || process.env.OPS_CACHE_LEDGER || LEDGER_DEFAULT;
  const entry = {
    ts: new Date().toISOString(),
    script,
    mode,
    model,
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cache_read: usage.cache_read_input_tokens ?? 0,
    cache_create: usage.cache_creation_input_tokens ?? 0,
    // S117 + S121 G3: per-skill attribution. STUDIO_SKILL env first; falls back
    // to .cache/active-skill.json (set by `node scripts/set-active-skill.mjs <slug>`
    // at skill entry — file-based to survive across PowerShell subprocesses where
    // env vars don't propagate).
    skill: process.env.STUDIO_SKILL || readActiveSkillFile(),
  };
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, JSON.stringify(entry) + "\n");
  } catch {
    /* metrics must never break callers */
  }
}

/**
 * Generic Anthropic REST call (non-messages endpoints: vaults, sessions, files, etc.)
 * Keeps api.anthropic.com confined to the chokepoint for all endpoint families.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.method     - GET | POST | DELETE | PATCH
 * @param {string} opts.path       - e.g. '/v1/vaults'
 * @param {object} [opts.body]     - JSON body (omit for GET/DELETE)
 * @param {string} [opts.betaHeader] - extra anthropic-beta value(s)
 * @returns {Promise<{ status: number, body: object }>}
 */
export function callAnthropicRaw(
  { apiKey, method, path, body = null, betaHeader = null },
  httpsModule,
) {
  const headers = buildHeaders(apiKey);
  if (betaHeader) headers["anthropic-beta"] = betaHeader;
  const payload = body ? JSON.stringify(body) : null;
  if (payload) headers["Content-Length"] = Buffer.byteLength(payload);

  return new Promise((resolve, reject) => {
    const req = httpsModule.request(
      { hostname: "api.anthropic.com", path, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject(
              new Error(
                `JSON parse error: ${e.message}\nRaw: ${data.slice(0, 200)}`,
              ),
            );
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Submit a Messages Batch (50% cost discount, async).
 * Returns batch object with id for polling.
 */
export function submitBatch(apiKey, requests, httpsModule) {
  const payload = JSON.stringify({ requests });
  const headers = buildHeaders(apiKey);

  return new Promise((resolve, reject) => {
    const https = httpsModule;
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages/batches",
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Batch submit parse error: ${e.message}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Poll batch status until complete.
 * Returns results array when done.
 */
export async function pollBatch(
  apiKey,
  batchId,
  httpsModule,
  { pollIntervalMs = 10000, maxWaitMs = 600000 } = {},
) {
  const headers = buildHeaders(apiKey);
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const status = await new Promise((resolve, reject) => {
      const https = httpsModule;
      const req = https.request(
        {
          hostname: "api.anthropic.com",
          path: `/v1/messages/batches/${batchId}`,
          method: "GET",
          headers,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on("error", reject);
      req.end();
    });

    if (status.processing_status === "ended") {
      return status;
    }
    process.stderr.write(
      `  Batch ${batchId}: ${status.processing_status} (${status.request_counts?.processing ?? "?"} processing)...\n`,
    );
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Batch ${batchId} timed out after ${maxWaitMs / 1000}s`);
}

/**
 * Fetch all results for a completed batch (streams NDJSON from results endpoint).
 * Returns array of { custom_id, result: { type, message } | { type, error } }.
 */
export function fetchBatchResults(apiKey, batchId, httpsModule) {
  const headers = buildHeaders(apiKey);
  return new Promise((resolve, reject) => {
    const req = httpsModule.request(
      {
        hostname: "api.anthropic.com",
        path: `/v1/messages/batches/${batchId}/results`,
        method: "GET",
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          const results = raw
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              try {
                return JSON.parse(line);
              } catch {
                return null;
              }
            })
            .filter(Boolean);
          resolve(results);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
