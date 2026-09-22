import type { QuoteData, QuoteLine } from "../app/lib/quote";
import type { Assertion, Scenario } from "./types";

const review: Scenario["review"] = {
  inputs: "pending",
  expectations: "pending",
  provider: "blocked",
  note: "Fictional contract fixture. It is eligible for a separately approved live run, never sent by default.",
};

const header = (reference: string): QuoteData => ({
  reference,
  title: "Entretien fictif de verrière",
  customerName: "Maison des Aulnes SA",
  customerAddress: "Chemin du Liseron 4\n1000 Luneval",
  customerContact: "",
  businessName: "Atelier des Brumes Sàrl",
  businessAddress: "Rue des Étoiles 11\n1000 Luneval",
  businessContact: "bonjour@brumes.example.test",
  vatId: "",
  issueDate: "2026-11-02",
  validUntil: "2026-12-02",
  siteAddress: "Orangerie des Aulnes, Luneval",
  terms: "",
  vatRegistered: false,
  discountMode: "none",
  discount: "0",
  sections: [],
  lines: [],
});

function quote(reference: string, sections: QuoteData["sections"], lines: QuoteData["lines"]): QuoteData {
  return { ...header(reference), sections, lines };
}

function line(id: string, sectionId: string, description: string, mode: QuoteLine["mode"], quantity: string, unit: string, unitPrice: string, amount: string): QuoteLine {
  return { id, sectionId, description, mode, quantity, unit, unitPrice, amount };
}

function equals(label: string, path: string, expected: unknown, category: Assertion["category"] = "commercial"): Assertion {
  return { label, path, operator: "equals", expected, category };
}

function oneOf(label: string, path: string, expected: readonly unknown[]): Assertion {
  return { label, path, operator: "oneOf", expected: [...expected], category: "commercial" };
}

function unchanged(path: string): Assertion {
  return { label: `header preserved: ${path}`, path, operator: "unchanged", category: "commercial" };
}

const protectedHeaders = [
  "quote.reference", "quote.title", "quote.customerName", "quote.customerAddress", "quote.customerContact",
  "quote.businessName", "quote.businessAddress", "quote.businessContact", "quote.vatId", "quote.issueDate",
  "quote.validUntil", "quote.siteAddress", "quote.terms", "quote.vatRegistered", "quote.discountMode", "quote.discount",
];

function commercialLineAssertions(expected: QuoteLine, sectionIndex = -1, unitEquivalents?: readonly string[]): Assertion[] {
  return [
    equals("section count", "quote.sections.length", sectionIndex < 0 ? 0 : 1),
    equals("one priced line", "quote.lines.length", 1),
    equals("pricing mode", "quote.lines[0].mode", expected.mode),
    equals("quantity", "quote.lines[0].quantity", expected.quantity),
    ...(unitEquivalents ? [oneOf("equivalent unit", "quote.lines[0].unit", unitEquivalents)] : [equals("unit", "quote.lines[0].unit", expected.unit)]),
    equals("unit price", "quote.lines[0].unitPrice", expected.unitPrice),
    equals("fixed amount", "quote.lines[0].amount", expected.amount),
    equals("section membership", "quote.lines[0].sectionId", sectionIndex),
    ...protectedHeaders.map(unchanged),
  ];
}

function contractScenario(id: string, title: string, startingQuote: QuoteData, expectedQuote: QuoteData, text: string, assertions: Assertion[], humanReview: string[]): Scenario {
  return {
    id,
    version: 1,
    suite: "contract",
    title,
    profession: "joinery",
    locale: "fr",
    provenance: {
      kind: "synthetic-contract",
      alias: "fictional-contract-fixture",
      notes: [
        "Entirely fictional French working-draft fixture; it does not represent an Artisan, Customer or actual project.",
        "It checks the accepted tool contract through the real HTTP and PostgreSQL evaluation seam."
      ],
    },
    review,
    startingQuote,
    history: [],
    steps: [{ kind: "artisan", text, assertions: [
      ...assertions,
      equals("contract turn committed", "outcome", "committed", "contract"),
      equals("contract has no failed calls", "failedCalls", 0, "contract"),
    ] }],
    expectedQuote,
    requiredClarification: [],
    forbiddenMutations: protectedHeaders,
    humanReview,
  };
}

const fixedStart = header("CT-FIXE-001");
const fixedLine = line("expected-fixed", "", "Réglage final des volets de la verrière", "fixed", "", "", "", "486.50");

const quantityStart = header("CT-QUANTITE-001");
const quantityLine = line("expected-quantity", "", "Remplacement de poignées de lucarne", "quantity", "7", "pièce", "18.40", "");

const sectionStart = header("CT-SECTION-001");
const expectedSectionId = "expected-galerie-nord";
const sectionLine = line("expected-section-line", expectedSectionId, "Protection temporaire du sol", "fixed", "", "", "", "92.00");

const splitStart = header("CT-PREUVE-001");
const splitLine = line("expected-split", "", "Pose de ruban d’étanchéité", "quantity", "12.75", "m", "6.80", "");

export const contractScenarios: Scenario[] = [
  contractScenario(
    "contract-fixed-line",
    "Forfait unique fictif",
    fixedStart,
    quote(fixedStart.reference, [], [fixedLine]),
    "Pour le pavillon imaginaire de Luneval, ajoute un forfait unique de 486,50 CHF pour le réglage final des volets de la verrière. Ne modifie rien d’autre.",
    commercialLineAssertions(fixedLine),
    ["Vérifier qu’une formulation française fidèle du réglage des volets a été conservée, sans engagement ajouté."],
  ),
  contractScenario(
    "contract-quantity-line",
    "Quantité et prix unitaire fictifs",
    quantityStart,
    quote(quantityStart.reference, [], [quantityLine]),
    "Ajoute une seule ligne pour le remplacement de poignées de lucarne : 7 pièces à 18,40 CHF l’unité. Ne modifie rien d’autre.",
    commercialLineAssertions(quantityLine, -1, ["pièce", "pièces", "pce", "unité", "unités"]),
    ["Vérifier que la description française reste fidèle au remplacement de poignées et que les mesures ont été comprises sans ajout."],
  ),
  contractScenario(
    "contract-section-assignment",
    "Rubrique puis affectation fictive",
    sectionStart,
    quote(sectionStart.reference, [{ id: expectedSectionId, title: "Galerie nord" }], [sectionLine]),
    "Crée la rubrique « Galerie nord », puis place-y une ligne forfaitaire de 92,00 CHF pour la protection temporaire du sol. Ne modifie rien d’autre.",
    [
      equals("section title", "quote.sections[0].title", "Galerie nord"),
      ...commercialLineAssertions(sectionLine, 0),
    ],
    ["Vérifier que le titre de rubrique et la description française restent fidèles aux faits fictifs fournis."],
  ),
  contractScenario(
    "contract-split-evidence",
    "Preuves réparties dans deux paragraphes",
    splitStart,
    quote(splitStart.reference, [], [splitLine]),
    "Pour l’orangerie fictive, note une ligne de pose de ruban d’étanchéité. La longueur mesurée est de 12,75 m.\n\nLe tarif convenu pour cette pose est de 6,80 CHF par mètre. Ne modifie rien d’autre.",
    commercialLineAssertions(splitLine, -1, ["m", "mètre", "mètres"]),
    ["Vérifier que la prose française relie fidèlement la pose, la longueur et le tarif pourtant fournis dans des paragraphes distincts."],
  ),
];
