# Proposed contract examples

These are fictional review examples, not executed tests or claims about live-model quality. IDs are stable application IDs. The examples show replacement tool arguments only. Tools take commercial and structural values directly, without source excerpts.

## Fixed-price line

Artisan: `Add a fixed price of CHF 486.50 for the final adjustment of the conservatory shutters.`

```json
{
  "name": "edit_quote_lines",
  "arguments": {
    "lines": [{
      "description": "Réglage final des volets de la verrière",
      "mode": "fixed",
      "quantity": "",
      "unit": "",
      "unitPrice": "",
      "amount": "486.50"
    }]
  }
}
```

The application validates the line shape and fixed-price mode, then calculates Quote totals. The Artisan reviews whether the description and amount match the request.

## Quantity line from separate paragraphs

Artisan:

```text
Pour l'orangerie, note une ligne de pose de ruban d'étanchéité.
La longueur mesurée est de 12,75 m.

Le tarif convenu est de 6,80 CHF par mètre.
```

```json
{
  "name": "edit_quote_lines",
  "arguments": {
    "lines": [{
      "description": "Pose de ruban d'étanchéité",
      "mode": "quantity",
      "quantity": "12.75",
      "unit": "m",
      "unitPrice": "6.80",
      "amount": ""
    }]
  }
}
```

The separated paragraphs are ordinary conversation context. They do not add a tool argument or validation rule. The application validates decimal values and quantity mode, then calculates the amount.

## Derived quantity and adjusted price

For a room 2 m by 4 m with 3 m walls, the assistant may enter a derived wall quantity. For a requested 5% increase from CHF 12.50, it may enter the adjusted price `13.13` after CHF half-up rounding.

```json
{
  "name": "edit_quote_lines",
  "arguments": {
    "lines": [{
      "id": "line_paint",
      "description": "Peinture des murs de la chambre, longueur 2 m, largeur 4 m, hauteur 3 m",
      "mode": "quantity",
      "quantity": "36",
      "unit": "m²",
      "unitPrice": "13.13",
      "amount": ""
    }]
  }
}
```

The application checks shape, precision, ranges, mode, and resulting Quote calculations. It does not verify the wall-area formula, percentage adjustment, rounding choice, or interpretation. The Artisan must review the result.

## Section then assigned line

```json
{
  "name": "edit_quote_sections",
  "arguments": { "sections": [{ "title": "Galerie nord" }] }
}
```

The successful result returns the generated section ID. The next call uses that returned ID:

```json
{
  "name": "edit_quote_lines",
  "arguments": {
    "lines": [{
      "sectionId": "section_new",
      "description": "Protection temporaire du sol",
      "mode": "fixed",
      "quantity": "",
      "unit": "",
      "unitPrice": "",
      "amount": "92.00"
    }]
  }
}
```

## Mixed batches

A long request can create two sections and eight lines in separate batches. The assistant creates the sections, uses their returned IDs, then sends complete line batches in the requested order. It must wait for each accepted result and must not recreate accepted lines. Smaller batches are appropriate for long descriptions.

The combined evaluation case checks this behavior with shared rates, fixed and quantity lines, and facts spread across paragraphs. Passing it proves the scripted contract and expected commercial state, not reliable interpretation of longer Quotes.

## Clarification and manual actions

If two bedrooms could be the target of `Use the same price for the other room`, the assistant asks which room and which source line the Artisan means. It does not mutate the draft.

Publication, Undo, deletion of a section, and clearing all work are manual actions. For a permitted deletion, the assistant calls `delete_quote_lines` with explicit line IDs only. If a request would delete every original line in the turn, the application discards the staged turn.
