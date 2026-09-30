import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Form, Link, useBlocker } from 'react-router';
import { Building2, FileText, LogOut, Percent, TriangleAlert, UserRound } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { QuoteData } from '@/lib/quote';
import { BusinessLogoField } from '../quotes/business-logo-field';
import { AppShell } from '../app-shell';
import { setAppearance, themes, useAppearance, type Theme } from '@/lib/appearance';

type Locale = 'fr' | 'en';
type Defaults = Partial<QuoteData>;
export const settingsSections = ['business', 'vat', 'quotes', 'account'] as const;
export type SettingsSection = typeof settingsSections[number];

const t = (locale: Locale, fr: string, en: string) => locale === 'fr' ? fr : en;

function sectionCopy(locale: Locale) {
  return {
    business: { icon: Building2, label: t(locale, 'Entreprise', 'Business'), hint: t(locale, 'Nom, adresse, logo', 'Name, address, logo'), title: t(locale, 'Votre entreprise', 'Your business'), description: t(locale, 'Ces coordonnées sont copiées dans chaque nouveau devis. Les devis existants gardent celles qu’ils contiennent.', 'These details are copied into each new Quote. Existing Quotes keep the details they already have.') },
    vat: { icon: Percent, label: t(locale, 'TVA', 'VAT'), hint: t(locale, 'Assujettissement, numéro', 'Registration, identifier'), title: t(locale, 'TVA', 'VAT'), description: t(locale, 'Le statut TVA des nouveaux devis. Vous pouvez le laisser à préciser et commencer un devis quand même.', 'The VAT status of new Quotes. You can leave it to confirm and still start a Quote.') },
    quotes: { icon: FileText, label: t(locale, 'Devis', 'Quote defaults'), hint: t(locale, 'Conditions par défaut', 'Default terms'), title: t(locale, 'Valeurs par défaut des devis', 'Quote defaults'), description: t(locale, 'Ajoutées à chaque nouveau devis. Vous pouvez toujours les modifier dans un devis.', 'Added to each new Quote. You can still change them on each Quote.') },
    account: { icon: UserRound, label: t(locale, 'Compte', 'Account'), hint: t(locale, 'Langue, thème, déconnexion', 'Language, theme, sign out'), title: t(locale, 'Compte', 'Account'), description: t(locale, 'Vos préférences sur cet espace Easy Quote.', 'Your preferences for this Easy Quote workspace.') },
  } satisfies Record<SettingsSection, unknown>;
}

