import { useLoaderData } from 'react-router';
import type { Route } from './+types/customers';
import { requireApprovedArtisan } from '../lib/auth.server';
import { CustomersPage } from '../components/customers/customers-page';
import { useInterfaceLanguage } from '../components/quotes/use-interface-language';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

export async function loader({ request }: Route.LoaderArgs) {
  const access = await requireApprovedArtisan(request);
  return { locale: access.artisan.interfaceLanguage === 'en' ? 'en' as const : 'fr' as const };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.locale === 'en' ? 'Customers | Easy Quote' : 'Clients | Easy Quote' }];
}

export default function Customers() {
  const { locale: initial } = useLoaderData<typeof loader>();
  const [locale, changeLanguage] = useInterfaceLanguage(initial, '/customers');
  return <CustomersPage locale={locale} onLanguage={changeLanguage} />;
}
