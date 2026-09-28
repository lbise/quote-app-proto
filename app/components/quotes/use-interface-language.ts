import { useState } from 'react';

type Locale = 'fr' | 'en';

/** Persists the Artisan's interface language. It never changes a Quote's language. */
export function useInterfaceLanguage(initial: Locale, returnTo: string) {
  const [locale, setLocale] = useState<Locale>(initial);
  async function change(language: Locale): Promise<boolean> {
    try {
      const response = await fetch('/language', { method: 'POST', body: new URLSearchParams({ locale: language, returnTo }) });
      if (response.ok) setLocale(language);
      return response.ok;
    } catch {
      return false;
    }
  }
  return [locale, change] as const;
}
