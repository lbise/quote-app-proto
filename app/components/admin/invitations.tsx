import { useEffect, useId, useRef } from 'react';
import { useFetcher } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formatDate, refusalMessage, t, type AdminActionResult, type Locale } from './admin-shell';

import type { AdministeredInvitation, InvitationState } from '@/lib/administration.server';

/** Loader data: dates arrive as ISO strings. */
export type AdminInvitation = Omit<AdministeredInvitation, 'sentAt' | 'expiresAt'> & { sentAt: string; expiresAt: string };
export type InvitationAction = 'resend_invitation' | 'cancel_invitation';

function stateLabel(locale: Locale, state: InvitationState) {
  return {
    pending: t(locale, 'Invitation en attente', 'Invitation pending'),
    expired: t(locale, 'Invitation expirée', 'Invitation expired'),
    cancelled: t(locale, 'Invitation annulée', 'Invitation cancelled'),
  }[state];
}

export function invitationConfirmation(locale: Locale, action: InvitationAction, target: AdminInvitation) {
  return {
    resend_invitation: {
      title: t(locale, `Renvoyer l’invitation à ${target.email} ?`, `Resend the invitation to ${target.email}?`),
      description: t(locale, 'Un nouveau lien, valable 7 jours, lui est envoyé. Le lien précédent ne fonctionnera plus.', 'They are emailed a new link, valid for 7 days. The previous link stops working.'),
      confirm: t(locale, 'Renvoyer', 'Resend'),
    },
    cancel_invitation: {
      title: t(locale, `Annuler l’invitation de ${target.email} ?`, `Cancel the invitation to ${target.email}?`),
      description: t(locale, 'Son lien ne fonctionnera plus. L’invitation reste dans la liste et vous pourrez la renvoyer.', 'Their link stops working. The invitation stays in the list and you can resend it.'),
      confirm: t(locale, 'Annuler l’invitation', 'Cancel invitation'),
    },
  }[action];
}

/** An invitation not yet accepted, as a row of the User list. */
export function InvitationRow({ locale, invitation, busy, onAction }: {
  locale: Locale; invitation: AdminInvitation; busy: boolean; onAction: (action: InvitationAction) => void;
}) {
  return <tr data-invitation={invitation.state}>
    <td><div className="qp-admin-user"><strong>{invitation.email}</strong><span>{t(locale, `Invité par ${invitation.invitedByEmail}`, `Invited by ${invitation.invitedByEmail}`)}</span></div></td>
    <td><Badge variant={invitation.state === 'pending' ? 'outline' : 'secondary'}>{stateLabel(locale, invitation.state)}</Badge></td>
    <td>{invitation.administrator ? <span>{t(locale, 'Administrateur', 'Administrator')}</span> : <span className="qp-admin-muted">—</span>}</td>
    <td><span className="qp-admin-muted">—</span></td>
    <td>
      <span>{t(locale, 'Envoyée le', 'Sent')} <time dateTime={invitation.sentAt}>{formatDate(locale, invitation.sentAt)}</time></span>
      {invitation.state === 'pending' && <small>{t(locale, 'Expire le', 'Expires')} <time dateTime={invitation.expiresAt}>{formatDate(locale, invitation.expiresAt)}</time></small>}
    </td>
    <td><div className="qp-admin-actions">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => onAction('resend_invitation')}>{t(locale, 'Renvoyer', 'Resend')}</Button>
      {invitation.state !== 'cancelled' && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onAction('cancel_invitation')}>{t(locale, 'Annuler', 'Cancel')}</Button>}
    </div></td>
  </tr>;
}

export function InviteDialog({ locale, open, onClose, onSent }: {
  locale: Locale; open: boolean; onClose: () => void; onSent: (email: string) => void;
}) {
  return <Dialog open={open} onOpenChange={next => { if (!next) onClose(); }}>
    <DialogContent className="qp-modal" lang={locale}>
      {/* Mounted only while open, so each invitation starts from an empty form. */}
      {open && <InviteForm locale={locale} onClose={onClose} onSent={onSent} />}
    </DialogContent>
  </Dialog>;
}

function InviteForm({ locale, onClose, onSent }: { locale: Locale; onClose: () => void; onSent: (email: string) => void }) {
  const id = useId();
  const fetcher = useFetcher<AdminActionResult>();
  const email = useRef('');
  const sending = fetcher.state !== 'idle';
  const refusal = fetcher.state === 'idle' && fetcher.data && 'error' in fetcher.data ? fetcher.data.error : null;

  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data && 'ok' in fetcher.data) onSent(email.current);
  }, [fetcher.state, fetcher.data, onSent]);

  return <fetcher.Form method="post" onSubmit={event => { email.current = String(new FormData(event.currentTarget).get('email') ?? '').trim().toLowerCase(); }}>
    <input type="hidden" name="intent" value="invite" />
    <DialogHeader>
      <DialogTitle>{t(locale, 'Inviter une personne', 'Invite someone')}</DialogTitle>
      <DialogDescription>{t(locale,
        'Elle reçoit un lien pour créer son compte et choisir son mot de passe. Le lien est valable 7 jours et ne sert qu’une fois. L’e-mail lui indique que les administrateurs peuvent lire ses devis et ses conversations.',
        'They are emailed a link to create their account and choose their password. The link is valid for 7 days and works once. The email tells them that Administrators can read their Quotes and conversations.')}</DialogDescription>
    </DialogHeader>
    <FieldGroup className="qp-admin-invite-fields">
      <Field data-disabled={sending || undefined}>
        <FieldLabel htmlFor={`${id}-email`}>{t(locale, 'E-mail', 'Email')}</FieldLabel>
        <Input id={`${id}-email`} name="email" type="email" required autoComplete="off" disabled={sending} autoFocus />
      </Field>
      <Field orientation="horizontal" data-disabled={sending || undefined}>
        <input id={`${id}-administrator`} name="administrator" type="checkbox" disabled={sending} />
        <div>
          <FieldLabel htmlFor={`${id}-administrator`}>{t(locale, 'Nommer administrateur', 'Make them an Administrator')}</FieldLabel>
          <FieldDescription>{t(locale, 'Dès son inscription, il pourra voir et gérer toutes les entreprises et tous les utilisateurs.', 'Once signed up, they can see and manage every Artisan Business and User.')}</FieldDescription>
        </div>
      </Field>
      {refusal && <Alert variant="destructive" role="alert"><TriangleAlert /><AlertTitle>{t(locale, 'Invitation non envoyée', 'Invitation not sent')}</AlertTitle><AlertDescription>{refusalMessage(locale, refusal)}</AlertDescription></Alert>}
    </FieldGroup>
    <DialogFooter>
      <Button type="button" variant="outline" disabled={sending} onClick={onClose}>{t(locale, 'Annuler', 'Cancel')}</Button>
      <Button type="submit" disabled={sending}>{sending ? t(locale, 'Envoi…', 'Sending…') : t(locale, 'Envoyer l’invitation', 'Send invitation')}</Button>
    </DialogFooter>
  </fetcher.Form>;
}
