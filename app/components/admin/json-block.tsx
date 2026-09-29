import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t, type Locale } from './admin-shell';

function formatBytes(locale: Locale, bytes: number) {
  const format = (value: number, unit: string) => `${new Intl.NumberFormat(locale === 'fr' ? 'fr-CH' : 'en-GB', { maximumFractionDigits: 1 }).format(value)} ${unit}`;
  if (bytes < 1024) return format(bytes, t(locale, 'o', 'B'));
  if (bytes < 1024 * 1024) return format(bytes / 1024, t(locale, 'Ko', 'KB'));
  return format(bytes / 1024 / 1024, t(locale, 'Mo', 'MB'));
}

/**
 * A recorded value, collapsed until opened, then shown as recorded: text as
 * text, anything else as indented JSON. Both can be copied. Large payloads are
 * only laid out once opened.
 */
export function JsonBlock({ locale, label, value }: { locale: Locale; label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null);
  const text = useMemo(() => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'undefined', [value]);
  const bytes = useMemo(() => new TextEncoder().encode(text).length, [text]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
    window.setTimeout(() => setCopied(null), 2000);
  }

  return <div className="qp-json">
    <details onToggle={event => setOpen(event.currentTarget.open)}>
      <summary><span>{label}</span><small>{typeof value === 'string' ? t(locale, 'Texte', 'Text') : 'JSON'} · {formatBytes(locale, bytes)}</small></summary>
      {open && <pre tabIndex={0}>{text}</pre>}
    </details>
    <Button type="button" size="xs" variant="ghost" onClick={() => void copy()} aria-label={`${t(locale, 'Copier', 'Copy')} ${label}`}>
      {copied === 'done' ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied === 'done' ? t(locale, 'Copié', 'Copied') : copied === 'failed' ? t(locale, 'Copie impossible', 'Copy failed') : t(locale, 'Copier', 'Copy')}
    </Button>
  </div>;
}
