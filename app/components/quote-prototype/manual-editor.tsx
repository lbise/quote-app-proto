"use client"

import { useState, type FormEvent } from "react"

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
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

// THROWAWAY manual editing controls for layout review, not production forms.
import type { QuoteData, QuoteLine, QuoteSection } from "./fixtures"
import { scaled, totals } from "./calculations"

type Locale = "fr" | "en"
type LineError = "quantity" | "unitPrice" | "amount"

function t(locale: Locale, fr: string, en: string) {
  return locale === "fr" ? fr : en
}

function decimalError(value: string, precision: number, locale: Locale) {
  if (!value.trim()) {
    return undefined
  }

  const pattern = new RegExp(`^\\d+(?:[,.]\\d{1,${precision}})?$`)
  if (!pattern.test(value.trim())) {
    return t(
      locale,
      `Indiquez un nombre avec au plus ${precision} décimales.`,
      `Enter a number with no more than ${precision} decimal places.`
    )
  }

  return undefined
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
  const [draft, setDraft] = useState(() => ({ ...quote }))
  const [discountError, setDiscountError] = useState<string>()

  function update<K extends keyof QuoteData>(key: K, value: QuoteData[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.discountMode !== "none" && (scaled(draft.discount, 2) === null || !totals(draft).validDiscount)) {
      setDiscountError(t(locale, "Indiquez une remise valide, au plus égale au sous-total, avec deux décimales au maximum.", "Enter a valid discount no greater than the subtotal, with at most two decimal places."))
      document.getElementById("manual-pricing")?.setAttribute("open", "")
      setTimeout(() => document.getElementById("manual-discount")?.focus(), 0)
      return
    }
    setDiscountError(undefined)
    onApply(draft)
    onClose()
  }

  const referenceDescription = lockedReference
    ? t(
        locale,
        "La référence est verrouillée après la publication du devis.",
        "The reference is locked after the quote is published."
      )
    : t(
        locale,
        "La référence est propre à ce devis.",
        "The reference belongs to this quote only."
      )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="qp-modal" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(locale, "Modifier le devis", "Edit quote")}</DialogTitle>
          <DialogDescription>
            {t(
              locale,
              "Copie uniquement. Ces changements restent dans ce devis et ne créent ni ne mettent à jour de fiche client ou d'entreprise réutilisable.",
              "This changes this copied quote only. It does not create or update a reusable customer or business record."
            )}
          </DialogDescription>
        </DialogHeader>

        <form className="flex max-h-[75vh] flex-col gap-5 overflow-y-auto" onSubmit={apply}>
          <details open>
            <summary>{t(locale, "Devis", "Quote")}</summary>
            <FieldGroup>
              <Field data-disabled={lockedReference || undefined}>
                <FieldLabel htmlFor="manual-reference">
                  {t(locale, "Référence", "Reference")}
                </FieldLabel>
                <Input
                  id="manual-reference"
                  value={draft.reference}
                  disabled={lockedReference}
                  onChange={(event) => update("reference", event.target.value)}
                  aria-describedby="manual-reference-description"
                />
                <FieldDescription id="manual-reference-description">
                  {referenceDescription}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-title">
                  {t(locale, "Objet", "Title")}
                </FieldLabel>
                <Input
                  id="manual-title"
                  value={draft.title}
                  onChange={(event) => update("title", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-issue-date">
                  {t(locale, "Date d'émission", "Issue date")}
                </FieldLabel>
                <Input
                  id="manual-issue-date"
                  type="date"
                  value={draft.issueDate}
                  onChange={(event) => update("issueDate", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-valid-until">
                  {t(locale, "Valable jusqu'au", "Valid until")}
                </FieldLabel>
                <Input
                  id="manual-valid-until"
                  type="date"
                  value={draft.validUntil}
                  onChange={(event) => update("validUntil", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-site-address">
                  {t(locale, "Adresse du chantier", "Site address")}
                </FieldLabel>
                <Textarea
                  id="manual-site-address"
                  value={draft.siteAddress}
                  onChange={(event) => update("siteAddress", event.target.value)}
                />
              </Field>
            </FieldGroup>
          </details>

          <details open>
            <summary>{t(locale, "Client", "Customer")}</summary>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="manual-customer-name">
                  {t(locale, "Nom", "Name")}
                </FieldLabel>
                <Input
                  id="manual-customer-name"
                  value={draft.customerName}
                  onChange={(event) => update("customerName", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-customer-address">
                  {t(locale, "Adresse", "Address")}
                </FieldLabel>
                <Textarea
                  id="manual-customer-address"
                  value={draft.customerAddress}
                  onChange={(event) => update("customerAddress", event.target.value)}
                />
              </Field>
            </FieldGroup>
          </details>

          <details>
            <summary>{t(locale, "Votre entreprise", "Your business")}</summary>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="manual-business-name">
                  {t(locale, "Raison sociale", "Business name")}
                </FieldLabel>
                <Input
                  id="manual-business-name"
                  value={draft.businessName}
                  onChange={(event) => update("businessName", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-business-address">
                  {t(locale, "Adresse", "Address")}
                </FieldLabel>
                <Textarea
                  id="manual-business-address"
                  value={draft.businessAddress}
                  onChange={(event) => update("businessAddress", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-business-contact">
                  {t(locale, "Coordonnées", "Contact details")}
                </FieldLabel>
                <Input
                  id="manual-business-contact"
                  value={draft.businessContact}
                  onChange={(event) => update("businessContact", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-vat-id">{t(locale, "Numéro TVA", "VAT identifier")}</FieldLabel>
                <Input
                  id="manual-vat-id"
                  value={draft.vatId}
                  onChange={(event) => update("vatId", event.target.value)}
                />
              </Field>
            </FieldGroup>
          </details>

          <details id="manual-pricing">
            <summary>{t(locale, "Prix et TVA", "Pricing and VAT")}</summary>
            <p className="mb-4 text-sm">{t(locale, "Deux cas pris en charge : non-assujetti, ou totalité des travaux au taux normal actuel de 8,1 %. Les autres traitements fiscaux ne sont pas pris en charge.", "Two supported cases: not VAT registered, or all work at the current 8.1% standard rate. Other tax treatments are unsupported.")}</p>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="manual-vat-registered">
                  {t(locale, "Assujetti à la TVA", "VAT registered")}
                </FieldLabel>
                <select
                  id="manual-vat-registered"
                  value={draft.vatRegistered ? "yes" : "no"}
                  onChange={(event) => update("vatRegistered", event.target.value === "yes")}
                >
                  <option value="yes">{t(locale, "Oui", "Yes")}</option>
                  <option value="no">{t(locale, "Non", "No")}</option>
                </select>
              </Field>
              <Field>
                <FieldLabel htmlFor="manual-discount-mode">
                  {t(locale, "Remise", "Discount")}
                </FieldLabel>
                <select
                  id="manual-discount-mode"
                  value={draft.discountMode}
                  onChange={(event) =>
                    update(
                      "discountMode",
                      event.target.value as QuoteData["discountMode"]
                    )
                  }
                >
                  <option value="none">{t(locale, "Aucune", "None")}</option>
                  <option value="percent">{t(locale, "Pourcentage", "Percentage")}</option>
                  <option value="fixed">{t(locale, "Montant fixe", "Fixed amount")}</option>
                </select>
              </Field>
              <Field data-disabled={draft.discountMode === "none" || undefined} data-invalid={!!discountError || undefined}>
                <FieldLabel htmlFor="manual-discount">
                  {t(locale, "Valeur de la remise", "Discount value")}
                </FieldLabel>
                <Input
                  id="manual-discount"
                  aria-invalid={!!discountError}
                  aria-describedby={discountError ? "discount-error" : undefined}
                  inputMode="decimal"
                  value={draft.discount}
                  disabled={draft.discountMode === "none"}
                  onChange={(event) => { update("discount", event.target.value); setDiscountError(undefined) }}
                />
                {discountError && <FieldError id="discount-error">{discountError}</FieldError>}
              </Field>
            </FieldGroup>
          </details>

          <details>
            <summary>{t(locale, "Conditions", "Terms")}</summary>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="manual-terms">
                  {t(locale, "Conditions du devis", "Quote terms")}
                </FieldLabel>
                <Textarea
                  id="manual-terms"
                  value={draft.terms}
                  onChange={(event) => update("terms", event.target.value)}
                />
              </Field>
            </FieldGroup>
          </details>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t(locale, "Annuler", "Cancel")}
            </Button>
            <Button type="submit">{t(locale, "Appliquer", "Apply")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function LineEditor({
  line,
  sections,
  locale,
  onApply,
  onClose,
}: {
  line: QuoteLine
  sections: QuoteSection[]
  locale: Locale
  onApply: (l: QuoteLine) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => ({ ...line }))
  const [errors, setErrors] = useState<Partial<Record<LineError, string>>>({})

  function update<K extends keyof QuoteLine>(key: K, value: QuoteLine[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    if (key === "quantity" || key === "unitPrice" || key === "amount") {
      setErrors((current) => ({ ...current, [key]: undefined }))
    }
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors: Partial<Record<LineError, string>> = {}
    if (draft.mode === "quantity") {
      const quantityError = decimalError(draft.quantity, 3, locale)
      if (quantityError) {
        nextErrors.quantity = quantityError
      } else if (draft.quantity.trim() && Number(draft.quantity.replace(",", ".")) <= 0) {
        nextErrors.quantity = t(
          locale,
          "La quantité doit être supérieure à zéro.",
          "Quantity must be greater than zero."
        )
      }

      const unitPriceError = decimalError(draft.unitPrice, 2, locale)
      if (unitPriceError) {
        nextErrors.unitPrice = unitPriceError
      }
    } else {
      const amountError = decimalError(draft.amount, 2, locale)
      if (amountError) {
        nextErrors.amount = amountError
      }
    }

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      const first = nextErrors.quantity ? "line-quantity" : nextErrors.unitPrice ? "line-unit-price" : "line-amount"
      setTimeout(() => document.getElementById(first)?.focus(), 0)
      return
    }

    onApply(draft)
    onClose()
  }

  const hasCurrentSection = sections.some((section) => section.id === draft.sectionId)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="qp-modal" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(locale, "Modifier la ligne", "Edit quote line")}</DialogTitle>
          <DialogDescription>
            {t(
              locale,
              "Les champs peuvent rester vides. Utilisez une virgule ou un point pour les décimales.",
              "Fields may stay blank. Use a comma or a point for decimals."
            )}
          </DialogDescription>
        </DialogHeader>

        <form className="flex max-h-[75vh] flex-col gap-5 overflow-y-auto" onSubmit={apply}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="line-section">
                {t(locale, "Section", "Section")}
              </FieldLabel>
              <select
                id="line-section"
                value={draft.sectionId}
                onChange={(event) => update("sectionId", event.target.value)}
              >
                <option value="">{t(locale, "Sans section", "No section")}</option>
                {!hasCurrentSection && draft.sectionId && (
                  <option value={draft.sectionId}>{draft.sectionId}</option>
                )}
                {sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="line-description">
                {t(locale, "Description", "Description")}
              </FieldLabel>
              <Textarea
                id="line-description"
                rows={5}
                value={draft.description}
                onChange={(event) => update("description", event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="line-mode">
                {t(locale, "Mode de prix", "Pricing mode")}
              </FieldLabel>
              <select
                id="line-mode"
                value={draft.mode}
                onChange={(event) =>
                  update("mode", event.target.value as QuoteLine["mode"])
                }
              >
                <option value="quantity">
                  {t(locale, "Quantité et prix unitaire", "Quantity and unit price")}
                </option>
                <option value="fixed">
                  {t(locale, "Montant fixe", "Fixed amount")}
                </option>
              </select>
            </Field>

            {draft.mode === "quantity" ? (
              <>
                <Field data-invalid={Boolean(errors.quantity) || undefined}>
                  <FieldLabel htmlFor="line-quantity">
                    {t(locale, "Quantité", "Quantity")}
                  </FieldLabel>
                  <Input
                    id="line-quantity"
                    inputMode="decimal"
                    value={draft.quantity}
                    onChange={(event) => update("quantity", event.target.value)}
                    aria-invalid={Boolean(errors.quantity)}
                    aria-describedby={errors.quantity ? "line-quantity-error" : undefined}
                  />
                  {errors.quantity && (
                    <FieldError id="line-quantity-error">{errors.quantity}</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="line-unit">{t(locale, "Unité", "Unit")}</FieldLabel>
                  <Input
                    id="line-unit"
                    value={draft.unit}
                    onChange={(event) => update("unit", event.target.value)}
                  />
                </Field>
                <Field data-invalid={Boolean(errors.unitPrice) || undefined}>
                  <FieldLabel htmlFor="line-unit-price">
                    {t(locale, "Prix unitaire", "Unit price")}
                  </FieldLabel>
                  <Input
                    id="line-unit-price"
                    inputMode="decimal"
                    value={draft.unitPrice}
                    onChange={(event) => update("unitPrice", event.target.value)}
                    aria-invalid={Boolean(errors.unitPrice)}
                    aria-describedby={errors.unitPrice ? "line-unit-price-error" : undefined}
                  />
                  {errors.unitPrice && (
                    <FieldError id="line-unit-price-error">{errors.unitPrice}</FieldError>
                  )}
                </Field>
              </>
            ) : (
              <Field data-invalid={Boolean(errors.amount) || undefined}>
                <FieldLabel htmlFor="line-amount">
                  {t(locale, "Montant", "Amount")}
                </FieldLabel>
                <Input
                  id="line-amount"
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(event) => update("amount", event.target.value)}
                  aria-invalid={Boolean(errors.amount)}
                  aria-describedby={errors.amount ? "line-amount-error" : undefined}
                />
                <FieldDescription>
                  {t(locale, "Un montant de zéro est accepté.", "An amount of zero is allowed.")}
                </FieldDescription>
                {errors.amount && (
                  <FieldError id="line-amount-error">{errors.amount}</FieldError>
                )}
              </Field>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t(locale, "Annuler", "Cancel")}
            </Button>
            <Button type="submit">{t(locale, "Appliquer", "Apply")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
