import { useRef } from 'react';
import { ArrowDown, ArrowUp, Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu';

export function LineActions({ number, locale, canMoveUp, canMoveDown, onEdit, onDuplicate, onMove, onDelete }: {
  number: number;
  locale: 'fr' | 'en';
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDuplicate: () => string;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const actionSelected = useRef(false);
  const restoreEditFocus = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const duplicatedLineId = useRef<string | null>(null);
  const t = (fr: string, en: string) => locale === 'fr' ? fr : en;
  const action = (callback: () => void, restoreFocus = false) => {
    actionSelected.current = true;
    restoreEditFocus.current = restoreFocus;
    callback();
  };
  return <div className="qp-line-actions" lang={locale}>
    <Button ref={editButton} variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`${t('Modifier la ligne', 'Edit line')} ${number}`} title={`${t('Modifier la ligne', 'Edit line')} ${number}`}>
      <Pencil />
    </Button>
    <DropdownMenu onOpenChange={open => { if (open) { actionSelected.current = false; duplicatedLineId.current = null; } }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t(`Autres actions de la ligne ${number}`, `More actions for line ${number}`)}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="qp-line-menu" lang={locale} onCloseAutoFocus={event => {
        // A mutation restores focus to the resulting line, not the old menu trigger.
        if (actionSelected.current) {
          event.preventDefault();
          // Restore only after the menu's focus trap has unmounted. A moved
          // row retains its ref; a duplicate has a new ID; deletion handles its fallback.
          requestAnimationFrame(() => {
            const target = duplicatedLineId.current
              ? document.getElementById(`line-${duplicatedLineId.current}`)?.querySelector<HTMLButtonElement>('button')
              : restoreEditFocus.current ? editButton.current : null;
            target?.focus({ preventScroll: true });
          });
        }
      }}>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => action(() => { duplicatedLineId.current = onDuplicate(); })}><Copy />{t(`Dupliquer la ligne ${number}`, `Duplicate line ${number}`)}</DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveUp} onSelect={() => action(() => onMove(-1), true)}><ArrowUp />{t(`Monter la ligne ${number}`, `Move up line ${number}`)}</DropdownMenuItem>
          <DropdownMenuItem disabled={!canMoveDown} onSelect={() => action(() => onMove(1), true)}><ArrowDown />{t(`Descendre la ligne ${number}`, `Move down line ${number}`)}</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onSelect={() => action(onDelete)}><Trash2 />{t(`Supprimer la ligne ${number}`, `Delete line ${number}`)}</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
