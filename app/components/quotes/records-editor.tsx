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
import { randomUUID } from "@/lib/random-id"

type Locale = "fr" | "en"
type Customer = { id: string; name: string; address: string; contact: string }
type RecordsResponse = { customers?: Customer[]; defaults?: Partial<QuoteData> }
type CustomerDraft = Omit<Customer, "id"> & { id?: string }
type Status = "idle" | "loading" | "saving" | "error"

function t(locale: Locale, fr: string, en: string) {
  return locale === "fr" ? fr : en
}

const emptyCustomer = (): CustomerDraft => ({ name: "", address: "", contact: "" })

export function RecordsEditor({
  quote,
  locale,
  onApply,
  onClose,
}: {
  quote: QuoteData | null
  locale: Locale
  onApply: (q: QuoteData) => void
  onClose: () => void
}) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [defaults, setDefaults] = useState<Partial<QuoteData>>({})
  const [savedDefaults, setSavedDefaults] = useState<Partial<QuoteData>>({})
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const afterDiscard = useRef<() => void>(onClose)
  const [customer, setCustomer] = useState<CustomerDraft>(emptyCustomer)
  const [selectedId, setSelectedId] = useState("")
  const [status, setStatus] = useState<Status>("loading")
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState("")
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const [defaultsSaveFailed, setDefaultsSaveFailed] = useState(false)
  const [vatIdError, setVatIdError] = useState(false)
  const opener = useRef(typeof document === "undefined" ? null : document.activeElement as HTMLElement | null)
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

  function chooseCustomer(id: string) {
    setSelectedId(id)
    const record = customers.find((item) => item.id === id)
    setCustomer(record ? { ...record } : emptyCustomer())
  }

  function updateCustomer<K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) {
    setCustomer((current) => ({ ...current, [key]: value }))
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
    if (!customer.name.trim() || !customer.address.trim()) {
      setError(t(locale, "Indiquez le nom et l'adresse du client.", "Enter the Customer name and address."))
      setStatus("error")
      return
    }
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
      setCustomers(data.customers ?? [])
      setStatus("idle")
      setSelectedId("")
      setCustomer(emptyCustomer())
    } catch {
      setStatus("error")
      setError(t(locale, "Impossible d'enregistrer le client. Réessayez.", "Could not save the Customer. Try again."))
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

  function close(action = onClose) {
    if (status === "saving") return
    if (JSON.stringify(defaults) !== JSON.stringify(savedDefaults)) {
      afterDiscard.current = action
      setConfirmDiscard(true)
    } else action()
  }

  function useCustomer() {
    if (!quote || !customer.id) return
    close(() => {
      onApply({ ...quote, customerName: customer.name, customerAddress: customer.address, customerContact: customer.contact })
      onClose()
    })
  }

  const selectedCustomer = customers.find((item) => item.id === selectedId)
  const busy = !loaded || status === "loading" || status === "saving"

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
                <FieldLabel htmlFor="record-customer">{t(locale, "Choisir un client", "Choose a Customer")}</FieldLabel>
                <select id="record-customer" value={selectedId} disabled={busy} onChange={(event) => chooseCustomer(event.target.value)}>
                  <option value="">{t(locale, "Nouveau client", "New Customer")}</option>
                  {customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <FieldDescription>{t(locale, "Choisissez une fiche pour la mettre à jour, ou créez-en une nouvelle.", "Choose a record to update it, or create a new one.")}</FieldDescription>
              </Field>
            </FieldGroup>

            <form className="mt-4" onSubmit={saveCustomer} noValidate>
              <FieldGroup>
                <Field data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-customer-name">{t(locale, "Nom", "Name")}</FieldLabel>
                  <Input id="record-customer-name" value={customer.name} disabled={busy} onChange={(event) => updateCustomer("name", event.target.value)} />
                </Field>
                <Field data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-customer-address">{t(locale, "Adresse", "Address")}</FieldLabel>
                  <Textarea id="record-customer-address" value={customer.address} disabled={busy} onChange={(event) => updateCustomer("address", event.target.value)} />
                </Field>
                <Field data-disabled={busy || undefined}>
                  <FieldLabel htmlFor="record-customer-contact">{t(locale, "Personne de contact", "Contact person")}</FieldLabel>
                  <Input id="record-customer-contact" value={customer.contact} disabled={busy} onChange={(event) => updateCustomer("contact", event.target.value)} />
                  <FieldDescription>{t(locale, "Facultatif.", "Optional.")}</FieldDescription>
                </Field>
                <div className="flex flex-wrap justify-end gap-2">
                  {quote && selectedCustomer && <Button type="button" variant="outline" disabled={busy} onClick={useCustomer}>{t(locale, "Utiliser ce client", "Use this Customer")}</Button>}
                  <Button type="submit" disabled={busy}>{customer.id ? t(locale, "Mettre à jour le client", "Update Customer") : t(locale, "Créer le client", "Create Customer")}</Button>
                </div>
              </FieldGroup>
            </form>
            {quote && <p className="mt-3 text-sm text-muted-foreground">{t(locale, "Utiliser ce client copie les valeurs affichées dans le devis. Les modifications ultérieures de la fiche restent indépendantes.", "Use this Customer copies the displayed values into the Quote. Later record edits remain independent.")}</p>}
          </section>

          <section aria-labelledby="business-defaults-heading">
            <h2 id="business-defaults-heading" className="mb-3 text-base font-medium">{t(locale, "Valeurs par défaut de l'entreprise", "Business defaults")}</h2>
            {quote && <p className="mb-4 text-sm text-muted-foreground">{t(locale, "Pour modifier les coordonnées de l'entreprise dans ce devis, utilisez Coordonnées et conditions.", "To change this Quote's business details, use Details & terms.")}</p>}
            <form id="record-defaults-form" onSubmit={saveDefaults} noValidate>
              <FieldGroup>
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
        <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(locale, "Abandonner les modifications non enregistrées des valeurs par défaut ?", "Discard unsaved default edits?")}</AlertDialogTitle>
              <AlertDialogDescription>{t(locale, "Les modifications non enregistrées seront perdues. Les valeurs par défaut enregistrées resteront inchangées.", "Unsaved default edits will be lost. Saved defaults will stay unchanged.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t(locale, "Continuer la saisie", "Keep editing")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => afterDiscard.current()}>{t(locale, "Abandonner les modifications", "Discard edits")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
