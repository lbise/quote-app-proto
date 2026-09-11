export type QuoteLine = {
  id: string;
  sectionId: string;
  description: string;
  mode: "quantity" | "fixed";
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
};

export type QuoteSection = {
  id: string;
  title: string;
};

export type QuoteData = {
  reference: string;
  title: string;
  customerName: string;
  customerAddress: string;
  businessName: string;
  businessAddress: string;
  businessContact: string;
  vatId: string;
  issueDate: string;
  validUntil: string;
  siteAddress: string;
  terms: string;
  vatRegistered: boolean;
  discountMode: "none" | "percent" | "fixed";
  discount: string;
  sections: QuoteSection[];
  lines: QuoteLine[];
};

const quantityLine = (
  id: string,
  sectionId: string,
  description: string,
  quantity: string,
  unit: string,
  unitPrice: string,
  amount: string,
): QuoteLine => ({
  id,
  sectionId,
  description,
  mode: "quantity",
  quantity,
  unit,
  unitPrice,
  amount,
});

const fixedLine = (
  id: string,
  sectionId: string,
  description: string,
  amount: string,
): QuoteLine => ({
  id,
  sectionId,
  description,
  mode: "fixed",
  quantity: "",
  unit: "",
  unitPrice: "",
  amount,
});

export function makeJoineryQuote(): QuoteData {
  const sections = [
    { id: "joinery-kitchen", title: "Cuisine" },
    { id: "joinery-entry", title: "Entrée" },
    { id: "joinery-living", title: "Séjour" },
    { id: "joinery-main-bedroom", title: "Chambre principale" },
    { id: "joinery-child-bedroom", title: "Chambre enfant" },
    { id: "joinery-bathroom", title: "Salle de bains" },
    { id: "joinery-laundry", title: "Buanderie" },
  ];

  return {
    reference: "DQ-2026-014",
    title: "Agencements intérieurs sur mesure",
    customerName: "Camille Morel",
    customerAddress: "Chemin des Tilleuls 14\n1024 Rivaz",
    businessName: "Atelier du Fil Sàrl",
    businessAddress: "Route de la Menuiserie 6\n1027 Saint-Saphorin",
    businessContact: "bonjour@atelier-du-fil.example\n021 555 01 14",
    vatId: "CHE-123.456.789 TVA",
    issueDate: "2026-09-18",
    validUntil: "2026-10-18",
    siteAddress: "Chemin des Tilleuls 14\n1024 Rivaz",
    terms:
      "Prix en CHF, TVA comprise. Les dimensions seront relevées sur place avant lancement en fabrication. Toute modification après validation peut faire l'objet d'un ajustement de prix et de délai.",
    vatRegistered: true,
    discountMode: "percent",
    discount: "5",
    sections,
    lines: [
      fixedLine(
        "joinery-01",
        "joinery-kitchen",
        "Relevé final, protection des sols et installation de chantier.",
        "650.00",
      ),
      fixedLine(
        "joinery-02",
        "joinery-kitchen",
        "Meuble bas sur mesure en mélaminé chêne naturel, L 3 180 mm, P 600 mm, H 720 mm, avec caissons, plinthes noires et réglage des façades.",
        "4800.00",
      ),
      quantityLine(
        "joinery-03",
        "joinery-kitchen",
        "Plan de travail stratifié compact noir, chants finis et découpes pour évier et plaque de cuisson.",
        "4.800",
        "m",
        "610.00",
        "2928.00",
      ),
      quantityLine(
        "joinery-04",
        "joinery-kitchen",
        "Façade battante en MDF laqué mat, perçages et charnières amorties compris.",
        "6.000",
        "pce",
        "385.00",
        "2310.00",
      ),
      fixedLine(
        "joinery-05",
        "joinery-kitchen",
        "Colonne pour fours, L 600 mm, P 600 mm, H 2 280 mm, avec deux niches ventilées et panneaux de finition latéraux.",
        "2450.00",
      ),
      fixedLine(
        "joinery-06",
        "joinery-entry",
        "Vestiaire d'entrée en mélaminé blanc cassé, L 1 850 mm, P 420 mm, H 2 360 mm, comprenant penderie, casier à chaussures et portes sans poignée.",
        "3600.00",
      ),
      quantityLine(
        "joinery-07",
        "joinery-entry",
        "Banc en chêne massif huilé, épaisseur 30 mm, fixé sur support invisible.",
        "3.600",
        "m",
        "420.00",
        "1512.00",
      ),
      quantityLine(
        "joinery-08",
        "joinery-entry",
        "Patère murale en acier thermolaqué noir, pose comprise.",
        "8.000",
        "pce",
        "48.00",
        "384.00",
      ),
      fixedLine(
        "joinery-09",
        "joinery-entry",
        "Miroir sur panneau chêne, L 900 mm, H 1 600 mm, avec réservation pour applique existante.",
        "780.00",
      ),
      fixedLine(
        "joinery-10",
        "joinery-living",
        "Bibliothèque toute hauteur en placage chêne, L 3 400 mm, P 320 mm, H 2 540 mm, avec montants, étagères réglables et deux modules fermés en partie basse.",
        "6250.00",
      ),
      quantityLine(
        "joinery-11",
        "joinery-living",
        "Tablette en chêne massif huilé, épaisseur 30 mm, pose sur équerres invisibles.",
        "3.200",
        "m",
        "285.00",
        "912.00",
      ),
      quantityLine(
        "joinery-12",
        "joinery-living",
        "Spot LED encastré 3 W, alimentation et raccordement dans mobilier compris.",
        "12.000",
        "pce",
        "68.00",
        "816.00",
      ),
      fixedLine(
        "joinery-13",
        "joinery-living",
        "Meuble TV suspendu, L 2 400 mm, P 420 mm, H 380 mm, avec trois abattants, passe-câbles et fond technique ventilé.",
        "3100.00",
      ),
      fixedLine(
        "joinery-14",
        "joinery-main-bedroom",
        "Dressing sur mesure en mélaminé lin, L 3 600 mm, P 600 mm, H 2 400 mm, avec portes coulissantes, penderies doubles, étagères et éclairage intégré.",
        "7400.00",
      ),
      quantityLine(
        "joinery-15",
        "joinery-main-bedroom",
        "Rail aluminium pour porte coulissante, avec amortisseurs et caches de finition.",
        "5.400",
        "m",
        "96.00",
        "518.40",
      ),
      quantityLine(
        "joinery-16",
        "joinery-main-bedroom",
        "Tiroir intérieur à sortie totale, façade mélaminée et amortissement compris.",
        "10.000",
        "pce",
        "145.00",
        "1450.00",
      ),
      fixedLine(
        "joinery-17",
        "joinery-main-bedroom",
        "Tête de lit en panneaux chêne, L 2 800 mm, H 1 120 mm, avec deux tablettes suspendues et passages de câbles.",
        "1650.00",
      ),
      fixedLine(
        "joinery-18",
        "joinery-child-bedroom",
        "Placard sous rampant en mélaminé blanc, L 2 700 mm, P 550 mm, hauteur variable de 1 050 à 2 260 mm, avec portes battantes et plinthes découpées.",
        "4250.00",
      ),
      quantityLine(
        "joinery-19",
        "joinery-child-bedroom",
        "Tringle penderie ovale aluminium, supports et coupes à dimension compris.",
        "3.000",
        "m",
        "88.00",
        "264.00",
      ),
      quantityLine(
        "joinery-20",
        "joinery-child-bedroom",
        "Bac de rangement coulissant en contreplaqué bouleau verni.",
        "6.000",
        "pce",
        "125.00",
        "750.00",
      ),
      fixedLine(
        "joinery-21",
        "joinery-child-bedroom",
        "Bureau sur mesure en stratifié blanc, L 1 600 mm, P 650 mm, avec caisson à trois tiroirs et joue de soutien.",
        "1850.00",
      ),
      fixedLine(
        "joinery-22",
        "joinery-bathroom",
        "Meuble sous vasque hydrofuge, L 1 200 mm, P 500 mm, H 520 mm, avec deux grands tiroirs, découpes de siphons et poignées fraisées.",
        "3480.00",
      ),
      quantityLine(
        "joinery-23",
        "joinery-bathroom",
        "Façade en stratifié compact beige, chants étanches et perçages compris.",
        "2.000",
        "pce",
        "455.00",
        "910.00",
      ),
      quantityLine(
        "joinery-24",
        "joinery-bathroom",
        "Tablette murale en chêne verni mat, épaisseur 30 mm, pose comprise.",
        "2.400",
        "m",
        "325.00",
        "780.00",
      ),
      fixedLine(
        "joinery-25",
        "joinery-bathroom",
        "Habillage démontable de gaine technique, L 740 mm, P 220 mm, H 2 300 mm, avec trappe d'accès et joints souples contre carrelage.",
        "1200.00",
      ),
      fixedLine(
        "joinery-26",
        "joinery-laundry",
        "Meuble bas de buanderie en mélaminé gris clair, L 2 100 mm, P 650 mm, H 900 mm, avec réservation pour lave-linge et sèche-linge.",
        "2980.00",
      ),
      quantityLine(
        "joinery-27",
        "joinery-laundry",
        "Plan de pliage stratifié compact, chants finis et découpe autour des arrivées d'eau.",
        "3.600",
        "m",
        "390.00",
        "1404.00",
      ),
      quantityLine(
        "joinery-28",
        "joinery-laundry",
        "Façade battante en mélaminé gris clair, charnières amorties comprises.",
        "4.000",
        "pce",
        "340.00",
        "1360.00",
      ),
      fixedLine(
        "joinery-29",
        "joinery-laundry",
        "Niche technique amovible, L 600 mm, P 300 mm, H 1 800 mm, pour collecteurs et compteur, avec portes affleurantes.",
        "980.00",
      ),
      fixedLine(
        "joinery-30",
        "joinery-laundry",
        "Ajustage final, joints, caches latéraux et nettoyage des agencements posés.",
        "780.00",
      ),
    ],
  };
}

