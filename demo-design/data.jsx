// Shared data for BloomOulu prototype

const PLANTS = [
  {
    id: "puls-pat",
    accession: "OULU-1998-0421",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Pulsatilla_patens01%28js%29.jpg/800px-Pulsatilla_patens01%28js%29.jpg",
    name: "Pulsatilla patens",
    fi: "Hämeenkylmänkukka",
    sv: "Nipsippa",
    en: "Eastern Pasqueflower",
    family: "Ranunculaceae",
    rarity: "CR",
    rarityLabel: "Critically Endangered",
    origin: "Häme, southern Finland",
    habitat: "Dry esker pine forests",
    color: "#2D5440",
    accent: "#E8EEDE",
    variant: 0,
    adopters: 47,
    funded: 86,
    target: 100,
    story: "Once common on Finland's sandy eskers, the pasqueflower has retreated to a handful of protected sites. Oulu propagated 230 seedlings under LIFE+ ESCAPE.",
    bloom: "April – May",
    accessed: "Collected 1998, Hämeenlinna pop.",
    audio: "1:42",
    quickFacts: [
      ["Origin", "Häme esker"],
      ["Bloom", "Apr – May"],
      ["Red List", "CR (2019)"],
      ["Ex-situ since", "1998"]
    ]
  },
  {
    id: "camp-uni",
    accession: "OULU-2014-0033",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Campanula_uniflora_upernavik_2007-07-11_1.jpg/800px-Campanula_uniflora_upernavik_2007-07-11_1.jpg",
    name: "Campanula uniflora",
    fi: "Pohjankello",
    sv: "Höga klockor",
    en: "Arctic Harebell",
    family: "Campanulaceae",
    rarity: "VU",
    rarityLabel: "Vulnerable",
    origin: "Kilpisjärvi fells",
    habitat: "Calcareous fell slopes",
    color: "#3D6A52",
    accent: "#D6EBE3",
    variant: 2,
    adopters: 22,
    funded: 53,
    target: 75,
    story: "A tiny azure bell that flowers for three weeks above the tree line. Sensitive to reindeer overgrazing and warming summers.",
    bloom: "July",
    accessed: "Collected 2014, Saana fell",
    audio: "1:15",
    quickFacts: [
      ["Origin", "Kilpisjärvi"],
      ["Bloom", "July"],
      ["Red List", "VU"],
      ["Habitat", "Fell slope"]
    ]
  },
  {
    id: "saxi-hirc",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Skaftafell_-_Gelbe_Bl%C3%BCten.jpg/800px-Skaftafell_-_Gelbe_Bl%C3%BCten.jpg",
    accession: "OULU-2009-0117",
    name: "Saxifraga hirculus",
    fi: "Lettorikko",
    sv: "Myrbräcka",
    en: "Marsh Saxifrage",
    family: "Saxifragaceae",
    rarity: "EN",
    rarityLabel: "Endangered",
    origin: "Pohjois-Pohjanmaa mires",
    habitat: "Rich fens",
    color: "#C9A14A",
    accent: "#F1E6CB",
    variant: 7,
    adopters: 31,
    funded: 71,
    target: 90,
    story: "A buttery yellow saxifrage of intact rich fens, indicator species for healthy mires. Oulu maintains 5 source populations ex situ.",
    bloom: "August",
    accessed: "Collected 2009, Pudasjärvi mire",
    audio: "2:08",
    quickFacts: [
      ["Origin", "Pudasjärvi"],
      ["Bloom", "August"],
      ["Red List", "EN"],
      ["Habitat", "Rich fen"]
    ]
  },
  {
    id: "prim-nut",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Primula_nutans_Simo%2C_Finland_03.06.2013.jpg/800px-Primula_nutans_Simo%2C_Finland_03.06.2013.jpg",
    accession: "OULU-2002-0288",
    name: "Primula nutans",
    fi: "Ruijanesikko",
    sv: "Strandviva",
    en: "Finnmark Primrose",
    family: "Primulaceae",
    rarity: "EN",
    rarityLabel: "Endangered",
    origin: "Bothnian Bay coast",
    habitat: "Coastal meadows",
    color: "#B25C3A",
    accent: "#F0DCD0",
    variant: 6,
    adopters: 64,
    funded: 92,
    target: 100,
    story: "A pink coastal primrose tightly bound to the rising shores of the Bothnian Bay - a uniquely Finnish post-glacial story.",
    bloom: "June – July",
    accessed: "Collected 2002, Hailuoto",
    audio: "1:58",
    quickFacts: [
      ["Origin", "Hailuoto"],
      ["Bloom", "Jun – Jul"],
      ["Red List", "EN"],
      ["Habitat", "Sea meadow"]
    ]
  },
  {
    id: "trol-eur",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/2/29/Trollius_europaeus_flower_-_Keila.jpg/800px-Trollius_europaeus_flower_-_Keila.jpg",
    accession: "OULU-1987-0044",
    name: "Trollius europaeus",
    fi: "Kullero",
    sv: "Smörboll",
    en: "Globeflower",
    family: "Ranunculaceae",
    rarity: "NT",
    rarityLabel: "Near Threatened",
    origin: "North Karelia meadows",
    habitat: "Damp meadows",
    color: "#C9A14A",
    accent: "#F1E6CB",
    variant: 7,
    adopters: 89,
    funded: 100,
    target: 100,
    story: "A signature meadow species declining with the loss of traditional pasture management. Sponsorship funds restoration partnerships.",
    bloom: "June",
    accessed: "Collected 1987, Lieksa",
    audio: "1:24",
    quickFacts: [
      ["Origin", "Lieksa"],
      ["Bloom", "June"],
      ["Red List", "NT"],
      ["Habitat", "Wet meadow"]
    ]
  },
  {
    id: "cyp-cal",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Cypripedium_calceolus_wiki_mg-k01.jpg/800px-Cypripedium_calceolus_wiki_mg-k01.jpg",
    accession: "OULU-1995-0009",
    name: "Cypripedium calceolus",
    fi: "Tikankontti",
    sv: "Guckusko",
    en: "Lady's-slipper Orchid",
    family: "Orchidaceae",
    rarity: "VU",
    rarityLabel: "Vulnerable",
    origin: "Kuusamo limestone",
    habitat: "Calcareous boreal forest",
    color: "#B25C3A",
    accent: "#F0DCD0",
    variant: 4,
    adopters: 152,
    funded: 100,
    target: 100,
    story: "Europe's most iconic temperate orchid. Slow-growing - a single rhizome can live a century. Strictly protected; propagation is exacting.",
    bloom: "Late May – June",
    accessed: "Collected 1995, Kuusamo",
    audio: "2:34",
    quickFacts: [
      ["Origin", "Kuusamo"],
      ["Bloom", "May – Jun"],
      ["Red List", "VU"],
      ["Habitat", "Limestone forest"]
    ]
  },
  {
    id: "lob-pul",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Lobaria_pulmonaria_010108c.jpg/800px-Lobaria_pulmonaria_010108c.jpg",
    accession: "OULU-2017-0204",
    name: "Lobaria pulmonaria",
    fi: "Raidankeuhkojäkälä",
    sv: "Lunglav",
    en: "Tree Lungwort",
    family: "Lobariaceae",
    rarity: "NT",
    rarityLabel: "Near Threatened",
    origin: "Old-growth forests",
    habitat: "Bark of old aspens",
    color: "#3D6A52",
    accent: "#E8EEDE",
    variant: 5,
    adopters: 12,
    funded: 28,
    target: 60,
    story: "A leafy lichen and an indicator species - its presence signals ancient, undisturbed forest. Sensitive to logging and air pollution.",
    bloom: "n/a (lichen)",
    accessed: "Collected 2017, Syöte NP",
    audio: "1:50",
    quickFacts: [
      ["Origin", "Syöte"],
      ["Bloom", "-"],
      ["Red List", "NT"],
      ["Habitat", "Aspen bark"]
    ]
  },
  {
    id: "vict-am",
    image: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Victoria_amazonica_edit_1.jpg/800px-Victoria_amazonica_edit_1.jpg",
    accession: "OULU-1972-0001",
    name: "Victoria amazonica",
    fi: "Amazonin jättivesilumme",
    sv: "Amazonjättenäckros",
    en: "Giant Water Lily",
    family: "Nymphaeaceae",
    rarity: "NA",
    rarityLabel: "Greenhouse Star",
    origin: "Amazon basin (cultivated since 1972)",
    habitat: "Romeo & Julia pond",
    color: "#5FB0A0",
    accent: "#D6EBE3",
    variant: 3,
    adopters: 312,
    funded: 100,
    target: 100,
    story: "The most photographed plant in the Romeo greenhouse. Leaves reach 2.5 m; can support 30 kg. Night blooms turn from white to pink.",
    bloom: "August evenings",
    accessed: "Cultivated since 1972",
    audio: "3:12",
    quickFacts: [
      ["Origin", "Amazon"],
      ["Bloom", "Aug nights"],
      ["Status", "Greenhouse"],
      ["Leaf span", "2.5 m"]
    ]
  }
];

