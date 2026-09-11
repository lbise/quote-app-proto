// THROWAWAY: exact scaled-integer arithmetic for inspecting prototype amounts, not the production calculation boundary.
import type { QuoteData, QuoteLine } from './fixtures';
export function scaled(value: string, places: number): bigint | null {
  const normal = value.trim().replace(',', '.');
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(normal)) return null;
  const [whole, fraction = ''] = normal.split('.');
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0'));
}
export function lineCents(line: QuoteLine): bigint | null {
  if (!line.description.trim()) return null;
  if (line.mode === 'fixed') return scaled(line.amount, 2);
  const q = scaled(line.quantity, 3), p = scaled(line.unitPrice, 2);
  return q === null || q === 0n || p === null || !line.unit.trim() ? null : (q * p + 500n) / 1000n;
}
export function totals(quote: QuoteData) {
  const amounts = quote.lines.map(lineCents);
  const subtotal = amounts.reduce<bigint>((sum, n) => sum + (n ?? 0n), 0n);
  const missing = amounts.filter(n => n === null).length;
  const d = quote.discountMode === 'none' ? 0n : scaled(quote.discount, 2);
  const discount = d === null ? null : quote.discountMode === 'percent' ? (subtotal * d + 5000n) / 10000n : d;
  const validDiscount = discount !== null && discount <= subtotal && !(quote.discountMode === 'percent' && (d ?? 0n) > 10000n);
  const net = subtotal - (discount ?? 0n);
  const vat = quote.vatRegistered ? (net * 81n + 500n) / 1000n : 0n;
  const complete = missing === 0 && amounts.length > 0 && validDiscount;
  return { subtotal, discount: discount ?? 0n, vat, total: complete ? net + vat : null, missing, validDiscount };
}
export function money(cents: bigint | null) {
  if (cents === null) return '—';
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  return `${whole}.${(cents % 100n).toString().padStart(2, '0')}`;
}
export function publicationMissing(q: QuoteData) {
  return !q.title.trim() || !q.customerName.trim() || !q.customerAddress.trim() || !q.businessName.trim() || !q.businessAddress.trim() || !q.businessContact.trim() || !q.reference.trim() || !q.issueDate || (q.vatRegistered && !q.vatId.trim());
}
