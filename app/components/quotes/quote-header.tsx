import type { ReactNode } from 'react';
import { ArrowLeft, FileText, Settings, ShieldCheck, UsersRound } from 'lucide-react';
import { Link, useRouteLoaderData } from 'react-router';
import { Button } from '../ui/button';
import type { QuoteData } from '../../lib/quote';

export type AppSection = 'quotes' | 'customers' | 'settings' | 'admin';

/**
 * Application header. Inside a Quote it keeps the back link and Quote heading,
 * with compact links to Customers and Settings. Elsewhere it shows the
 * destinations as navigation. Only Administrators see the admin area.
 */
export function QuoteHeader({ locale, onLanguage, onList, quote, current, quoteActions }: {
  locale: 'fr' | 'en'; onLanguage: (locale: 'fr' | 'en') => void; onList: () => void;
  quote?: QuoteData; current?: AppSection;
  /** The Quote's actions menu, shown inside a Quote. */
  quoteActions?: ReactNode;
}) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const administrator = (useRouteLoaderData('root') as { administrator?: boolean } | undefined)?.administrator === true;
  const destinations = [
    { id: 'quotes' as const, to: '/quotes', icon: FileText, label: t('Devis', 'Quotes') },
    { id: 'customers' as const, to: '/customers', icon: UsersRound, label: t('Clients', 'Customers') },
    { id: 'settings' as const, to: '/settings', icon: Settings, label: t('Paramètres', 'Settings') },
    ...(administrator ? [{ id: 'admin' as const, to: '/admin', icon: ShieldCheck, label: t('Administration', 'Administration') }] : []),
  ];
  const language = <select aria-label="Interface language / Langue de l’interface" value={locale} onChange={e => onLanguage(e.target.value as 'en' | 'fr')}><option value="fr">FR</option><option value="en">EN</option></select>;

  if (quote) return <header className="qp-app-header">
    <div className="qp-brand-group"><button className="qp-wordmark" onClick={onList}>easy<span>quote</span><span className="qp-brand-dot">.</span></button><span className="qp-header-divider" /><Button variant="ghost" onClick={onList} aria-label={t('Mes devis', 'My Quotes')}><ArrowLeft data-icon="inline-start" /><span className="qp-back-label">{t('Mes devis', 'My Quotes')}</span></Button></div>
    <div className="qp-project-heading"><span>{quote.reference}</span><strong>{quote.title || t('Nouveau devis', 'New Quote')}</strong></div>
    <div className="qp-header-end">
      {quoteActions}
      {destinations.slice(1).map(({ id, to, icon: Icon, label }) => <Button key={id} asChild variant="ghost" size="icon-sm"><Link to={to} aria-label={label} title={label}><Icon /></Link></Button>)}
      {language}
    </div>
  </header>;

  return <header className="qp-app-header qp-app-header-nav">
    <Link className="qp-wordmark" to="/quotes">easy<span>quote</span><span className="qp-brand-dot">.</span></Link>
    <nav className="qp-app-nav" aria-label={t('Navigation principale', 'Main navigation')}>
      {destinations.map(({ id, to, icon: Icon, label }) => <Link key={id} to={to} aria-current={current === id ? 'page' : undefined} data-compact={id === 'admin' || undefined}><Icon /><span>{label}</span></Link>)}
    </nav>
    <div className="qp-header-end">{language}</div>
  </header>;
}
