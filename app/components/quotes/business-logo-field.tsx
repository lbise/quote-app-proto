import { useRef, useState, type ChangeEvent } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"

type Locale = "fr" | "en"

const MAX_LOGO_BYTES = 1_000_000
const t = (locale: Locale, fr: string, en: string) => locale === "fr" ? fr : en

/** Upload or remove the business logo. Uploading saves at once; existing Quotes keep the logo they copied. */
export function BusinessLogoField({ locale, logoId, disabled, onUploaded, onRemove }: {
  locale: Locale
  logoId: string | undefined
  disabled: boolean
  onUploaded: (logoId: string) => void
  onRemove: () => Promise<boolean>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<"idle" | "uploading">("idle")
  const [error, setError] = useState<string | null>(null)

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setError(null)
    if (file.type !== "image/png" && file.type !== "image/jpeg") { setError(t(locale, "Choisissez une image PNG ou JPEG.", "Choose a PNG or JPEG image.")); return }
    if (file.size > MAX_LOGO_BYTES) { setError(t(locale, "Le logo dépasse 1 Mo. Choisissez une image plus légère.", "The logo is larger than 1 MB. Choose a smaller image.")); return }
    setStatus("uploading")
    try {
      const response = await fetch("/api/business-logo", { method: "POST", headers: { "content-type": file.type }, body: file })
      const data = await response.json() as { defaults?: { logoId?: string }; error?: string }
      if (response.ok && data.defaults?.logoId) onUploaded(data.defaults.logoId)
      else if (response.status === 413) setError(t(locale, "Le logo dépasse 1 Mo. Choisissez une image plus légère.", "The logo is larger than 1 MB. Choose a smaller image."))
      else if (response.status === 415) setError(t(locale, "Ce fichier n'est pas une image PNG ou JPEG valide.", "This file is not a valid PNG or JPEG image."))
      else setError(t(locale, "Le logo n'a pas été enregistré. Réessayez.", "The logo was not saved. Try again."))
    } catch {
      setError(t(locale, "Le logo n'a pas été enregistré. Vérifiez votre connexion et réessayez.", "The logo was not saved. Check your connection and try again."))
    } finally { setStatus("idle") }
  }

  async function remove() {
    setError(null)
    if (!(await onRemove())) setError(t(locale, "Le logo n'a pas été retiré. Réessayez.", "The logo was not removed. Try again."))
  }

  const busy = disabled || status === "uploading"
  return <Field data-invalid={Boolean(error) || undefined} data-disabled={busy || undefined}>
    <FieldLabel htmlFor="record-business-logo">{t(locale, "Logo", "Logo")}</FieldLabel>
    {logoId && <img src={`/api/business-logo/${logoId}`} alt={t(locale, "Logo actuel de l'entreprise", "Current business logo")} className="max-h-16 max-w-48 object-contain object-left" />}
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} id="record-business-logo" type="file" accept="image/png,image/jpeg" className="sr-only" disabled={busy} onChange={(event) => void upload(event)} aria-describedby="record-business-logo-help" />
      <Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>{status === "uploading" ? t(locale, "Envoi du logo…", "Uploading logo…") : logoId ? t(locale, "Remplacer le logo", "Replace logo") : t(locale, "Ajouter un logo", "Add logo")}</Button>
      {logoId && <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>{t(locale, "Retirer le logo", "Remove logo")}</Button>}
    </div>
    <FieldDescription id="record-business-logo-help">{t(locale, "PNG ou JPEG, 1 Mo au maximum. Il apparaît sur les PDF des nouveaux devis. Les devis existants gardent leur logo.", "PNG or JPEG, up to 1 MB. It appears on the PDFs of new Quotes. Existing Quotes keep their logo.")}</FieldDescription>
    {error && <FieldError>{error}</FieldError>}
  </Field>
}
