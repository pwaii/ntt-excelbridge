# ADR 0001 — Design decisions from the design-grilling session

- **Date:** 2026-10-16
- **Status:** Accepted
- **Context:** A grilling pass over `docs/design.md` surfaced 8 parts that either didn't fully make sense or would bite later, plus 2 clarity gaps. This record captures the decisions and the reasoning so they aren't re-litigated. Where a decision overrides or refines `design.md`, that is noted.

---

## Decisions

### D1 — Demo working size is ~2,000 rows; 50k stays as the reject wall
`design.md` §3.3 set 50k rows / 25 MB as the reject-above limit, which implied the UI, budget, and AI all had to handle files that large — they can't (no human reviews thousands of issues; AI matching against 50k rows is costly; $140 Bedrock cap won't survive it).

**Decision:** Design the review UI, cost model, and matching for **~2,000 rows**. Keep 25 MB / 50k rows as the **hard reject ceiling** only. Files between the tiers may run with a "large file — top issues only" banner.

### D2 — "Update" emits a new version of the main file; the original upload is never mutated
`design.md` §6 State 12 "both" mode said "update the main workbook," which reads as editing the trusted source-of-truth reference.

**Decision:** Updating the central database = **writing a new S3 object** that is the main workbook with approved rows merged in (`output/final.xlsx`). The uploaded main file stays frozen as the audit baseline. This preserves the "update the database" concept *and* the immutable-source invariant (§13.3 already requires writing to a new path).

**Consequence:** The download is a *different base file by mode* — current-derived for standardize/neither, main-derived for update/both. The output-policy screen (§6) must name which file the download is.

### D3 — Human gates use chained short executions, not task tokens
`design.md` §7.3 chose Step Functions Standard specifically to pause on `waitForTaskToken` at each human gate. That creates timeout / stuck-execution / orphaned-token risk and left token storage unspecified.

**Decision:** Run the workflow as **2–3 short executions that each end at a gate.** A segment runs (inspect → propose), ends, and leaves the job status in DynamoDB as "needs review." The human's review-submit API call **starts the next segment.** Nothing is ever paused waiting on a human.

**Consequence:** No token timeout failure mode; resume is just "submit the review"; a reopened browser re-reads status from DynamoDB. Trade-off: 2–3 separate executions instead of one end-to-end timeline in the Step Functions console (acceptable; audit lives in DynamoDB). Step Functions Standard is still used for the durable apply/validate work, just not as the human-wait mechanism.

### D4 — Tool #2 returns one rule per value-pattern, never per cell
`design.md` §10.3 allowed "one proposal per affected cell **or** value class." Per-cell on a dirty column blows `maxTokens`, the $140 cap, and the review UI.

**Decision:** Tool #2 returns **one rule per distinct value pattern** (e.g. "DD/MM/YYYY → ISO date"). The deterministic backend applies that rule to every matching cell and re-parses each in Python (§10.3 already requires re-parse). The human reviews a handful of rules. The "per cell" option is removed from the schema.

### D5 — Every output cell carries a formula-vs-data tag that drives injection-escaping
`design.md` §12/§14.4 escape cells starting with `=`,`+`,`-`,`@` to prevent formula injection — but an approved Tool #3 formula also starts with `=`. Escaping by leading character alone corrupts approved formulas.

**Decision:** Tag each output cell by **origin**: *approved-formula* (written live, logged in audit) → never escaped; *data* → escaped if it starts with a dangerous character. The escaper keys off the tag, not the first character. The tag is an explicit field in the apply/audit model.

### D6 — Tool #5 candidate generation uses key-blocking + fuzzy, capped ~5, recall-biased
`design.md` §10.6 said Tool #5 "receives candidate matches" but never said how candidates are produced for rows that failed the exact-match pass.

**Decision:** Add a plain-Python **blocking** step before the AI: narrow to candidates by a cheap key (e.g. first letter of last name / email domain), fuzzy-rank within the block, keep **top ~5**, and bias for **recall** (better to admit a few non-matches than block out a true match — the exact pass and human catch the extras). The AI only picks from those ~5, or returns "none." This is the standard record-linkage "blocking" technique; no new library needed for 2k rows.

### D7 — Update mode skips unmatched current rows (insert deferred)
`design.md` defined an "unmatched" label but never said what happens to those rows on apply.

**Decision:** **Skip** unmatched current rows for the demo — report them, don't write them. Inserting them as new main-file records is **future work** (see `memory/future-work-insert-unmatched-rows.md`); when built, it must be a human-gated option, not automatic.

### D8 — Next-segment start is gated behind the existing revision conditional write
A consequence of D3: since a review-submit launches the next segment, a double-click or network retry could start it twice.

**Decision:** The approve call does one **conditional DynamoDB write** ("advance revision N→N+1 only if still N", already in §7.6). Only the write that wins starts the next execution; the loser gets the existing `409 REVIEW_REVISION_CONFLICT` (§11). No new mechanism.

### D9 — Confidence drives sorting and bulk-approve, not just display
Both gates require human approval, so no proposal auto-applies — leaving AI `confidence` with no behavioral job.

**Decision:** Use confidence to **sort** proposals (riskiest first) and to **power a bulk-approve action** ("accept all high-confidence exact matches"). A bulk action is still a human decision, logged as `human accepted`. The high-confidence cutoff is a tuning knob, picked during day-6/7 evaluation.

### D10 — Header row is auto-detected, then confirmed by the user
`design.md` §3.3 ("header within first 20 rows") implied a silent guess; a wrong guess poisons all downstream column names, type checks, and prompts.

**Decision:** **Auto-detect + confirm.** Code guesses the header row; the existing post-upload sheet-select screen (§5.1) shows the guess ("We think row 3 is the header — correct?") for the user to accept or correct before the job starts.

---

## Residual notes (agreed, not separate decisions)

- **"both" ordering:** compute the match/blocking key on the **standardized** current value, not the raw one. Order: standardize current → then block + match against main.
- **High-confidence cutoff (D9):** a tuning number chosen during evaluation, not a design decision.
- **Bedrock response caching by input hash (§15):** safe to keep — a human reviews every result, so a stale cached proposal can never auto-apply.

## Deferred to future work
- Column-total / summary-row formulas — `memory/future-work-column-totals.md`
- Inserting unmatched rows in update mode — `memory/future-work-insert-unmatched-rows.md`

## Open risk (no decision removes it)
The 7-day / 3-person schedule is tight and day 1–3 front-loads the hardest AWS integration (FastAPI-on-Lambda + Cognito authorizer + Step Functions + presigned S3 + conditional writes). Recommended mitigation: build a thin end-to-end walking skeleton by day 2 (fake data, one real gate), and keep Tools #3/#5 as the first things to stub if the schedule slips. This is a project-management call, not a design hole.