export function makeFlatQuote(): QuoteData {
  const sectionId = "";

  return {
    reference: "EX-2026-091",
    title: "Aménagement extérieur. Exemple adapté",
    customerName: "Maison Exemple SA",
    customerAddress: "Rue Exemple 8\n1000 Exemple",
    businessName: "Jardin Exemple Sàrl",
    businessAddress: "Rue Exemple 1\n1000 Exemple",
    businessContact: "contact@example.test\n021 555 00 91",
    vatId: "CHE-000.000.000 TVA",
    issueDate: "2026-08-15",
    validUntil: "2026-09-14",
    siteAddress: "Rue Exemple 8\n1000 Exemple",
    terms: "",
    vatRegistered: true,
    discountMode: "none",
    discount: "0",
    sections: [],
    lines: [
      fixedLine("landscape-01", sectionId, "Installation de chantier", "200.00"),
      quantityLine("landscape-02", sectionId, "Dalle grès cérame", "66.000", "pce", "80.00", "5280.00"),
      quantityLine("landscape-03", sectionId, "Pose des dalles et réglage du lit de pose", "60.000", "m2", "30.00", "1800.00"),
      quantityLine("landscape-04", sectionId, "Natte géotextile", "180.000", "m2", "3.00", "540.00"),
      quantityLine("landscape-05", sectionId, "Piquet de fixation", "16.000", "pce", "7.00", "112.00"),
      quantityLine("landscape-06", sectionId, "Gravier 4/8", "3.000", "m3", "110.00", "330.00"),
      quantityLine("landscape-07", sectionId, "Grave", "10.000", "m3", "85.00", "850.00"),
      quantityLine("landscape-08", sectionId, "Balaste", "30.000", "m3", "85.00", "2550.00"),
      quantityLine("landscape-09", sectionId, "Heures de travail", "20.000", "h", "65.00", "1300.00"),
      quantityLine("landscape-10", sectionId, "Galets", "3.600", "m3", "120.00", "432.00"),
      quantityLine("landscape-11", sectionId, "Natte géotextile", "18.000", "m2", "3.00", "54.00"),
      quantityLine("landscape-12", sectionId, "Cortaderia selloana", "4.000", "pce", "23.50", "94.00"),
      quantityLine("landscape-13", sectionId, "Terre végétale", "5.000", "m3", "90.00", "450.00"),
      quantityLine("landscape-14", sectionId, "Heure de travail", "16.000", "h", "65.00", "1040.00"),
    ],
  };
}

export function makeEmptyQuote(): QuoteData {
  return {
    reference: "DQ-2026-015",
    title: "",
    customerName: "",
    customerAddress: "",
    businessName: "Atelier du Fil Sàrl",
    businessAddress: "Route de la Menuiserie 6\n1027 Saint-Saphorin",
    businessContact: "bonjour@atelier-du-fil.example\n021 555 01 14",
    vatId: "CHE-123.456.789 TVA",
    issueDate: "2026-09-18",
    validUntil: "",
    siteAddress: "",
    terms: "",
    vatRegistered: false,
    discountMode: "none",
    discount: "0",
    sections: [],
    lines: [],
  };
}
