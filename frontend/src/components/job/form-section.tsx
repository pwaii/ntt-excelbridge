import type { ReactNode } from "react";

interface FormSectionProps {
  id: string;
  title: string;
  required?: boolean;
  children: ReactNode;
}

export function FormSection({ id, title, required, children }: FormSectionProps) {
  return (
    <section aria-labelledby={`${id}-title`} className="min-w-0 px-4 py-3.5 sm:px-5">
      <h2 id={`${id}-title`} tabIndex={-1} className="mb-2.5 scroll-mt-6 rounded text-[13px] font-semibold">{title}{required && <span className="ml-1 text-primary" aria-hidden="true">*</span>}</h2>
      {children}
    </section>
  );
}
