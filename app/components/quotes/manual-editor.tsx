"use client"

import { useRef, useState, type FormEvent } from "react"
import "./editor-layout.css"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { calculateQuote, type QuoteData, type QuoteLine, type QuoteSection } from "@/lib/quote"

type Locale = "fr" | "en"
type Errors = Record<string, string>

function t(locale: Locale, fr: string, en: string) {
  return locale === "fr" ? fr : en
}

function validationMessage(locale: Locale, code: string) {
  const messages: Record<string, [string, string]> = {
    invalid_value: ["Indiquez une valeur valide.", "Enter a valid value."],
    unsupported_precision: ["La précision indiquée n'est pas prise en charge.", "This precision is not supported."],
    negative_value: ["La valeur ne peut pas être négative.", "The value cannot be negative."],
    must_be_positive: ["La quantité doit être supérieure à zéro.", "Quantity must be greater than zero."],
    out_of_range: ["La valeur est hors de la plage autorisée.", "The value is outside the allowed range."],
    inapplicable: ["Ce champ doit rester vide pour ce mode de prix.", "This field must be blank for this pricing mode."],
    unknown_section: ["Choisissez une section existante.", "Choose an existing section."],
    duplicate: ["Cette valeur existe déjà.", "This value already exists."],
    invalid_type: ["La valeur a un format invalide.", "This value has an invalid format."],
  }
  const message = messages[code]
  return message ? message[locale === "fr" ? 0 : 1] : t(locale, "Corrigez cette valeur.", "Correct this value.")
}

function errorsFor(result: ReturnType<typeof calculateQuote>, locale: Locale) {
  return result.errors.reduce<Errors>((errors, issue) => {
    const path = String(issue.path).replace(/\[(\d+)\]/g, ".$1")
    errors[path] = validationMessage(locale, issue.code)
    return errors
  }, {})
}

function firstErrorId(errors: Errors, fields: Array<[string, string]>) {
  return fields.find(([path]) => errors[path])?.[1]
}

