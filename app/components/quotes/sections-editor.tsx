"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { type QuoteData, type QuoteSection } from "@/lib/quote"

type Locale = "fr" | "en"

function t(locale: Locale, fr: string, en: string) {
  return locale === "fr" ? fr : en
}

function sectionId() {
  return `section-${crypto.randomUUID()}`
}

function groupedLines(quote: QuoteData) {
  const rank = new Map(quote.sections.map((section, index) => [section.id, index]))
  return quote.lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const aRank = a.line.sectionId ? rank.get(a.line.sectionId) ?? Number.MAX_SAFE_INTEGER : -1
      const bRank = b.line.sectionId ? rank.get(b.line.sectionId) ?? Number.MAX_SAFE_INTEGER : -1
      return aRank - bRank || a.index - b.index
    })
    .map(({ line }) => line)
}

export function SectionsEditor({
  quote,
  locale,
  onApply,
  onClose,
}: {
  quote: QuoteData
  locale: Locale
  onApply: (q: QuoteData) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<QuoteData>(() => structuredClone(quote))
  const names = useRef(new Map<string, HTMLInputElement>())
  const addButton = useRef<HTMLButtonElement>(null)
  const focusTarget = useRef<string | "add" | null>(null)

  useEffect(() => {
    const target = focusTarget.current
    if (!target) return
    focusTarget.current = null
    if (target === "add") addButton.current?.focus()
    else names.current.get(target)?.focus()
  }, [draft.sections])

  function rename(id: string, title: string) {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === id ? { ...section, title } : section),
    }))
  }

  function move(index: number, delta: number) {
    setDraft((current) => {
      const destination = index + delta
      if (destination < 0 || destination >= current.sections.length) return current
      const sections = [...current.sections]
      ;[sections[index], sections[destination]] = [sections[destination], sections[index]]
      return { ...current, sections, lines: groupedLines({ ...current, sections }) }
    })
  }

  function duplicate(section: QuoteSection) {
    const id = sectionId()
    setDraft((current) => {
      const sourceIndex = current.sections.findIndex((item) => item.id === section.id)
      const copy = { ...section, id, title: `${section.title} ${t(locale, "copie", "copy")}` }
      const sections = [...current.sections]
      sections.splice(sourceIndex + 1, 0, copy)
      const lines = current.lines.flatMap((line) => line.sectionId === section.id ? [line, { ...line, id: `${id}-${line.id}`, sectionId: id }] : [line])
      return { ...current, sections, lines: groupedLines({ ...current, sections, lines }) }
    })
    focusTarget.current = id
  }

  function remove(index: number) {
    setDraft((current) => {
      const removed = current.sections[index]
      const nextSection = current.sections[index + 1]
      focusTarget.current = nextSection?.id ?? "add"
      const sections = current.sections.filter((section) => section.id !== removed.id)
      const lines = current.lines.filter((line) => line.sectionId !== removed.id)
      return { ...current, sections, lines: groupedLines({ ...current, sections, lines }) }
    })
  }

  function add() {
    const section = { id: sectionId(), title: t(locale, "Nouvelle section", "New section") }
    setDraft((current) => ({ ...current, sections: [...current.sections, section] }))
    focusTarget.current = section.id
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="qp-modal" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t(locale, "Organiser les sections", "Organise sections")}</DialogTitle>
          <DialogDescription>{t(locale, "Les renommages et l'organisation sont appliqués ensemble lorsque vous terminez.", "Renames and organisation are applied together when you finish.")}</DialogDescription>
        </DialogHeader>

        <div className="qp-section-editor">
          {draft.sections.map((section, index) => <div key={section.id}>
            <FieldGroup className="flex-1">
              <Field>
                <FieldLabel className="sr-only" htmlFor={`section-name-${section.id}`}>{`${t(locale, "Nom de section", "Section name")} ${index + 1}`}</FieldLabel>
                <Input
                  id={`section-name-${section.id}`}
                  ref={(element) => {
                    if (element) names.current.set(section.id, element)
                    else names.current.delete(section.id)
                  }}
                  value={section.title}
                  onChange={(event) => rename(section.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.altKey && event.key === "ArrowUp") {
                      event.preventDefault()
                      move(index, -1)
                    }
                    if (event.altKey && event.key === "ArrowDown") {
                      event.preventDefault()
                      move(index, 1)
                    }
                  }}
                />
              </Field>
            </FieldGroup>
            <div className="qp-section-controls" aria-label={`${t(locale, "Commandes de section", "Section controls")} ${index + 1}`}>
              <Button type="button" variant="ghost" size="icon" disabled={index === 0} aria-label={t(locale, "Monter la section", "Move section up")} onClick={() => move(index, -1)}><ArrowUp /></Button>
              <Button type="button" variant="ghost" size="icon" disabled={index === draft.sections.length - 1} aria-label={t(locale, "Descendre la section", "Move section down")} onClick={() => move(index, 1)}><ArrowDown /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t(locale, "Dupliquer la section", "Duplicate section")} onClick={() => duplicate(section)}><Copy /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t(locale, "Supprimer la section et ses lignes", "Delete section and its lines")} onClick={() => remove(index)}><Trash2 /></Button>
            </div>
          </div>)}
        </div>

        <div className="qp-modal-actions">
          <Button ref={addButton} type="button" variant="outline" onClick={add}><Plus data-icon="inline-start" />{t(locale, "Ajouter", "Add")}</Button>
          <Button type="button" variant="outline" onClick={onClose}>{t(locale, "Annuler", "Cancel")}</Button>
          <Button type="button" onClick={() => { onApply({ ...draft, lines: groupedLines(draft) }); onClose() }}>{t(locale, "Terminer", "Done")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
