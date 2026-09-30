import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ChevronRight, Plus, TriangleAlert, UsersRound } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { randomUUID } from '@/lib/random-id';
import { AppShell } from '../app-shell';

type Locale = 'fr' | 'en';
type Customer = { id: string; name: string; address: string; contact: string };
type CustomerFields = Omit<Customer, 'id'>;
type RecordsResponse = { customers?: Customer[]; savedCustomer?: Customer };

const t = (locale: Locale, fr: string, en: string) => locale === 'fr' ? fr : en;
const emptyFields = (): CustomerFields => ({ name: '', address: '', contact: '' });
const fieldsOf = (customer: CustomerFields): CustomerFields => ({ name: customer.name, address: customer.address, contact: customer.contact });
const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
/** The index letter of a name: its first letter without accents, or # for anything else. */
const initialOf = (name: string) => {
  const letter = normalizeSearch(name.trim()).charAt(0).toLocaleUpperCase('fr-CH');
  return /^[A-Z]$/.test(letter) ? letter : '#';
};
/** Customers grouped by initial, in the list's order. */
function groupByInitial(customers: Customer[]) {
  const groups: { letter: string; customers: Customer[] }[] = [];
  for (const customer of customers) {
    const letter = initialOf(customer.name);
    const group = groups.find(entry => entry.letter === letter);
    if (group) group.customers.push(customer); else groups.push({ letter, customers: [customer] });
  }
  return groups.sort((a, b) => a.letter === '#' ? 1 : b.letter === '#' ? -1 : a.letter.localeCompare(b.letter));
}

