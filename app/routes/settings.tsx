import { redirect, useLoaderData } from 'react-router';
import type { Route } from './+types/settings';
import { requireApprovedArtisan } from '../lib/auth.server';
import { SettingsPage, settingsSections, type SettingsSection } from '../components/settings/settings-page';
import { useInterfaceLanguage } from '../components/quotes/use-interface-language';
import '../components/quotes/quotes.css';
import '../components/quotes/app-pages.css';

export async function loader({ request, params }: Route.LoaderArgs) {
  const access = await requireApprovedArtisan(request);
  const section = params.section;
  if (!section || !(settingsSections as readonly string[]).includes(section)) throw redirect('/settings/business');
  return {
    locale: access.artisan.interfaceLanguage === 'en' ? 'en' as const : 'fr' as const,
    email: access.user.email,
    section: section as SettingsSection,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: loaderData?.locale === 'en' ? 'Settings | Easy Quote' : 'Paramètres | Easy Quote' }];
}

export default function Settings() {
  const { locale: initial, email, section } = useLoaderData<typeof loader>();
  const [locale, changeLanguage] = useInterfaceLanguage(initial, `/settings/${section}`);
  return <SettingsPage locale={locale} onLanguage={changeLanguage} section={section} email={email} />;
}
