# Joinery and cladding reference

`joinery-reference.json` is a documentation fixture for a long French CHF Quote. It adapts a locally inspected four-page joinery and cladding invoice into 30 positive-priced Quote Lines across seven Quote Sections. It is not a production schema or a customer-ready Quote.

## Privacy and provenance

The original PDF stays outside the repository. This fixture contains no original party identity, address, contact detail, VAT identifier, document reference, filename, or project location. The issuer, Customer, Quote reference, dates, addresses, email, and VAT identifier in the JSON are independently invented examples.

The source establishes the document's work volume and its repeated joinery and cladding assemblies. Its invoice framing does not become Quote content. In particular, this fixture excludes the source's prior-payment deduction and amount-due framing. It has no Quote Discount and no negative Quote Line.

The fixture retains the 30 positive work amounts and the useful, legible technical content: removal of existing aluminium elements, wood support work, cladding, windows, panels, and repeated internal dimensions of 30/60 mm, 40/80 mm, and 50 mm. It replaces the work-area names with `Zone de travail A` through `Zone de travail G`. The first section holds the two site-wide preparation lines so the fixture keeps the required seven Quote Sections.

## Uncertain units

The local extraction did not make every source unit reliable. This is an adaptation, not a claim about the invoice:

- Fixed Quote Lines keep a printed positive amount without a made-up quantity, unit, or unit price.
- `pce` is an adapted count for window and removal work.
- `ml` is an adapted length for wood cladding support work.
- `m2` is an adapted area for panel installation work.

The adapted quantity-priced lines reconcile to their retained printed price and amount. The unit labels let the fixture exercise decimal quantities, pieces, square metres, and linear metres. They need clarification before anyone treats them as commercial facts from the source.

## Calculation check

A separate local Python check used `Decimal` and `ROUND_HALF_UP`. It recalculated every quantity-priced line from quantity times unit price, kept fixed amounts as entered, then summed the rounded line amounts.

| Expected amount | CHF |
| --- | ---: |
| 30 rounded Quote Lines and section subtotals | 26'854.30 |
| Quote Discount | 0.00 |
| Base before VAT | 26'854.30 |
| VAT at 8.1%, calculated once on the whole base | 2'175.20 |
| Total | 29'029.50 |

Section subtotals are before VAT and any whole-Quote Discount. The 8.1% VAT calculation is the fixture's supported tax treatment. It does not classify the work for tax purposes.

## Suggested test use

Use this fixture for the long-document rehearsal: section navigation, repeated-line duplication, a missing-unit clarification, manual and conversational edits, save/reopen, recovery, Publication, and a later Working Draft. Import the JSON as fixture data at the whole-Quote calculation boundary. Its expected amounts belong in the test independently of the calculator implementation.
