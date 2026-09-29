import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QuoteHeader } from '../quotes/quote-header';

import type { AdministeredUser, AdministratorActionRecord, RefusalCode } from '@/lib/administration.server';
import type { AdministratorActionKind as Action } from '@/lib/db/schema';

type Locale = 'fr' | 'en';
/** Loader data: dates arrive as ISO strings. */
type Serialized<T> = Omit<T, 'createdAt'> & { createdAt: string };
export type AdminUser = Serialized<AdministeredUser>;
export type AdminActionRecord = Serialized<AdministratorActionRecord>;

const t = (locale: Locale, fr: string, en: string) => locale === 'fr' ? fr : en;

function formatDate(locale: Locale, value: string, withTime = false) {
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-CH' : 'en-GB', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value));
}

function statusLabel(locale: Locale, status: AdminUser['status']) {
  return { invited: t(locale, 'Invité', 'Invited'), active: t(locale, 'Actif', 'Active'), blocked: t(locale, 'Bloqué', 'Blocked') }[status];
}

/** One record line: the acting Administrator, what they did, and to whom. */
function recordSentence(locale: Locale, record: AdminActionRecord) {
  const actor = <strong>{record.actorEmail}</strong>;
  const target = <strong>{record.targetEmail}</strong>;
  switch (record.action) {
    case 'block': return <>{actor} {t(locale, 'a bloqué', 'blocked')} {target}</>;
    case 'unblock': return <>{actor} {t(locale, 'a débloqué', 'unblocked')} {target}</>;
    case 'grant_administrator': return locale === 'fr' ? <>{actor} a nommé administrateur {target}</> : <>{actor} made {target} an Administrator</>;
    case 'remove_administrator': return <>{actor} {t(locale, 'a retiré le rôle d’administrateur à', 'removed the Administrator role from')} {target}</>;
  }
}

function refusalMessage(locale: Locale, code: RefusalCode) {
  return {
    not_administrator: t(locale, 'Vous n’êtes plus administrateur.', 'You are no longer an Administrator.'),
    user_not_found: t(locale, 'Cet utilisateur n’existe plus.', 'This User no longer exists.'),
    self: t(locale, 'Vous ne pouvez pas vous bloquer ni retirer votre propre rôle d’administrateur.', 'You cannot block yourself or remove your own Administrator role.'),
    bootstrap_administrator: t(locale, 'Cet administrateur est défini dans ADMIN_EMAILS. Il ne peut être ni bloqué ni rétrogradé ici.', 'This Administrator is set in ADMIN_EMAILS. They cannot be blocked or demoted here.'),
    last_administrator: t(locale, 'C’est le dernier administrateur nommé ici. Nommez-en un autre avant de lui retirer le rôle.', 'This is the last Administrator granted here. Grant another before removing this role.'),
  }[code];
}

function confirmation(locale: Locale, action: Action, target: AdminUser) {
  const who = target.name || target.email;
  return {
    block: {
      title: t(locale, `Bloquer ${who} ?`, `Block ${who}?`),
      description: t(locale, 'Ses sessions sont fermées tout de suite et la connexion lui est refusée. Son entreprise, ses devis et ses clients sont conservés. Vous pourrez le débloquer.', 'Their sessions end at once and they cannot sign in. Their business, Quotes and Customers are kept. You can unblock them later.'),
      confirm: t(locale, 'Bloquer', 'Block'),
    },
    unblock: {
      title: t(locale, `Débloquer ${who} ?`, `Unblock ${who}?`),
      description: t(locale, 'Il pourra de nouveau se connecter et retrouvera son entreprise, ses devis et ses clients.', 'They can sign in again and get back their business, Quotes and Customers.'),
      confirm: t(locale, 'Débloquer', 'Unblock'),
    },
    grant_administrator: {
      title: t(locale, `Nommer ${who} administrateur ?`, `Make ${who} an Administrator?`),
      description: t(locale, 'Il pourra voir et gérer toutes les entreprises et tous les utilisateurs d’Easy Quote.', 'They will be able to see and manage every Artisan Business and User in Easy Quote.'),
      confirm: t(locale, 'Nommer administrateur', 'Make Administrator'),
    },
    remove_administrator: {
      title: t(locale, `Retirer le rôle d’administrateur à ${who} ?`, `Remove ${who}’s Administrator role?`),
      description: t(locale, 'Il gardera l’accès à sa propre entreprise, mais plus à l’administration.', 'They keep access to their own business, but not to the admin area.'),
      confirm: t(locale, 'Retirer le rôle', 'Remove role'),
    },
  }[action];
}

