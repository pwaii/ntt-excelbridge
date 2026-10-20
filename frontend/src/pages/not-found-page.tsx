import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <section aria-labelledby="page-title" className="rounded-2xl border bg-card px-6 py-14 shadow-xs sm:p-12">
      <p className="text-sm font-semibold text-primary">Error 404</p>
      <h1 id="page-title" className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Page not found</h1>
      <p className="mt-4 max-w-lg leading-relaxed text-muted-foreground">We could not find that page. Check the address or return to job creation.</p>
      <Button asChild className="mt-8"><Link to="/jobs/new"><ArrowLeft aria-hidden="true" />Go to job creation</Link></Button>
    </section>
  );
}
