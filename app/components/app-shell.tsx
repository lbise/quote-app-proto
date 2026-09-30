import type { HTMLAttributes, ReactNode } from 'react';
import { ChevronDown, FileText, LogOut, Settings, ShieldCheck, UserRound, UsersRound } from 'lucide-react';
import { Link, useRouteLoaderData, useSubmit } from 'react-router';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu';
import { setAppearance, themes, useAppearance, type Theme } from '../lib/appearance';

export type AppSection = 'quotes' | 'customers' | 'settings' | 'admin';
type Locale = 'fr' | 'en';

/**
 * The application frame around every signed-in page: brand, main navigation,
 * the account menu and the page content. Inside a Quote, a breadcrumb names the
 * Quote and the navigation stays in place.
 *
 * Designs place the pieces with CSS only (see app/styles/README.md). The
 * header can be flattened with `display: contents` so brand, breadcrumb,
 * navigation and account become grid items of `.eq-shell`.
 */
export function AppShell({ locale, onLanguage, current, quote, className, children, ...rest }: {
  locale: Locale;
  onLanguage: (locale: Locale) => unknown;
  current?: AppSection;
  /** Shown as a breadcrumb inside a Quote. */
  quote?: { reference: string; title: string };
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const administrator = (useRouteLoaderData('root') as { administrator?: boolean } | undefined)?.administrator === true;
  const section = quote ? 'quotes' : current;
  const destinations = [
    { id: 'quotes' as const, to: '/quotes', icon: FileText, label: t('Devis', 'Quotes') },
    { id: 'customers' as const, to: '/customers', icon: UsersRound, label: t('Clients', 'Customers') },
    { id: 'settings' as const, to: '/settings', icon: Settings, label: t('Paramètres', 'Settings') },
    ...(administrator ? [{ id: 'admin' as const, to: '/admin', icon: ShieldCheck, label: t('Administration', 'Administration') }] : []),
  ];
  return <div className={cn('qp-app eq-shell', className)} data-shell-mode={quote ? 'quote' : 'page'} lang={locale} {...rest}>
    <header className="qp-app-header qp-app-header-nav eq-shell-header">
      <Link className="qp-wordmark eq-shell-brand" to="/quotes" aria-label="Easy Quote">easy<span>quote</span><span className="qp-brand-dot">.</span></Link>
      {quote && <nav className="eq-breadcrumb" aria-label={t('Fil d’Ariane', 'Breadcrumb')}>
        <ol>
          <li><Link to="/quotes">{t('Mes devis', 'My Quotes')}</Link></li>
          <li><span aria-current="page"><span className="eq-breadcrumb-reference">{quote.reference}</span> <strong>{quote.title || t('Nouveau devis', 'New Quote')}</strong></span></li>
        </ol>
      </nav>}
      <nav className="qp-app-nav eq-shell-nav" aria-label={t('Navigation principale', 'Main navigation')}>
        {destinations.map(({ id, to, icon: Icon, label }) => <Link key={id} to={to} className="eq-nav-link" data-section={id}
          // Inside a Quote, Quotes is the current section rather than the current page.
          aria-current={section === id ? (quote ? 'true' : 'page') : undefined}><Icon aria-hidden="true" /><span>{label}</span></Link>)}
      </nav>
      <AccountMenu locale={locale} onLanguage={onLanguage} />
    </header>
    <div className="eq-shell-main">{children}</div>
  </div>;
}

const themeLabels: Record<Theme, [string, string]> = { light: ['Clair', 'Light'], dark: ['Sombre', 'Dark'], system: ['Système', 'System'] };

/** Language, colour theme and sign-out for the signed-in person. */
export function AccountMenu({ locale, onLanguage }: { locale: Locale; onLanguage: (locale: Locale) => unknown }) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const email = (useRouteLoaderData('root') as { email?: string | null } | undefined)?.email ?? null;
  const { theme } = useAppearance();
  const submit = useSubmit();
  return <div className="qp-header-end eq-shell-account">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="eq-account-trigger">
          <UserRound data-icon="inline-start" aria-hidden="true" />
          <span className="eq-account-short">{t('Compte', 'Account')}</span>
          {email && <span className="eq-account-email">{email}</span>}
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="qp-line-menu eq-account-menu" lang={locale}>
        {email && <><DropdownMenuLabel className="eq-account-identity"><span>{t('Connecté en tant que', 'Signed in as')}</span><strong>{email}</strong></DropdownMenuLabel><DropdownMenuSeparator /></>}
        <DropdownMenuGroup>
          <DropdownMenuLabel id="eq-account-language">{t('Langue de l’interface', 'Interface language')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup aria-labelledby="eq-account-language" value={locale} onValueChange={value => { if (value === 'fr' || value === 'en') void onLanguage(value); }}>
            <DropdownMenuRadioItem value="fr" lang="fr">Français</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="en" lang="en">English</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel id="eq-account-theme">{t('Thème', 'Theme')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup aria-labelledby="eq-account-theme" value={theme} onValueChange={value => { if ((themes as readonly string[]).includes(value)) setAppearance('theme', value as Theme); }}>
            {themes.map(value => <DropdownMenuRadioItem key={value} value={value}>{t(...themeLabels[value])}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild><Link to="/settings/account"><Settings />{t('Paramètres du compte', 'Account settings')}</Link></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void submit(null, { method: 'post', action: '/sign-out' })}><LogOut />{t('Se déconnecter', 'Sign out')}</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