export function AdminPage({ locale, onLanguage, currentUserId, users, actions }: {
  locale: Locale; onLanguage: (locale: Locale) => Promise<boolean>; currentUserId: string; users: AdminUser[]; actions: AdminActionRecord[];
}) {
  const fetcher = useFetcher<{ ok: true } | { error: RefusalCode }>();
  const [pending, setPending] = useState<{ action: Action; target: AdminUser } | null>(null);
  const busy = fetcher.state !== 'idle';
  const refusal = fetcher.state === 'idle' && fetcher.data && 'error' in fetcher.data ? fetcher.data.error : null;

  useEffect(() => { if (fetcher.state === 'idle' && fetcher.data) setPending(null); }, [fetcher.state, fetcher.data]);

  function confirm() {
    if (!pending) return;
    void fetcher.submit({ intent: pending.action, userId: pending.target.id }, { method: 'post' });
  }

  const dialog = pending ? confirmation(locale, pending.action, pending.target) : null;

  return <div className="qp-app qp-page" lang={locale}>
    <QuoteHeader current="admin" locale={locale} onLanguage={language => void onLanguage(language)} onList={() => undefined} />
    <main className="qp-admin">
      <div className="qp-page-heading">
        <div><h1>Administration</h1><p>{t(locale, 'Gérez qui peut se connecter à Easy Quote et qui peut l’administrer.', 'Manage who can sign in to Easy Quote and who can administer it.')}</p></div>
      </div>

      {refusal && <Alert variant="destructive" className="qp-admin-alert"><TriangleAlert /><AlertTitle>{t(locale, 'Action refusée', 'Action refused')}</AlertTitle><AlertDescription>{refusalMessage(locale, refusal)}</AlertDescription></Alert>}

      <section className="qp-panel" aria-labelledby="admin-users-heading">
        <header className="qp-panel-header">
          <h2 id="admin-users-heading">{t(locale, 'Utilisateurs', 'Users')}</h2>
          <p>{users.length === 1 ? t(locale, '1 utilisateur', '1 User') : t(locale, `${users.length} utilisateurs`, `${users.length} Users`)}</p>
        </header>
        <div className="qp-admin-table-scroll">
          <table className="qp-admin-table">
            <thead><tr>
              <th scope="col">{t(locale, 'Utilisateur', 'User')}</th>
              <th scope="col">{t(locale, 'Statut', 'Status')}</th>
              <th scope="col">{t(locale, 'Rôle', 'Role')}</th>
              <th scope="col">{t(locale, 'Entreprise', 'Artisan Business')}</th>
              <th scope="col">{t(locale, 'Créé le', 'Created')}</th>
              <th scope="col"><span className="sr-only">{t(locale, 'Actions', 'Actions')}</span></th>
            </tr></thead>
            <tbody>
              {users.map(entry => {
                const self = entry.id === currentUserId;
                const bootstrap = entry.administrator === 'bootstrap';
                return <tr key={entry.id} data-status={entry.status}>
                  <td><div className="qp-admin-user"><strong>{entry.name}{self && ` (${t(locale, 'vous', 'you')})`}</strong><span>{entry.email}</span></div></td>
                  <td><Badge variant={entry.status === 'blocked' ? 'destructive' : entry.status === 'active' ? 'secondary' : 'outline'}>{statusLabel(locale, entry.status)}</Badge></td>
                  <td>{entry.administrator === 'none' ? <span className="qp-admin-muted">—</span> : <span>{t(locale, 'Administrateur', 'Administrator')}{bootstrap && <small>ADMIN_EMAILS</small>}</span>}</td>
                  <td>{entry.business ? (entry.business.name || <span className="qp-admin-muted">{t(locale, 'Sans nom', 'Unnamed')}</span>) : <span className="qp-admin-muted">—</span>}</td>
                  <td><time dateTime={entry.createdAt}>{formatDate(locale, entry.createdAt)}</time></td>
                  <td><div className="qp-admin-actions">
                    {entry.status === 'blocked'
                      ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPending({ action: 'unblock', target: entry })}>{t(locale, 'Débloquer', 'Unblock')}</Button>
                      : !self && !bootstrap && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPending({ action: 'block', target: entry })}>{t(locale, 'Bloquer', 'Block')}</Button>}
                    {entry.administrator === 'none' && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setPending({ action: 'grant_administrator', target: entry })}>{t(locale, 'Nommer administrateur', 'Make Administrator')}</Button>}
                    {entry.administrator === 'granted' && !self && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setPending({ action: 'remove_administrator', target: entry })}>{t(locale, 'Retirer le rôle', 'Remove Administrator')}</Button>}
                  </div></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="qp-panel" aria-labelledby="admin-record-heading">
        <header className="qp-panel-header">
          <h2 id="admin-record-heading">{t(locale, 'Historique des actions', 'Administrator actions')}</h2>
          <p>{t(locale, 'Chaque blocage, déblocage et changement de rôle, du plus récent au plus ancien.', 'Every block, unblock and role change, newest first.')}</p>
        </header>
        {actions.length === 0
          ? <p className="qp-admin-empty">{t(locale, 'Aucune action pour le moment.', 'No actions yet.')}</p>
          : <ol className="qp-admin-record">
            {actions.map(record => <li key={record.id}>
              <time dateTime={record.createdAt}>{formatDate(locale, record.createdAt, true)}</time>
              <span>{recordSentence(locale, record)}</span>
            </li>)}
          </ol>}
      </section>
    </main>

    <AlertDialog open={pending !== null} onOpenChange={open => { if (!open && !busy) setPending(null); }}>
      <AlertDialogContent className="qp-modal" lang={locale}>
        {dialog && pending && <>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{dialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="qp-admin-identity">{pending.target.email}</p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t(locale, 'Annuler', 'Cancel')}</AlertDialogCancel>
            <Button type="button" variant={pending.action === 'block' ? 'destructive' : 'default'} disabled={busy} onClick={confirm}>{dialog.confirm}</Button>
          </AlertDialogFooter>
        </>}
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
