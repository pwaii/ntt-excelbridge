import type { OutputPolicy } from "@/types/review";

export const outputPolicies: Record<OutputPolicy, { title: string; description: string }> = {
  standardize_only: {
    title: "Standardize only",
    description: "The final download is derived from the current workbook, with approved standardization rules applied and the requested output column if approved. Original uploads remain unchanged.",
  },
  update_only: {
    title: "Update only",
    description: "The final download is a NEW version derived from the main workbook, with approved current rows merged into matched rows. The original main workbook remains unchanged. Unmatched current rows are skipped and reported, never inserted automatically.",
  },
  both: {
    title: "Standardize and update",
    description: "Standardize current data first, then match against the main workbook using standardized current values. Apply approved updates to a NEW main-derived workbook. The original main workbook remains unchanged. Unmatched current rows are skipped and reported, never inserted automatically.",
  },
  neither: {
    title: "Neither standardization nor update",
    description: "The final download is derived from the current workbook, with approved quality fixes and the requested column. No standardization or main-file update is performed. Original uploads remain unchanged.",
  },
};

export function getOutputPolicy(standardize: boolean, update: boolean): OutputPolicy {
  if (standardize && update) return "both";
  if (standardize) return "standardize_only";
  if (update) return "update_only";
  return "neither";
}
