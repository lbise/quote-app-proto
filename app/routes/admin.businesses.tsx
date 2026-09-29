import { useLoaderData } from 'react-router';
import type { Route } from './+types/admin.businesses';
import { adminPage, asAdministrator } from '../lib/admin-area.server';
import { listArtisanBusinesses } from '../lib/admin-inspection.server';
import { BusinessesPage } from '../components/admin/businesses-page';
import { useInterfaceLanguage } from '../components/quotes/use-interface-language';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

export async function loader({ request }: Route.LoaderArgs) {
  const { administratorId, locale, database } = await adminPage(request);
  return { locale, businesses: await asAdministrator(() => listArtisanBusinesses(database, administratorId)) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.locale === 'en' ? 'Artisan Businesses | Easy Quote' : 'Entreprises | Easy Quote' }];
}

export default function AdminBusinesses() {
  const loaded = useLoaderData<typeof loader>();
  const [locale, changeLanguage] = useInterfaceLanguage(loaded.locale, '/admin/businesses');
  return <BusinessesPage locale={locale} onLanguage={changeLanguage} businesses={loaded.businesses} />;
}
