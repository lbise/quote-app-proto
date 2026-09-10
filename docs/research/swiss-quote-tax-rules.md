# Swiss VAT and CHF rounding notes for Easy Quote

Research evidence for initial CHF Quotes in French-speaking Switzerland. This is not tax advice and does not make product decisions. It records federal source material that a Swiss tax professional should review before release.

## Confirmed VAT facts

### Current and historical rates

The Federal Tax Administration (FTA, ESTV/AFC) lists these [current Swiss VAT rates](https://www.estv.admin.ch/en/vat-rates-switzerland):

| VAT treatment | Rate |
| --- | ---: |
| Normal rate | 8.1% |
| Reduced rate | 2.6% |
| Special accommodation rate | 3.8% |

The special rate applies to accommodation, including an overnight stay with breakfast. The FTA lists categories for the reduced rate. Ordinary artisan work should not be assumed to qualify for either exception. Its VAT treatment needs to be supplied or confirmed by the Artisan Business.

The FTA [rate history](https://www.estv.admin.ch/en/development-swiss-vat-rates) records the rates in force from 1 January 2018 until the change on 1 January 2024: normal 7.7%, reduced 2.5%, special accommodation 3.7%. A 2021, 2022, or 2023 Quote for ordinary work can therefore legitimately show 7.7%, but only where the service was performed in that period.

### Service date controls the rate

For the 2024 rate change, the FTA's [VAT Info 19, section 2.1](https://www.gate.estv.admin.ch/mwst-webpublikationen/public/pages/taxInfos/cipherDisplay.xhtml?publicationId=1003601&componentId=1003638) says the applicable rate is determined by the time, or for periodic services the period, of performance. It is not determined by the invoice date or payment date. Work performed through 31 December 2023 uses the former rates. Work performed from 1 January 2024 uses the new rates.

The FTA gives a directly relevant building-work example. Work performed from 11 December 2023 to 30 January 2024 is split between 7.7% for the amount attributable through 31 December and 8.1% for the amount attributable from 1 January, even though one invoice was issued and paid in 2024. A single invoice that mixes periods must separately show the performance date or period and the amount for each rate. Otherwise the FTA says the whole invoiced amount is settled at the new rate.

This confirms why an old Quote may show 7.7% and why a current invoice can show 8.1%. It does not make the Quote creation date a tax-date field.

### "Not VAT registered" is not the same as a VAT-excluded service

The [VAT Act](https://www.fedlex.admin.ch/eli/cc/2009/615/de), especially Articles 10, 11, 21, and 22, distinguishes these cases:

- An enterprise with annual domestic and foreign turnover below CHF 100,000 from supplies that are not excluded under Article 21 is *exempt from VAT liability* under Article 10(2)(a). It may waive that exemption and register voluntarily under Article 11.
- A supply listed in Article 21 is *excluded from tax*. Without an Article 22 option, that supply is not taxable. This is a classification of a supply, not merely a small-business registration status.
- The FTA also distinguishes supplies *exempt from tax* under other provisions, such as exports, from Article 21 supplies excluded from tax. Neither category should be collapsed into a generic "small business VAT exempt" label.

For an Artisan Business under the threshold, "not registered for VAT" is a candidate product-facing description of the first case. French wording such as `Non assujetti à la TVA` is a sensible label to validate with a Swiss adviser. It is not prescribed wording established by this note.

The distinction has a concrete invoice consequence. VAT Act Article 27(1) says that a person not entered in the register of taxable persons may not refer to tax on invoices. Article 27(2) says a person who shows tax without entitlement, or shows too much tax, owes the shown tax unless it is corrected or no tax loss is credibly shown.

### Invoice rules do not automatically become Quote rules

VAT Act Article 26 concerns a requested invoice. It normally requires identification of supplier, recipient and service, the service date or period when different from the invoice date, the consideration, and the applicable rate and tax amount. If consideration includes tax, the applicable rate is enough. It does not state that every pre-contract Quote must have those fields. A customer-facing Quote should therefore not be represented as a legally complete VAT invoice merely because it uses similar data.

## CHF .05 rounding

### What the sources confirm

The Swiss National Bank's [coin Q&A](https://www.snb.ch/en/services-events/digital-services/faq-overview/qas_muenzen) says the regular coins in circulation are CHF 5, 2 and 1, plus 50, 20, 10 and 5 centimes. It says the 1-centime coin was withdrawn from circulation on 1 January 2007. This is a cash-denomination fact. It explains why a cash settlement may need a rounding or change-handling rule.

### What is not confirmed

I did not find an FTA, Fedlex, SNB, or other Swiss government source that requires a commercial CHF Quote or invoice total to be rounded to CHF 0.05, or that requires each displayed VAT amount to be rounded to CHF 0.05. The reviewed VAT Act and VAT Ordinance do require an invoice to state the applicable rate and tax amount when tax is shown. They do not provide that .05 invoice-rounding rule.

Nor did the reviewed government material establish a rule requiring a CHF bank-transfer amount to be a multiple of CHF 0.05. The SNB cash source instead identifies the missing 1-centime coin and the available 5-centime coin.

So the old samples' .05-rounded intermediate VAT is evidence of an existing business convention, not evidence of a Swiss legal requirement. Do not encode it as one without adviser confirmation.

### Legal requirement versus a later app policy

| Topic | Status from sources | Possible policy question, not a decision |
| --- | --- | --- |
| VAT rate | Legal rule: use the rate for the performance date or period. | How will the Quote record an intended or actual performance period for work spanning a rate change? |
| VAT display for a registered business | Legal invoice rule: show the applicable rate and tax amount, subject to Article 26. | At which calculation stage should amounts be rounded so the displayed amount matches the stored tax calculation? |
| VAT display for a business not registered for VAT | Legal invoice rule: do not refer to VAT on the invoice. | Should the French customer document say `Non assujetti à la TVA`, and should it suppress VAT rows entirely? |
| Cash collection | No .05 Quote or invoice rule was confirmed. The physical coin set makes cash settlement the relevant concern. | If cash is accepted, should a separately disclosed payment-total adjustment apply only at cash settlement, while the Quote and bank-transfer amount retain centimes? |
| Bank transfer | No .05 requirement was confirmed. | Should initial release support transfer only, or also record cash as a payment method? |

The accepted scope is one whole-Quote pre-VAT discount. The sources above do not select a discount allocation or rounding method. That remains a product and accounting policy question, especially if a Quote ever contains more than one VAT treatment.

## Bounded questions for the user

1. Does each Artisan Business explicitly choose `registered for VAT` or `not registered for VAT`, with a separate later path for Article 21 excluded supplies? Do not infer it from turnover.
2. Can a Quote record a service date or service period, including a split across 31 December 2023 and 1 January 2024, or is historical-document display the only requirement for now?
3. Will the first release collect only bank transfers, or must it also support cash collection? If cash is required, should any CHF 0.05 adjustment be a payment-settlement adjustment rather than a Quote or VAT-line rounding rule?
4. With one pre-VAT whole-Quote discount accepted, what rounding stage should the business approve: line amounts, discounted subtotal, VAT amount, or final payable total? This needs a named business policy and adviser review, not an inference from legacy samples.

## Sources

All sources were read without supplying personal data.

1. Federal Tax Administration, [Swiss VAT rates](https://www.estv.admin.ch/en/vat-rates-switzerland). Current rates, reduced-rate categories, and accommodation rate.
2. Federal Tax Administration, [Development of Swiss VAT rates](https://www.estv.admin.ch/en/development-swiss-vat-rates). Rate history. The page's rate table records 7.7%, 2.5%, and 3.7% from 1 January 2018 and 8.1%, 2.6%, and 3.8% from 1 January 2024.
3. Federal Tax Administration, [VAT rate increase on 1 January 2024](https://www.estv.admin.ch/de/erhoehung-mwst-steuersaetze-2024), and [VAT Info 19, section 2.1](https://www.gate.estv.admin.ch/mwst-webpublikationen/public/pages/taxInfos/cipherDisplay.xhtml?publicationId=1003601&componentId=1003638). Performance-date rule, separate allocation, and the furniture and interior-construction examples. Sections [2.2.1](https://www.gate.estv.admin.ch/mwst-webpublikationen/public/pages/taxInfos/cipherDisplay.xhtml?publicationId=1003601&componentId=1707244), [2.3](https://www.gate.estv.admin.ch/mwst-webpublikationen/public/pages/taxInfos/cipherDisplay.xhtml?publicationId=1003601&componentId=1003649), and [2.4](https://www.gate.estv.admin.ch/mwst-webpublikationen/public/pages/taxInfos/cipherDisplay.xhtml?publicationId=1003601&componentId=1003696) cover part payments, prepayments, and periodic services.
4. Swiss Confederation, [VAT Act, SR 641.20](https://www.fedlex.admin.ch/eli/cc/2009/615/de), Articles 10, 11, 21, 22, 26, and 27. The FTA's consolidated publication of the [VAT Act with amendments from 2025](https://www.estv.admin.ch/dam/de/sd-web/sc4WgPZIIElS/21019-mwstg-mit-aenderungen-de.pdf) was used to read the article text.
5. Swiss Confederation, [VAT Ordinance, SR 641.201](https://www.fedlex.admin.ch/eli/cc/2009/828/de). The FTA's consolidated publication of the [VAT Ordinance with amendments from 2025](https://www.estv.admin.ch/dam/de/sd-web/ZCfvcCGIDszz/mwst-publ-mwstv-aenderungen-2025-de.pdf) was reviewed for the rounding question.
6. Swiss National Bank, [Questions and answers on coins](https://www.snb.ch/en/services-events/digital-services/faq-overview/qas_muenzen). Current coin denominations, 1-centime withdrawal, and the cited Federal Act on Currency and Payment Instruments rules for coins as legal tender.
