"use client"

import { useEffect, useId, useRef, useState, type FormEvent } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { QuoteData } from "@/lib/quote"
import { randomUUID } from "@/lib/random-id"
import "./editor-layout.css"

type Locale = "fr" | "en"
type Customer = { id: string; name: string; address: string; contact: string }
type CustomerFields = Omit<Customer, "id">
type RecordsResponse = { customers?: Customer[]; savedCustomer?: Customer }

function t(locale: Locale, fr: string, en: string) {
  return locale === "fr" ? fr : en
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
}

export function CustomerQuoteEditor({
  quote,
  locale,
  onApply,
  onClose,
}: {
  quote: QuoteData
  locale: Locale
  onApply: (next: QuoteData) => void
  onClose: () => void
}) {
  const id = useId()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [fields, setFields] = useState<CustomerFields>(() => ({
    name: quote.customerName, address: quote.customerAddress, contact: quote.customerContact,
  }))
  const [saveToList, setSaveToList] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [invalid, setInvalid] = useState<Array<"name" | "address">>([])
  const loadController = useRef<AbortController | null>(null)
  const saveRequest = useRef<{ payload: string; id: string } | null>(null)

  async function load() {
    loadController.current?.abort()
    const controller = new AbortController()
    loadController.current = controller
    setLoading(true)
    setLoadError(false)
    try {
      const response = await fetch("/api/quotes", { signal: controller.signal })
      if (!response.ok) throw new Error("load failed")
      const data = await response.json() as RecordsResponse
      if (!Array.isArray(data.customers)) throw new Error("invalid customer list")
      if (!controller.signal.aborted) setCustomers(data.customers)
    } catch {
      if (!controller.signal.aborted) setLoadError(true)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    return () => loadController.current?.abort()
  }, [])

  const filtered = customers.filter((customer) =>
    normalize(`${customer.name} ${customer.address} ${customer.contact}`).includes(normalize(search)))

  function choose(id: string) {
    setSelectedId(id)
    setSearch("")
    setSaveToList(false)
    setSaveError(false)
    setInvalid([])
    const customer = customers.find((item) => item.id === id)
    // Choosing "New Customer" deliberately starts a blank record. Opening the dialog does not.
    setFields(customer
      ? { name: customer.name, address: customer.address, contact: customer.contact }
      : { name: "", address: "", contact: "" })
    saveRequest.current = null
  }

  function change(key: keyof CustomerFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }))
    setInvalid((current) => current.filter((field) => field !== key))
    setSaveError(false)
  }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (saveToList && !selectedId) {
      const missing = [
        ...(!fields.name.trim() ? ["name" as const] : []),
        ...(!fields.address.trim() ? ["address" as const] : []),
      ]
      if (missing.length) {
        setInvalid(missing)
        document.getElementById(`${id}-${missing[0]}`)?.focus()
        return
      }
      setSaving(true)
      setSaveError(false)
      try {
        // Never send an existing record's id. Edits to a selected Customer are Quote-only.
        const customer = { name: fields.name, address: fields.address, contact: fields.contact }
        const payload = JSON.stringify(customer)
        if (saveRequest.current?.payload !== payload) saveRequest.current = { payload, id: randomUUID() }
        const response = await fetch("/api/quotes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "customer-save", customer, requestId: saveRequest.current.id }),
        })
        if (!response.ok) throw new Error("save failed")
        const data = await response.json() as RecordsResponse
        if (!data.savedCustomer?.id) throw new Error("missing saved Customer")
        saveRequest.current = null
      } catch {
        setSaveError(true)
        setSaving(false)
        return
      }
    }
    onApply({
      ...quote,
      customerName: fields.name,
      customerAddress: fields.address,
      customerContact: fields.contact,
    })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <DialogContent className="qp-modal qp-editor-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(locale, "Client du devis", "Quote Customer")}</DialogTitle>
          <DialogDescription>{t(locale,
            "Choisissez un client enregistré ou saisissez ses coordonnées. Les modifications ici ne changent que ce devis.",
            "Choose a saved Customer or enter their details. Edits here change only this Quote.")}</DialogDescription>
        </DialogHeader>
        <form id={`${id}-form`} onSubmit={(event) => void apply(event)} className="qp-editor-form">
          <div className="qp-editor-body">
          <FieldGroup>
            <Field data-disabled={saving || undefined}>
              <FieldLabel htmlFor={`${id}-search`}>{t(locale, "Rechercher un client", "Search Customers")}</FieldLabel>
              <Input id={`${id}-search`} type="search" value={search} disabled={saving}
                onChange={(event) => setSearch(event.target.value)} />
            </Field>
            {loadError && <Alert variant="destructive">
              <AlertTitle>{t(locale, "Clients indisponibles", "Customers unavailable")}</AlertTitle>
              <AlertDescription>{t(locale, "Réessayez ou saisissez les coordonnées ci-dessous.", "Retry or enter details below.")}
                <Button type="button" variant="outline" disabled={saving} onClick={() => void load()}>{t(locale, "Réessayer", "Retry")}</Button>
              </AlertDescription>
            </Alert>}
            <Field data-disabled={saving || undefined}>
              <FieldLabel htmlFor={`${id}-customer`}>{t(locale, "Client enregistré", "Saved Customer")}</FieldLabel>
              <select id={`${id}-customer`} value={selectedId} disabled={saving} onChange={(event) => choose(event.target.value)}>
                <option value="">{t(locale, "Aucune fiche sélectionnée", "No record selected")}</option>
                {filtered.map((customer) => <option key={customer.id} value={customer.id}>
                  {customer.name} — {customer.address.replace(/\n/g, ", ")}
                </option>)}
                {selectedId && !filtered.some((customer) => customer.id === selectedId) &&
                  customers.filter((customer) => customer.id === selectedId).map((customer) =>
                    <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </select>
              <FieldDescription>{loading
                ? t(locale, "Chargement des clients…", "Loading Customers…")
                : t(locale, "Choisir une fiche copie ses coordonnées. Les modifications restent propres à ce devis.",
                    "Choosing a record copies its details. Further edits stay in this Quote.")}</FieldDescription>
            </Field>
            {!loading && !loadError && filtered.length === 0 && <p className="text-sm text-muted-foreground" role="status">{search
              ? t(locale, "Aucun client ne correspond à la recherche.", "No Customers match your search.")
              : t(locale, "Aucun client enregistré. Saisissez ses coordonnées ci-dessous.", "No saved Customers. Enter details below.")}</p>}
            <Button type="button" variant="outline" disabled={saving} onClick={() => choose("")}>{t(locale, "Nouveau client (effacer les champs)", "New Customer (clear fields)")}</Button>
            <Field data-invalid={invalid.includes("name") || undefined} data-disabled={saving || undefined}>
              <FieldLabel htmlFor={`${id}-name`}>{t(locale, "Nom du client", "Customer name")}</FieldLabel>
              <Input id={`${id}-name`} value={fields.name} disabled={saving} aria-invalid={invalid.includes("name")}
                aria-describedby={invalid.includes("name") ? `${id}-name-error` : undefined}
                onChange={(event) => change("name", event.target.value)} />
              {invalid.includes("name") && <FieldError id={`${id}-name-error`}>{t(locale, "Indiquez le nom pour enregistrer ce client.", "Enter a name to save this Customer.")}</FieldError>}
            </Field>
            <Field data-invalid={invalid.includes("address") || undefined} data-disabled={saving || undefined}>
              <FieldLabel htmlFor={`${id}-address`}>{t(locale, "Adresse du client", "Customer address")}</FieldLabel>
              <Textarea id={`${id}-address`} value={fields.address} disabled={saving} aria-invalid={invalid.includes("address")}
                aria-describedby={invalid.includes("address") ? `${id}-address-error` : undefined}
                onChange={(event) => change("address", event.target.value)} />
              {invalid.includes("address") && <FieldError id={`${id}-address-error`}>{t(locale, "Indiquez l'adresse pour enregistrer ce client.", "Enter an address to save this Customer.")}</FieldError>}
            </Field>
            <Field data-disabled={saving || undefined}>
              <FieldLabel htmlFor={`${id}-contact`}>{t(locale, "Personne de contact", "Contact person")}</FieldLabel>
              <Input id={`${id}-contact`} value={fields.contact} disabled={saving}
                onChange={(event) => change("contact", event.target.value)} />
              <FieldDescription>{t(locale, "Facultatif.", "Optional.")}</FieldDescription>
            </Field>
            {!selectedId && <Field orientation="horizontal" data-disabled={saving || undefined}>
              <input id={`${id}-save`} type="checkbox" checked={saveToList} disabled={saving}
                onChange={(event) => { setSaveToList(event.target.checked); setSaveError(false); setInvalid([]) }} />
              <FieldLabel htmlFor={`${id}-save`}>{t(locale, "Enregistrer dans la liste des clients", "Save to customer list")}</FieldLabel>
            </Field>}
            {saveError && <Alert variant="destructive" role="alert">
              <AlertTitle>{t(locale, "Client non enregistré", "Customer not saved")}</AlertTitle>
              <AlertDescription>{t(locale,
                "Le devis est inchangé. Votre saisie est conservée ; réessayez ou décochez l'enregistrement dans la liste.",
                "The Quote is unchanged. Your entries are kept; retry or uncheck saving to the list.")}</AlertDescription>
            </Alert>}
          </FieldGroup>
          </div>
        <DialogFooter className="qp-editor-footer">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t(locale, "Annuler", "Cancel")}</Button>
          <Button type="submit" form={`${id}-form`} disabled={saving}>{saving
            ? t(locale, "Enregistrement…", "Saving…")
            : t(locale, "Appliquer au devis", "Apply to Quote")}</Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
