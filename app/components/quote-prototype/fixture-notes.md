# Quote prototype fixtures

`makeJoineryQuote` is a synthetic joinery Quote. It has 30 priced Quote Lines in seven work-area Quote Sections. The fixed-price assemblies deliberately include repeated cabinetry and internal measurements because the prototype needs dense, long commercial content. It is not a source-verified adaptation. No original joinery document was read for this fixture. A source-verified, safely anonymized adaptation remains follow-up work.

`makeFlatQuote` adapts all 14 priced Quote Lines in `docs/examples/first-quotes/landscape-reference.json`. It leaves them ungrouped, with no Quote Sections, to exercise a flat Quote while retaining the complete adapted content. Its identities, reference, dates, addresses, contact details, and VAT identifier are fictional fixture data. The source documentation records the unit inferences and provenance limits for its commercial figures.

`makeEmptyQuote` has no Customer and no Quote Lines. Its business details are fictional defaults. The two priced fixtures contain no intentionally missing price values. The prototype UI creates its two missing-field states after loading a fully priced fixture.

## Expected totals

These totals were calculated independently with Python `Decimal`, using line amounts as shown, a 5% percentage Quote Discount for the joinery Quote, and VAT at 8.1%. Monetary steps use `ROUND_HALF_UP` to CHF 0.01. VAT is calculated once on the discounted base. The empty Quote is not VAT-registered.

| Fixture | Subtotal | Discount | VAT | Total |
| --- | ---: | ---: | ---: | ---: |
| Joinery | CHF 62'498.40 | CHF 3'124.92 | CHF 4'809.25 | CHF 64'182.73 |
| Flat landscape | CHF 15'032.00 | CHF 0.00 | CHF 1'217.59 | CHF 16'249.59 |
| Empty | CHF 0.00 | CHF 0.00 | CHF 0.00 | CHF 0.00 |
