import { useState } from 'react';
import { Archive, ArchiveRestore, MoreHorizontal, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../ui/alert-dialog';
import { randomUUID } from '../../lib/random-id';

type Locale = 'fr' | 'en';
export type QuoteIdentity = { reference: string; title: string };

const titleOf = (quote: QuoteIdentity, locale: Locale) => quote.title || (locale === 'fr' ? 'Nouveau devis' : 'New Quote');

/**
 * Archive/Restore and Delete for one Quote. Active Quotes offer Archive, Archived
 * Quotes offer Restore; both offer Delete, which asks for confirmation first.
 */
export function QuoteActionsMenu({ locale, quote, archived, disabled, archiveDisabled, onArchive, onRestore, onDelete, onMenuClosed }: {
  locale: Locale;
  quote: QuoteIdentity;
  archived: boolean;
  disabled?: boolean;
  /** Archive or Restore is unavailable, for example while an assistant change is pending. */
  archiveDisabled?: boolean;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  /** Called instead of returning focus to the trigger when an action removed it. */
  onMenuClosed?: (event: Event) => void;
}) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const name = `${quote.reference} ${titleOf(quote, locale)}`;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={t(`Actions du devis ${name}`, `Actions for Quote ${name}`)} title={t('Actions du devis', 'Quote actions')}><MoreHorizontal /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="qp-line-menu" lang={locale} onCloseAutoFocus={onMenuClosed}>
      <DropdownMenuGroup>
        {archived
          ? <DropdownMenuItem disabled={archiveDisabled} onSelect={onRestore}><ArchiveRestore />{t('Restaurer', 'Restore')}</DropdownMenuItem>
          : <DropdownMenuItem disabled={archiveDisabled} onSelect={onArchive}><Archive />{t('Archiver', 'Archive')}</DropdownMenuItem>}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 />{t('Supprimer…', 'Delete…')}</DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/**
 * Confirms permanent deletion. Cancel has the default focus. The request key
 * lives as long as the dialog, so retrying after a lost response is safe.
 */
export function DeleteQuoteDialog({ locale, quote, onCancel, onConfirm }: {
  locale: Locale;
  quote: QuoteIdentity | null;
  onCancel: () => void;
  /** Resolves true once the Quote is deleted. */
  onConfirm: (requestId: string) => Promise<boolean>;
}) {
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const [requestId, setRequestId] = useState(() => randomUUID());
  const [deleting, setDeleting] = useState(false);
  const [failed, setFailed] = useState(false);
  function reset() { setRequestId(randomUUID()); setDeleting(false); setFailed(false); }
  async function confirm() {
    setDeleting(true); setFailed(false);
    const deleted = await onConfirm(requestId);
    if (deleted) reset();
    else { setDeleting(false); setFailed(true); }
  }
  return <AlertDialog open={quote !== null} onOpenChange={open => { if (!open && !deleting) { reset(); onCancel(); } }}>
    <AlertDialogContent className="qp-modal" lang={locale}>
      <AlertDialogHeader>
        <AlertDialogTitle>{t('Supprimer ce devis définitivement ?', 'Delete this Quote permanently?')}</AlertDialogTitle>
        <AlertDialogDescription>{t('Cette action est irréversible. Le devis, ses révisions publiées et sa conversation seront supprimés.', 'This cannot be undone. The Quote, its Published Revisions and its conversation will be deleted.')}</AlertDialogDescription>
      </AlertDialogHeader>
      {quote && <p className="qp-delete-identity"><span>{quote.reference}</span><strong>{titleOf(quote, locale)}</strong></p>}
      {failed && <p className="qp-delete-failed" role="alert"><TriangleAlert />{t('Le devis n’a pas pu être supprimé. Vérifiez votre connexion, puis réessayez.', 'The Quote could not be deleted. Check your connection, then try again.')}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={deleting}>{t('Annuler', 'Cancel')}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={deleting} onClick={event => { event.preventDefault(); void confirm(); }}><Trash2 data-icon="inline-start" />{deleting ? t('Suppression…', 'Deleting…') : t('Supprimer définitivement', 'Delete permanently')}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
