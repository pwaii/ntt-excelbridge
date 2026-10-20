import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <section aria-labelledby="page-title" className="panel mx-auto max-w-2xl p-6 sm:p-8">
      <p className="text-sm font-semibold text-primary">Error 404</p>
      <h1 id="page-title" className="page-title mt-3">Page not found</h1>
      <p className="mt-4 max-w-lg leading-relaxed text-muted-foreground">We could not find that page. Check the address or return to job creation.</p>
      <Button asChild className="mt-6"><Link to="/jobs/new"><ArrowLeft aria-hidden="true" />Go to job creation</Link></Button>
    </section>
  );
}