const TIERS = [
  {
    id: "seed",
    name: "Seed",
    fi: "Siemen",
    price: 25,
    monthly: 5,
    tag: "Most popular gift",
    blurb: "A starter gesture. Digital certificate, name on the adopter wall, and a thank-you from a real gardener.",
    perks: [
      "PDF certificate (instant)",
      "Add to Wallet",
      "Name on adopter wall",
      "Gardener thank-you note"
    ],
    color: "#A8C060",
    bg: "#E8EEDE"
  },
  {
    id: "common",
    name: "Common",
    fi: "Yleinen",
    price: 75,
    monthly: 7,
    tag: "Best value",
    blurb: "Named plant page for a year, two greenhouse passes, and a 10% shop voucher.",
    perks: [
      "All of Seed",
      "Named plant page (12 months)",
      "2× greenhouse passes",
      "10% gift-shop voucher"
    ],
    color: "#88A050",
    bg: "#DDE6CB"
  },
  {
    id: "vulnerable",
    name: "Vulnerable",
    fi: "Vaarantunut",
    price: 180,
    monthly: 15,
    tag: "Adopters' Day invite",
    blurb: "Funds an actively threatened species. Includes our annual Adopters' Day and first-bloom alerts.",
    perks: [
      "All of Common",
      "Printed certificate (mailed)",
      "Annual Adopters' Day invite",
      "First-bloom alerts",
      "Rotating name on QR page"
    ],
    color: "#5FB0A0",
    bg: "#D6EBE3"
  },
  {
    id: "critical",
    name: "Critically Endangered",
    fi: "Erittäin uhanalainen",
    price: 500,
    monthly: 40,
    tag: "Engraved plaque",
    blurb: "Two-year stewardship of one of Finland's most threatened plants, with a real plaque next to the specimen.",
    perks: [
      "All of Vulnerable",
      "Engraved plaque (2 years)",
      "Behind-the-scenes tour (2 guests)",
      "Annual Report listing",
      "Signed letter from the Director"
    ],
    color: "#1F3C2D",
    bg: "#CFD9D0"
  }
];

