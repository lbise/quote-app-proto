import { data, useLoaderData } from 'react-router';
import type { Route } from './+types/admin.turn';
import { adminPage, asAdministrator } from '../lib/admin-area.server';
import { readTurnTrace } from '../lib/turn-traces.server';
import { MissingTurnTracePage, TurnTracePage } from '../components/admin/turn-trace-page';
import { useInterfaceLanguage } from '../components/quotes/use-interface-language';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

/** A Turn Trace's stable URL, which problem reports link to (#45). A trace that is gone reads as not found. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const { administratorId, locale, database } = await adminPage(request);
  const trace = await asAdministrator(() => readTurnTrace(database, administratorId, params.traceId ?? ''));
  if (!trace) return data({ locale, trace: null }, { status: 404, headers: { 'cache-control': 'no-store' } });
  return data({ locale, trace }, { headers: { 'cache-control': 'no-store' } });
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.locale === 'en' ? 'Turn Trace | Easy Quote' : 'Trace du tour | Easy Quote' }];
}

export default function AdminTurn() {
  const loaded = useLoaderData<typeof loader>();
  const [locale, changeLanguage] = useInterfaceLanguage(loaded.locale, loaded.trace ? `/admin/turns/${encodeURIComponent(loaded.trace.id)}` : '/admin/turns');
  return loaded.trace
    ? <TurnTracePage locale={locale} onLanguage={changeLanguage} trace={loaded.trace} />
    : <MissingTurnTracePage locale={locale} onLanguage={changeLanguage} />;
}
