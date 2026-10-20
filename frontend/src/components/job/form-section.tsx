import type { ReactNode } from "react";

interface FormSectionProps {
  id: string;
  title: string;
  required?: boolean;
  children: ReactNode;
}

export function FormSection({ id, title, required, children }: FormSectionProps) {
  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 px-5 py-5 sm:px-6">
      <h2 id={`${id}-title`} tabIndex={-1} className="mb-3 scroll-mt-6 rounded text-sm font-semibold">{title}{required && <span className="ml-1 text-primary" aria-hidden="true">*</span>}</h2>
      {children}
    </section>
  );
}
