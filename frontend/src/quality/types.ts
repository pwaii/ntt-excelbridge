import { z } from "zod";
import type { components } from "@/api/generated/backend";

// Runtime evidence decoder for the published review-report contract.
export const qualityKinds = ["duplicate-row", "blank-row", "blank-column", "type-mismatch", "semantic", "normalization-rule"] as const;
export const qualityLabels: Record<typeof qualityKinds[number], string> = {
  "duplicate-row": "Duplicate rows", "blank-row": "Blank rows", "blank-column": "Blank columns",
  "type-mismatch": "Type mismatches", semantic: "Column meaning", "normalization-rule": "Normalization rules",
};
export type DecisionDraft = components["schemas"]["ReviewItemDecision"];
export const transformationKinds = ["formula", "standardization", "update-match"] as const;
export const transformationLabels = { formula: "Formulas", standardization: "Standardization mappings", "update-match": "Update matches" };
export const matchTypes = ["exact", "normalized", "ambiguous", "duplicate", "conflict", "unmatched"] as const;
const text = z.string().min(1);
export const qualityItemSchema = z.object({
  id: text, kind: z.enum([...qualityKinds, ...transformationKinds]), title: text,
  slot: z.string().optional(), filename: z.string().nullable().optional(),
  severity: z.enum(["high", "medium", "low"]), reason: text,
  sheet: z.string().optional(), row: z.number().int().positive().optional(), column: z.string().optional(),
  cells: z.array(z.object({ coordinate: text, before: z.string().nullable().default(null), after: z.string().nullable().optional() })),
  confidence: z.number().min(0).max(1).optional(), pattern: z.string().optional(),
  affectedCount: z.number().int().nonnegative().optional(),
  formula: z.object({ text: text, referencedColumns: z.array(text), syntax: z.enum(["verified", "invalid", "unverified"]), diagnostic: z.string().optional() }).optional(),
  match: z.object({ type: z.enum(matchTypes), sourceKey: z.string(), targetKeys: z.array(z.string()) }).optional(),
  status: z.enum(["proposed", "human_accepted", "human_edited", "human_rejected", "human_ignored"]),
  requiresDecision: z.boolean(), allowedDecisions: z.array(z.enum(["accept", "reject", "edit", "ignore"])),
});
export const qualitySnapshotSchema = z.object({
  jobId: text, revision: z.number().int().nonnegative(), status: text,
  items: z.array(qualityItemSchema), complete: z.boolean(), requestId: z.string().optional(),
}).superRefine((snapshot, context) => {
  if (new Set(snapshot.items.map((item) => item.id)).size !== snapshot.items.length)
    context.addIssue({ code: "custom", message: "Review identities must be unique." });
});
export type QualityItem = z.infer<typeof qualityItemSchema>;
export type QualitySnapshot = z.infer<typeof qualitySnapshotSchema>;
export interface QualityReviewAdapter {
  load(jobId: string, signal: AbortSignal): Promise<QualitySnapshot>;
  submit(jobId: string, revision: number, decisions: Record<string, DecisionDraft>, signal: AbortSignal): Promise<components["schemas"]["ReviewResponse"]>;
}
