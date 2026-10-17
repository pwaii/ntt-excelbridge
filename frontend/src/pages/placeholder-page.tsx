import { Clock3, type LucideIcon } from "lucide-react";

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
  message: string;
}

export function PlaceholderPage({ title, description, icon: Icon, message }: PlaceholderPageProps) {
  return (
    <section aria-labelledby="page-title">
      <div className="max-w-2xl">
        <h1 id="page-title" className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="mt-8 rounded-2xl border bg-card px-6 py-12 shadow-xs sm:mt-10 sm:px-10 sm:py-16">
        <div className="max-w-lg">
          <div className="mb-8 flex size-14 items-center justify-center rounded-2xl bg-accent text-primary"><Icon className="size-6" aria-hidden="true" /></div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"><Clock3 className="size-3.5" aria-hidden="true" />Coming soon</span>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">{title} is not implemented yet</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>
        </div>
      </div>
    </section>
  );
}
