"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { type QuoteData } from "@/lib/quote"
import { BusinessLogoField } from "./business-logo-field"
import { randomUUID } from "@/lib/random-id"

type Locale = "fr" | "en"
type Customer = { id: string; name: string; address: string; contact: string }
type RecordsResponse = { customers?: Customer[]; savedCustomer?: Customer; defaults?: Partial<QuoteData> }
type CustomerDraft = Omit<Customer, "id"> & { id?: string }
type Status = "idle" | "loading" | "saving" | "error"
type DiscardScope = "defaults" | "customer"

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
}

function customerFields(value: CustomerDraft | Customer) {
  return { name: value.name, address: value.address, contact: value.contact }
}

function t(locale: Locale, fr: string, en: string) {
  return locale === "fr" ? fr : en
}

const emptyCustomer = (): CustomerDraft => ({ name: "", address: "", contact: "" })

export function RecordsEditor({
  quote,
  locale,
  onApplyCustomer,
  onClose,
}: {
  quote: QuoteData | null
  locale: Locale
  onApplyCustomer: (customerId: string, snapshot: { name: string; address: string; contact: string }) => Promise<boolean>
  onClose: () => void
}) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [defaults, setDefaults] = useState<Partial<QuoteData>>({})
  const [savedDefaults, setSavedDefaults] = useState<Partial<QuoteData>>({})
  const [confirmDiscard, setConfirmDiscard] = useState<DiscardScope | null>(null)
  const afterDiscard = useRef<() => void>(onClose)
  const [customer, setCustomer] = useState<CustomerDraft>(emptyCustomer)
  const [selectedId, setSelectedId] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<Status>("loading")
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [customerNotice, setCustomerNotice] = useState("")
  const [customerFieldErrors, setCustomerFieldErrors] = useState<Array<"name" | "address">>([])
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const [defaultsSaveFailed, setDefaultsSaveFailed] = useState(false)
  const [vatIdError, setVatIdError] = useState(false)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const opener = useRef(typeof document === "undefined" ? null : document.activeElement as HTMLElement | null)
  const useCustomerButton = useRef<HTMLButtonElement | null>(null)
  const customerRequest = useRef<{ payload: string; id: string } | null>(null)

  async function load(signal?: AbortSignal) {
    setStatus("loading")
    setDefaultsSaveFailed(false)
    setError("")
    try {
      const response = await fetch("/api/quotes", { signal })
      if (!response.ok) throw new Error("load")
      const data = await response.json() as RecordsResponse
      setCustomers(Array.isArray(data.customers) ? data.customers : [])
      setDefaults(data.defaults ?? {})
      setSavedDefaults(data.defaults ?? {})
      setLoaded(true)
      setStatus("idle")
    } catch (reason) {
      if (signal?.aborted) return
      setStatus("error")
      setError(t(locale, "Impossible de charger les fiches. Réessayez.", "Could not load records. Try again."))
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, []) // The endpoint is loaded once. A locale change only changes visible copy.

  const selectedCustomer = customers.find((item) => item.id === selectedId)
  const customerDirty = JSON.stringify(customerFields(customer)) !== JSON.stringify(customerFields(selectedCustomer ?? emptyCustomer()))
  const filteredCustomers = customers.filter((item) => normalizeSearch(`${item.name} ${item.address} ${item.contact}`).includes(normalizeSearch(search)))

  useEffect(() => {
    if (selectedId && !filteredCustomers.some((item) => item.id === selectedId)) {
      setSelectedId("")
      if (!customerDirty) setCustomer(emptyCustomer())
    }
  }, [search, customers, customerDirty])

  function discardCustomerEdits() {
    setCustomer(selectedCustomer ? { ...selectedCustomer } : emptyCustomer())
  }

  function askDiscard(scope: DiscardScope, action: () => void) {
    afterDiscard.current = () => {
      if (scope === "customer") discardCustomerEdits()
      else {
        setDefaults({ ...savedDefaults })
        setDefaultsSaved(false)
      }
      action()
    }
    setConfirmDiscard(scope)
  }

  function withCustomerEditsDiscarded(action: () => void) {
    if (customerDirty) askDiscard("customer", action)
    else action()
  }

  function chooseCustomerNow(id: string) {
    setSelectedId(id)
    const record = customers.find((item) => item.id === id)
    setCustomer(record ? { ...record } : emptyCustomer())
    setCustomerNotice("")
    setError("")
  }

  function chooseCustomer(id: string) {
    withCustomerEditsDiscarded(() => chooseCustomerNow(id))
  }

  function updateCustomer<K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) {
    setCustomer((current) => ({ ...current, [key]: value }))
    if (key === "name" || key === "address") setCustomerFieldErrors((current) => current.filter((field) => field !== key))
    setCustomerNotice("")
    setError("")
  }

  function updateDefaults<K extends keyof QuoteData>(key: K, value: QuoteData[K]) {
    setDefaults((current) => ({ ...current, [key]: value }))
    setDefaultsSaved(false)
    if (key === "vatId" || key === "vatRegistered") setVatIdError(false)
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDefaultsSaved(false)
    setDefaultsSaveFailed(false)
    const missingCustomerFields = [
      ...(!customer.name.trim() ? ["name" as const] : []),
      ...(!customer.address.trim() ? ["address" as const] : []),
    ]
    if (missingCustomerFields.length) {
      setCustomerFieldErrors(missingCustomerFields)
      setError(t(locale, "Indiquez le nom et l'adresse du client.", "Enter the Customer name and address."))
      document.getElementById(missingCustomerFields[0] === "name" ? "record-customer-name" : "record-customer-address")?.focus()
      setStatus("error")
      return
    }
    setCustomerFieldErrors([])
    setStatus("saving")
    setError("")
    try {
      const payload = JSON.stringify(customer)
      if (customerRequest.current?.payload !== payload) customerRequest.current = { payload, id: randomUUID() }
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "customer-save", customer, requestId: customerRequest.current.id }),
      })
      if (!response.ok) throw new Error("save")
      const data = await response.json() as RecordsResponse
      customerRequest.current = null
      const saved = data.savedCustomer ?? data.customers?.find((item) => item.name === customer.name.trim() && item.address === customer.address.trim() && item.contact === customer.contact) ?? null
      setCustomers(data.customers ?? [])
      setStatus("idle")
      setCustomerFieldErrors([])
      if (saved) {
        setSelectedId(saved.id)
        setCustomer({ ...saved })
        setCustomerNotice(t(locale, customer.id ? "Client mis à jour. Les devis existants sont inchangés." : "Client créé. Ce devis est inchangé.", customer.id ? "Customer updated. Existing Quotes are unchanged." : "Customer created. This Quote is unchanged."))
      }
    } catch {
      setStatus("error")
      setError(t(locale, "Impossible d'enregistrer le client. Votre saisie est conservée. Réessayez.", "Could not save the Customer. Your entries are kept. Try again."))
    }
  }

  async function saveDefaults(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setDefaultsSaved(false)
    setDefaultsSaveFailed(false)
    setError("")
    if (defaults.vatRegistered === true && !defaults.vatId?.trim()) {
      setVatIdError(true)
      document.getElementById("record-vat-id")?.focus()
      return
    }
    setStatus("saving")
    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "defaults-save", defaults }),
      })
      if (!response.ok) throw new Error("save")
      const data = await response.json() as RecordsResponse
      setDefaults(data.defaults ?? defaults)
      setSavedDefaults(data.defaults ?? defaults)
      setStatus("idle")
      setDefaultsSaved(true)
    } catch {
      setStatus("error")
      setDefaultsSaveFailed(true)
      setError(t(locale, "Impossible d'enregistrer les valeurs par défaut. Votre saisie est conservée. Réessayez.", "Could not save the defaults. Your entries are kept. Try again."))
    }
  }

  function logoUploaded(logoId: string) {
    setDefaults((current) => ({ ...current, logoId }))
    setSavedDefaults((current) => ({ ...current, logoId }))
  }

  /** Removing the logo saves at once, like uploading. Other unsaved default edits stay in the form. */
  async function removeLogo(): Promise<boolean> {
    try {
      const response = await fetch("/api/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "defaults-save", defaults: { ...savedDefaults, logoId: "" } }),
      })
      if (!response.ok) return false
      setDefaults((current) => ({ ...current, logoId: "" }))
      setSavedDefaults((current) => ({ ...current, logoId: "" }))
      return true
    } catch {
      return false
    }
  }

  function close(action = onClose) {
    if (status === "saving") return
    if (customerDirty) {
      askDiscard("customer", () => {
        if (JSON.stringify(defaults) !== JSON.stringify(savedDefaults)) askDiscard("defaults", action)
        else action()
      })
      return
    }
    if (JSON.stringify(defaults) !== JSON.stringify(savedDefaults)) {
      askDiscard("defaults", action)
      return
    }
    action()
  }

  function useCustomer() {
    if (!quote || !selectedCustomer || customerDirty) return
    if (JSON.stringify(defaults) !== JSON.stringify(savedDefaults)) {
      askDiscard("defaults", () => setReplacementOpen(true))
      return
    }
    setReplacementOpen(true)
  }

  async function replaceCustomer() {
    if (!selectedCustomer) return
    const applied = await onApplyCustomer(selectedCustomer.id, customerFields(selectedCustomer))
    if (!applied) {
      setError(t(locale, "Impossible de remplacer le client. Votre devis reste inchangé. Réessayez.", "Could not replace the Customer. Your Quote is unchanged. Try again."))
      return
    }
    setReplacementOpen(false)
    onClose()
  }

  const busy = !loaded || status === "loading" || status === "saving"
  const replacementRows = [
    { label: t(locale, "Nom", "Name"), current: quote?.customerName ?? "", replacement: selectedCustomer?.name ?? "" },
    { label: t(locale, "Adresse", "Address"), current: quote?.customerAddress ?? "", replacement: selectedCustomer?.address ?? "" },
    { label: t(locale, "Personne de contact", "Contact person"), current: quote?.customerContact ?? "", replacement: selectedCustomer?.contact ?? "" },
  ]

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="qp-modal flex flex-col" showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus() }}>
        <DialogHeader>
          <DialogTitle>{t(locale, "Clients et valeurs par défaut", "Customers and defaults")}</DialogTitle>
          <DialogDescription>{t(locale, "Les fiches réutilisables sont distinctes de ce devis. Les changements n'actualisent jamais un devis existant.", "Reusable records are separate from this Quote. Changes never refresh an existing Quote.")}</DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive"><AlertTitle>{t(locale, "Action non effectuée", "Action not completed")}</AlertTitle><AlertDescription>{error}{!loaded && <Button type="button" variant="outline" onClick={() => void load()}>{t(locale, "Réessayer", "Retry")}</Button>}{defaultsSaveFailed && <Button type="submit" form="record-defaults-form" variant="outline">{t(locale, "Réessayer", "Retry")}</Button>}</AlertDescription></Alert>}

        <div className="flex min-h-0 max-h-[65vh] flex-col gap-6 overflow-y-auto">
          <section aria-labelledby="customer-record-heading">
            <h2 id="customer-record-heading" className="mb-3 text-base font-medium">{t(locale, "Fiche client", "Customer record")}</h2>
            <FieldGroup>
              <Field data-disabled={busy || undefined}>
                <FieldLabel htmlFor="record-customer-search">{t(locale, "Rechercher un client", "Search Customers")}</FieldLabel>
                <Input id="record-customer-search" value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} />
              </Field>
              <Field data-disabled={busy || undefined}>
                <FieldLabel htmlFor="record-customer">{t(locale, "Choisir un client", "Choose a Customer")}</FieldLabel>
                <select id="record-customer" value={selectedId} disabled={busy} onChange={(event) => chooseCustomer(event.target.value)}>
                  <option value="">{t(locale, "Nouveau client", "New Customer")}</option>
                  {filteredCustomers.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.address.replace(/\n/g, ", ")}</option>)}
                </select>
                <FieldDescription>{t(locale, "Choisissez une fiche pour la mettre à jour, ou créez-en une nouvelle.", "Choose a record to update it, or create a new one.")}</FieldDescription>
              </Field>
            </FieldGroup>
            {customers.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t(locale, "Aucun client enregistré. Vous pouvez en ajouter un maintenant ou continuer votre devis.", "No saved Customers yet. You can add one now or continue your Quote.")}</p>}
            {customers.length > 0 && filteredCustomers.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t(locale, "Aucun client ne correspond à votre recherche.", "No Customers match your search.")}</p>}

            <form className="mt-4" onSubmit={saveCustomer} noValidate>
              <FieldGroup>
                <Field data-invalid={customerFieldErrors.includes("name") || undefined} data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-customer-name">{t(locale, "Nom", "Name")}</FieldLabel>
                  <Input id="record-customer-name" value={customer.name} disabled={busy} aria-invalid={customerFieldErrors.includes("name")} aria-describedby={customerFieldErrors.includes("name") ? "record-customer-name-error" : undefined} onChange={(event) => updateCustomer("name", event.target.value)} />
                  {customerFieldErrors.includes("name") && <FieldError id="record-customer-name-error">{t(locale, "Indiquez le nom du client.", "Enter the Customer name.")}</FieldError>}
                </Field>
                <Field data-invalid={customerFieldErrors.includes("address") || undefined} data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-customer-address">{t(locale, "Adresse", "Address")}</FieldLabel>
                  <Textarea id="record-customer-address" value={customer.address} disabled={busy} aria-invalid={customerFieldErrors.includes("address")} aria-describedby={customerFieldErrors.includes("address") ? "record-customer-address-error" : undefined} onChange={(event) => updateCustomer("address", event.target.value)} />
                  {customerFieldErrors.includes("address") && <FieldError id="record-customer-address-error">{t(locale, "Indiquez l'adresse du client.", "Enter the Customer address.")}</FieldError>}
                </Field>
                <Field data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-customer-contact">{t(locale, "Personne de contact", "Contact person")}</FieldLabel>
                  <Input id="record-customer-contact" value={customer.contact} disabled={busy} onChange={(event) => updateCustomer("contact", event.target.value)} />
                  <FieldDescription>{t(locale, "Facultatif.", "Optional.")}</FieldDescription>
                </Field>
                {customerDirty && <Alert><AlertDescription>{t(locale, "Enregistrez ou abandonnez les modifications de la fiche avant d'utiliser ce client.", "Save or discard record edits before using this Customer.")}</AlertDescription></Alert>}
                <div className="flex flex-wrap justify-end gap-2">
                  {customerDirty && <Button type="button" variant="ghost" disabled={busy} onClick={discardCustomerEdits}>{t(locale, "Abandonner les modifications", "Discard edits")}</Button>}
                  {quote && selectedCustomer && <Button ref={useCustomerButton} type="button" variant="outline" disabled={busy || customerDirty} onClick={useCustomer}>{t(locale, "Utiliser pour ce devis", "Use for this Quote")}</Button>}
                  <Button type="submit" disabled={busy}>{customer.id ? t(locale, "Mettre à jour le client", "Update Customer") : t(locale, "Créer le client", "Create Customer")}</Button>
                </div>
              </FieldGroup>
            </form>
            {customerNotice && <p className="mt-3 text-sm text-muted-foreground" role="status">{customerNotice}</p>}
            {quote && <p className="mt-3 text-sm text-muted-foreground">{t(locale, "Utiliser ce client copie les valeurs enregistrées dans le devis. Les modifications ultérieures de la fiche restent indépendantes.", "Use this Customer copies the saved values into the Quote. Later record edits remain independent.")}</p>}
          </section>

          <section aria-labelledby="business-defaults-heading">
            <h2 id="business-defaults-heading" className="mb-3 text-base font-medium">{t(locale, "Valeurs par défaut de l'entreprise", "Business defaults")}</h2>
            {quote && <p className="mb-4 text-sm text-muted-foreground">{t(locale, "Pour modifier les coordonnées de l'entreprise dans ce devis, cliquez sur le bloc de l'entreprise dans le devis.", "To change this Quote's business details, select the business block in the Quote.")}</p>}
            <form id="record-defaults-form" onSubmit={saveDefaults} noValidate>
              <FieldGroup>
                <BusinessLogoField locale={locale} logoId={defaults.logoId || undefined} disabled={busy} onUploaded={logoUploaded} onRemove={removeLogo} />
                <Field data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-business-name">{t(locale, "Raison sociale", "Business name")}</FieldLabel>
                  <Input id="record-business-name" value={defaults.businessName ?? ""} disabled={busy} onChange={(event) => updateDefaults("businessName", event.target.value)} />
                </Field>
                <Field data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-business-address">{t(locale, "Adresse", "Address")}</FieldLabel>
                  <Textarea id="record-business-address" value={defaults.businessAddress ?? ""} disabled={busy} onChange={(event) => updateDefaults("businessAddress", event.target.value)} />
                </Field>
                <Field data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-business-contact">{t(locale, "Coordonnées", "Contact details")}</FieldLabel>
                  <Input id="record-business-contact" value={defaults.businessContact ?? ""} disabled={busy} onChange={(event) => updateDefaults("businessContact", event.target.value)} />
                </Field>
                <Field data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-vat-registered">{t(locale, "Assujetti à la TVA", "VAT registered")}</FieldLabel>
                  <select id="record-vat-registered" value={defaults.vatRegistered === null || defaults.vatRegistered === undefined ? "unknown" : defaults.vatRegistered ? "yes" : "no"} disabled={busy} onChange={(event) => updateDefaults("vatRegistered", event.target.value === "unknown" ? null : event.target.value === "yes")}>
                    <option value="unknown">{t(locale, "À préciser", "To confirm")}</option>
                    <option value="yes">{t(locale, "Oui", "Yes")}</option>
                    <option value="no">{t(locale, "Non", "No")}</option>
                  </select>
                  <FieldDescription>{t(locale, "Les devis assujettis prennent en charge uniquement les travaux au taux normal actuel de 8,1 %. Les autres traitements fiscaux ne sont pas pris en charge.", "Registered Quotes support work at the current 8.1% standard rate only. Other tax treatments are unsupported.")}</FieldDescription>
                </Field>
                <Field data-invalid={vatIdError || undefined} data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-vat-id">{t(locale, "Numéro TVA", "VAT identifier")}</FieldLabel>
                  <Input id="record-vat-id" value={defaults.vatId ?? ""} disabled={busy} required={defaults.vatRegistered === true} aria-invalid={vatIdError} aria-describedby={vatIdError ? "record-vat-id-error" : undefined} onChange={(event) => updateDefaults("vatId", event.target.value)} />
                  {vatIdError && <FieldError id="record-vat-id-error">{t(locale, "Indiquez le numéro TVA de l'entreprise assujettie.", "Enter the VAT identifier for a registered business.")}</FieldError>}
                </Field>
                <Field data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-terms">{t(locale, "Conditions par défaut", "Default terms")}</FieldLabel>
                  <Textarea id="record-terms" value={defaults.terms ?? ""} disabled={busy} onChange={(event) => updateDefaults("terms", event.target.value)} />
                  <FieldDescription>{t(locale, "Facultatif. Ces conditions ne modifient pas les devis existants.", "Optional. These terms do not change existing Quotes.")}</FieldDescription>
                </Field>
                <div className="flex justify-end"><Button type="submit" disabled={busy}>{t(locale, "Enregistrer les valeurs par défaut", "Save defaults")}</Button></div>
              </FieldGroup>
            </form>
          </section>
        </div>

        <DialogFooter className="shrink-0">
          {defaultsSaved && <span className="mr-auto text-sm text-muted-foreground" role="status">{quote
            ? t(locale, "Valeurs par défaut enregistrées pour les nouveaux devis. Ce devis est inchangé.", "Defaults saved for new Quotes. This Quote is unchanged.")
            : t(locale, "Valeurs par défaut enregistrées pour les nouveaux devis.", "Defaults saved for new Quotes.")}</span>}
          {status === "loading" && <span className="mr-auto text-sm text-muted-foreground" role="status">{t(locale, "Chargement…", "Loading…")}</span>}
          {status === "saving" && <span className="mr-auto text-sm text-muted-foreground" role="status">{t(locale, "Enregistrement…", "Saving…")}</span>}
          <Button type="button" variant="outline" disabled={status === "saving"} onClick={() => close()}>{t(locale, "Fermer", "Close")}</Button>
        </DialogFooter>
        <AlertDialog open={confirmDiscard !== null} onOpenChange={(open) => !open && setConfirmDiscard(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmDiscard === "customer"
                ? t(locale, "Abandonner les modifications non enregistrées de la fiche ?", "Discard unsaved record edits?")
                : t(locale, "Abandonner les modifications non enregistrées des valeurs par défaut ?", "Discard unsaved default edits?")}</AlertDialogTitle>
              <AlertDialogDescription>{confirmDiscard === "customer"
                ? t(locale, "Les modifications non enregistrées de la fiche seront perdues. Le devis reste inchangé.", "Unsaved record edits will be lost. The Quote stays unchanged.")
                : t(locale, "Les modifications non enregistrées seront perdues. Les valeurs par défaut enregistrées resteront inchangées.", "Unsaved default edits will be lost. Saved defaults will stay unchanged.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t(locale, "Continuer la saisie", "Keep editing")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setConfirmDiscard(null); afterDiscard.current() }}>{t(locale, "Abandonner les modifications", "Discard edits")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={replacementOpen} onOpenChange={(open) => { setReplacementOpen(open); if (!open) setTimeout(() => useCustomerButton.current?.focus(), 0) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(locale, "Remplacer les coordonnées du client dans ce devis ?", "Replace Customer details in this Quote?")}</AlertDialogTitle>
              <AlertDialogDescription>{t(locale, "Seul ce brouillon de travail change. Les fiches clients et les révisions publiées restent inchangées. Vous pouvez annuler ce remplacement.", "Only this Working Draft changes. Saved Customer records and Published Revisions stay unchanged. You can undo this replacement.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="overflow-x-auto">
              <table>
                <thead><tr><th>{t(locale, "Champ", "Field")}</th><th>{t(locale, "Actuel", "Current")}</th><th>{t(locale, "Remplacement", "Replacement")}</th></tr></thead>
                <tbody>
                  {replacementRows.map(({ label, current, replacement }) => <tr key={label}><th>{label}</th><td>{current || t(locale, "Aucun", "None")}</td><td>{replacement || t(locale, "Aucun", "None")}</td></tr>)}
                </tbody>
              </table>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t(locale, "Conserver le client actuel", "Keep current Customer")}</AlertDialogCancel>
              <AlertDialogAction onClick={(event) => { event.preventDefault(); void replaceCustomer() }}>{t(locale, "Remplacer dans ce devis", "Replace in this Quote")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
