# Supplementary Quote interaction review, v1

Status: supplementary design decisions approved by the user. See the [approval record on #9](https://github.com/lbise/quote-app-proto/issues/9#issuecomment-5669015864). Approval does not mean the proposed changes are implemented. The review states below retain their original proposal wording for traceability.

## Artifact and scope

Review the existing application at local commit `c8c70120705f3b729d685b80f9589967202cba65`, supplemented by the numbered text states below. These are reviewable before/after states, not screenshots or working new controls. Their proposed behavior is scripted; none of the assistant examples is a live-model result. That implementation commit was not available on GitHub at handoff time; its public source link remains to be published. The complete text states can be reviewed in the handoff comment on #9.

The [#8 approval record](https://github.com/lbise/quote-app-proto/issues/8#issuecomment-5648207748) remains authoritative for layout B v0.4 at `84874fb63fe51cfd8d6c9d5dc131d0c9388232b5`. Keep section navigation left, Quote centre, conversation right at 58/42, the 52px single-icon collapsed rail, no rail for sectionless Quotes, existing line actions and dialog editors. Keep the constrained-width panel buttons and section selector. No A/C exploration or desktop dropdown replacement.

This handoff supplements [#7](https://github.com/lbise/quote-app-proto/issues/7), without changing that issue or reopening #8. It follows the snapshot and Publication rules in `docs/adr/0003-freeze-published-quote-revisions.md`. No schema, persistence or real AI functionality is added here. Speech, PDF/print, logos, imports, sending and Customer acceptance stay deferred.

### Open the existing artifact

With a configured local development database and approved test account, run `npm run dev` and open `/quotes`. Setup and isolated browser-test instructions are in [Quote workspace](quote-workflow.md). Use a disposable local business containing only fictional records. The existing `/quotes` route really saves data; it is not an in-memory prototype. Do not send the scripted requests below to a live provider for this review.

For an unauthenticated view of the already-approved layout only, run `npm run prototype:quotes` and open `/quote-layout-prototype?variant=B`. That older development-only prototype simulates saving, AI and Publication. It does not contain the supplementary records interactions.

All identities, addresses, work and figures below are synthetic. This is not a verified adaptation of the joinery source and does not establish production integration or Artisan rehearsal completion. Do not use the source archive or PDFs as review fixtures.

## Current implementation versus proposed decisions

Code inspection refers to the pinned implementation above. Runtime evidence is listed separately at the end.

| Area | Current implementation | v1 decision proposed for approval |
| --- | --- | --- |
| Customer selection | `records-editor.tsx` has a native selector, create/update forms and optional contact person, but no search. | R1: add a labelled search field and filtered native selector inside the existing dialog. |
| Edit scope | `manual-editor.tsx` says copied details affect this Quote only. Reusable forms explicitly say existing Quotes never refresh. | R2: retain these separate scopes and make the replacement action name its scope. |
| Customer replacement | "Use this Customer" copies the displayed form values immediately, including unsaved edits to a selected record. Creation resets selection. | R2: only copy a saved, selected record; preview old/new details and confirm replacement. After creation, select the new saved record, without applying it automatically. |
| Business defaults | Separate form and save operation inside the records dialog. No action refreshes the open Quote. | R3: retain this behavior; clearly direct edits for this Quote to Details & terms. |
| Assistant | Plain conversation, changed-line labels/count and one link to the first surviving changed line. Clarification and retained-value explanations depend on model output. | R4: use focused conversational clarification, not a new target-picker UI. Require concrete explanations and no changes to ambiguous targets. |
| Section undo/deletion | All dialog edits apply together on Done. Delete removes the section and its lines; focus goes to the next name or Add. | R5: retain one dialog transaction; show deletion consequences in visible text and focus next, then previous, then Add. |
| Moving lines | Line editor has a Section selector. Arrow moves can also change membership at a section boundary. Changing the selector does not explicitly place the line at the destination's end. | R6: use Section selection to move to any section, including empty sections or No section. Append at destination. Arrows reorder within the current group only. |
| Language and accessibility | Labelled buttons, manual field errors, focus styles and English/French UI exist. Section-generated names use interface language. Record errors are a general alert. | R7: preserve French generated commercial names, add field-linked record errors and the focus/copy rules below. |

Paths in this table are under `app/components/quotes/`. Assistant behavior also depends on `app/lib/quote-assistant.server.ts` and `app/lib/quotes.server.ts`. These observations do not establish that a real model will follow its instructions.

## R1. Begin work, then find or create a Customer

### State 1a: first Working Draft

The Artisan creates a Quote without selecting a Customer or filling business defaults. The document shows French missing-data placeholders. Conversation and Add a line remain available. The editor guidance names missing details separately from incomplete prices; complete line amounts still calculate. Publication remains blocked where required information is missing.

Use the existing workspace entry points:

| English | French | Destination |
| --- | --- | --- |
| Customers & business | Clients et entreprise | Reusable-record dialog |
| Details & terms | Coordonnées et conditions | This Working Draft's copied details |
| Add a line | Ajouter une ligne | Line editor, without administrative setup |

### State 1b: Customer search, no match and creation

Inside the existing records dialog, the proposed Customer area reads:

```text
Customer record
Search Customers [Tilleuls                 ]
Choose a Customer [Maison des Tilleuls SA  v]
                  Rue Exemple 8, 1000 Exemple
[New Customer]
Name             [Maison des Tilleuls SA   ]
Address          [Rue Exemple 8             ]
                 [1000 Exemple              ]
Contact person   [Camille Exemple            ] Optional
[Update Customer] [Use for this Quote]
```

Search filters saved name, address and contact, case- and accent-insensitively. Results show name plus address so similarly named Customers can be distinguished. A native selector keeps ordinary keyboard selection; search is not a custom keyboard-only combobox. Typing a query never creates a record, changes a Quote or chooses the first match automatically. Clear the selection when it no longer matches.

With query `Orme` and no match, show "No Customers match your search." Keep New Customer available. With no records at all, show "No saved Customers yet. You can add one now or continue your Quote." New Customer opens blank fields, not inferred details from the search query. Name and address are required to save a reusable Customer; contact person is optional. Missing Quote details can still remain blank in the Working Draft.

After saving fictional `Maison de l'Orme SA`, `Rue Exemple 12, 1000 Exemple`, no contact, show "Customer created. This Quote is unchanged." Select that saved record and offer Use for this Quote. Do not apply it automatically. On failure retain entered values, announce the error and allow retry. Switching records, choosing New Customer or closing with unsaved record edits asks whether to discard those edits; remaining in the form is the safe default.

Current gaps: no search, empty-result message or discard prompt; successful creation resets the form instead of selecting the new record. These states are proposals, not current controls.

## R2. Separate copied details, reusable edits and replacement

### State 2a: edit only this Working Draft

Open Details & terms. Keep the scope notice visible above the form. Change the copied Customer address from `Rue Exemple 8` to `Rue Exemple 10`, then Apply. The Working Draft changes; the reusable Customer and Published Revisions do not. This is one undoable draft action. Editing copied business details follows the same rule.

### State 2b: update only the reusable Customer

Open Customers & business, select Maison des Tilleuls SA and change its saved address from `Rue Exemple 8` to `Rue Exemple 14`. Choose Update Customer. Show "Customer updated. Existing Quotes are unchanged." The Working Draft from 2a still says `Rue Exemple 10`. Record saves are not part of Quote Undo.

If the selected form has unsaved edits, disable Use for this Quote and explain "Save or discard record edits before using this Customer." Offer a labelled Discard edits action that restores the saved form. Do not silently choose whether to copy the old record or the unsaved form.

### State 2c: explicit replacement preview

Select saved Maison de l'Orme SA and choose Use for this Quote. Within the existing dialog flow, show this review state:

```text
Replace Customer details in this Quote?
                         Current                  Replacement
Name                     Maison des Tilleuls SA   Maison de l'Orme SA
Address                  Rue Exemple 10           Rue Exemple 12
                         1000 Exemple             1000 Exemple
Contact person           Camille Exemple          None

Only this Working Draft changes. Saved Customer records and
Published Revisions stay unchanged. You can undo this replacement.
[Keep current Customer] [Replace in this Quote]
```

Replace all three copied fields together. A blank replacement contact clears the old contact; never retain a contact from a different Customer. Do not change project title, work-site address, lines, prices, terms or business details. Undo restores the former copied fields together. Keep current Customer returns to the selected record without changing anything. On first assignment use "Use for this Quote" and show the same field preview with empty current values.

No replacement control appears for a read-only Published Revision. Editing reusable records from the list remains independent of any Quote. Returning from confirmation restores focus to Use for this Quote; successful replacement closes the records dialog and returns focus to its workspace opener.

## R3. Business defaults without an opening setup form

Keep Business defaults as a separately headed form with its own Save defaults action inside Customers & business. Do not combine its save with Customer creation or Quote Apply.

In the first-use state, names/contact/address/terms are empty and VAT registration says To confirm. Do not infer registration or a VAT identifier. An optional terms field may stay blank. Editing defaults must not make it impossible to begin a Quote first.

Scripted review:

1. Create Working Draft A before defaults exist; its copied business details remain missing.
2. Save fictional business `Atelier Exemple Sàrl`, `Rue Exemple 1, 1000 Exemple`, `bonjour@example.test`, explicit not VAT registered and French terms `Paiement à 30 jours.`
3. Show "Defaults saved for new Quotes. This Quote is unchanged." A still has missing copied details. Use Details & terms to complete A explicitly.
4. Create Quote B. It starts with the saved defaults. Changing defaults later does not refresh A or B. A new revision draft still copies its latest Published Revision, not current defaults.

Do not add a bulk "refresh defaults" operation in this design. This avoids overwriting negotiated terms or tax settings in an existing Quote. Record/default errors must preserve the form and use the validation treatment in R7.

## R4. Clarification, numeric corrections and copied values

Keep plain conversation beside the Quote. The messages below specify review examples, not exact text that a model must generate. Reply in the current interface language. Commercial descriptions stay French.

Reset to this synthetic state before each scenario. VAT is explicitly unregistered, there is no Quote Discount, and unrelated details remain fixed.

| Current number | Section | French description | Supplied pricing | CHF |
| --- | --- | --- | --- | --- |
| 1 | Séjour | Habillage mural en chêne | 12 m² × 40.00 | 480.00 |
| 2 | Chambre | Habillage mural en chêne | 8 m² × 40.00 | 320.00 |
| 3 | Chambre | Pose de la tablette, fixations comprises | Fixed amount 150.00 | 150.00 |

The known subtotal and total are CHF 950.00. These figures are independently worked examples, not totals copied from application output.

### State 4a: focused missing information

Artisan: "Add oak wall cladding in the hall. I don't have measurements or a price yet."

Add a French line `Habillage mural en chêne` in `Entrée`, with quantity and price missing. Do not invent a unit or pricing method as a settled commercial fact. Ask one related question, "Should this be priced by quantity or as a fixed amount?" / "Faut-il chiffrer ce travail à la quantité ou au forfait ?" Keep unknown values visible, the existing CHF 950.00 as a partial subtotal and the final total withheld. Do not ask for Customer address or VAT details in this reply.

### State 4b: ambiguous target, no mutation

Artisan: "Change the cladding to 45."

English reply: "Do you mean the unit price of the cladding in Séjour, line 1, Chambre, line 2, or both? No changes applied."

French reply: "Voulez-vous passer le prix unitaire de l'habillage à 45 CHF dans Séjour, ligne 1, dans Chambre, ligne 2, ou dans les deux ? Aucune modification appliquée."

Keep the Working Draft and latest Undo target unchanged. Keep focus in the composer. The Artisan can answer "Both unit prices, CHF 45 per m²" or correct the interpretation. Identify candidates using current number, section and description, not hidden IDs or numbers from an earlier state. If a manual edit makes that reference ambiguous again, clarify against the current draft before applying.

### State 4c: clear multi-line numeric correction and Undo

Artisan: "Set the unit price of both wall-cladding lines to CHF 45 per m²." Apply directly, without a confirmation dialog. Lines 1 and 2 become CHF 540.00 and CHF 360.00. Line 3 remains CHF 150.00; total CHF 1,050.00.

English reply: "Changed the unit prices on lines 1 and 2 from CHF 40.00 to CHF 45.00 per m². Kept quantities of 12 m² and 8 m². Line 3 is unchanged."

French reply: "Prix unitaires des lignes 1 et 2 passés de 40.00 CHF à 45.00 CHF par m². Quantités conservées : 12 m² et 8 m². La ligne 3 est inchangée."

Both lines show a textual Changed marker, plus the existing changed-line count and View in Quote action. Automatic reveal scrolls to the first changed line without taking keyboard focus away from the composer. Explicit View in Quote also places focus on that line's Edit action. Other changed lines remain identifiable by their number and text marker; no new change-navigator panel is proposed.

One Undo restores both prices and CHF 950.00. Retain the request and response and add "Last change undone. Earlier messages describe the previous state." / "Dernière modification annulée. Les messages précédents décrivent l'état antérieur." Clear active changed markers for the reversed action. Do not remove the conversation or imply that Publication can be undone.

### State 4d: copy with unknown measurements

Artisan: "Copy Chambre to Bureau with the same work and prices, but I don't know the wall area yet."

Create Bureau with two new lines. Keep the cladding description, unit m² and unit price CHF 40.00, but leave quantity missing. Copy the fixed-price tablet line at CHF 150.00. Leave the original Chambre untouched. New partial subtotal is CHF 1,100.00, with final total withheld.

English reply: "Copied Chambre to Bureau. Kept the cladding unit m² and unit price CHF 40.00; left its quantity blank because the wall area is unknown. Kept the tablet's fixed amount of CHF 150.00. Chambre is unchanged."

French reply: "Chambre copiée dans Bureau. Unité m² et prix unitaire de l'habillage de 40.00 CHF conservés ; quantité laissée vide car la surface est inconnue. Forfait de la tablette de 150.00 CHF conservé. Chambre est inchangée."

If the original price was missing, its copy stays missing and the reply says so. If a copied multiline description contains a measurement whose applicability is now uncertain, do not preserve it as a known new measurement: remove that assertion from the copy or ask a focused question. Retain supplied materials and technical references only to the extent the request identifies them as the same work. Never supply a plausible replacement dimension or market price.

These scenarios expose current prompt-dependent behavior for approval. They do not certify provider compliance. The existing UI does not focus the line after View in Quote; that focus change is proposed.

## R5. Section transactions and deletion focus

Keep Organise sections as a dialog with local edits. Renaming several sections, reordering and duplicating within one opening produces one undoable action only when Done is chosen. Cancel or Escape discards all dialog edits. Typing each character is not an undo action. A no-change Done must not consume the previous Undo target.

Review state: sections `Séjour`, `Chambre`, `Bureau`. Rename Chambre to `Chambre nord`, then move it above Séjour. Before Done, the underlying Quote is unchanged. After Done, both changes apply together. One Undo restores the old title and order. Conversation-based section edits follow the same one-request/one-action rule as 4c.

Deleting a section continues to remove its lines. Before deletion, show visible wording with the section name and line count, and choices Keep section / Delete section and its lines. Keep section is the default focus. This confirmation affects only the dialog's local draft; Done is still the commit action. To keep lines, move them to another section or No section using R6 first. Do not silently ungroup them on deletion.

| Deletion case | Proposed focus after confirmed deletion |
| --- | --- |
| Middle section | Next section's name input |
| Last section with a preceding section | Previous section's name input |
| Only section | Add button |
| Quote Line in the document | Next line's Edit action, otherwise previous line's Edit action, otherwise Add a line |

Deleting the last section and choosing Done removes the section rail. Focus returns to the dialog opener if it survives; otherwise use the document toolbar's Add a section button. Adding or duplicating a section focuses its new name field. Section move buttons retain focus on the moved section's corresponding control, falling back to its name input if that button becomes disabled at a boundary.

Current gaps: section deletion consequences are only in the icon's accessible label; no visible confirmation exists. Last-section deletion jumps to Add even when a previous section exists. Dialog-close fallback is the scrollable document rather than Add a section. Confirm these proposed changes before production work.

## R6. Moving Quote Lines between sections

Retain the existing line editor's Section selector, including No section and empty sections. No dragging is required. Changing Section and choosing Apply moves the line to the end of the destination group. Cancel leaves both membership and order unchanged. Values and description are untouched; display numbers are recomputed in document order. The move and any other changes in that Apply are one undoable action.

Review state: move line 1 from Séjour into an empty `Bureau` section using Section. Bureau gains that line, Séjour remains as an empty section, the line retains 12 m² and CHF 40.00, and the Quote total stays CHF 950.00. Focus returns to that line's Edit action at its new position. One Undo restores membership and order.

Keep the approved arrow controls, but limit them to reordering within a section or the unsectioned group. Disable Up on the first line of its group and Down on the last. Use Section to cross groups, so a reorder click cannot unexpectedly change the scope of work. This is a proposed behavior change from the current boundary-crossing arrows, not an already-approved rule.

## R7. Copy and keyboard review

### Proposed final English/French control copy

This table defines the supplementary copy to approve. Existing unrelated layout labels remain unchanged. Assistant examples in R4 are illustrative content, not fixed model-output assertions.

| English | French |
| --- | --- |
| Customers and defaults | Clients et valeurs par défaut |
| Customer record | Fiche client |
| Search Customers | Rechercher un client |
| Choose a Customer | Choisir un client |
| New Customer | Nouveau client |
| Name / Address / Contact person | Nom / Adresse / Personne de contact |
| Optional | Facultatif |
| Create Customer / Update Customer | Créer le client / Mettre à jour le client |
| Use for this Quote | Utiliser pour ce devis |
| Discard edits / Keep editing | Abandonner les modifications / Continuer la saisie |
| Replace Customer details in this Quote? | Remplacer les coordonnées du client dans ce devis ? |
| Current / Replacement / None | Actuel / Remplacement / Aucun |
| Keep current Customer / Replace in this Quote | Conserver le client actuel / Remplacer dans ce devis |
| Business defaults / Save defaults | Valeurs par défaut de l'entreprise / Enregistrer les valeurs par défaut |
| Business name / Contact details / Default terms | Raison sociale / Coordonnées / Conditions par défaut |
| VAT registered / VAT identifier | Assujetti à la TVA / Numéro TVA |
| To confirm / Yes / No | À préciser / Oui / Non |
| Organise sections / Section name | Organiser les sections / Nom de section |
| Move section up / Move section down / Duplicate section | Monter la section / Descendre la section / Dupliquer la section |
| Keep section / Delete section and its lines | Conserver la section / Supprimer la section et ses lignes |
| Section / No section | Section / Sans section |
| Add / Apply / Done / Cancel / Close | Ajouter / Appliquer / Terminer / Annuler / Fermer |
| Undo last change | Annuler la dernière modification |
| Changed / View in Quote | Modifié / Voir dans le devis |
| Assistant data and privacy icon | Icône données et confidentialité de l'assistant |
| Loading… / Saving… / Retry | Chargement… / Enregistrement… / Réessayer |

Give line actions their current line number and section actions their section name in accessible labels. Use Undo last change for the workspace action to distinguish it from Cancel in a dialog. Generated French commercial names remain `Nouvelle section` and the suffix `copie` even in the English interface. Interface switching changes controls and future assistant replies, not prior conversation messages or French Quote content.

### Proposed final messages

| English | French |
| --- | --- |
| No saved Customers yet. You can add one now or continue your Quote. | Aucun client enregistré. Vous pouvez en ajouter un maintenant ou continuer votre devis. |
| No Customers match your search. | Aucun client ne correspond à votre recherche. |
| Customer created. This Quote is unchanged. | Client créé. Ce devis est inchangé. |
| Customer updated. Existing Quotes are unchanged. | Client mis à jour. Les devis existants sont inchangés. |
| Save or discard record edits before using this Customer. | Enregistrez ou abandonnez les modifications de la fiche avant d'utiliser ce client. |
| Discard unsaved record edits? | Abandonner les modifications non enregistrées de la fiche ? |
| This changes this Quote only. Saved Customer records and business defaults stay unchanged. | Ces modifications concernent uniquement ce devis. Les fiches clients et les valeurs par défaut de l'entreprise restent inchangées. |
| Only this Working Draft changes. Saved Customer records and Published Revisions stay unchanged. You can undo this replacement. | Seul ce brouillon de travail change. Les fiches clients et les révisions publiées restent inchangées. Vous pouvez annuler ce remplacement. |
| Defaults saved for new Quotes. This Quote is unchanged. | Valeurs par défaut enregistrées pour les nouveaux devis. Ce devis est inchangé. |
| To change this Quote's business details, use Details & terms. | Pour modifier les coordonnées de l'entreprise dans ce devis, utilisez Coordonnées et conditions. |
| Enter the Customer name. / Enter the Customer address. | Indiquez le nom du client. / Indiquez l'adresse du client. |
| Could not load records. Try again. | Impossible de charger les fiches. Réessayez. |
| Could not save the Customer. Your entries are kept. Try again. | Impossible d'enregistrer le client. Votre saisie est conservée. Réessayez. |
| Could not save the defaults. Your entries are kept. Try again. | Impossible d'enregistrer les valeurs par défaut. Votre saisie est conservée. Réessayez. |
| Delete empty section "{name}"? You can still cancel all changes before choosing Done. | Supprimer la section vide "{name}" ? Vous pouvez encore annuler tous les changements avant de choisir Terminer. |
| Delete section "{name}" and its 1 line? You can still cancel all changes before choosing Done. | Supprimer la section "{name}" et sa ligne ? Vous pouvez encore annuler tous les changements avant de choisir Terminer. |
| Delete section "{name}" and its {count} lines? You can still cancel all changes before choosing Done. | Supprimer la section "{name}" et ses {count} lignes ? Vous pouvez encore annuler tous les changements avant de choisir Terminer. |
| Use the arrow buttons to reorder sections. In a section name, Alt+Up or Alt+Down also works. | Utilisez les boutons fléchés pour réordonner les sections. Dans un nom de section, Alt+Haut ou Alt+Bas fonctionne aussi. |
| Use Section in the line editor to move work to another section. | Utilisez Section dans l'éditeur de ligne pour déplacer le travail vers une autre section. |
| Enter to send. Ctrl+Enter or Cmd+Enter for a new line. | Entrée pour envoyer. Ctrl+Entrée ou Cmd+Entrée pour une nouvelle ligne. |

For deletion, interpolate the current section name and line count. Use the empty-section message for zero lines, the singular message for one and the plural message for two or more. For the R5 example, `{name}` is `Chambre` and `{count}` is `2`.

Existing numeric validation remains field-specific. Blank means missing, never zero. For example, entering `-5` as a unit price must keep the dialog open, focus that field and explain that a nonnegative price with at most two decimals is required. Do not silently truncate or coerce invalid values.

### Hosted-AI disclosure

Retain `assistant-disclosure.tsx` as an optional warning opened by the right-aligned data and privacy icon in the chat header. It must not block sending a message.

Issue #16 supersedes this review's original OpenAI-specific privacy copy. The current bilingual component and [hosted AI configuration](quote-ai.md) describe pi-backed processing and the configured provider. The assistant is available in development, but provider terms still determine how submitted content is handled. Do not restore the earlier OpenAI retention statement for another provider.

Applied changes save automatically. Review them and use Undo last change if needed. The assistant cannot publish, send or accept a Quote. Manual editing remains available without AI.

### Keyboard and validation acceptance walkthrough

Run in English and French, at desktop width and the existing constrained-width fallback. These are approval/rehearsal checks, not claims of automated coverage.

1. Use Tab and Shift+Tab from the workspace to both detail dialogs, then Enter or Space to open them. Focus stays in the open dialog. Escape cancels local Quote/section edits; unsaved reusable-record edits use the discard choice in R1. Closing returns to the opener or the specified surviving fallback.
2. Search by typing, Tab to the Customer selector, choose with arrow keys and confirm normally. Read the name/address distinction without depending on color. Search returns no selection when there is no match. Creation and replacement remain keyboard reachable.
3. Submit an empty Customer form. Announce the error, mark name/address with `aria-invalid`, associate each error with its field and focus the first invalid field. After correction, clear its stale error. Do not leave only a general alert at the top. On a load error, provide an actual Retry control that reloads records.
4. Open a line editor, use Section to move to an empty section, then Apply. Verify destination, numbering, totals and focus. Use Up/Down buttons within a section. No essential action depends on dragging or hover. The existing visible focus ring must remain visible after scrolling.
5. Reorder, rename, duplicate and delete sections with keyboard controls. Check every focus destination in R5 and confirm a disabled boundary button does not strand focus. Confirm Cancel and one Undo have different effects.
6. Tab to View in Quote after 4c. Verify focus reaches the first changed line and both changed lines have textual markers. Undo retains the transcript with a visible annotation. Automatic assistant scrolling must not steal input focus.
7. Enter invalid numeric values and inspect the linked error text and focused field. Leave an allowed missing value blank and verify the incomplete state instead of an invalid-input error. Enter deliberate zero price and verify it stays zero.
8. Switch interface language. Controls and new replies follow it; section names, technical descriptions and existing conversation remain unchanged. Check longer French messages, visible focus and dialog scrolling at narrow widths. Do not infer screen-reader or contrast conformance from labels alone.

## Evidence and approval gate

This pass inspects existing code and provides text review states. It does not implement the proposals above. Existing tests do not cover every new proposed focus, search, replacement or assistant explanation state. No acceptance tests were added for an unapproved design.

Checks performed on 2026-09-14:

- `npm run typecheck` passed before and after the documentation changes.
- Focused calculation run passed all 17 checks. Focused reusable-record browser run passed both tests.
- Full existing Chromium suite passed all 12 tests against the isolated browser database, with live AI disabled. This verifies existing behavior, not the proposed controls or scripted assistant examples.
- Full Vitest run with database-backed tests enabled passed 44 of 45 tests. The local-account setup test rejected the `_browser` database name because its safety guard requires `_local` or `_test`. Rerunning only `app/lib/dev-user.server.test.ts` against a separate loopback database named `quote_issue9_review_test` passed all 3 tests. No application code was changed to bypass that guard.
- The focused browser run logged a Vite dynamic-import rejection during server shutdown after the two passing tests. The full browser run passed without that warning.

Two-axis review of the staged documentation found one Standards issue, curly quotation marks, and one Spec issue, missing zero/singular deletion copy. Both were corrected before publishing the handoff. No production code changes resulted.

The user approved the supplementary design after reviewing its summary. This does not establish hands-on keyboard, screen-reader or visual verification of every state. The existing browser checks are not a full accessibility audit. The configured SSH signing agent was unavailable. When asked separately whether to commit the documentation unsigned, the user replied: "yes commit". This authorizes an unsigned handoff commit without changing repository signing settings.

### Approval record

After the agent summarized the proposals and offered approval together or specific changes, the user replied: "ok I can approve these changes". The [approval comment](https://github.com/lbise/quote-app-proto/issues/9#issuecomment-5669015864) identifies [review v1 as published](https://github.com/lbise/quote-app-proto/issues/9#issuecomment-5668864957) and local implementation `c8c70120705f3b729d685b80f9589967202cba65`. No exceptions were stated.

Approved decision groups:

- R1 to R3: search/creation, saved-record-only replacement, snapshot scope and separate defaults.
- R4: focused clarification, multi-line corrections, retained/missing copied values and conversation-preserving Undo.
- R5 to R6: dialog undo grouping, deletion warning/focus and explicit cross-section moves.
- R7: English/French copy, hosted-AI disclosure and keyboard/validation behavior.

The human design gate is satisfied. #9 remains open until the public implementation-source link is available, not for further design approval. Record the handoff commit on #9 after committing. Design approval does not waive implementation or verification work. #8's layout approval and the deferred scope are unchanged.
