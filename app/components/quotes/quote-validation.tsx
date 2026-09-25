import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Field, FieldDescription, FieldError } from '../ui/field';
import type { QuoteCalculation, QuoteProblem } from '../../lib/quote';
import { problemLabel } from './problem-label';

export type Locale = 'fr' | 'en';

const missingLabels: Record<string, [string, string]> = {
  reference: ['Référence manquante', 'Reference missing'],
  title: ['Objet manquant', 'Title missing'],
  customerName: ['Nom du client manquant', 'Customer name missing'],
  customerAddress: ['Adresse du client manquante', 'Customer address missing'],
  businessName: ['Raison sociale manquante', 'Business name missing'],
  businessAddress: ['Adresse de l’entreprise manquante', 'Business address missing'],
  businessContact: ['Coordonnées de l’entreprise manquantes', 'Business contact details missing'],
  issueDate: ['Date d’émission manquante', 'Issue date missing'],
  vatRegistered: ['Statut TVA à préciser', 'VAT status missing'],
  vatId: ['Numéro TVA manquant', 'VAT identifier missing'],
  discount: ['Remise manquante', 'Discount missing'],
  description: ['Description manquante', 'Description missing'],
  quantity: ['Quantité manquante', 'Quantity missing'],
  unit: ['Unité manquante', 'Unit missing'],
  unitPrice: ['Prix manquant', 'Price missing'],
  amount: ['Prix manquant', 'Price missing'],
  lines: ['Travaux manquants', 'Work missing'],
};
const invalidLabels: Record<string, [string, string]> = {
  invalid_value: ['Indiquez une valeur valide.', 'Enter a valid value.'],
  unsupported_precision: ["La précision indiquée n'est pas prise en charge.", 'This precision is not supported.'],
  negative_value: ['La valeur ne peut pas être négative.', 'The value cannot be negative.'],
  must_be_positive: ['La quantité doit être supérieure à zéro.', 'Quantity must be greater than zero.'],
  out_of_range: ['La valeur est hors de la plage autorisée.', 'The value is outside the allowed range.'],
  inapplicable: ['Ce champ doit rester vide pour ce mode de prix.', 'This field must be blank for this pricing mode.'],
  unknown_section: ['Choisissez une section existante.', 'Choose an existing section.'],
};

export function validationLabel(problem: QuoteProblem, locale: Locale) {
  const field = problem.path.split('.').at(-1)!;
  const labels = problem.code === 'required'
    ? (problem.path.startsWith('sections[') && field === 'title' ? ['Nom de section manquant', 'Section name missing'] : missingLabels[field])
    : invalidLabels[problem.code];
  return labels?.[locale === 'fr' ? 0 : 1] ?? problemLabel(problem, locale);
}

export function problemAt(calculation: QuoteCalculation, path: string) {
  return calculation.errors.find(problem => problem.path === path) ?? calculation.missing.find(problem => problem.path === path);
}

export function MissingWarning({ problem, locale, onClick }: { problem: QuoteProblem; locale: Locale; onClick: () => void }) {
  return <button type="button" className="qp-field-warning" lang={locale} onClick={onClick}><TriangleAlert aria-hidden="true" /><span>{validationLabel(problem, locale)}</span></button>;
}

/** Validation is calculated by the caller once, then shared by its fields. */
export function QuoteField({ calculation, path, id, locale, children, disabled }: {
  calculation: QuoteCalculation; path: string; id: string; locale: Locale; children: ReactNode; disabled?: boolean;
}) {
  const problem = problemAt(calculation, path);
  const missing = problem?.code === 'required';
  const invalid = Boolean(problem && !missing);
  const messageId = `${id}-validation`;
  return <Field lang={locale} data-missing={missing || undefined} data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
    {Children.map(children, child => {
      if (!isValidElement(child) || (child.props as { id?: string }).id !== id) return child;
      const control = child as ReactElement<{ 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
      return cloneElement(control, {
        'aria-invalid': invalid,
        'aria-describedby': [invalid ? null : control.props['aria-describedby'], problem ? messageId : null].filter(Boolean).join(' ') || undefined,
      });
    })}
    {problem && (missing
      ? <FieldDescription id={messageId} className="qp-field-message"><TriangleAlert aria-hidden="true" />{validationLabel(problem, locale)}</FieldDescription>
      : <FieldError id={messageId}>{validationLabel(problem, locale)}</FieldError>)}
  </Field>;
}

export function focusEditorField(id?: string) {
  return (event: Event) => {
    if (!id) return;
    const field = document.getElementById(id);
    if (!field) return;
    event.preventDefault();
    field.focus({ preventScroll: true });
    field.closest('[data-slot="field"]')?.scrollIntoView({ block: 'nearest' });
  };
}

export const lineInputId = (field: string) => `line-${({ sectionId: 'section', unitPrice: 'unit-price' } as Record<string, string>)[field] ?? field}`;
