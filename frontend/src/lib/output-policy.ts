import type { OutputPolicy } from "@/types/review";

export const outputPolicies: Record<OutputPolicy, { title: string; description: string }> = {
  standardize_only: {
    title: "Standardized workbook",
    description: "Download a new current workbook with approved standardization and the requested column, if approved.",
  },
  update_only: {
    title: "Updated main workbook",
    description: "Download a new main workbook with approved current values merged into matched rows. Unmatched rows are skipped and reported.",
  },
  both: {
    title: "Standardized main workbook",
    description: "Standardize current data, then use those values to match and update a new main workbook. Only approved changes are applied; unmatched rows are skipped and reported.",
  },
  neither: {
    title: "New current workbook",
    description: "Download a new current workbook with approved quality fixes and the requested column.",
  },
};

export function getOutputPolicy(standardize: boolean, update: boolean): OutputPolicy {
  if (standardize && update) return "both";
  if (standardize) return "standardize_only";
  if (update) return "update_only";
  return "neither";
}
