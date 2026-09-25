import { Pencil } from 'lucide-react';

/** Visible draft-only cue; the enclosing button supplies the specific accessible name. */
export function EditAffordance({ locale }: { locale?: 'fr' | 'en' }) {
  return <span className="qp-edit-affordance" aria-hidden="true" lang={locale}>
    <Pencil />
  </span>;
}
