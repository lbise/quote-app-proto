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

const factsStart = header("CT-FAITS-001");
const factsLine = line("expected-facts", "", "Pose de ruban d’étanchéité", "quantity", "12.75", "m", "6.80", "");

const correctionStart = quote("CT-CORRECTION-001", [], [
  line("existing-hinges", "", "Remplacement de charnières de l’orangerie", "quantity", "5", "pièce", "34.25", ""),
  line("existing-glazing", "", "Protection des vitrages", "fixed", "", "", "", "63.20"),
]);
const correctedLine = { ...correctionStart.lines[0]!, quantity: "8" };

const copyStart = quote("CT-COPIE-001", [], [
  line("existing-seals", "", "Pose de joints souples sur les ouvrants", "quantity", "4", "m", "29.50", ""),
  line("existing-cover", "", "Protection du mobilier", "fixed", "", "", "", "41.00"),
]);
const copiedLine = { ...copyStart.lines[0]!, id: "expected-seals-copy", quantity: "" };

const mixedStart = header("CT-LOTS-001");
const mixedSections = [{ id: "expected-atelier", title: "Atelier" }, { id: "expected-reserve", title: "Réserve" }];
const mixedLines = [
  line("expected-mixed-1", "expected-atelier", "Housse sur mesure, repère 2,40 m par 1,80 m", "fixed", "", "", "", "214.60"),
  line("expected-mixed-2", "expected-atelier", "Remplacement de crémones", "quantity", "3", "pièce", "27.30", ""),
  line("expected-mixed-3", "expected-atelier", "Pose de joint souple", "quantity", "8.25", "m", "9.60", ""),
  line("expected-mixed-4", "expected-atelier", "Pose de butées", "quantity", "4", "pièce", "11.70", ""),
  line("expected-mixed-5", "expected-reserve", "Remplacement de crémones", "quantity", "2", "pièce", "27.30", ""),
  line("expected-mixed-6", "expected-reserve", "Pose de joint souple", "quantity", "5.5", "m", "9.60", ""),
  line("expected-mixed-7", "expected-reserve", "Protection du rayonnage, démontage compris", "fixed", "", "", "", "184.20"),
  line("expected-mixed-8", "expected-reserve", "Pose de butées", "quantity", "6", "pièce", "11.70", ""),
];
const mixedAssertions: Assertion[] = [
  equals("two sections", "quote.sections.length", 2),
  oneOf("Atelier first", "quote.sections[0].title", ["Atelier", "atelier", "Local Atelier", "Local atelier"]),
  oneOf("Réserve second", "quote.sections[1].title", ["Réserve", "réserve", "Local Réserve", "Local réserve"]),
  equals("all eight lines, without duplicates", "quote.lines.length", 8),
  ...mixedLines.flatMap((item, index) => [
    ...(["mode", "quantity", "unitPrice", "amount"] as const).map(field => equals(`line ${index + 1} ${field}`, `quote.lines[${index}].${field}`, item[field])),
    oneOf(`line ${index + 1} unit`, `quote.lines[${index}].unit`, item.unit === "pièce" ? ["pièce", "pièces", "pce", "unité", "unités"] : item.unit === "m" ? ["m", "mètre", "mètres"] : [""]),
    equals(`line ${index + 1} section`, `quote.lines[${index}].sectionId`, index < 4 ? 0 : 1),
  ]),
  ...protectedHeaders.map(unchanged),
];

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
    "contract-multi-paragraph-facts",
    "Faits fictifs répartis dans deux paragraphes",
    factsStart,
    quote(factsStart.reference, [], [factsLine]),
    "Pour l’orangerie fictive, note une ligne de pose de ruban d’étanchéité. La longueur mesurée est de 12,75 m.\n\nLe tarif convenu pour cette pose est de 6,80 CHF par mètre. Ne modifie rien d’autre.",
    commercialLineAssertions(factsLine, -1, ["m", "mètre", "mètres"]),
    ["Vérifier que la prose française relie fidèlement la pose, la longueur et le tarif fournis dans des paragraphes distincts."],
  ),
  contractScenario(
    "contract-targeted-correction",
    "Correction ciblée d’une quantité fictive",
    correctionStart,
    quote(correctionStart.reference, [], [correctedLine, correctionStart.lines[1]!]),
    "Sur la ligne de remplacement des charnières de l’orangerie, corrige seulement la quantité : 8 pièces au lieu de 5. Le prix reste à 34,25 CHF par pièce. Ne touche pas à la protection des vitrages ni aux autres champs du devis.",
    [
      equals("no extra sections", "quote.sections.length", 0),
      equals("both lines retained", "quote.lines.length", 2),
      equals("corrected quantity", "quote.lines[0].quantity", "8"),
      equals("corrected pricing mode", "quote.lines[0].mode", "quantity"),
      oneOf("corrected unit", "quote.lines[0].unit", ["pièce", "pièces", "pce", "unité", "unités"]),
      equals("unit price retained", "quote.lines[0].unitPrice", "34.25"),
      equals("no fixed amount on quantity line", "quote.lines[0].amount", ""),
      equals("corrected line stays unsectioned", "quote.lines[0].sectionId", -1),
      equals("corrected line amount", "calculation.lines[0].amount", 27400),
      equals("independent total", "calculation.total", 33720),
      unchanged("quote.lines[1]"),
      ...protectedHeaders.map(unchanged),
    ],
    ["Vérifier que le descriptif français des charnières reste fidèle et que la protection des vitrages est intacte."],
  ),
  contractScenario(
    "contract-copy-unknown-quantity",
    "Copie fictive avec nouvelle quantité inconnue",
    copyStart,
    quote(copyStart.reference, [], [copyStart.lines[0]!, copiedLine, copyStart.lines[1]!]),
    "Copie la ligne de pose de joints souples sur les ouvrants juste après l’originale. Pour cette nouvelle intervention, la longueur n’est pas encore mesurée : laisse sa quantité inconnue, mais conserve le tarif de 29,50 CHF par mètre. Garde l’originale et la protection du mobilier inchangés.",
    [
      equals("no sections added", "quote.sections.length", 0),
      equals("one copy, no extra work", "quote.lines.length", 3),
      unchanged("quote.lines[0]"),
      equals("copy stays unsectioned", "quote.lines[1].sectionId", -1),
      equals("copy uses unit pricing", "quote.lines[1].mode", "quantity"),
      equals("new quantity unknown", "quote.lines[1].quantity", ""),
      oneOf("copy unit retained", "quote.lines[1].unit", ["m", "mètre", "mètres"]),
      equals("copy unit price retained", "quote.lines[1].unitPrice", "29.50"),
      equals("copy has no fixed amount", "quote.lines[1].amount", ""),
      equals("copy cannot be priced yet", "calculation.lines[1].amount", null),
      equals("known work subtotal", "calculation.subtotal", 15900),
      equals("total waits for the new measurement", "calculation.total", null),
      equals("quantity remains required", "calculation.missing", [{ path: "lines[1].quantity", code: "required" }]),
      equals("draft remains incomplete", "calculation.complete", false),
      equals("unrelated line preserved after copy", "quote.lines[2]", {
        sectionId: -1, description: "Protection du mobilier", mode: "fixed",
        quantity: "", unit: "", unitPrice: "", amount: "41",
      }),
      ...protectedHeaders.map(unchanged),
    ],
    ["Vérifier que la description française de la copie reste fidèle à la pose de joints, sans longueur inventée."],
  ),
  contractScenario(
    "contract-mixed-batches",
    "Deux rubriques, tarifs communs et forfaits composites",
    mixedStart,
    quote(mixedStart.reference, mixedSections, mixedLines),
    "Prépare le détail pour l’Atelier puis la Réserve, avec une rubrique pour chacun.\n\nTarifs communs aux deux locaux : remplacement des crémones à 27,30 CHF pièce, pose de joint souple à 9,60 CHF par mètre et pose de butées à 11,70 CHF pièce.\n\nDans l’Atelier, commence par une housse sur mesure à 214,60 CHF au forfait. Ensuite, dans cet ordre : 3 crémones, 8,25 m de joint souple et 4 butées.\n\nPour la housse de l’Atelier, conserve les cotes 2,40 m par 1,80 m dans le descriptif. Ce sont des repères techniques du forfait, pas des quantités à multiplier.\n\nDans la Réserve, prévois dans cet ordre : 2 crémones, 5,5 m de joint souple, une protection du rayonnage à 184,20 CHF au forfait, puis 6 butées. Le démontage de la protection est compris dans ce forfait. Ne change rien aux en-têtes du devis.",
    mixedAssertions,
    ["Vérifier les huit descriptions françaises fidèles, les deux rubriques et leur ordre, les cotes conservées dans le forfait de la housse et le démontage inclus sans prestation ajoutée."],
  ),
];
