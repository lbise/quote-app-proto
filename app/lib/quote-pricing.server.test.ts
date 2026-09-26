import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { firstQuoteExample } from "./first-quote-examples";
import { calculateQuote, type QuoteData, type QuoteLine } from "./quote";
import { completeQuote, quoteHttpHarness, quoteSteps, type ArtisanFixture } from "./quote-http.test-support";

// #15: whole-Quote Discount and VAT through the authenticated Quote HTTP boundary.
// Expected amounts are the independently checked figures from #6, not calculator output.

const fixed = (id: string, amount: string, description = "Forfait"): QuoteLine => ({ id, sectionId: "", description, mode: "fixed", quantity: "", unit: "", unitPrice: "", amount });
const priced = (id: string, quantity: string, unit: string, unitPrice: string, description = "Travail"): QuoteLine => ({ id, sectionId: "", description, mode: "quantity", quantity, unit, unitPrice, amount: "" });

const syntheticLines: QuoteLine[] = [
  priced("line-1", "0.125", "h", "80.20", "Découpe"),
  priced("line-2", "2", "pce", "45,50", "Fourniture"),
  fixed("line-3", "25.00"),
];

describe.runIf(Boolean(process.env.TEST_DATABASE_URL)).sequential("Quote pricing through the authenticated Quote HTTP boundary", () => {
  const harness = quoteHttpHarness("pricing");
  let artisan: ArtisanFixture;
  let steps: ReturnType<typeof quoteSteps>;

  beforeAll(async () => {
    harness.setUp();
    artisan = await harness.artisan();
    steps = quoteSteps(artisan.request);
  });
  afterAll(() => harness.tearDown());

  /** Save a Working Draft, check its reload is identical, then publish it and return the server's stored calculation. */
  async function publishedCalculation(patch: Partial<QuoteData>) {
    let detail = await steps.create();
    const quote = completeQuote(detail.draft!.reference, patch);
    detail = await steps.save(detail, quote);
    const reloaded = await steps.read(detail.id);
    expect(reloaded.draft).toEqual(calculateQuote(quote).quote);
    detail = await steps.publish(reloaded);
    expect(detail.revisions).toHaveLength(1);
    return detail.revisions[0].calculation;
  }

  it("publishes the agreed synthetic example with registered and unregistered VAT", async () => {
    expect(await publishedCalculation({ discountMode: "percent", discount: "10", lines: syntheticLines })).toMatchObject({
      complete: true,
      lines: [{ id: "line-1", amount: 1003 }, { id: "line-2", amount: 9100 }, { id: "line-3", amount: 2500 }],
      subtotal: 12603, discount: 1260, net: 11343, vat: 919, total: 12262,
    });
    // Unregistered is not a 0% rate: there is no VAT amount at all.
    expect(await publishedCalculation({ discountMode: "percent", discount: "10", vatRegistered: false, vatId: "", lines: syntheticLines })).toMatchObject({
      complete: true, subtotal: 12603, discount: 1260, net: 11343, vat: null, total: 11343,
    });
  });

  it("publishes the adapted landscape, civil-works and joinery references with their checked totals", async () => {
    const expected = {
      "landscape-reference": { subtotal: 1_503_200, vat: 121_759, total: 1_624_959 },
      "civil-works-reference": { subtotal: 931_150, vat: 75_423, total: 1_006_573 },
      "joinery-reference": { subtotal: 2_685_430, vat: 217_520, total: 2_902_950 },
    } as const;
    for (const [name, totals] of Object.entries(expected)) {
      const { reference: _reference, ...example } = firstQuoteExample(name as keyof typeof expected);
      expect(await publishedCalculation(example)).toMatchObject({ complete: true, discount: 0, net: totals.subtotal, ...totals });
    }
  });

  it("rounds each line, the percentage discount and the VAT half-up at their own stage", async () => {
    // Half-cent line: 0.5 × CHF 0.01 = 0.005 → 0.01.
    expect(await publishedCalculation({ lines: [priced("tie", "0.5", "pce", "0.01")] }))
      .toMatchObject({ lines: [{ amount: 1 }], subtotal: 1 });
    // Rounded lines are summed: 2 × round(10.025) = 20.06, not round(20.05).
    expect(await publishedCalculation({ lines: [priced("one", "0.125", "h", "80.20"), priced("two", "0.125", "h", "80.20")] }))
      .toMatchObject({ subtotal: 2006, vat: 162, total: 2168 });
    // Half-cent percentage discount: 10% of CHF 0.05 = 0.005 → 0.01.
    expect(await publishedCalculation({ discountMode: "percent", discount: "10", lines: [fixed("small", "0.05")] }))
      .toMatchObject({ subtotal: 5, discount: 1, net: 4 });
    // Percentage with two decimals: 12.25% of CHF 80.00 = 9.80.
    expect(await publishedCalculation({ discountMode: "percent", discount: "12.25", lines: [fixed("line", "80.00")] }))
      .toMatchObject({ subtotal: 8000, discount: 980, net: 7020, vat: 569, total: 7589 });
    // Half-cent VAT: 8.1% of CHF 5.00 = 0.405 → 0.41.
    expect(await publishedCalculation({ lines: [fixed("vat-tie", "5.00")] }))
      .toMatchObject({ net: 500, vat: 41, total: 541 });
    // VAT is calculated once on the whole discounted subtotal, not per line: 8.1% of 0.12 = 0.00972 → 0.01.
    expect(await publishedCalculation({ lines: [fixed("one", "0.06"), fixed("two", "0.06")] }))
      .toMatchObject({ subtotal: 12, net: 12, vat: 1, total: 13 });
    // A fixed discount is subtracted before VAT.
    expect(await publishedCalculation({ discountMode: "fixed", discount: "20.50", lines: [fixed("line", "100.00")] }))
      .toMatchObject({ subtotal: 10000, discount: 2050, net: 7950, vat: 644, total: 8594 });
  });

  it("keeps sections before the discount and VAT without adding them twice", async () => {
    expect(await publishedCalculation({
      discountMode: "percent", discount: "10",
      sections: [{ id: "a", title: "Séjour" }, { id: "b", title: "Chambre" }],
      lines: [{ ...fixed("a-1", "60.00"), sectionId: "a" }, { ...fixed("b-1", "40.00"), sectionId: "b" }, fixed("flat", "20.00")],
    })).toMatchObject({
      sections: [{ id: "a", subtotal: 6000 }, { id: "b", subtotal: 4000 }],
      subtotal: 12000, discount: 1200, net: 10800, vat: 875, total: 11675,
    });
  });

  it("publishes zero prices, a 100% discount and a fixed discount equal to the subtotal as zero totals", async () => {
    expect(await publishedCalculation({ lines: [priced("offered", "1", "pce", "0.00"), fixed("free", "0.00")] }))
      .toMatchObject({ complete: true, subtotal: 0, discount: 0, net: 0, vat: 0, total: 0 });
    expect(await publishedCalculation({ discountMode: "percent", discount: "100.00", lines: [fixed("line", "12.34")] }))
      .toMatchObject({ complete: true, subtotal: 1234, discount: 1234, net: 0, vat: 0, total: 0 });
    expect(await publishedCalculation({ discountMode: "fixed", discount: "12.34", vatRegistered: false, vatId: "", lines: [fixed("line", "12.34")] }))
      .toMatchObject({ complete: true, subtotal: 1234, discount: 1234, net: 0, vat: null, total: 0 });
  });

  it("rejects invalid discount, tax and price inputs without coercing or changing the saved draft", async () => {
    let detail = await steps.create();
    const baseline = completeQuote(detail.draft!.reference, { discountMode: "percent", discount: "5" });
    detail = await steps.save(detail, baseline);
    const cases: [Record<string, unknown>, { path: string; code: string }][] = [
      [{ discountMode: "percent", discount: "-5" }, { path: "discount", code: "negative_value" }],
      [{ discountMode: "percent", discount: "12.345" }, { path: "discount", code: "unsupported_precision" }],
      [{ discountMode: "percent", discount: "100.01" }, { path: "discount", code: "out_of_range" }],
      [{ discountMode: "percent", discount: "10 %" }, { path: "discount", code: "invalid_value" }],
      [{ discountMode: "fixed", discount: "100.01" }, { path: "discount", code: "out_of_range" }],
      [{ discountMode: "fixed", discount: "10.001" }, { path: "discount", code: "unsupported_precision" }],
      [{ discountMode: "per-line" }, { path: "discountMode", code: "invalid_value" }],
      [{ vatRegistered: "reduced" }, { path: "vatRegistered", code: "invalid_type" }],
      [{ vatRegistered: 0 }, { path: "vatRegistered", code: "invalid_type" }],
      [{ lines: [fixed("line-1", "-100.00")] }, { path: "lines[0].amount", code: "negative_value" }],
      [{ lines: [priced("line-1", "1", "h", "80.205")] }, { path: "lines[0].unitPrice", code: "unsupported_precision" }],
    ];
    for (const [patch, problem] of cases) {
      const rejected = await artisan.request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: { ...baseline, ...patch } });
      expect(rejected.status, JSON.stringify(patch)).toBe(422);
      expect((await rejected.json()).details.errors, JSON.stringify(patch)).toContainEqual(problem);
    }
    const reloaded = await steps.read(detail.id);
    expect(reloaded.version).toBe(detail.version);
    expect(reloaded.draft).toEqual(baseline);
  });

  it("ignores client-supplied totals and publishes the server calculation", async () => {
    let detail = await steps.create();
    const quote = completeQuote(detail.draft!.reference);
    detail = await steps.save(detail, { ...quote, total: 1, vat: 0, calculation: { total: 1 } } as unknown as QuoteData);
    expect(detail.draft).toEqual(quote);
    detail = await steps.publish(detail);
    expect(detail.revisions[0].calculation).toMatchObject({ subtotal: 10000, vat: 810, total: 10810 });
  });

  it("saves incomplete pricing, withholds publication, and checks an oversized fixed discount only once pricing is complete", async () => {
    let detail = await steps.create();
    const reference = detail.draft!.reference;
    const incomplete = completeQuote(reference, { discountMode: "fixed", discount: "150.00", lines: [fixed("known", "100.00"), fixed("unknown", "")] });
    detail = await steps.save(detail, incomplete);
    const reloaded = await steps.read(detail.id);
    expect(reloaded.draft).toEqual(incomplete);
    // Known amounts remain available while the discount and every total after it wait for complete pricing.
    expect(calculateQuote(reloaded.draft)).toMatchObject({ errors: [], subtotal: 10000, discount: null, net: null, vat: null, total: null, complete: false });
    const blocked = await artisan.request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({ details: { missing: expect.arrayContaining([{ path: "lines[1].amount", code: "required" }]) } });

    const oversized = await artisan.request({ action: "save", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID(), quote: { ...incomplete, lines: [fixed("known", "100.00"), fixed("unknown", "20.00")] } });
    expect(oversized.status).toBe(422);
    expect((await oversized.json()).details.errors).toEqual([{ path: "discount", code: "out_of_range" }]);

    detail = await steps.save(detail, { ...incomplete, lines: [fixed("known", "100.00"), fixed("unknown", "60.00")] });
    detail = await steps.publish(detail);
    expect(detail.revisions[0].calculation).toMatchObject({ subtotal: 16000, discount: 15000, net: 1000, vat: 81, total: 1081 });
  });

  it("keeps missing VAT configuration distinct from unregistered status and from missing administrative details", async () => {
    const blockedBy = async (patch: Partial<QuoteData>) => {
      let detail = await steps.create();
      detail = await steps.save(detail, completeQuote(detail.draft!.reference, patch));
      const response = await artisan.request({ action: "publish", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
      expect(response.status).toBe(422);
      const reloaded = await steps.read(detail.id);
      return { missing: (await response.json()).details.missing, calculation: calculateQuote(reloaded.draft) };
    };
    const unknown = await blockedBy({ vatRegistered: null });
    expect(unknown.missing).toEqual([{ path: "vatRegistered", code: "required" }]);
    expect(unknown.calculation).toMatchObject({ net: 10000, vat: null, total: null });

    const registeredWithoutId = await blockedBy({ vatId: " " });
    expect(registeredWithoutId.missing).toEqual([{ path: "vatId", code: "required" }]);
    expect(registeredWithoutId.calculation).toMatchObject({ vat: 810, total: 10810 });

    const missingCustomer = await blockedBy({ customerName: "" });
    expect(missingCustomer.missing).toEqual([{ path: "customerName", code: "required" }]);
    expect(missingCustomer.calculation).toMatchObject({ errors: [], net: 10000, vat: 810, total: 10810 });

    expect(await publishedCalculation({ vatRegistered: false, vatId: "" })).toMatchObject({ complete: true, vat: null, total: 10000 });
  });

  it("persists Quote-local discount and tax changes with latest-action undo and leaves business defaults unchanged", async () => {
    const defaults = { businessName: "Atelier Défauts", businessAddress: "Rue Défaut 1\n1000 Exemple", businessContact: "defaut@example.test", vatRegistered: true, vatId: "CHE-111.111.111 TVA" };
    expect((await artisan.request({ action: "defaults-save", defaults })).status).toBe(200);
    let detail = await steps.create();
    expect(detail.draft).toMatchObject({ vatRegistered: true, vatId: defaults.vatId, discountMode: "none" });
    const before = completeQuote(detail.draft!.reference, { ...defaults });
    detail = await steps.save(detail, before);
    const changed = { ...before, discountMode: "percent" as const, discount: "7.5", vatRegistered: false, vatId: "" };
    detail = await steps.save(detail, changed);

    expect((await steps.read(detail.id)).draft).toEqual(changed);
    expect((await steps.list()).defaults).toMatchObject({ vatRegistered: true, vatId: defaults.vatId });

    detail = await steps.undo(detail);
    expect(detail.draft).toEqual(before);
    expect((await steps.read(detail.id)).draft).toEqual(before);
    const secondUndo = await artisan.request({ action: "undo", id: detail.id, expectedVersion: detail.version, requestId: crypto.randomUUID() });
    expect(secondUndo.status).toBe(409);

    detail = await steps.save(detail, changed);
    detail = await steps.publish(detail);
    expect(detail.revisions[0].calculation).toMatchObject({ subtotal: 10000, discount: 750, net: 9250, vat: null, total: 9250 });
    expect((await steps.list()).defaults).toMatchObject({ vatRegistered: true, vatId: defaults.vatId, businessName: defaults.businessName });
  });
});
