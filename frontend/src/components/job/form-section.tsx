import type { ReactNode } from "react";

interface FormSectionProps {
  id: string;
  title: string;
  required?: boolean;
  children: ReactNode;
}

export function FormSection({ id, title, required, children }: FormSectionProps) {
  return (
    <section aria-labelledby={`${id}-title`} className="form-section">
      <h2 id={`${id}-title`} tabIndex={-1} className="scroll-mt-4 rounded">{title}{required && <span className="ml-1 text-primary" aria-hidden="true">*</span>}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
