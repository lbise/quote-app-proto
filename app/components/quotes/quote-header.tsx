import { ArrowLeft, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/button';
import type { QuoteData } from '../../lib/quote';

export function QuoteHeader({ locale, onLanguage, onList, quote, onRecords, onPrivacy }: {
  locale: 'fr' | 'en'; onLanguage: (locale: 'fr' | 'en') => void; onList: () => void;
  quote?: QuoteData; onRecords: () => void; onPrivacy: () => void;
}) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  return <header className="qp-app-header">
    <div className="qp-brand-group"><button className="qp-wordmark" onClick={onList}>easy<span>quote</span><span className="qp-brand-dot">.</span></button><span className="qp-header-divider" /><Button variant="ghost" onClick={onList}><ArrowLeft data-icon="inline-start" />{t('Mes devis', 'My Quotes')}</Button></div>
    {quote && <div className="qp-project-heading"><span>{quote.reference}</span><strong>{quote.title || t('Nouveau devis', 'New Quote')}</strong></div>}
    <div className="qp-header-end">
      <Button variant="ghost" size="icon-sm" onClick={onRecords} aria-label={t('Clients et valeurs par défaut', 'Customers and defaults')} title={t('Clients et valeurs par défaut', 'Customers and defaults')}><Settings2 /></Button>
      <Button variant="ghost" size="icon-sm" onClick={onPrivacy} aria-label={t('Confidentialité de l’assistant', 'Assistant privacy')} title={t('Confidentialité de l’assistant', 'Assistant privacy')}><ShieldCheck /></Button>
      <select aria-label="Interface language / Langue de l’interface" value={locale} onChange={e => onLanguage(e.target.value as 'en' | 'fr')}><option value="fr">FR</option><option value="en">EN</option></select>
    </div>
  </header>;
}