export function CustomersPage({ locale, onLanguage }: { locale: Locale; onLanguage: (locale: Locale) => Promise<boolean> }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const selection = params.get('id');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<CustomerFields>(emptyFields);
  const [fieldErrors, setFieldErrors] = useState<Array<'name' | 'address'>>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  const saveRequest = useRef<{ payload: string; id: string } | null>(null);
  const loadController = useRef<AbortController | null>(null);

  const record = selection && selection !== 'new' ? customers.find(customer => customer.id === selection) : undefined;
  const missing = status === 'ready' && selection !== null && selection !== 'new' && !record;
  const base = selection === 'new' ? emptyFields() : record ? fieldsOf(record) : null;
  const dirty = base !== null && JSON.stringify(fieldsOf(draft)) !== JSON.stringify(base);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  const filtered = customers.filter(customer => normalizeSearch(`${customer.name} ${customer.address} ${customer.contact}`).includes(normalizeSearch(search)));

  async function load() {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setStatus('loading');
    try {
      const response = await fetch('/api/quotes', { signal: controller.signal });
      if (!response.ok) throw new Error('load');
      const data = await response.json() as RecordsResponse;
      if (!Array.isArray(data.customers)) throw new Error('invalid customer list');
      setCustomers(data.customers);
      setStatus('ready');
    } catch {
      if (!controller.signal.aborted) setStatus('error');
    }
  }

  useEffect(() => {
    void load();
    return () => loadController.current?.abort();
  }, []);

  // Selecting another Customer starts from its saved values. Unsaved edits are guarded by the blocker.
  useEffect(() => {
    setDraft(base ?? emptyFields());
    setFieldErrors([]);
    setSaveError(false);
    saveRequest.current = null;
  }, [selection, status === 'ready']);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function update(key: keyof CustomerFields, value: string) {
    setDraft(current => ({ ...current, [key]: value }));
    if (key === 'name' || key === 'address') setFieldErrors(current => current.filter(field => field !== key));
    setSaveError(false);
    setNotice(null);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;
    const missingFields = [
      ...(!draft.name.trim() ? ['name' as const] : []),
      ...(!draft.address.trim() ? ['address' as const] : []),
    ];
    if (missingFields.length) {
      setFieldErrors(missingFields);
      document.getElementById(missingFields[0] === 'name' ? 'customer-name' : 'customer-address')?.focus();
      return;
    }
    setSaving(true); setSaveError(false);
    const customer = { ...(record ? { id: record.id } : {}), ...draft };
    try {
      const payload = JSON.stringify(customer);
      if (saveRequest.current?.payload !== payload) saveRequest.current = { payload, id: randomUUID() };
      const response = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'customer-save', customer, requestId: saveRequest.current.id }),
      });
      if (!response.ok) throw new Error('save');
      const data = await response.json() as RecordsResponse;
      const saved = data.savedCustomer;
      if (!saved?.id) throw new Error('missing saved Customer');
      saveRequest.current = null;
      setCustomers(Array.isArray(data.customers) ? data.customers : [...customers.filter(item => item.id !== saved.id), saved]);
      setDraft(fieldsOf(saved));
      setNotice({ id: saved.id, text: record
        ? t(locale, 'Client mis à jour. Les devis existants sont inchangés.', 'Customer updated. Existing Quotes are unchanged.')
        : t(locale, 'Client créé.', 'Customer created.') });
      if (!record) {
        dirtyRef.current = false;
        navigate(`/customers?id=${encodeURIComponent(saved.id)}`, { replace: true });
      }
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(base ?? emptyFields());
    setFieldErrors([]);
    setSaveError(false);
  }

  const count = customers.length;
  const groups = groupByInitial(filtered);
  const statusText = saving ? t(locale, 'Enregistrement…', 'Saving…')
    : notice && notice.id === selection && !dirty ? notice.text
    : dirty ? t(locale, 'Modifications non enregistrées', 'Unsaved changes')
    : '';

  const list = <section className="qp-panel qp-customer-list" aria-labelledby="customer-list-heading">
    <h2 id="customer-list-heading" className="sr-only">{t(locale, 'Liste des clients', 'Customer list')}</h2>
    <div className="qp-customer-search">
      <FieldGroup><Field data-disabled={status !== 'ready' || undefined}>
        <FieldLabel htmlFor="customer-search">{t(locale, 'Rechercher un client', 'Search Customers')}</FieldLabel>
        <Input id="customer-search" type="search" value={search} disabled={status !== 'ready'} placeholder={t(locale, 'Nom, adresse ou contact', 'Name, address or contact')} onChange={event => setSearch(event.target.value)} />
      </Field></FieldGroup>
    </div>
    {status === 'loading' && <p className="qp-customer-message" role="status">{t(locale, 'Chargement des clients…', 'Loading Customers…')}</p>}
    {status === 'error' && <div className="qp-customer-message"><Alert variant="destructive"><TriangleAlert /><AlertTitle>{t(locale, 'Clients indisponibles', 'Customers unavailable')}</AlertTitle><AlertDescription>{t(locale, 'Impossible de charger les clients. Réessayez.', 'Could not load Customers. Try again.')}<Button type="button" variant="outline" onClick={() => void load()}>{t(locale, 'Réessayer', 'Retry')}</Button></AlertDescription></Alert></div>}
    {status === 'ready' && count === 0 && <div className="qp-customer-empty">
      <UsersRound />
      <p><strong>{t(locale, 'Aucun client enregistré.', 'No saved Customers yet.')}</strong> {t(locale, 'Ajoutez les clients avec qui vous travaillez souvent. Vous pouvez aussi en enregistrer un depuis un devis.', 'Add the Customers you work with often. You can also save one from a Quote.')}</p>
    </div>}
    {status === 'ready' && count > 0 && filtered.length === 0 && <p className="qp-customer-message" role="status">{t(locale, 'Aucun client ne correspond à votre recherche.', 'No Customers match your search.')}</p>}
    {status === 'ready' && filtered.length > 0 && <>
      {/* Hidden unless a design shows it; see app/styles/README.md. */}
      <nav className="eq-alpha-index" aria-label={t(locale, 'Index alphabétique des clients', 'Customers by initial')}>
        {groups.map(group => <a key={group.letter} href={`#customers-${group.letter === '#' ? 'other' : group.letter}`} onClick={event => {
          event.preventDefault();
          const first = document.getElementById(`customers-${group.letter === '#' ? 'other' : group.letter}`)?.querySelector<HTMLElement>('a');
          first?.scrollIntoView({ block: 'nearest' });
          first?.focus({ preventScroll: true });
        }} aria-label={group.letter === '#' ? t(locale, 'Autres', 'Other') : group.letter}>{group.letter}</a>)}
      </nav>
      <div className="qp-customer-groups">{groups.map(group => {
        const id = `customers-${group.letter === '#' ? 'other' : group.letter}`;
        return <section key={group.letter} className="eq-alpha-group" id={id} aria-labelledby={`${id}-heading`}>
          <h3 className="eq-alpha-heading" id={`${id}-heading`}>{group.letter === '#' ? t(locale, 'Autres', 'Other') : group.letter}</h3>
          <ul className="qp-customer-rows">
            {group.customers.map(customer => <li key={customer.id}>
              <Link to={`/customers?id=${encodeURIComponent(customer.id)}`} aria-current={customer.id === selection ? 'true' : undefined}>
                <span><strong>{customer.name}</strong><span>{customer.address.replace(/\n+/g, ', ')}</span>{customer.contact && <span>{customer.contact}</span>}</span>
                <ChevronRight />
              </Link>
            </li>)}
          </ul>
        </section>;
      })}</div>
    </>}
  </section>;

  const detail = <section className="qp-panel qp-customer-detail" aria-labelledby="customer-detail-heading">
    {selection === null || missing ? <div className="qp-customer-placeholder">
      <h2 id="customer-detail-heading">{missing ? t(locale, 'Client introuvable', 'Customer not found') : t(locale, 'Aucun client sélectionné', 'No Customer selected')}</h2>
      <p>{missing
        ? t(locale, 'Cette fiche n’existe plus. Choisissez un autre client dans la liste.', 'This record no longer exists. Choose another Customer from the list.')
        : t(locale, 'Choisissez un client dans la liste pour voir ou modifier ses coordonnées.', 'Choose a Customer from the list to view or edit their details.')}</p>
    </div> : <form onSubmit={event => void save(event)} noValidate>
      <header className="qp-panel-header">
        <Link className="qp-back-link" to="/customers" aria-label={t(locale, 'Retour aux clients', 'Back to Customers')}><ArrowLeft aria-hidden="true" />{t(locale, 'Clients', 'Customers')}</Link>
        <h2 id="customer-detail-heading">{record?.name || t(locale, 'Nouveau client', 'New Customer')}</h2>
        <p>{t(locale, 'Modifier une fiche ne change jamais les devis existants. Pour utiliser un client, choisissez-le depuis le bloc client d’un devis.', 'Editing a record never changes existing Quotes. To use a Customer, choose them from the Customer block of a Quote.')}</p>
      </header>
      <div className="qp-panel-body">
        {saveError && <Alert variant="destructive"><TriangleAlert /><AlertTitle>{t(locale, 'Client non enregistré', 'Customer not saved')}</AlertTitle><AlertDescription>{t(locale, 'Impossible d’enregistrer le client. Votre saisie est conservée. Réessayez.', 'Could not save the Customer. Your entries are kept. Try again.')}</AlertDescription></Alert>}
        <FieldGroup>
          <Field data-invalid={fieldErrors.includes('name') || undefined} data-disabled={saving || status !== 'ready' || undefined}>
            <FieldLabel htmlFor="customer-name">{t(locale, 'Nom', 'Name')}</FieldLabel>
            <Input id="customer-name" value={draft.name} disabled={saving || status !== 'ready'} aria-invalid={fieldErrors.includes('name')} aria-describedby={fieldErrors.includes('name') ? 'customer-name-error' : undefined} onChange={event => update('name', event.target.value)} />
            {fieldErrors.includes('name') && <FieldError id="customer-name-error">{t(locale, 'Indiquez le nom du client.', 'Enter the Customer name.')}</FieldError>}
          </Field>
          <Field data-invalid={fieldErrors.includes('address') || undefined} data-disabled={saving || status !== 'ready' || undefined}>
            <FieldLabel htmlFor="customer-address">{t(locale, 'Adresse', 'Address')}</FieldLabel>
            <Textarea id="customer-address" rows={3} value={draft.address} disabled={saving || status !== 'ready'} aria-invalid={fieldErrors.includes('address')} aria-describedby={fieldErrors.includes('address') ? 'customer-address-error' : undefined} onChange={event => update('address', event.target.value)} />
            {fieldErrors.includes('address') && <FieldError id="customer-address-error">{t(locale, "Indiquez l'adresse du client.", 'Enter the Customer address.')}</FieldError>}
          </Field>
          <Field data-disabled={saving || status !== 'ready' || undefined}>
            <FieldLabel htmlFor="customer-contact">{t(locale, 'Personne de contact', 'Contact person')}</FieldLabel>
            <Input id="customer-contact" value={draft.contact} disabled={saving || status !== 'ready'} onChange={event => update('contact', event.target.value)} />
            <FieldDescription>{t(locale, 'Facultatif.', 'Optional.')}</FieldDescription>
          </Field>
        </FieldGroup>
      </div>
      <footer className="qp-panel-footer">
        <p role="status" data-tone={dirty && !saving ? 'pending' : undefined}>{statusText}</p>
        <div>
          {dirty && <Button type="button" variant="ghost" disabled={saving} onClick={discard}>{t(locale, 'Annuler les modifications', 'Discard changes')}</Button>}
          <Button type="submit" disabled={saving || !dirty}>{record ? t(locale, 'Mettre à jour le client', 'Update Customer') : t(locale, 'Créer le client', 'Create Customer')}</Button>
        </div>
      </footer>
    </form>}
  </section>;

  return <AppShell className="qp-page" current="customers" locale={locale} onLanguage={onLanguage}>
    <main className="qp-customers" data-view={selection === null ? 'list' : 'detail'}>
      <div className="qp-page-heading">
        <div><h1>{t(locale, 'Clients', 'Customers')}</h1><p>{status !== 'ready' ? '\u00a0' : count === 1 ? t(locale, '1 client enregistré', '1 saved Customer') : t(locale, `${count} clients enregistrés`, `${count} saved Customers`)}</p></div>
        <Button asChild><Link to="/customers?id=new"><Plus data-icon="inline-start" />{t(locale, 'Nouveau client', 'New Customer')}</Link></Button>
      </div>
      <div className="qp-customers-layout">{list}{detail}</div>
    </main>

    <AlertDialog open={blocker.state === 'blocked'} onOpenChange={open => { if (!open && blocker.state === 'blocked') blocker.reset(); }}>
      <AlertDialogContent className="qp-modal">
        <AlertDialogHeader>
          <AlertDialogTitle>{t(locale, 'Abandonner les modifications de la fiche ?', 'Discard unsaved record edits?')}</AlertDialogTitle>
          <AlertDialogDescription>{t(locale, 'Les modifications non enregistrées de ce client seront perdues. Les devis restent inchangés.', 'Unsaved edits to this Customer will be lost. Quotes stay unchanged.')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t(locale, 'Continuer la saisie', 'Keep editing')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => { dirtyRef.current = false; blocker.proceed?.(); }}>{t(locale, 'Abandonner les modifications', 'Discard changes')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppShell>;
}
