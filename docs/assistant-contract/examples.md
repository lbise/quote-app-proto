# Proposed contract examples

These are review examples, not executed tests or claims about live-model quality. IDs are fictional stable IDs. No provider receives these examples in addition to the approved prompt. Each example identifies its capability stage. Results describe model-visible acknowledgements; full diagnostics remain internal.

## Initial capture without administrative questions, #26

Artisan, English: `Paint the bedroom walls. The room is 2 m long, 4 m wide and 3 m high. CHF 12.50 per m².`

```json
{
  "name": "add_quote_line",
  "arguments": {
    "description": "Peinture des murs de la chambre, longueur 2 m, largeur 4 m, hauteur 3 m",
    "mode": "quantity",
    "quantityCalculation": {
      "kind": "room_wall_area",
      "length": "2",
      "width": "4",
      "height": "3",
      "source": "The room is 2 m long, 4 m wide and 3 m high."
    },
    "unit": "m²",
    "unitPrice": "12.50",
    "evidence": [{ "field": "unitPrice", "text": "CHF 12.50 per m²" }]
  }
}
```

The application returns new line ID `line_new`, quantity `36`, unit price `12.50` and line amount 45,000 CHF cents. Quote totals may remain incomplete because other commercial fields are missing. Model reply: `Added the bedroom wall painting: 36 m² at CHF 12.50 per m².` The application prepends the committed status only after committing. There is no question about Customer or business identity before capture.

Artisan, French: `Peindre les murs de la chambre, dimensions et prix encore inconnus.`

```json
{
  "name": "add_quote_line",
  "arguments": { "description": "Peinture des murs de la chambre", "mode": "quantity" }
}
```

The new line retains missing quantity, unit and price. Model reply: `J'ai ajouté la peinture des murs de la chambre. Quelle surface faut-il prévoir ?` The assistant must not choose zero or infer a room size.

## Correction of a manually entered line, #26

Context has manually entered `line_manual`, description `Peinture des murs`, quantity `36`, unit `m²`, unitPrice `12.50`.

Artisan: `Le prix de la ligne 1 est 14 CHF par m², pas 12.50.`

```json
{
  "name": "update_quote_line",
  "arguments": {
    "lineId": "line_manual",
    "fields": { "unitPrice": "14" },
    "evidence": [{ "field": "unitPrice", "text": "Le prix de la ligne 1 est 14 CHF par m²" }]
  }
}
```

The application accepts the correction and returns the recalculated line amount of 50,400 cents. It does not repeat every unchanged line field. It does not require the line to be assistant-captured. The temporary supply_missing_line_fields tool is not used to overwrite a populated value. No read_work call precedes the correction.

## Copy with unknown measurements, #26

Context section `section_bedroom` contains a quantity line with `36 m²`, price `14`, and dimensions in its description.

Artisan: `Copie cette section pour une autre chambre dont les dimensions sont encore inconnues. Garde le prix au m².`

```json
{
  "name": "duplicate_quote_section",
  "arguments": { "sectionId": "section_bedroom", "measurementPolicy": "unknown" }
}
```

The application returns a fresh section ID and fresh line IDs. It clears the copied quantity and removable embedded dimensions, retains the `m²` unit and price `14`, and marks the copied work incomplete. The original section stays unchanged. If a measurement cannot safely be removed, the whole call rejects for clarification.

Model reply: `J'ai copié la section. Les quantités restent à renseigner ; le prix de 14 CHF par m² est conservé.` The application adds its deterministic retained/missing-value disclosure. A later rename can use the new section ID from this result without rereading the initial context.

## Malformed call, correction and atomic commit, #26

The current Artisan message supplies `36 m²`. A staged earlier section rename succeeded. The model then calls:

```json
{
  "name": "update_quote_line",
  "arguments": {
    "lineId": "line_manual",
    "fields": { "quantity": "36 m²" },
    "evidence": [{ "field": "quantity", "text": "36 m²" }]
  }
}
```

Pi marks the result as an error. Its model-visible text says: `Quantity must be a decimal without units. Resubmit the complete call.` The prior rename is still staged, not committed. The model resubmits the complete call:

```json
{
  "name": "update_quote_line",
  "arguments": {
    "lineId": "line_manual",
    "fields": { "quantity": "36" },
    "evidence": [{ "field": "quantity", "text": "36 m²" }]
  }
}
```

The runner keeps the unresolved operation, failure ID and correction count internally. If its exact correction matcher accepts this complete replacement, the quantity call succeeds. After successful model completion, both changes commit in one transaction and share one manual Undo action.

If the model instead calls create_quote_section, the runner keeps the original operation unresolved and counts the attempt internally. Two further rejected attempts discard both the failed quantity request and the earlier successful rename. Switching tools cannot restart the counter. A final text-only `Done` while the failure is unresolved also discards the turn. The exact correction matching rule remains under review.

If the draft is changed manually while the provider is working, even a valid correction is discarded as stale. If another business's Quote is requested, authorization aborts before inference; the model receives no corrective information about that Quote.

## Quote-local commercial correction, #27

Artisan: `Pour ce devis seulement, remplace l'adresse du client par Rue du Lac 9, 1000 Lausanne. Valable jusqu'au 2026-12-31.`