export function SettingsPage({ locale, onLanguage, section, email }: {
  locale: Locale; onLanguage: (locale: Locale) => Promise<boolean>; section: SettingsSection; email: string;
}) {
  const copy = sectionCopy(locale);
  const { theme } = useAppearance();
  const current = copy[section];
  const [defaults, setDefaults] = useState<Defaults>({});
  const [saved, setSaved] = useState<Defaults>({});
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<'loading' | 'idle' | 'saving'>('loading');
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [vatIdError, setVatIdError] = useState(false);
  const [languageError, setLanguageError] = useState(false);
  const dirty = loaded && JSON.stringify(defaults) !== JSON.stringify(saved);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname);
  const busy = !loaded || status !== 'idle';

  async function load(signal?: AbortSignal) {
    setStatus('loading'); setLoadError(false);
    try {
      const response = await fetch('/api/quotes', { signal });
      if (!response.ok) throw new Error('load');
      const data = await response.json() as { defaults?: Defaults };
      setDefaults(data.defaults ?? {}); setSaved(data.defaults ?? {});
      setLoaded(true); setStatus('idle');
    } catch {
      if (signal?.aborted) return;
      setLoadError(true); setStatus('idle');
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => { setSavedNotice(false); setSaveError(false); setVatIdError(false); setLanguageError(false); }, [section]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function update<K extends keyof QuoteData>(key: K, value: QuoteData[K]) {
    setDefaults(currentDefaults => ({ ...currentDefaults, [key]: value }));
    setSavedNotice(false);
    if (key === 'vatId' || key === 'vatRegistered') setVatIdError(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !dirty) return;
    setSavedNotice(false); setSaveError(false);
    if (defaults.vatRegistered === true && !defaults.vatId?.trim()) {
      setVatIdError(true);
      document.getElementById('settings-vat-id')?.focus();
      return;
    }
    setStatus('saving');
    try {
      const response = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'defaults-save', defaults }),
      });
      if (!response.ok) throw new Error('save');
      const data = await response.json() as { defaults?: Defaults };
      setDefaults(data.defaults ?? defaults); setSaved(data.defaults ?? defaults);
      setSavedNotice(true);
    } catch {
      setSaveError(true);
    } finally {
      setStatus('idle');
    }
  }

  function discard() {
    setDefaults({ ...saved }); setVatIdError(false); setSaveError(false);
  }

  function logoUploaded(logoId: string) {
    setDefaults(currentDefaults => ({ ...currentDefaults, logoId }));
    setSaved(currentSaved => ({ ...currentSaved, logoId }));
  }

  /** Removing the logo saves at once, like uploading. Other unsaved edits stay in the form. */
  async function removeLogo(): Promise<boolean> {
    try {
      const response = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'defaults-save', defaults: { ...saved, logoId: '' } }),
      });
      if (!response.ok) return false;
      setDefaults(currentDefaults => ({ ...currentDefaults, logoId: '' }));
      setSaved(currentSaved => ({ ...currentSaved, logoId: '' }));
      return true;
    } catch {
      return false;
    }
  }

  async function changeLanguage(value: string) {
    if (value !== 'fr' && value !== 'en') return;
    setLanguageError(!(await onLanguage(value)));
  }

  const statusText = status === 'loading' ? t(locale, 'Chargement…', 'Loading…')
    : status === 'saving' ? t(locale, 'Enregistrement…', 'Saving…')
    : savedNotice ? t(locale, 'Enregistré pour les nouveaux devis. Les devis existants sont inchangés.', 'Saved for new Quotes. Existing Quotes are unchanged.')
    : dirty ? t(locale, 'Modifications non enregistrées', 'Unsaved changes')
    : '';

  const fields = section === 'business' ? <FieldGroup>
    <BusinessLogoField locale={locale} logoId={defaults.logoId || undefined} disabled={busy} onUploaded={logoUploaded} onRemove={removeLogo} />
    <Field data-disabled={busy || undefined}>
      <FieldLabel htmlFor="settings-business-name">{t(locale, 'Raison sociale', 'Business name')}</FieldLabel>
      <Input id="settings-business-name" value={defaults.businessName ?? ''} disabled={busy} onChange={event => update('businessName', event.target.value)} />
    </Field>
    <Field data-disabled={busy || undefined}>
      <FieldLabel htmlFor="settings-business-address">{t(locale, 'Adresse', 'Address')}</FieldLabel>
      <Textarea id="settings-business-address" rows={3} value={defaults.businessAddress ?? ''} disabled={busy} onChange={event => update('businessAddress', event.target.value)} />
    </Field>
    <Field data-disabled={busy || undefined}>
      <FieldLabel htmlFor="settings-business-contact">{t(locale, 'Coordonnées', 'Contact details')}</FieldLabel>
      <Input id="settings-business-contact" value={defaults.businessContact ?? ''} disabled={busy} onChange={event => update('businessContact', event.target.value)} />
      <FieldDescription>{t(locale, 'Par exemple e-mail et téléphone, sur une ligne.', 'For example email and phone, on one line.')}</FieldDescription>
    </Field>
  </FieldGroup>
    : section === 'vat' ? <FieldGroup>
      <Field data-disabled={busy || undefined}>
        <FieldLabel htmlFor="settings-vat-registered">{t(locale, 'Assujetti à la TVA', 'VAT registered')}</FieldLabel>
        <select id="settings-vat-registered" value={defaults.vatRegistered === null || defaults.vatRegistered === undefined ? 'unknown' : defaults.vatRegistered ? 'yes' : 'no'} disabled={busy} onChange={event => update('vatRegistered', event.target.value === 'unknown' ? null : event.target.value === 'yes')}>
          <option value="unknown">{t(locale, 'À préciser', 'To confirm')}</option>
          <option value="yes">{t(locale, 'Oui', 'Yes')}</option>
          <option value="no">{t(locale, 'Non', 'No')}</option>
        </select>
        <FieldDescription>{t(locale, 'Les devis assujettis prennent en charge uniquement les travaux au taux normal actuel de 8,1 %. Les autres traitements fiscaux ne sont pas pris en charge.', 'Registered Quotes support work at the current 8.1% standard rate only. Other tax treatments are unsupported.')}</FieldDescription>
      </Field>
      <Field data-invalid={vatIdError || undefined} data-disabled={busy || undefined}>
        <FieldLabel htmlFor="settings-vat-id">{t(locale, 'Numéro TVA', 'VAT identifier')}</FieldLabel>
        <Input id="settings-vat-id" value={defaults.vatId ?? ''} disabled={busy} required={defaults.vatRegistered === true} aria-invalid={vatIdError} aria-describedby={vatIdError ? 'settings-vat-id-error' : 'settings-vat-id-help'} onChange={event => update('vatId', event.target.value)} />
        {vatIdError
          ? <FieldError id="settings-vat-id-error">{t(locale, "Indiquez le numéro TVA de l'entreprise assujettie.", 'Enter the VAT identifier for a registered business.')}</FieldError>
          : <FieldDescription id="settings-vat-id-help">{t(locale, 'Obligatoire si l’entreprise est assujettie. Par exemple CHE-123.456.789 TVA.', 'Required when the business is registered. For example CHE-123.456.789 TVA.')}</FieldDescription>}
      </Field>
    </FieldGroup>
    : section === 'quotes' ? <FieldGroup>
      <Field data-disabled={busy || undefined}>
        <FieldLabel htmlFor="settings-terms">{t(locale, 'Conditions par défaut', 'Default terms')}</FieldLabel>
        <Textarea id="settings-terms" rows={7} value={defaults.terms ?? ''} disabled={busy} onChange={event => update('terms', event.target.value)} />
        <FieldDescription>{t(locale, 'Facultatif. Par exemple acompte, délai de paiement et garantie. Rédigées dans la langue de vos devis.', 'Optional. For example deposit, payment period and warranty. Write them in the language of your Quotes.')}</FieldDescription>
      </Field>
    </FieldGroup>
    : null;

  return <AppShell className="qp-page" current="settings" locale={locale} onLanguage={language => void changeLanguage(language)}>
    <main className="qp-settings">
      <div className="qp-page-heading">
        <div><h1>{t(locale, 'Paramètres', 'Settings')}</h1><p>{t(locale, 'Les valeurs par défaut s’appliquent aux nouveaux devis. Les devis existants ne changent jamais.', 'Defaults apply to new Quotes. Existing Quotes never change.')}</p></div>
      </div>
      <div className="qp-settings-layout">
        <nav className="qp-settings-nav" aria-label={t(locale, 'Sections des paramètres', 'Settings sections')}>
          {settingsSections.map(id => {
            const { icon: Icon, label, hint } = copy[id];
            return <Link key={id} to={`/settings/${id}`} aria-current={id === section ? 'page' : undefined}><Icon /><span><strong>{label}</strong><small>{hint}</small></span></Link>;
          })}
        </nav>

        <section className="qp-panel qp-settings-panel" aria-labelledby="settings-section-title">
          <header className="qp-panel-header">
            <h2 id="settings-section-title">{current.title}</h2>
            <p>{current.description}</p>
          </header>

          {section === 'account' ? <div className="qp-panel-body qp-account">
            <dl><dt>{t(locale, 'Connecté en tant que', 'Signed in as')}</dt><dd>{email}</dd></dl>
            <Field>
              <FieldLabel id="settings-language-label">{t(locale, 'Langue de l’interface', 'Interface language')}</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={locale} onValueChange={value => void changeLanguage(value)} aria-labelledby="settings-language-label" aria-describedby="settings-language-help">
                <ToggleGroupItem value="fr" lang="fr">Français</ToggleGroupItem>
                <ToggleGroupItem value="en" lang="en">English</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription id="settings-language-help">{t(locale, 'Change uniquement la langue de l’application. Vos devis gardent leur propre langue.', 'Changes only the app’s language. Your Quotes keep their own language.')}</FieldDescription>
              {languageError && <FieldError>{t(locale, 'La langue n’a pas été changée. Réessayez.', 'The language was not changed. Try again.')}</FieldError>}
            </Field>
            <Field>
              <FieldLabel id="settings-theme-label">{t(locale, 'Thème', 'Theme')}</FieldLabel>
              <ToggleGroup type="single" variant="outline" value={theme} onValueChange={value => { if ((themes as readonly string[]).includes(value)) setAppearance('theme', value as Theme); }} aria-labelledby="settings-theme-label" aria-describedby="settings-theme-help">
                <ToggleGroupItem value="light">{t(locale, 'Clair', 'Light')}</ToggleGroupItem>
                <ToggleGroupItem value="dark">{t(locale, 'Sombre', 'Dark')}</ToggleGroupItem>
                <ToggleGroupItem value="system">{t(locale, 'Système', 'System')}</ToggleGroupItem>
              </ToggleGroup>
              <FieldDescription id="settings-theme-help">{t(locale, 'Système suit le réglage de votre appareil. Enregistré sur cet appareil.', 'System follows your device setting. Saved on this device.')}</FieldDescription>
            </Field>
            <Form method="post" action="/sign-out" className="qp-account-signout">
              <Button type="submit" variant="outline"><LogOut data-icon="inline-start" />{t(locale, 'Se déconnecter', 'Sign out')}</Button>
            </Form>
          </div> : <form id="settings-form" onSubmit={event => void save(event)} noValidate>
            <div className="qp-panel-body">
              {loadError && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{t(locale, 'Paramètres indisponibles', 'Settings unavailable')}</AlertTitle><AlertDescription>{t(locale, 'Impossible de charger les paramètres. Réessayez.', 'Could not load settings. Try again.')}<Button type="button" variant="outline" onClick={() => void load()}>{t(locale, 'Réessayer', 'Retry')}</Button></AlertDescription></Alert>}
              {saveError && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{t(locale, 'Modifications non enregistrées', 'Changes not saved')}</AlertTitle><AlertDescription>{t(locale, 'Impossible d’enregistrer. Votre saisie est conservée. Réessayez.', 'Could not save. Your entries are kept. Try again.')}<Button type="submit" variant="outline">{t(locale, 'Réessayer', 'Retry')}</Button></AlertDescription></Alert>}
              {fields}
            </div>
            <footer className="qp-panel-footer">
              <p role="status" data-tone={dirty && status === 'idle' && !savedNotice ? 'pending' : undefined}>{statusText}</p>
              <div>
                {dirty && <Button type="button" variant="ghost" disabled={busy} onClick={discard}>{t(locale, 'Annuler les modifications', 'Discard changes')}</Button>}
                <Button type="submit" disabled={busy || !dirty}>{t(locale, 'Enregistrer', 'Save changes')}</Button>
              </div>
            </footer>
          </form>}
        </section>
      </div>
    </main>

    <AlertDialog open={blocker.state === 'blocked'} onOpenChange={open => { if (!open && blocker.state === 'blocked') blocker.reset(); }}>
      <AlertDialogContent className="qp-modal">
        <AlertDialogHeader>
          <AlertDialogTitle>{t(locale, 'Abandonner les modifications non enregistrées ?', 'Discard unsaved changes?')}</AlertDialogTitle>
          <AlertDialogDescription>{t(locale, 'Vos modifications de cette section seront perdues. Les paramètres enregistrés restent inchangés.', 'Your changes to this section will be lost. Saved settings stay unchanged.')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t(locale, 'Continuer la saisie', 'Keep editing')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => { discard(); dirtyRef.current = false; blocker.proceed?.(); }}>{t(locale, 'Abandonner les modifications', 'Discard changes')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppShell>;
}
