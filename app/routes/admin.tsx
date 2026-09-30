import { data, useLoaderData } from 'react-router';
import type { Route } from './+types/admin';
import {
  AdministrationRefusal,
  applyAdministratorAction,
  cancelInvitation,
  listAdministratorActions,
  listInvitations,
  listUsers,
  requireAdministrator,
  resendInvitation,
  sendInvitation,
} from '../lib/administration.server';
import { getArtisanForUser } from '../lib/artisan.server';
import { assertMutationOrigin } from '../lib/quotes.server';
import { getDatabase } from '../lib/db.server';
import { userActions, type UserActionKind } from '../lib/db/schema';
import { AdminPage } from '../components/admin/admin-page';
import { useInterfaceLanguage } from '../components/quotes/use-interface-language';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

export async function loader({ request }: Route.LoaderArgs) {
  const administrator = await requireAdministrator(request);
  const database = getDatabase();
  const [profile, users, invitations, actions] = await Promise.all([
    getArtisanForUser(administrator.id, database),
    listUsers(database),
    listInvitations(database),
    listAdministratorActions(database),
  ]);
  return {
    locale: profile?.interfaceLanguage === 'en' ? 'en' as const : 'fr' as const,
    currentUserId: administrator.id,
    users: users.map(entry => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    invitations: invitations.map(entry => ({ ...entry, sentAt: entry.sentAt.toISOString(), expiresAt: entry.expiresAt.toISOString() })),
    actions: actions.map(entry => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const administrator = await requireAdministrator(request);
  try { assertMutationOrigin(request); } catch { throw new Response('Forbidden', { status: 403 }); }
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const database = getDatabase();
  const actorUserId = administrator.id;
  try {
    if (intent === 'invite') {
      const text = (name: string) => { const value = form.get(name); return typeof value === 'string' ? value : undefined; };
      await sendInvitation(database, {
        actorUserId,
        email: String(form.get('email') ?? ''),
        administrator: form.get('administrator') === 'on',
        subject: text('subject'),
        message: text('message'),
      });
      return { ok: true as const, intent };
    }
    if (intent === 'resend_invitation' || intent === 'cancel_invitation') {
      const invitationId = String(form.get('invitationId') ?? '');
      if (!invitationId) throw new Response('Bad Request', { status: 400 });
      if (intent === 'resend_invitation') await resendInvitation(database, { actorUserId, invitationId });
      else await cancelInvitation(database, { actorUserId, invitationId });
      return { ok: true as const, intent };
    }
    const targetUserId = String(form.get('userId') ?? '');
    if (!(userActions as readonly string[]).includes(intent) || !targetUserId) throw new Response('Bad Request', { status: 400 });
    await applyAdministratorAction(database, { actorUserId, targetUserId, action: intent as UserActionKind });
    return { ok: true as const, intent };
  } catch (error) {
    if (error instanceof AdministrationRefusal) return data({ error: error.code }, { status: 409 });
    throw error;
  }
}

export function meta() {
  return [{ title: 'Administration | Easy Quote' }];
}

export default function Admin() {
  const loaded = useLoaderData<typeof loader>();
  const [locale, changeLanguage] = useInterfaceLanguage(loaded.locale, '/admin');
  return <AdminPage locale={locale} onLanguage={changeLanguage} currentUserId={loaded.currentUserId} users={loaded.users} invitations={loaded.invitations} actions={loaded.actions} />;
}
