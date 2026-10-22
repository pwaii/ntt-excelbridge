import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <section aria-labelledby="page-title" className="mx-auto max-w-xl py-16">

      <h1 id="page-title" className="page-title">Page not found</h1>
      <p className="mt-4 max-w-lg leading-relaxed text-muted-foreground">We could not find that page. Check the address or return to job creation.</p>
      <Button asChild className="mt-6"><Link to="/jobs/new"><ArrowLeft aria-hidden="true" />Create a workflow</Link></Button>
    </section>
  );
}