const CORPORATE_TIERS = [
  { name: "Bronze", price: 2500, color: "#B25C3A", perks: ["Logo on sponsor wall", "Plant page mention", "CSR/ESG quarterly report"] },
  { name: "Silver", price: 7500, color: "#5FB0A0", perks: ["All of Bronze", "Quarterly impact report", "Employee group tour (×1)", "Marketing badge rights"] },
  { name: "Gold", price: 20000, color: "#1F3C2D", perks: ["All of Silver", "Lobby plaque", "Named species partnership", "Annual report co-branding", "Custom event in Romeo & Julia"] }
];

const ASK_CITATIONS = [
  { id: "c1", source: "Annales Botanici Fennici", year: 2019, title: "Distribution patterns of Pulsatilla patens in Häme eskers", page: "56(1–3): 41–58" },
  { id: "c2", source: "LIFE+ ESCAPE Final Report", year: 2017, title: "Ex-situ conservation of Finnish native plant species", page: "Section 4.2" },
  { id: "c3", source: "Oulu Accession DB", year: 2024, title: "Accession OULU-1998-0421", page: "Pulsatilla patens, Hämeenlinna source pop." },
  { id: "c4", source: "Red List of Finnish Species", year: 2019, title: "Vascular plants - threat category assessment", page: "p. 217" },
  { id: "c5", source: "Memoranda Soc. F. F. Fennica", year: 2021, title: "Saxifraga hirculus indicator value in boreal fens", page: "97: 33–47" }
];

const TRENDING_QUESTIONS = [
  "What is blooming in the Romeo greenhouse this week?",
  "Which plants here are Critically Endangered in Finland?",
  "Can I see the Victoria water lily bloom this weekend?",
  "Where can I find the Lady's-slipper Orchid in the garden?",
  "Tell me about the LIFE+ ESCAPE seed bank project."
];

Object.assign(window, { PLANTS, TIERS, CORPORATE_TIERS, ASK_CITATIONS, TRENDING_QUESTIONS });
