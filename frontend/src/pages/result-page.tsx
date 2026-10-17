import { ArrowDownToLine } from "lucide-react";
import { PlaceholderPage } from "@/pages/placeholder-page";

export function ResultPage() {
  return (
    <PlaceholderPage
      title="Result"
      description="Access the validated workbook and a record of your review decisions."
      icon={ArrowDownToLine}
      message="The final XLSX workbook, JSON change report, and review summary will be available here after processing and validation complete."
    />
  );
}
