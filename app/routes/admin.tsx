import { data, useLoaderData } from 'react-router';
import type { Route } from './+types/admin';
import {
  AdministrationRefusal,
  applyAdministratorAction,
  listAdministratorActions,
  listUsers,
  requireAdministrator,
} from '../lib/administration.server';
import { getArtisanForUser } from '../lib/artisan.server';
import { assertMutationOrigin } from '../lib/quotes.server';
import { getDatabase } from '../lib/db.server';
import { administratorActions, type AdministratorActionKind } from '../lib/db/schema';
import { AdminPage } from '../components/admin/admin-page';
import { useInterfaceLanguage } from '../components/quotes/use-interface-language';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

export async function loader({ request }: Route.LoaderArgs) {
  const administrator = await requireAdministrator(request);
  const database = getDatabase();
  const [profile, users, actions] = await Promise.all([
    getArtisanForUser(administrator.id, database),
    listUsers(database),
    listAdministratorActions(database),
  ]);
  return {
    locale: profile?.interfaceLanguage === 'en' ? 'en' as const : 'fr' as const,
    currentUserId: administrator.id,
    users: users.map(entry => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    actions: actions.map(entry => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const administrator = await requireAdministrator(request);
  try { assertMutationOrigin(request); } catch { throw new Response('Forbidden', { status: 403 }); }
  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const targetUserId = String(form.get('userId') ?? '');
  if (!(administratorActions as readonly string[]).includes(intent) || !targetUserId) throw new Response('Bad Request', { status: 400 });
  try {
    await applyAdministratorAction(getDatabase(), { actorUserId: administrator.id, targetUserId, action: intent as AdministratorActionKind });
    return { ok: true as const };
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
  return <AdminPage locale={locale} onLanguage={changeLanguage} currentUserId={loaded.currentUserId} users={loaded.users} actions={loaded.actions} />;
}
