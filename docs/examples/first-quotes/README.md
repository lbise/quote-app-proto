# First Quote fixtures

Specification: [Define the first Quote, issue #6](https://github.com/lbise/quote-app-proto/issues/6).

These are anonymized, adapted documentation fixtures. They retain useful commercial figures. They do not claim statistical anonymity. They are not a production schema and are not customer-ready Quotes.

## Files

- `landscape-reference.json` contains 14 priced Quote Lines from `landscape-reference`.
- `civil-works-reference.json` contains 17 priced Quote Lines from `civil-works-reference`.
- `calculation-examples.json` contains synthetic calculation cases.

The Quote fixtures use French and CHF. Issuer, Customer, Quote reference, address, email, VAT identifier, `issueDate`, and `serviceDate` are synthetic. `serviceDate` is illustrative fixture data, not a newly required product field. Decimal values are JSON strings. Quote Line numbers run sequentially across flat Quote Sections. Section totals are before any Quote Discount and VAT.

## Source handling

The references were read locally. This directory contains no original PDF, raw extracted text, original filename, or identifying party, contact, bank, Quote reference, address, or project location. The source aliases above are the only retained provenance identifiers.

The fixtures keep complete work descriptions where legible, normalize obvious spelling faults, and remove identifying narrative. `sourceEvidence` connects an adapted Quote Line to its printed values or source position without reproducing identifying data.

### `landscape-reference`

The source printed no units for its priced lines. The fixture records every inference beside the relevant Quote Line. It infers `pce` for tiles, plants, and fixings, `h` where the description says hours, `m2` for geotextile and terrace work, and `m3` for loose materials. The balaste unit remains uncertain. The installation line is a fixed amount because the source showed quantity `1` without a unit. The fixture does not add a quantity or unit to that fixed Quote Line.

No commercial terms were found in the source. `quoteSnapshot.terms` is therefore empty. The fixture does not add generic validity, deposit, or payment terms.

The 14 extracted quantity-price products sum to CHF 15'032.00. The printed source totals were CHF 13'232.00 before VAT, CHF 1'018.85 VAT at 7.7%, and CHF 14'250.85 total. The CHF 1'800.00 difference equals the printed tile-laying amount. An unlabeled CHF 11'162.00 intermediate amount also appears before the second section. The adapted fixture keeps the tile-laying Quote Line, so its subtotal is CHF 15'032.00. At its synthetic 8.1% rate, VAT is CHF 1'217.59 and total is CHF 16'249.59.

### `civil-works-reference`

The 17 extracted priced lines sum to CHF 9'311.50, which matches the printed source subtotal. Source position `3.4` has a `pce` unit, the text quantity `par`, and a CHF 340.00 price, but no numeric quantity or final amount. `unpricedSourcePosition` records it. The fixture excludes it rather than inventing a Quote Line.

The printed source totals were CHF 9'311.50 before VAT, CHF 717.00 VAT at 7.7%, and CHF 10'028.50 total. CHF 9'311.50 multiplied by 7.7% is CHF 716.9855 before rounding. The printed VAT agrees with historical CHF 0.05 rounding, not the CHF 0.01 calculation used by these fixtures. The adapted fixture uses the same subtotal with synthetic 8.1% VAT of CHF 754.23 and a total of CHF 10'065.73.

The source had legible conditions. `quoteSnapshot.terms` contains anonymized French paraphrases, not quotations. They retain the price-variation condition, delivery confirmation, extra-work uplift, dated and signed acceptance, and the conditional 40% deposit above CHF 30'000 TTC. They are source-derived terms. The synthetic issuer, Customer, dates, and Quote reference are separate Quote metadata.

## Calculation rules

Each quantity-price Quote Line rounds to CHF 0.01 using half-up before summing. One optional Quote Discount is either a percentage or a fixed CHF amount. Round the discount to CHF 0.01, subtract it before VAT, then calculate 8.1% VAT once on the discounted base and round it to CHF 0.01. The total is base plus VAT.

The 8.1% treatment is a synthetic standard-rate calculation assumption. It does not classify plants, materials, or any other adapted line for tax purposes. These fixtures do not cover reduced-rate sales. Historical 7.7% and CHF 0.05 rounding are not expected behavior.

`calculation-examples.json` includes the requested CHF 122.62 percentage-discount calculation, a fixed CHF discount, 100% and fixed discounts equal to the subtotal, a no-VAT case with no VAT row, a zero total, and two rounding-stage discriminators. The line discriminator compares two CHF 10.03 rounded lines with a CHF 20.05 raw-sum counterexample. The VAT discriminator compares one VAT calculation on CHF 0.12 with the incorrect per-line VAT calculation.
