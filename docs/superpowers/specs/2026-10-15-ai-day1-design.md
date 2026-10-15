# AI Engineer — Day 1 Design

**Date:** 2026-10-15
**Scope:** Day-1 deliverables from `docs/ai-plan.md` — response envelope, prompt contracts, redaction/sample-cap policy. Tasks 1 (model preflight) and the five `ToolNOutput` schemas already exist; this spec covers what remains.

**Source-of-truth note:** The master plan `xlsx-data-workflow-demo-plan.md` referenced by CLAUDE.md no longer exists in the repo. `docs/ai-plan.md` is the authoritative extract. It names the *kinds* of caps but not exact numbers for three of four — those are flagged as placeholders below.

**Core invariant (unchanged):** Every AI result is an untrusted proposal. The model never executes code, never mutates data, and may only *select* from candidate IDs supplied in the prompt. These Day-1 artifacts exist to enforce that at the trust boundary before any Bedrock call is wired (Day 2).

---

## 1. Response envelope — `backend/app/domain/schemas.py`

A generic wrapper separating the model-produced payload from Python-computed audit metadata. The model never sees or produces audit fields.

```python
class AuditMeta(BaseModel):          # all Python-computed, never model-produced
    tool: str                        # "tool1_semantics" ...
    model_id: str
    prompt_version: str              # e.g. "v1"
    input_hash: str                  # sha256 of rendered prompt inputs
    output_hash: str                 # sha256 of raw model text
    latency_ms: int
    input_tokens: int
    output_tokens: int

class ToolResult(BaseModel, Generic[T]):
    meta: AuditMeta
    payload: T                       # Tool1Output | ... | Tool5Output
```

**Consumption:** BE persists `meta` to the DynamoDB `EVENT#` row and `payload` to `PROPOSAL#`. Keeps the trust boundary clean — `payload` stays a pure proposal, `meta` is trustworthy by construction.

## 2. Prompt contracts — `backend/app/prompts/` + `ai/prompts.py`

One reviewable `.md` per tool, version in the filename:

```
backend/app/prompts/
  tool1_semantics.v1.md
  tool2_types.v1.md
  tool3_formulas.v1.md
  tool4_standardize.v1.md
  tool5_update.v1.md
```

Loader stays tiny:

```python
@lru_cache
def get_prompt(tool: str, version: str = "v1") -> str:
    return (PROMPTS_DIR / f"{tool}.{version}.md").read_text(encoding="utf-8")
```

- Each `.md` is a template with named placeholders (`{headers}`, `{samples}`, `{candidates}`, …) the adapter fills.
- Prompt prose states the hard rules: select only from candidate IDs below, do not invent IDs, return JSON matching the shown shape.
- Each file ends with an explicit JSON-shape block mirroring its `ToolNOutput`.
- Per-tool `maxTokens` / `temperature` live as constants beside each adapter, **not** in the `.md`.
- **Day 1 = drafts only.** Real prose, but not wired to Bedrock (Day 2).

## 3. Redaction + sample-cap policy — `backend/app/ai/policy.py`

One cohesive, independently-testable safety unit: caps + masking + log allowlist.

```python
# --- Caps ---
MAX_ROWS = 50_000               # real: CLAUDE.md / ai-plan constraints
MAX_SAMPLES_PER_COLUMN = 20     # PLACEHOLDER — not in surviving extract, confirm
MAX_CANDIDATE_MATCHES  = 25     # PLACEHOLDER — not in surviving extract, confirm
MAX_OUTPUT_TOKENS      = 1024   # PLACEHOLDER per tool — not in extract, confirm

# --- Redaction: what may enter a prompt ---
def redact_sample(value, col_semantic) -> str: ...   # mask PII-ish, keep shape for inference

# --- Log allowlist: what may be logged ---
SAFE_LOG_FIELDS = {"tool","model_id","prompt_version","input_hash","output_hash",
                   "latency_ms","input_tokens","output_tokens","row_count"}
def safe_log(d: dict) -> dict:   # drops anything not in the allowlist
```

- Masking keeps enough shape that type/semantics stay inferable (ai-plan §14.3) but no raw sensitive values reach prompts or logs.
- `MAX_ROWS` and the 25 MB file limit are real; the other three caps are conservative placeholders to confirm against real master-plan values.

## Testing (self-check this slice owns)

- `ToolResult` round-trips; `payload` validates against each `ToolNOutput`; malformed payload rejected.
- `get_prompt` loads each tool's v1 file and caches; unknown tool/version raises.
- `safe_log` drops any field outside the allowlist (assert no raw-value key survives).
- `redact_sample` masks a sensitive value while preserving its type shape.

## Out of scope for Day 1

Bedrock Converse client, tool adapters, fixtures, real model calls — all Day 2+.

## Open items / risk

- Three of four caps are placeholders; confirm real values with the team.
- Model is pinned to Nova (commit `edfc456`); Nova's structured-JSON behavior differs from Claude's — matters when prompt contracts get wired Day 2.
