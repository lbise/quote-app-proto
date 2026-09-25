import { useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { EditAffordance } from './edit-affordance';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

type Locale = 'en' | 'fr';
const t = (locale: Locale, fr: string, en: string) => locale === 'fr' ? fr : en;

export function SectionHeading({ title, locale, readOnly, index, count, lineCount, onRename, onMove, onDuplicate, onRemove, onDelete, onAddLine, onInsert, changed }: {
  title: string; locale: Locale; readOnly: boolean; index: number; count: number; lineCount: number; changed: boolean;
  onRename: (title: string) => void; onMove: (delta: number) => void; onDuplicate: () => void; onRemove: () => void; onDelete: () => void;
  onAddLine: () => void; onInsert: (trigger: HTMLButtonElement | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const headingButton = useRef<HTMLButtonElement>(null);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const inserting = useRef(false);
  function closeRename() { setRenaming(false); requestAnimationFrame(() => headingButton.current?.focus()); }
  function rename(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    if (draft !== title) onRename(draft.trim());
    closeRename();
  }
  function action(callback: () => void) { setActionsOpen(false); callback(); requestAnimationFrame(() => actionsButton.current?.focus()); }
  return <div className="qp-section-title">
    {readOnly ? <h3>{title}</h3> : renaming ? <form className="qp-section-rename" onSubmit={rename}><label className="sr-only" htmlFor={`section-rename-${index}`}>{t(locale, `Nom de section ${title}`, `Section name ${title}`)}</label><Input id={`section-rename-${index}`} autoFocus value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeRename(); } }} aria-invalid={!draft.trim()} /><Button size="sm" type="submit" disabled={!draft.trim()}>{t(locale, 'Enregistrer', 'Save')}</Button><Button type="button" size="sm" variant="ghost" onClick={closeRename}>{t(locale, 'Annuler', 'Cancel')}</Button></form> : <h3 aria-label={title}><button ref={headingButton} type="button" className="qp-section-rename-trigger qp-edit-target" aria-label={t(locale, `Renommer la section ${title}`, `Rename section ${title}`)} onClick={() => { setDraft(title); setRenaming(true); }}><span>{title}</span><EditAffordance /></button></h3>}
    {changed && !readOnly && <span className="qp-changed-label" lang={locale}>{t(locale, 'Section modifiée', 'Section changed')}</span>}
    <span className="qp-section-end"><span className="qp-section-currency">CHF</span>{!readOnly && <><Button type="button" variant="ghost" size="sm" className="qp-section-add" onClick={onAddLine} aria-label={t(locale, `Ajouter une ligne à ${title}`, `Add line to ${title}`)} lang={locale}><Plus data-icon="inline-start" />{t(locale, 'Ligne', 'Line')}</Button><Popover open={actionsOpen} onOpenChange={open => { if (open) inserting.current = false; setActionsOpen(open); }}><PopoverTrigger asChild><Button ref={actionsButton} variant="ghost" size="icon-sm" aria-label={t(locale, `Actions de section ${title}`, `Section actions ${title}`)} title={t(locale, `Actions de section ${title}`, `Section actions ${title}`)}><MoreHorizontal aria-hidden="true" /></Button></PopoverTrigger><PopoverContent align="end" className="qp-section-menu" lang={locale} onCloseAutoFocus={event => { if (inserting.current) event.preventDefault(); }}><div className="flex flex-col gap-1"><Button type="button" variant="ghost" onClick={() => { inserting.current = true; setActionsOpen(false); onInsert(actionsButton.current); }}><Plus data-icon="inline-start" />{t(locale, 'Insérer une section après celle-ci', 'Insert section below')}</Button><Button type="button" variant="ghost" disabled={index === 0} onClick={() => action(() => onMove(-1))}><ArrowUp data-icon="inline-start" />{t(locale, 'Monter la section', 'Move section up')}</Button><Button type="button" variant="ghost" disabled={index === count - 1} onClick={() => action(() => onMove(1))}><ArrowDown data-icon="inline-start" />{t(locale, 'Descendre la section', 'Move section down')}</Button><Button type="button" variant="ghost" onClick={() => { setActionsOpen(false); onDuplicate(); }}><Copy data-icon="inline-start" />{t(locale, 'Dupliquer la section et ses lignes', 'Duplicate section and lines')}</Button><Button type="button" variant="ghost" onClick={() => { setActionsOpen(false); onRemove(); }}><Trash2 data-icon="inline-start" />{t(locale, 'Retirer la section (garder les lignes)', 'Remove section (keep lines)')}</Button><Button type="button" variant="destructive" onClick={() => { setActionsOpen(false); setConfirmDelete(true); }}><Trash2 data-icon="inline-start" />{t(locale, 'Supprimer la section et ses lignes', 'Delete section and its lines')}</Button></div></PopoverContent></Popover></>}</span>
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t(locale, `Supprimer « ${title} » et ses lignes ?`, `Delete “${title}” and its lines?`)}</AlertDialogTitle><AlertDialogDescription>{t(locale, `Cela supprimera ${lineCount} ${lineCount === 1 ? 'ligne' : 'lignes'} du brouillon de travail. Pour conserver le travail, choisissez plutôt « Retirer la section ». Vous pourrez annuler cette modification après l’enregistrement.`, `This removes ${lineCount} ${lineCount === 1 ? 'line' : 'lines'} from the Working Draft. To keep the work, use Remove section instead. You can undo this edit after saving.`)}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t(locale, 'Conserver la section', 'Keep section')}</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={onDelete}>{t(locale, 'Supprimer la section et ses lignes', 'Delete section and its lines')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

export function AddSectionControl({ locale, after, initiallyOpen = false, onAdd, onCancel }: { locale: Locale; after: string | null; initiallyOpen?: boolean; onAdd: (title: string) => void; onCancel?: () => void }) {
  const [editing, setEditing] = useState(initiallyOpen);
  const [title, setTitle] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  function cancel() { setEditing(false); setTitle(''); if (onCancel) onCancel(); else requestAnimationFrame(() => button.current?.focus()); }
  function submit(event: FormEvent) { event.preventDefault(); if (!title.trim()) return; onAdd(title.trim()); setEditing(false); setTitle(''); }
  return <div className="qp-add-section">{editing ? <form className="qp-section-rename" onSubmit={submit}><label className="sr-only" htmlFor={`new-section-${after ?? 'end'}`}>{t(locale, 'Nom de la nouvelle section', 'New section name')}</label><Input autoFocus id={`new-section-${after ?? 'end'}`} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } }} /><Button type="submit" size="sm" disabled={!title.trim()}>{t(locale, 'Ajouter', 'Add')}</Button><Button type="button" size="sm" variant="ghost" onClick={cancel}>{t(locale, 'Annuler', 'Cancel')}</Button></form> : <Button ref={button} type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}><Plus data-icon="inline-start" />{t(locale, 'Ajouter une section', 'Add section')}</Button>}</div>;
}
