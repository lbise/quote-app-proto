"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { quoteLineId, randomUUID } from "@/lib/random-id"

type Locale = "fr" | "en"

function t(locale: Locale, fr: string, en: string) {
  return locale === "fr" ? fr : en
}

function sectionId() {
  return `section-${randomUUID()}`
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
  const controls = useRef(new Map<string, HTMLButtonElement>())
  const addButton = useRef<HTMLButtonElement>(null)
  const keepSectionButton = useRef<HTMLButtonElement>(null)
  const confirmedDelete = useRef(false)
  const focusTarget = useRef<"add" | { id: string; control?: "up" | "down" } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  useEffect(() => {
    const target = focusTarget.current
    if (!target) return
    focusTarget.current = null
    if (target === "add") {
      addButton.current?.focus()
      return
    }
    const control = target.control && controls.current.get(`${target.id}:${target.control}`)
    if (control && !control.disabled) control.focus()
    else names.current.get(target.id)?.focus()
  }, [draft.sections])

  function rename(id: string, title: string) {
    setDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === id ? { ...section, title } : section),
    }))
  }

  function move(index: number, delta: number, retainNameFocus = false) {
    setDraft((current) => {
      const destination = index + delta
      if (destination < 0 || destination >= current.sections.length) return current
      const section = current.sections[index]
      focusTarget.current = retainNameFocus
        ? { id: section.id }
        : { id: section.id, control: delta < 0 ? "up" : "down" }
      const sections = [...current.sections]
      ;[sections[index], sections[destination]] = [sections[destination], sections[index]]
      return { ...current, sections, lines: groupedLines({ ...current, sections }) }
    })
  }

  function duplicate(section: QuoteSection) {
    const id = sectionId()
    setDraft((current) => {
      const sourceIndex = current.sections.findIndex((item) => item.id === section.id)
      const copy = { ...section, id, title: `${section.title} copie` }
      const sections = [...current.sections]
      sections.splice(sourceIndex + 1, 0, copy)
      const lines = current.lines.flatMap((line) => line.sectionId === section.id ? [line, { ...line, id: quoteLineId(), sectionId: id }] : [line])
      return { ...current, sections, lines: groupedLines({ ...current, sections, lines }) }
    })
    focusTarget.current = { id }
  }

  function confirmRemove() {
    if (!pendingDelete) return
    confirmedDelete.current = true
    setDraft((current) => {
      const index = current.sections.findIndex((section) => section.id === pendingDelete)
      if (index < 0) return current
      const removed = current.sections[index]
      const nextSection = current.sections[index + 1] ?? current.sections[index - 1]
      focusTarget.current = nextSection ? { id: nextSection.id } : "add"
      const sections = current.sections.filter((section) => section.id !== removed.id)
      const lines = current.lines.filter((line) => line.sectionId !== removed.id)
      return { ...current, sections, lines: groupedLines({ ...current, sections, lines }) }
    })
    setPendingDelete(null)
  }

  function add() {
    const section = { id: sectionId(), title: "Nouvelle section" }
    setDraft((current) => ({ ...current, sections: [...current.sections, section] }))
    focusTarget.current = { id: section.id }
  }

  return (
    <>
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
                      move(index, -1, true)
                    }
                    if (event.altKey && event.key === "ArrowDown") {
                      event.preventDefault()
                      move(index, 1, true)
                    }
                  }}
                />
              </Field>
            </FieldGroup>
            <div className="qp-section-controls" aria-label={`${t(locale, "Commandes de section", "Section controls")} ${index + 1}`}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={index === 0}
                aria-label={`${t(locale, "Monter la section", "Move section up")} ${section.title}`}
                ref={(element) => {
                  if (element) controls.current.set(`${section.id}:up`, element)
                  else controls.current.delete(`${section.id}:up`)
                }}
                onClick={() => move(index, -1)}
              ><ArrowUp /></Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={index === draft.sections.length - 1}
                aria-label={`${t(locale, "Descendre la section", "Move section down")} ${section.title}`}
                ref={(element) => {
                  if (element) controls.current.set(`${section.id}:down`, element)
                  else controls.current.delete(`${section.id}:down`)
                }}
                onClick={() => move(index, 1)}
              ><ArrowDown /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`${t(locale, "Dupliquer la section", "Duplicate section")} ${section.title}`} onClick={() => duplicate(section)}><Copy /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`${t(locale, "Supprimer la section et ses lignes", "Delete section and its lines")} ${section.title}`} onClick={() => setPendingDelete(section.id)}><Trash2 /></Button>
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

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          keepSectionButton.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          if (confirmedDelete.current) {
            event.preventDefault()
            confirmedDelete.current = false
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t(locale, "Supprimer cette section ?", "Delete this section?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {(() => {
              const section = draft.sections.find((item) => item.id === pendingDelete)
              const count = section ? draft.lines.filter((line) => line.sectionId === section.id).length : 0
              const name = section?.title ?? ""
              if (count === 0) return t(locale, `Supprimer la section vide « ${name} » ? Vous pouvez encore annuler tous les changements avant de choisir Terminer.`, `Delete empty section “${name}”? You can still cancel all changes before choosing Done.`)
              if (count === 1) return t(locale, `Supprimer la section « ${name} » et sa ligne ? Vous pouvez encore annuler tous les changements avant de choisir Terminer.`, `Delete section “${name}” and its 1 line? You can still cancel all changes before choosing Done.`)
              return t(locale, `Supprimer la section « ${name} » et ses ${count} lignes ? Vous pouvez encore annuler tous les changements avant de choisir Terminer.`, `Delete section “${name}” and its ${count} lines? You can still cancel all changes before choosing Done.`)
            })()}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={keepSectionButton}>{t(locale, "Conserver la section", "Keep section")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirmRemove}>{t(locale, "Supprimer la section et ses lignes", "Delete section and its lines")}</AlertDialogAction>
        </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
