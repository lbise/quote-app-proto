import { useLoaderData } from 'react-router';
import type { Route } from './+types/admin.business';
import { adminPage, asAdministrator } from '../lib/admin-area.server';
import { readArtisanBusiness } from '../lib/admin-inspection.server';
import { adminPaths } from '../components/admin/admin-shell';
import { BusinessPage } from '../components/admin/businesses-page';
import { useInterfaceLanguage } from '../components/quotes/use-interface-language';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

export async function loader({ request, params }: Route.LoaderArgs) {
  const { administratorId, locale, database } = await adminPage(request);
  const opened = await asAdministrator(() => readArtisanBusiness(database, administratorId, params.businessId ?? ''));
  if (!opened) throw new Response('Not Found', { status: 404 });
  return { locale, ...opened };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.business.name || (loaderData?.locale === 'en' ? 'Unnamed business' : 'Entreprise sans nom');
  return [{ title: `${name} | Easy Quote` }];
}

export default function AdminBusiness() {
  const loaded = useLoaderData<typeof loader>();
  const [locale, changeLanguage] = useInterfaceLanguage(loaded.locale, adminPaths.business(loaded.business.id));
  return <BusinessPage locale={locale} onLanguage={changeLanguage} business={loaded.business} quotes={loaded.quotes} />;
}