export function ManualEditor({
  quote,
  locale,
  lockedReference,
  onApply,
  onClose,
}: {
  quote: QuoteData
  locale: Locale
  lockedReference: boolean
  onApply: (q: QuoteData) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<QuoteData>(() => structuredClone(quote))
  const [errors, setErrors] = useState<Errors>({})

  function update<K extends keyof QuoteData>(key: K, value: QuoteData[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      const next = { ...current }
      delete next[String(key)]
      return next
    })
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = errorsFor(calculateQuote(draft), locale)
    setErrors(nextErrors)
    const id = firstErrorId(nextErrors, [
      ["reference", "manual-reference"],
      ["title", "manual-title"],
      ["issueDate", "manual-issue-date"],
      ["validUntil", "manual-valid-until"],
      ["customerName", "manual-customer-name"],
      ["customerAddress", "manual-customer-address"],
      ["businessName", "manual-business-name"],
      ["businessAddress", "manual-business-address"],
      ["businessContact", "manual-business-contact"],
      ["vatRegistered", "manual-vat-registered"],
      ["vatId", "manual-vat-id"],
      ["discount", "manual-discount"],
    ])
    if (id) {
      const field = document.getElementById(id)
      field?.closest("details")?.setAttribute("open", "")
      field?.focus()
      return
    }
    onApply(draft)
    onClose()
  }

  const fieldError = (path: string) => errors[path]
  const referenceDescription = lockedReference
    ? t(locale, "La référence est verrouillée après la publication du devis.", "The reference is locked after the quote is published.")
    : t(locale, "La référence est propre à ce devis.", "The reference belongs to this quote only.")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="qp-modal qp-editor-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(locale, "Modifier le devis", "Edit quote")}</DialogTitle>
          <DialogDescription>
            {t(locale, "Ces modifications concernent uniquement ce devis. Les fiches clients et les valeurs par défaut de l'entreprise restent inchangées.", "This changes this Quote only. Saved Customer records and business defaults stay unchanged.")}
          </DialogDescription>
        </DialogHeader>

        <form className="qp-editor-form" onSubmit={apply} noValidate>
          <div className="qp-editor-body">
          <details open>
            <summary>{t(locale, "Devis", "Quote")}</summary>
            <FieldGroup>
              <Field data-disabled={lockedReference || undefined} data-invalid={Boolean(fieldError("reference")) || undefined}>
                <FieldLabel htmlFor="manual-reference">{t(locale, "Référence", "Reference")}</FieldLabel>
                <Input id="manual-reference" value={draft.reference} disabled={lockedReference} onChange={(event) => update("reference", event.target.value)} aria-invalid={Boolean(fieldError("reference"))} aria-describedby={fieldError("reference") ? "manual-reference-error" : "manual-reference-description"} />
                <FieldDescription id="manual-reference-description">{referenceDescription}</FieldDescription>
                {fieldError("reference") && <FieldError id="manual-reference-error">{fieldError("reference")}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(fieldError("title")) || undefined}>
                <FieldLabel htmlFor="manual-title">{t(locale, "Objet", "Title")}</FieldLabel>
                <Input id="manual-title" value={draft.title} onChange={(event) => update("title", event.target.value)} aria-invalid={Boolean(fieldError("title"))} aria-describedby={fieldError("title") ? "manual-title-error" : undefined} />
                {fieldError("title") && <FieldError id="manual-title-error">{fieldError("title")}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(fieldError("issueDate")) || undefined}>
                <FieldLabel htmlFor="manual-issue-date">{t(locale, "Date d'émission", "Issue date")}</FieldLabel>
                <Input id="manual-issue-date" type="date" value={draft.issueDate} onChange={(event) => update("issueDate", event.target.value)} aria-invalid={Boolean(fieldError("issueDate"))} aria-describedby={fieldError("issueDate") ? "manual-issue-date-error" : undefined} />
                {fieldError("issueDate") && <FieldError id="manual-issue-date-error">{fieldError("issueDate")}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(fieldError("validUntil")) || undefined}>
                <FieldLabel htmlFor="manual-valid-until">{t(locale, "Valable jusqu'au", "Valid until")}</FieldLabel>
                <Input id="manual-valid-until" type="date" value={draft.validUntil} onChange={(event) => update("validUntil", event.target.value)} aria-invalid={Boolean(fieldError("validUntil"))} aria-describedby={fieldError("validUntil") ? "manual-valid-until-error" : undefined} />
                {fieldError("validUntil") && <FieldError id="manual-valid-until-error">{fieldError("validUntil")}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-site-address">{t(locale, "Adresse du chantier", "Site address")}</FieldLabel>
                <Textarea id="manual-site-address" value={draft.siteAddress} onChange={(event) => update("siteAddress", event.target.value)} />
              </Field>
            </FieldGroup>
          </details>

          <details open>
            <summary>{t(locale, "Client", "Customer")}</summary>
            <FieldGroup>
              <Field data-invalid={Boolean(fieldError("customerName")) || undefined}>
                <FieldLabel htmlFor="manual-customer-name">{t(locale, "Nom", "Name")}</FieldLabel>
                <Input id="manual-customer-name" value={draft.customerName} onChange={(event) => update("customerName", event.target.value)} aria-invalid={Boolean(fieldError("customerName"))} aria-describedby={fieldError("customerName") ? "manual-customer-name-error" : undefined} />
                {fieldError("customerName") && <FieldError id="manual-customer-name-error">{fieldError("customerName")}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(fieldError("customerAddress")) || undefined}>
                <FieldLabel htmlFor="manual-customer-address">{t(locale, "Adresse", "Address")}</FieldLabel>
                <Textarea id="manual-customer-address" value={draft.customerAddress} onChange={(event) => update("customerAddress", event.target.value)} aria-invalid={Boolean(fieldError("customerAddress"))} aria-describedby={fieldError("customerAddress") ? "manual-customer-address-error" : undefined} />
                {fieldError("customerAddress") && <FieldError id="manual-customer-address-error">{fieldError("customerAddress")}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-customer-contact">{t(locale, "Personne de contact", "Contact person")}</FieldLabel>
                <Input id="manual-customer-contact" value={draft.customerContact} onChange={(event) => update("customerContact", event.target.value)} />
                <FieldDescription>{t(locale, "Facultatif.", "Optional.")}</FieldDescription>
              </Field>
            </FieldGroup>
          </details>

          <details>
            <summary>{t(locale, "Votre entreprise", "Your business")}</summary>
            <FieldGroup>
              <Field data-invalid={Boolean(fieldError("businessName")) || undefined}>
                <FieldLabel htmlFor="manual-business-name">{t(locale, "Raison sociale", "Business name")}</FieldLabel>
                <Input id="manual-business-name" value={draft.businessName} onChange={(event) => update("businessName", event.target.value)} aria-invalid={Boolean(fieldError("businessName"))} aria-describedby={fieldError("businessName") ? "manual-business-name-error" : undefined} />
                {fieldError("businessName") && <FieldError id="manual-business-name-error">{fieldError("businessName")}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(fieldError("businessAddress")) || undefined}>
                <FieldLabel htmlFor="manual-business-address">{t(locale, "Adresse", "Address")}</FieldLabel>
                <Textarea id="manual-business-address" value={draft.businessAddress} onChange={(event) => update("businessAddress", event.target.value)} aria-invalid={Boolean(fieldError("businessAddress"))} aria-describedby={fieldError("businessAddress") ? "manual-business-address-error" : undefined} />
                {fieldError("businessAddress") && <FieldError id="manual-business-address-error">{fieldError("businessAddress")}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(fieldError("businessContact")) || undefined}>
                <FieldLabel htmlFor="manual-business-contact">{t(locale, "Coordonnées", "Contact details")}</FieldLabel>
                <Input id="manual-business-contact" value={draft.businessContact} onChange={(event) => update("businessContact", event.target.value)} aria-invalid={Boolean(fieldError("businessContact"))} aria-describedby={fieldError("businessContact") ? "manual-business-contact-error" : undefined} />
                {fieldError("businessContact") && <FieldError id="manual-business-contact-error">{fieldError("businessContact")}</FieldError>}
              </Field>
            </FieldGroup>
          </details>

          <details id="manual-pricing">
            <summary>{t(locale, "Prix et TVA", "Pricing and VAT")}</summary>
            <p className="mb-4 text-sm">{t(locale, "Deux cas pris en charge : non-assujetti, ou totalité des travaux au taux normal actuel de 8,1 %. Les autres traitements fiscaux ne sont pas pris en charge.", "Two supported cases: not VAT registered, or all work at the current 8.1% standard rate. Other tax treatments are unsupported.")}</p>
            <FieldGroup>
              <Field data-invalid={Boolean(fieldError("vatRegistered")) || undefined}>
                <FieldLabel htmlFor="manual-vat-registered">{t(locale, "Assujetti à la TVA", "VAT registered")}</FieldLabel>
                <select id="manual-vat-registered" value={draft.vatRegistered === null ? "unknown" : draft.vatRegistered ? "yes" : "no"} onChange={(event) => update("vatRegistered", event.target.value === "unknown" ? null : event.target.value === "yes")} aria-invalid={Boolean(fieldError("vatRegistered"))} aria-describedby={fieldError("vatRegistered") ? "manual-vat-registered-error" : undefined}>
                  <option value="unknown">{t(locale, "À préciser", "To confirm")}</option>
                  <option value="yes">{t(locale, "Oui", "Yes")}</option>
                  <option value="no">{t(locale, "Non", "No")}</option>
                </select>
                {fieldError("vatRegistered") && <FieldError id="manual-vat-registered-error">{fieldError("vatRegistered")}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(fieldError("vatId")) || undefined}>
                <FieldLabel htmlFor="manual-vat-id">{t(locale, "Numéro TVA", "VAT identifier")}</FieldLabel>
                <Input id="manual-vat-id" value={draft.vatId} onChange={(event) => update("vatId", event.target.value)} aria-invalid={Boolean(fieldError("vatId"))} aria-describedby={fieldError("vatId") ? "manual-vat-id-error" : undefined} />
                {draft.vatRegistered === true && !draft.vatId.trim() && <FieldDescription>{t(locale, "Le numéro TVA manque. Vous pouvez enregistrer ce brouillon de travail incomplet et le compléter plus tard.", "The VAT identifier is missing. You can save this incomplete Working Draft and complete it later.")}</FieldDescription>}
                {fieldError("vatId") && <FieldError id="manual-vat-id-error">{fieldError("vatId")}</FieldError>}
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-discount-mode">{t(locale, "Remise", "Discount")}</FieldLabel>
                <select id="manual-discount-mode" value={draft.discountMode} onChange={(event) => update("discountMode", event.target.value as QuoteData["discountMode"])}>
                  <option value="none">{t(locale, "Aucune", "None")}</option>
                  <option value="percent">{t(locale, "Pourcentage", "Percentage")}</option>
                  <option value="fixed">{t(locale, "Montant fixe", "Fixed amount")}</option>
                </select>
              </Field>
              <Field data-disabled={draft.discountMode === "none" || undefined} data-invalid={Boolean(fieldError("discount")) || undefined}>
                <FieldLabel htmlFor="manual-discount">{t(locale, "Valeur de la remise", "Discount value")}</FieldLabel>
                <Input id="manual-discount" inputMode="decimal" value={draft.discount} disabled={draft.discountMode === "none"} onChange={(event) => update("discount", event.target.value)} aria-invalid={Boolean(fieldError("discount"))} aria-describedby={fieldError("discount") ? "manual-discount-error" : undefined} />
                {fieldError("discount") && <FieldError id="manual-discount-error">{fieldError("discount")}</FieldError>}
              </Field>
            </FieldGroup>
          </details>

          <details>
            <summary>{t(locale, "Conditions", "Terms")}</summary>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="manual-terms">{t(locale, "Conditions du devis", "Quote terms")}</FieldLabel>
                <Textarea id="manual-terms" value={draft.terms} onChange={(event) => update("terms", event.target.value)} />
                <FieldDescription>{t(locale, "Facultatif.", "Optional.")}</FieldDescription>
              </Field>
            </FieldGroup>
          </details>

          </div>
          <DialogFooter className="qp-editor-footer">
            <Button type="button" variant="outline" onClick={onClose}>{t(locale, "Annuler", "Cancel")}</Button>
            <Button type="submit">{t(locale, "Appliquer", "Apply")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function LineEditor({
  line,
  lineNumber,
  sections,
  locale,
  onApply,
  onClose,
}: {
  line: QuoteLine
  lineNumber?: number
  sections: QuoteSection[]
  locale: Locale
  onApply: (l: QuoteLine) => void
  onClose: () => void
}) {
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const descriptionLabelRef = useRef<HTMLLabelElement>(null)
  const [draft, setDraft] = useState<QuoteLine>(() => structuredClone(line))
  const [errors, setErrors] = useState<Errors>({})

  function update<K extends keyof QuoteLine>(key: K, value: QuoteLine[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      const next = { ...current }
      delete next[`lines.0.${String(key)}`]
      return next
    })
  }

  function changeMode(mode: QuoteLine["mode"]) {
    setDraft((current) => mode === "quantity"
      ? { ...current, mode, amount: "" }
      : { ...current, mode, quantity: "", unit: "", unitPrice: "" })
    setErrors({})
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = calculateQuote({
      reference: "",
      title: "",
      customerName: "",
      customerAddress: "",
      customerContact: "",
      businessName: "",
      businessAddress: "",
      businessContact: "",
      vatId: "",
      vatRegistered: null,
      issueDate: "",
      validUntil: "",
      siteAddress: "",
      terms: "",
      discountMode: "none",
      discount: "",
      sections,
      lines: [draft],
    })
    const nextErrors = errorsFor(result, locale)
    setErrors(nextErrors)
    const id = firstErrorId(nextErrors, [
      ["lines.0.sectionId", "line-section"],
      ["lines.0.description", "line-description"],
      ["lines.0.quantity", "line-quantity"],
      ["lines.0.unit", "line-unit"],
      ["lines.0.unitPrice", "line-unit-price"],
      ["lines.0.amount", "line-amount"],
    ])
    if (id) {
      // Wait for inline errors to render before revealing the whole field.
      requestAnimationFrame(() => {
        const field = document.getElementById(id)
        field?.focus({ preventScroll: true })
        field?.closest('[data-slot="field"]')?.scrollIntoView({ block: "nearest" })
      })
      return
    }
    onApply(draft)
    onClose()
  }

  const fieldError = (field: string) => errors[`lines.0.${field}`]
  const hasCurrentSection = sections.some((section) => section.id === draft.sectionId)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="qp-modal qp-editor-dialog" showCloseButton={false} onOpenAutoFocus={(event) => {
        event.preventDefault()
        // Focus the description label on touch devices so opening the editor
        // does not summon a software keyboard. Tab still reaches Description first.
        const target = window.matchMedia("(pointer: coarse)").matches ? descriptionLabelRef.current : descriptionRef.current
        target?.focus({ preventScroll: true })
      }}>
        <DialogHeader>
          <DialogTitle>{lineNumber === undefined
            ? t(locale, "Ajouter une ligne", "Add a line")
            : t(locale, `Modifier la ligne ${lineNumber}`, `Edit quote line ${lineNumber}`)}</DialogTitle>
          <DialogDescription>{t(locale, "Les champs peuvent rester vides. Utilisez une virgule ou un point pour les décimales.", "Fields may stay blank. Use a comma or a point for decimals.")}</DialogDescription>
        </DialogHeader>

        <form className="qp-editor-form" onSubmit={apply} noValidate>
          <div className="qp-editor-body">
          <FieldGroup>
            <Field data-invalid={Boolean(fieldError("description")) || undefined}>
              <FieldLabel ref={descriptionLabelRef} tabIndex={-1} htmlFor="line-description">{t(locale, "Description", "Description")}</FieldLabel>
              <Textarea ref={descriptionRef} id="line-description" rows={5} value={draft.description} onChange={(event) => update("description", event.target.value)} aria-invalid={Boolean(fieldError("description"))} aria-describedby={fieldError("description") ? "line-description-error" : undefined} />
              {fieldError("description") && <FieldError id="line-description-error">{fieldError("description")}</FieldError>}
            </Field>
            <Field data-invalid={Boolean(fieldError("sectionId")) || undefined}>
              <FieldLabel htmlFor="line-section">{t(locale, "Section", "Section")}</FieldLabel>
              <select id="line-section" value={draft.sectionId} onChange={(event) => update("sectionId", event.target.value)} aria-invalid={Boolean(fieldError("sectionId"))} aria-describedby={fieldError("sectionId") ? "line-section-error" : undefined}>
                <option value="">{t(locale, "Sans section", "No section")}</option>
                {!hasCurrentSection && draft.sectionId && <option value={draft.sectionId}>{draft.sectionId}</option>}
                {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
              </select>
              {fieldError("sectionId") && <FieldError id="line-section-error">{fieldError("sectionId")}</FieldError>}
            </Field>
          </FieldGroup>
          <FieldSet className="qp-editor-pricing">
            <FieldLegend>{t(locale, "Prix", "Pricing")}</FieldLegend>
            <FieldGroup>
            <Field>
              <FieldLabel htmlFor="line-mode">{t(locale, "Mode de prix", "Pricing mode")}</FieldLabel>
              <select id="line-mode" value={draft.mode} onChange={(event) => changeMode(event.target.value as QuoteLine["mode"])}>
                <option value="quantity">{t(locale, "Quantité et prix unitaire", "Quantity and unit price")}</option>
                <option value="fixed">{t(locale, "Montant fixe", "Fixed amount")}</option>
              </select>
            </Field>

            {draft.mode === "quantity" ? <FieldGroup className="qp-editor-quantity-grid">
              <Field data-invalid={Boolean(fieldError("quantity")) || undefined}>
                <FieldLabel htmlFor="line-quantity">{t(locale, "Quantité", "Quantity")}</FieldLabel>
                <Input id="line-quantity" inputMode="decimal" value={draft.quantity} onChange={(event) => update("quantity", event.target.value)} aria-invalid={Boolean(fieldError("quantity"))} aria-describedby={fieldError("quantity") ? "line-quantity-error" : undefined} />
                {fieldError("quantity") && <FieldError id="line-quantity-error">{fieldError("quantity")}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(fieldError("unit")) || undefined}>
                <FieldLabel htmlFor="line-unit">{t(locale, "Unité", "Unit")}</FieldLabel>
                <Input id="line-unit" list="line-unit-suggestions" value={draft.unit} onChange={(event) => update("unit", event.target.value)} aria-invalid={Boolean(fieldError("unit"))} aria-describedby={fieldError("unit") ? "line-unit-error" : undefined} />
                <datalist id="line-unit-suggestions"><option value="h" /><option value="m" /><option value="m²" /><option value="m³" /><option value="pce" /><option value="forfait" /></datalist>
                <FieldDescription>{t(locale, "Suggestions uniquement. Aucune conversion n'est appliquée.", "Suggestions only. No conversion is applied.")}</FieldDescription>
                {fieldError("unit") && <FieldError id="line-unit-error">{fieldError("unit")}</FieldError>}
              </Field>
              <Field data-invalid={Boolean(fieldError("unitPrice")) || undefined}>
                <FieldLabel htmlFor="line-unit-price">{t(locale, "Prix unitaire", "Unit price")}</FieldLabel>
                <Input id="line-unit-price" inputMode="decimal" value={draft.unitPrice} onChange={(event) => update("unitPrice", event.target.value)} aria-invalid={Boolean(fieldError("unitPrice"))} aria-describedby={fieldError("unitPrice") ? "line-unit-price-error" : undefined} />
                {fieldError("unitPrice") && <FieldError id="line-unit-price-error">{fieldError("unitPrice")}</FieldError>}
              </Field>
            </FieldGroup> : <Field data-invalid={Boolean(fieldError("amount")) || undefined}>
              <FieldLabel htmlFor="line-amount">{t(locale, "Montant", "Amount")}</FieldLabel>
              <Input id="line-amount" inputMode="decimal" value={draft.amount} onChange={(event) => update("amount", event.target.value)} aria-invalid={Boolean(fieldError("amount"))} aria-describedby={fieldError("amount") ? "line-amount-error" : undefined} />
              <FieldDescription>{t(locale, "Un montant de zéro est accepté.", "An amount of zero is allowed.")}</FieldDescription>
              {fieldError("amount") && <FieldError id="line-amount-error">{fieldError("amount")}</FieldError>}
            </Field>}
            </FieldGroup>
          </FieldSet>
          </div>

          <DialogFooter className="qp-editor-footer">
            <Button type="button" variant="outline" onClick={onClose}>{t(locale, "Annuler", "Cancel")}</Button>
            <Button type="submit">{t(locale, "Appliquer", "Apply")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