```json
{
  "name": "edit_quote",
  "arguments": {
    "fields": { "customerAddress": "Rue du Lac 9, 1000 Lausanne", "validUntil": "2026-12-31" },
    "evidence": [
      { "fields": ["customerAddress", "validUntil"], "source": "current", "text": "Pour ce devis seulement, remplace l'adresse du client par Rue du Lac 9, 1000 Lausanne. Valable jusqu'au 2026-12-31." }
    ]
  }
}
```

Only this Working Draft changes. The reusable Customer, business defaults, other Quotes and Published Revisions do not change. Under #26 the assistant instead explains that date editing is unavailable through its tools; it must not partially pretend to complete this compound request.

## Bulk adjustment and failed-call rollback, #27

Artisan: `Increase the unit prices on lines 1, 2 and 3 by 5%.`

The three quantity-mode lines have prices `12.50`, `10.10` and empty. Their IDs are `line_1`, `line_2`, `line_3`.

```json
{
  "name": "edit_lines",
  "arguments": {
    "operations": [{ "op": "adjust", "lineIds": ["line_1", "line_2", "line_3"], "field": "unitPrice", "direction": "increase", "percent": "5" }],
    "evidence": [{ "fields": ["/operations/0/percent"], "source": "current", "text": "Increase the unit prices on lines 1, 2 and 3 by 5%." }]
  }
}
```

Application-calculated prices become `13.13`, `10.61` and empty. The result lists `line_3` in skippedMissingSource. Reply: `Increased the two supplied unit prices by 5%. Line 3 still has no unit price.` No price is filled from another line or from model knowledge.

If a call instead includes two update operations and the second has an unknown line ID, neither applies. Correcting only the second operation would omit requested work, so the replacement must contain the complete intended batch. Debug shows the rejected call and the accepted replacement, not an apparent partial success.

## Pricing-mode change and missing replacement amount, #27

Artisan: `Make line 1 fixed-price; the amount is not known yet.`

```json
{
  "name": "edit_lines",
  "arguments": { "operations": [{ "op": "update", "lineId": "line_1", "fields": { "mode": "fixed", "amount": "" } }] }
}
```

The application clears quantity, unit and unitPrice and leaves amount empty. It does not reuse the old calculated quantity-times-price amount. The line and whole Quote remain honestly incomplete. Setting amount to `0` would require evidence of a deliberately supplied zero price.

## Clarification instead of guessing, all stages

Two current sections are bedrooms, each with a painting line. Artisan: `Use the same price for the other room.`

No mutation tool call. Reply: `Which room should receive the price, and which line should it copy from?` In French: `Quelle chambre doit recevoir ce prix, et quelle ligne faut-il prendre comme référence ?`

If historyOmitted is true and the source was mentioned only in omitted conversation, the assistant asks again rather than reconstructing the price. Prior assistant prose containing a price is not permitted evidence.

## Explicit copying and ordering, #28

Artisan: `Copy lines 1 and 2 into the kitchen section, with the same measurements and prices.`

```json
{
  "name": "copy_work",
  "arguments": { "source": { "kind": "lines", "lineIds": ["line_1", "line_2"], "destinationSectionId": "section_kitchen" }, "measurementPolicy": "retain" }
}
```

The new IDs are `line_copy_1` and `line_copy_2`, appended in that order. Source lines and multiline content remain unchanged. A subsequent request to move these two before `line_kitchen_existing` uses:

```json
{
  "name": "move_work",
  "arguments": { "move": { "kind": "lines", "lineIds": ["line_copy_1", "line_copy_2"], "destinationSectionId": "section_kitchen", "beforeLineId": "line_kitchen_existing" } }
}
```

The stable new IDs come from the accepted copy result, not the outdated initial draft. Unrelated lines retain their relative order.

## Destructive confirmation covers the complete turn, #28

Artisan: `Rename the project to Kitchen repairs, and delete the bathroom section and all its work.`

The model first stages edit_quote with title `Kitchen repairs` and `{ "fields": ["title"], "source": "current", "text": "Rename the project to Kitchen repairs" }`, then:

```json
{
  "name": "delete_work",
  "arguments": { "target": { "kind": "sections", "sectionIds": ["section_bathroom"] } }
}
```

The section was populated. The result tells the model that application-controlled confirmation is required. Inference completes, but neither the title change nor deletion commits. The UI lists the title change, section, every contained line and before/after totals. It focuses Cancel by default. Model reply: `The application will show the title change and the bathroom work to remove. Review and confirm them there.`

- Artisan types `yes` in chat: no confirmation authority. The pending proposal still requires its UI button.
- Artisan cancels: title, section and lines remain unchanged.
- Artisan edits manually: the proposal becomes stale; confirmation cannot delete newer work.
- Artisan confirms an unchanged proposal: both edits commit atomically once. Retrying confirmation does not apply them again. Manual Undo restores the whole prior draft.
- The model first moves all bathroom lines out, then deletes the section: confirmation is still required because it was populated earlier in the turn.
- The model deletes all original lines in several calls, or adds replacements before deleting the originals: confirmation is still required.

## Publication and Undo are manual, all stages

Artisan: `Publie le devis.`

No tool call and no Publication dialog opened. Reply: `Utilisez le bouton de publication pour vérifier le devis et confirmer la publication.`

Artisan: `Undo that change.`

No inverse-edit simulation and no tool call. Reply: `Use the manual Undo control to reverse the last change.`
