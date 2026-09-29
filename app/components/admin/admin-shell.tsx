import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { QuoteHeader } from '../quotes/quote-header';
import type { RefusalCode } from '@/lib/administration.server';
import type { UserStatus } from '@/lib/db/schema';
import type { TurnOutcomeKind } from '@/lib/turn-trace';

export type Locale = 'fr' | 'en';
export type AdminSection = 'users' | 'businesses' | 'turns';
export type LanguageChange = (locale: Locale) => Promise<boolean>;

/** The admin area's pages. */
export const adminPaths = {
  business: (id: string) => `/admin/businesses/${encodeURIComponent(id)}`,
  quote: (id: string) => `/admin/quotes/${encodeURIComponent(id)}`,
  turn: (id: string) => `/admin/turns/${encodeURIComponent(id)}`,
  quoteTurns: (id: string) => `/admin/turns?quote=${encodeURIComponent(id)}`,
};

export const t = (locale: Locale, fr: string, en: string) => locale === 'fr' ? fr : en;

/** Admin dates are Swiss times, the same on the server and in the browser. */
const timeZone = 'Europe/Zurich';

export function formatDate(locale: Locale, value: Date | string, withTime = false) {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CH' : 'en-GB', withTime ? { dateStyle: 'medium', timeStyle: 'short', timeZone } : { dateStyle: 'medium', timeZone }).format(new Date(value));
}

export function formatSeconds(locale: Locale, value: Date | string) {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone }).format(new Date(value));
}

export function DateTime({ locale, value, seconds = false }: { locale: Locale; value: Date | string; seconds?: boolean }) {
  const date = new Date(value);
  return <time dateTime={date.toISOString()}>{seconds ? formatSeconds(locale, date) : formatDate(locale, date, true)}</time>;
}

export function formatNumber(locale: Locale, value: number) {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-CH' : 'en-GB').format(value);
}

/** Model costs are in US dollars and often under a cent. */
export function formatCost(locale: Locale, value: number) {
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-CH' : 'en-GB', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

/** What an admin area action returns. */
export type AdminActionResult = { ok: true; intent: string } | { error: RefusalCode };

/** Why an Administrator action was refused. */
export function refusalMessage(locale: Locale, code: RefusalCode) {
  return {
    not_administrator: t(locale, 'Vous n’êtes plus administrateur.', 'You are no longer an Administrator.'),
    user_not_found: t(locale, 'Cet utilisateur n’existe plus.', 'This User no longer exists.'),
    self: t(locale, 'Vous ne pouvez pas vous bloquer ni retirer votre propre rôle d’administrateur.', 'You cannot block yourself or remove your own Administrator role.'),
    bootstrap_administrator: t(locale, 'Cet administrateur est défini dans ADMIN_EMAILS. Il ne peut être ni bloqué ni rétrogradé ici.', 'This Administrator is set in ADMIN_EMAILS. They cannot be blocked or demoted here.'),
    last_administrator: t(locale, 'C’est le dernier administrateur nommé ici. Nommez-en un autre avant de lui retirer le rôle.', 'This is the last Administrator granted here. Grant another before removing this role.'),
    invalid_email: t(locale, 'Saisissez une adresse e-mail valide.', 'Enter a valid email address.'),
    user_exists: t(locale, 'Cette adresse appartient déjà à un utilisateur.', 'This email already belongs to a User.'),
    already_invited: t(locale, 'Cette adresse a déjà une invitation en attente. Renvoyez-la depuis la liste des utilisateurs.', 'This email already has a pending invitation. Resend it from the User list instead.'),
    invitation_not_found: t(locale, 'Cette invitation n’existe plus.', 'This invitation no longer exists.'),
    invitation_accepted: t(locale, 'Cette invitation a déjà été acceptée.', 'This invitation has already been accepted.'),
    email_not_sent: t(locale, 'L’e-mail d’invitation n’a pas pu être envoyé. Rien n’a été enregistré ; réessayez plus tard.', 'The invitation email could not be sent. Nothing was saved; try again later.'),
  }[code];
}

export function statusLabel(locale: Locale, status: UserStatus) {
  return { invited: t(locale, 'Invité', 'Invited'), active: t(locale, 'Actif', 'Active'), blocked: t(locale, 'Bloqué', 'Blocked') }[status];
}

export function UserStatusBadge({ locale, status }: { locale: Locale; status: UserStatus }) {
  return <Badge variant={status === 'blocked' ? 'destructive' : status === 'active' ? 'secondary' : 'outline'}>{statusLabel(locale, status)}</Badge>;
}

export function outcomeLabel(locale: Locale, kind: TurnOutcomeKind) {
  return {
    committed: t(locale, 'Appliqué', 'Committed'),
    committed_with_failed_calls: t(locale, 'Appliqué, avec appels échoués', 'Committed with failed calls'),
    unchanged: t(locale, 'Sans changement', 'Unchanged'),
    discarded: t(locale, 'Abandonné', 'Discarded'),
    provider_error: t(locale, 'Erreur du fournisseur', 'Provider error'),
    failed_before_model_call: t(locale, 'Échec avant tout appel au modèle', 'Failed before any model call'),
  }[kind];
}

export function OutcomeBadge({ locale, kind }: { locale: Locale; kind: TurnOutcomeKind }) {
  const failed = kind === 'provider_error' || kind === 'failed_before_model_call';
  return <Badge variant={failed ? 'destructive' : kind === 'committed' ? 'secondary' : 'outline'} data-outcome={kind}>{outcomeLabel(locale, kind)}</Badge>;
}

export function Unnamed({ locale }: { locale: Locale }) {
  return <span className="qp-admin-muted">{t(locale, 'Sans nom', 'Unnamed')}</span>;
}

/**
 * The admin area's frame: the application header, the area's sections, and
 * the page heading.
 */
export function AdminShell({ locale, onLanguage, section, title, description, back, actions, wide = false, children }: {
  locale: Locale;
  onLanguage: LanguageChange;
  section: AdminSection;
  title: ReactNode;
  description?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
  /** Room for a printed page beside another panel. */
  wide?: boolean;
  children: ReactNode;
}) {
  const sections = [
    { id: 'users' as const, to: '/admin', label: t(locale, 'Utilisateurs', 'Users') },
    { id: 'businesses' as const, to: '/admin/businesses', label: t(locale, 'Entreprises', 'Businesses') },
    { id: 'turns' as const, to: '/admin/turns', label: t(locale, 'Tours de l’assistant', 'Assistant Turns') },
  ];
  return <div className="qp-app qp-page" lang={locale}>
    <QuoteHeader current="admin" locale={locale} onLanguage={language => void onLanguage(language)} onList={() => undefined} />
    <main className="qp-admin" data-wide={wide || undefined}>
      <nav className="qp-admin-sections" aria-label={t(locale, 'Administration', 'Administration')}>
        {sections.map(entry => <Link key={entry.id} to={entry.to} aria-current={entry.id === section ? 'page' : undefined}>{entry.label}</Link>)}
      </nav>
      <div className="qp-page-heading">
        <div>
          {back && <Link className="qp-admin-back" to={back.to}><ArrowLeft />{back.label}</Link>}
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </main>
  </div>;
}
