import type { QuoteProblem } from '../../lib/quote';

const fields: Record<string, [string, string]> = {
  reference: ['Référence', 'Reference'], title: ['Objet', 'Title'],
  customerName: ['Nom du client', 'Customer name'], customerAddress: ['Adresse du client', 'Customer address'],
  businessName: ['Raison sociale', 'Business name'], businessAddress: ['Adresse de l’entreprise', 'Business address'],
  businessContact: ['Coordonnées de l’entreprise', 'Business contact details'],
  issueDate: ['Date d’émission', 'Issue date'], validUntil: ['Date de validité', 'Valid-until date'],
  vatRegistered: ['Assujettissement à la TVA', 'VAT registration'], vatId: ['Numéro TVA', 'VAT identifier'],
  discount: ['Remise', 'Discount'], discountMode: ['Type de remise', 'Discount type'],
  lines: ['Travaux', 'Work'], description: ['Description', 'Description'],
  quantity: ['Quantité', 'Quantity'], unit: ['Unité', 'Unit'], unitPrice: ['Prix unitaire', 'Unit price'],
  amount: ['Montant', 'Amount'], sectionId: ['Section', 'Section'],
};
export function problemLabel(problem: QuoteProblem, locale: 'fr' | 'en'): string {
  const language = locale === 'fr' ? 0 : 1;
  const match = /^(lines|sections)\[(\d+)\]\.(.+)$/.exec(problem.path);
  let field = problem.path;
  let prefix = '';
  if (match) {
    prefix = `${match[1] === 'lines' ? (locale === 'fr' ? 'Ligne' : 'Line') : 'Section'} ${Number(match[2]) + 1}, `;
    field = match[3];
  }
  const label = fields[field]?.[language] ?? (locale === 'fr' ? 'Contenu du devis' : 'Quote content');
  const reason = problem.code === 'required' ? (locale === 'fr' ? 'à compléter' : 'required') : (locale === 'fr' ? 'à corriger' : 'needs correcting');
  return `${prefix}${label}, ${reason}`;
}
