import { useLoaderData } from 'react-router';
import type { Route } from './+types/admin.turns';
import { adminPage, asAdministrator } from '../lib/admin-area.server';
import { listUsers } from '../lib/administration.server';
import { quote } from '../lib/db/schema';
import { isDay, listTurnTraces, type TurnTraceFilter } from '../lib/turn-traces.server';
import { turnOutcomeKinds, type TurnOutcomeKind } from '../lib/turn-trace';
import { TurnsPage } from '../components/admin/turns-page';
import { useInterfaceLanguage } from '../components/quotes/use-interface-language';
import { eq } from 'drizzle-orm';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

/** The filter in the list URL. Unknown values are ignored. */
function filterFrom(params: URLSearchParams): TurnTraceFilter {
  const value = (name: string) => params.get(name)?.trim() || undefined;
  const outcome = value('outcome');
  const from = value('from');
  const to = value('to');
  return {
    ...(outcome && (turnOutcomeKinds as readonly string[]).includes(outcome) ? { outcomeKind: outcome as TurnOutcomeKind } : {}),
    ...(value('user') ? { userId: value('user') } : {}),
    ...(value('quote') ? { quoteId: value('quote') } : {}),
    ...(from && isDay(from) ? { from } : {}),
    ...(to && isDay(to) ? { to } : {}),
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const { administratorId, locale, database } = await adminPage(request);
  const params = new URL(request.url).searchParams;
  const filter = filterFrom(params);
  const page = /^\d{1,6}$/.test(params.get('page') ?? '') ? Math.max(1, Number(params.get('page'))) : 1;
  const [{ traces, hasMore }, users, [scope]] = await Promise.all([
    asAdministrator(() => listTurnTraces(database, administratorId, filter, { page })),
    listUsers(database),
    filter.quoteId ? database.select({ id: quote.id, reference: quote.reference }).from(quote).where(eq(quote.id, filter.quoteId)).limit(1) : Promise.resolve([]),
  ]);
  return {
    locale, traces, hasMore, page, filter,
    users: users.map(entry => ({ id: entry.id, name: entry.name, email: entry.email })),
    quote: scope ?? null,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.locale === 'en' ? 'Assistant Turns | Easy Quote' : 'Tours de l’assistant | Easy Quote' }];
}

export default function AdminTurns() {
  const loaded = useLoaderData<typeof loader>();
  const [locale, changeLanguage] = useInterfaceLanguage(loaded.locale, '/admin/turns');
  return <TurnsPage locale={locale} onLanguage={changeLanguage} traces={loaded.traces} hasMore={loaded.hasMore} page={loaded.page} filter={loaded.filter} users={loaded.users} quote={loaded.quote} />;
}
