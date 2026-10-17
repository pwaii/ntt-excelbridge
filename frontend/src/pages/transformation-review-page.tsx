import { FileCheck2 } from "lucide-react";
import { PlaceholderPage } from "@/pages/placeholder-page";

export function TransformationReviewPage() {
  return (
    <PlaceholderPage
      title="Transformation review"
      description="Review proposed standardization mappings, update matches, and formulas."
      icon={FileCheck2}
      message="Proposals and supporting evidence will appear here. Changes will require your explicit approval before they are applied."
    />
  );
}
