import { ListChecks } from "lucide-react";
import { PlaceholderPage } from "@/pages/placeholder-page";

export function QualityReviewPage() {
  return (
    <PlaceholderPage
      title="Quality review"
      description="Review data-quality findings and proposed corrections before approving changes."
      icon={ListChecks}
      message="Duplicate rows, blank rows and columns, and type-mismatch proposals will be presented here for your review."
    />
  );
}
