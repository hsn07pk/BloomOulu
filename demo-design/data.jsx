// Shared data for BloomOulu prototype

const PLANTS = [
  {
    id: "puls-pat",
    accession: "OULU-1998-0421",
    image: "plants/pulsatilla-patens.jpg",
    name: "Pulsatilla patens",
    fi: "Kangasvuokko",
    sv: "Nipsippa",
    en: "Eastern Pasqueflower",
    family: "Ranunculaceae",
    rarity: "VU",
    rarityLabel: "Vulnerable",
    origin: "Häme, southern Finland",
    habitat: "Dry esker pine forests",
    biome: "Boreal heath / esker",
    bloomSeason: "spring",
    color: "#2D5440",
    accent: "#E8EEDE",
    variant: 0,
    adopters: 47,
    funded: 86,
    target: 100,
    story: "A purple-petaled survivor of Finland's sandy heaths. Vulnerable on the 2019 Red List; fire suppression has erased the open soil it needs to germinate. Oulu propagated 230 seedlings as part of the LIFE+ ESCAPE programme (LIFE11 BIO/FI/000917, 2012-2017), which collected 175 Finnish threatened taxa and banked 148 in long-term storage.",
    bloom: "April - May",
    accessed: "Collected 1998, Hämeenlinna pop.",
    audio: "0:32",
    transcript: {
      en: "Welcome to Pulsatilla patens, the Eastern pasqueflower. In Finnish, kangasvuokko. This Vulnerable species - listed on Finland's 2019 Red List - was once common on the sandy eskers of southern Finland, but fire suppression has erased the open soil it needs to germinate. The specimen in front of you was collected in 1998 from a population in Hämeenlinna, and is part of the Garden's contribution to the LIFE+ ESCAPE conservation programme. Watch the south-facing slope in April or May for the first silver-grey buds opening into deep violet flowers.",
      fi: "Pulsatilla patens, kangasvuokko. Vaarantunut laji vuoden 2019 punaisella listalla. Aikoinaan yleinen Suomen hiekkaharjuilla, nyt vain muutamalla suojelualueella. Tämä yksilö kerättiin Hämeenlinnasta vuonna 1998 osana LIFE+ ESCAPE -suojeluohjelmaa. Kukkii huhti- ja toukokuussa.",
      sv: "Pulsatilla patens, nipsippa. Sårbar art på Finlands rödlista 2019. En gång vanlig på sandåsar, idag bara på några skyddade platser. Detta exemplar samlades in från Hämeenlinna 1998 som del av LIFE+ ESCAPE-bevarandeprogrammet. Blommar i april och maj."
    },
    seasons: {
      spring: "plants/pulsatilla-patens.jpg",
      summer: "plants/pulsatilla-patens-steppe.jpg",
      autumn: "plants/pulsatilla-patens-reserve.jpg"
    },
    quickFacts: [
      ["Origin", "Häme esker"],
      ["Bloom", "Apr - May"],
      ["Red List", "VU (2019)"],
      ["Ex-situ since", "1998"]
    ]
  },
  {
    id: "camp-uni",
    accession: "OULU-2014-0033",
    image: "plants/campanula-uniflora.jpg",
    name: "Campanula uniflora",
    fi: "Pohjankello",
    sv: "Höga klockor",
    en: "Arctic Harebell",
    family: "Campanulaceae",
    rarity: "VU",
    rarityLabel: "Vulnerable",
    origin: "Kilpisjärvi fells, NW Lapland",
    habitat: "Calcareous fell slopes",
    biome: "Arctic-alpine fell",
    bloomSeason: "summer",
    color: "#3D6A52",
    accent: "#D6EBE3",
    variant: 2,
    adopters: 22,
    funded: 53,
    target: 75,
    story: "A tiny azure bell that flowers for three weeks above the tree line. Sensitive to reindeer overgrazing and warming summers.",
    bloom: "July",
    accessed: "Collected 2014, Saana fell",
    audio: "0:29",
    transcript: {
      en: "Campanula uniflora, the Arctic harebell, pohjankello in Finnish. A tiny azure bell that flowers for just three weeks above the tree line. This Vulnerable species comes from the Kilpisjärvi fells of northwestern Lapland, where it grows on calcareous slopes at altitudes that few flowering plants can survive. The Oulu specimen was collected in 2014 from Saana fell. Like many arctic-alpine plants, it is sensitive to reindeer overgrazing and warming summers.",
      fi: "Campanula uniflora, pohjankello. Vaarantunut laji. Pieni sininen kello, joka kukkii kolme viikkoa puurajan yläpuolella Kilpisjärven tuntureilla Luoteis-Lapissa. Oulun yksilö kerättiin Saanan tunturilta vuonna 2014. Herkkä porolaidunnukselle ja ilmaston lämpenemiselle.",
      sv: "Campanula uniflora, ettblommig blåklocka. Sårbar art. En liten azurblå klocka som blommar tre veckor ovanför trädgränsen i Kilpisjärvifjällen i nordvästra Lappland. Exemplaret samlades in från Saanafjället 2014. Känslig för renbete och varmare somrar."
    },
    seasons: {
      spring: "plants/campanula-uniflora.jpg",
      summer: "plants/campanula-uniflora-arctic.jpg",
      autumn: "plants/campanula-uniflora-upernavik.jpg"
    },
    quickFacts: [
      ["Origin", "Kilpisjärvi"],
      ["Bloom", "July"],
      ["Red List", "VU"],
      ["Habitat", "Fell slope"]
    ]
  },
  {
    id: "saxi-hirc",
    image: "plants/saxifraga-hirculus.jpg",
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
    biome: "Mire / fen",
    bloomSeason: "summer",
    color: "#C9A14A",
    accent: "#F1E6CB",
    variant: 7,
    adopters: 31,
    funded: 71,
    target: 90,
    story: "A buttery yellow saxifrage of intact rich fens, indicator species for healthy mires. Oulu maintains 5 source populations ex situ.",
    bloom: "August",
    accessed: "Collected 2009, Pudasjärvi mire",
    audio: "0:25",
    transcript: {
      en: "Saxifraga hirculus, the yellow marsh saxifrage. In Finnish, lettorikko. An Endangered species of cold, calcium-rich mires. Its bright yellow flowers, marked with orange dots, appear in August above carpets of sphagnum moss. The Oulu specimen comes from a fen near Kuusamo, where the species is one of the indicator plants used to identify intact boreal mire systems.",
      fi: "Saxifraga hirculus, lettorikko. Uhanalainen kalkkipitoisten soiden laji. Kirkkaankeltaiset kukat oranssipisteillä elokuussa, sammalmattojen päällä. Yksilö Pudasjärven suolta vuodelta 2009. Indikaattorilaji ehjille pohjoisille suoekosysteemeille.",
      sv: "Saxifraga hirculus, myrsildre. Starkt hotad art av kalla, kalkrika myrar. Klargula blommor med orange prickar i augusti, ovanför mattor av vitmossa. Exemplaret kommer från en myr nära Kuusamo. Indikatorväxt för intakta nordliga myrar."
    },
    seasons: {
      spring: "plants/saxifraga-hirculus.jpg",
      summer: "plants/saxifraga-hirculus-svalbard.jpg",
      autumn: "plants/saxifraga-hirculus-brassus.jpg"
    },
    quickFacts: [
      ["Origin", "Pudasjärvi"],
      ["Bloom", "August"],
      ["Red List", "EN"],
      ["Habitat", "Rich fen"]
    ]
  },
  {
    id: "prim-nut",
    image: "plants/primula-nutans.jpg",
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
    biome: "Bothnian coast",
    bloomSeason: "summer",
    color: "#B25C3A",
    accent: "#F0DCD0",
    variant: 6,
    adopters: 64,
    funded: 92,
    target: 100,
    story: "A pink coastal primrose tightly bound to the rising shores of the Bothnian Bay - a uniquely Finnish post-glacial story.",
    bloom: "June – July",
    accessed: "Collected 2002, Hailuoto",
    audio: "0:21",
    transcript: {
      en: "Primula nutans, the Finnmark primrose. Ruijanesikko in Finnish. A pink coastal primrose found only on the rising shores of the Bothnian Bay. As the land rebounds after the last ice age, new shoreline emerges each century, and this Endangered species follows the moving coast. The Oulu specimen was collected from Simo in 2002.",
      fi: "Primula nutans, ruijanesikko. Uhanalainen rannikon esikko. Löytyy vain Perämeren maannousurannoilta. Maan kohotessa uutta rantaa syntyy joka vuosisata, ja tämä laji seuraa liikkuvaa rantaa. Oulun yksilö kerättiin Simosta vuonna 2002.",
      sv: "Primula nutans, strandviva. Starkt hotad rosa kustviva. Återfinns endast på Bottenvikens stigande stränder. När landet höjs efter istiden uppstår ny strandlinje varje sekel, och denna art följer den rörliga kusten. Exemplaret samlades in från Simo 2002."
    },
    seasons: {
      spring: "plants/primula-nutans.jpg",
      summer: "plants/primula-nutans-bothnian.jpg",
      autumn: "plants/primula-nutans-simo2021.jpg"
    },
    quickFacts: [
      ["Origin", "Hailuoto"],
      ["Bloom", "Jun – Jul"],
      ["Red List", "EN"],
      ["Habitat", "Sea meadow"]
    ]
  },
  {
    id: "trol-eur",
    image: "plants/trollius-europaeus.jpg",
    seasons: {
      spring: "plants/trollius-europaeus-habitat.jpg",
      summer: "plants/trollius-europaeus.jpg",
      autumn: "plants/trollius-europaeus-seed.jpg"
    },
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
    biome: "Hay meadow",
    bloomSeason: "summer",
    color: "#C9A14A",
    accent: "#F1E6CB",
    variant: 7,
    adopters: 89,
    funded: 100,
    target: 100,
    story: "A signature meadow species declining with the loss of traditional pasture management. Sponsorship funds restoration partnerships.",
    bloom: "June",
    accessed: "Collected 1987, Lieksa",
    audio: "0:27",
    transcript: {
      en: "Trollius europaeus, the European globeflower. Kullero in Finnish. Its golden, almost spherical flowers light up the meadow bed each June and July. Once common in moist hay meadows, the globeflower has declined as traditional meadows have been ploughed or abandoned. It is now classified as Near Threatened in Finland. The Oulu population was established in 1987 and supports both ex-situ conservation and pollinator research.",
      fi: "Trollius europaeus, kullero. Silmälläpidettävä laji. Kultaiset pallomaiset kukat valaisevat niittyä kesä- ja heinäkuussa. Aikoinaan yleinen heinäniityillä, vähentynyt perinteisten niittyjen häviämisen myötä. Oulun populaatio vuodelta 1987 tukee ex situ -suojelua.",
      sv: "Trollius europaeus, smörboll. Nära hotad. Gyllene, nästan klotformade blommor lyser upp ängen varje juni och juli. En gång vanlig på fuktiga slåtterängar, har gått tillbaka när traditionella ängar plöjts eller övergivits. Uleåborgs population etablerades 1987."
    },
    quickFacts: [
      ["Origin", "Lieksa"],
      ["Bloom", "June"],
      ["Red List", "NT"],
      ["Habitat", "Wet meadow"]
    ]
  },
  {
    id: "cyp-cal",
    image: "plants/cypripedium-calceolus.jpg",
    seasons: {
      spring: "plants/cypripedium-calceolus.jpg",
      summer: "plants/cypripedium-calceolus-inflorescence.jpg",
      autumn: "plants/cypripedium-calceolus-sweden.jpg"
    },
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
    biome: "Limestone forest",
    bloomSeason: "spring",
    color: "#B25C3A",
    accent: "#F0DCD0",
    variant: 4,
    adopters: 152,
    funded: 100,
    target: 100,
    story: "Europe's most iconic temperate orchid. Slow-growing - a single rhizome can live a century. Strictly protected; propagation is exacting.",
    bloom: "Late May – June",
    accessed: "Collected 1995, Kuusamo",
    audio: "0:28",
    transcript: {
      en: "Cypripedium calceolus, the lady's-slipper orchid. In Finnish, tikankontti. Europe's most iconic temperate orchid. Each yellow shoe-shaped flower is a trap that briefly captures small bees, dusting them with pollen as they escape. This Vulnerable species is slow-growing - a single rhizome can live a century. The Oulu specimen was rescued from a roadworks site in Kuusamo in 1995. Please do not touch the flowers.",
      fi: "Cypripedium calceolus, tikankontti. Vaarantunut laji. Euroopan ikonisin lauhkean vyöhykkeen orkidea. Keltainen kenkämäinen kukka vangitsee hetkeksi pienet mehiläiset siitepölytykseen. Hidaskasvuinen - yksi juurakko voi elää sata vuotta. Pelastettu tietyömaalta Kuusamossa vuonna 1995. Älä koske kukkiin.",
      sv: "Cypripedium calceolus, guckusko. Sårbar art. Europas mest ikoniska tempererade orkidé. Varje gul skoformad blomma är en fälla som kort fångar små bin och pudrar dem med pollen när de flyr. Långsamt växande - en rotstock kan leva i ett sekel. Räddad från ett vägarbete i Kuusamo 1995. Rör inte blommorna."
    },
    quickFacts: [
      ["Origin", "Kuusamo"],
      ["Bloom", "May – Jun"],
      ["Red List", "VU"],
      ["Habitat", "Limestone forest"]
    ]
  },
  {
    id: "lob-pul",
    image: "plants/lobaria-pulmonaria.jpg",
    seasons: {
      spring: "plants/lobaria-pulmonaria.jpg",
      summer: "plants/lobaria-pulmonaria-detail.jpg",
      autumn: "plants/lobaria-pulmonaria-habitat.jpg"
    },
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
    biome: "Old-growth forest",
    bloomSeason: "all",
    color: "#3D6A52",
    accent: "#E8EEDE",
    variant: 5,
    adopters: 12,
    funded: 28,
    target: 60,
    story: "A leafy lichen and an indicator species - its presence signals ancient, undisturbed forest. Sensitive to logging and air pollution.",
    bloom: "n/a (lichen)",
    accessed: "Collected 2017, Syöte NP",
    audio: "0:25",
    transcript: {
      en: "Lobaria pulmonaria, the tree lungwort. Raidankeuhkojäkälä in Finnish. Not a plant at all, but a leafy lichen - a symbiosis of fungus, alga, and cyanobacteria. Its presence on a tree signals ancient, undisturbed forest, because Lobaria cannot tolerate logging or air pollution. This Near Threatened species was collected in 2017 from an old-growth spruce stand.",
      fi: "Lobaria pulmonaria, raidankeuhkojäkälä. Silmälläpidettävä. Ei kasvi, vaan lehtimäinen jäkälä - sienen, levän ja syanobakteerin symbioosi. Sen läsnäolo puussa kertoo vanhasta koskemattomasta metsästä, sillä se ei siedä hakkuita tai ilmansaasteita. Kerätty Syötteen kansallispuistosta vuonna 2017.",
      sv: "Lobaria pulmonaria, lunglav. Nära hotad. Inte en växt utan en bladlav - en symbios av svamp, alg och cyanobakterie. Dess närvaro på ett träd signalerar gammal ostörd skog, eftersom lunglav inte tål avverkning eller luftföroreningar. Insamlad 2017 från en gammal granskog."
    },
    quickFacts: [
      ["Origin", "Syöte"],
      ["Bloom", "-"],
      ["Red List", "NT"],
      ["Habitat", "Aspen bark"]
    ]
  },
  {
    id: "vict-am",
    image: "plants/victoria-amazonica.jpg",
    seasons: {
      spring: "plants/victoria-amazonica.jpg",
      summer: "plants/victoria-amazonica-fitch.jpg",
      autumn: "plants/victoria-amazonica-chatsworth.jpg"
    },
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
    biome: "Tropical greenhouse",
    bloomSeason: "summer",
    color: "#5FB0A0",
    accent: "#D6EBE3",
    variant: 3,
    adopters: 312,
    funded: 100,
    target: 100,
    story: "The most photographed plant in the Romeo greenhouse. Leaves reach 2.5 m; can support 30 kg. Night blooms turn from white to pink.",
    bloom: "August evenings",
    accessed: "Cultivated since 1972",
    audio: "0:26",
    transcript: {
      en: "Victoria amazonica, the giant Amazonian water lily. In Finnish, amazonin jättivesilumme. Cultivated here in the Romeo and Julia greenhouses since 1972. The leaves can reach two metres across and support the weight of a small child. The white flowers open at dusk on August evenings, turning pink overnight after pollination by scarab beetles. Bloom evenings are announced 48 hours in advance.",
      fi: "Victoria amazonica, amazonin jättivesilumme. Viljelty täällä Romeo ja Julia -kasvihuoneissa vuodesta 1972. Lehdet voivat ulottua kahteen metriin saakka ja kantaa pienen lapsen painon. Valkoiset kukat aukeavat hämärässä elokuun iltoina, muuttuen vaaleanpunaisiksi yön aikana pölytyksen jälkeen. Kukintaillat ilmoitetaan 48 tuntia etukäteen.",
      sv: "Victoria amazonica, jätteamazonnäckros. Odlas i Romeo och Julia-växthusen sedan 1972. Bladen når två meter i diameter och bär ett litet barns vikt. De vita blommorna öppnar sig i skymningen augustikvällar och blir rosa över natten efter pollinering av skalbaggar. Blomningskvällar tillkännages 48 timmar i förväg."
    },
    quickFacts: [
      ["Origin", "Amazon"],
      ["Bloom", "Aug nights"],
      ["Status", "Greenhouse"],
      ["Leaf span", "2.5 m"]
    ]
  }
];

// Tier ladder aligned to the v3 pitch (Growth Hack 2026).
// All 4 public tiers are annual by default; the monthly figure is provided as
// an opt-in equivalent (price / 12, rounded). Each tier includes I@H pairing
// (Internationalisation@Home - any tier pairs with a plant from the adopter's
// home region) and all physical perks are sourced locally from Finnish
// artists, presses, and the Garden's seed bank.
const TIERS = [
  {
    id: "seedling",
    name: "Seedling",
    fi: "Siemen",
    price: 25,
    monthly: 2,
    tag: "Most popular gift",
    blurb: "A starter gesture. Nickname your plant, pick one from your home region, get a digital certificate and quarterly notes.",
    perks: [
      "Nickname your plant",
      "I@H · plant from your home region",
      "Digital certificate & story page",
      "Quarterly grower's notes"
    ],
    color: "#A8C060",
    bg: "#E8EEDE"
  },
  {
    id: "rooted",
    name: "Rooted",
    fi: "Juurtunut",
    price: 75,
    monthly: 7,
    tag: "Best value",
    blurb: "Printed certificate mailed to you, I@H postcard from your plant's region, seasonal photos of your specific plant.",
    perks: [
      "Printed certificate · mailed",
      "I@H postcard from plant's region",
      "Seasonal photos of YOUR plant",
      "Adopters' Open Day invite"
    ],
    color: "#88A050",
    bg: "#DDE6CB"
  },
  {
    id: "vulnerable",
    name: "Vulnerable",
    fi: "Vaarantunut",
    price: 250,
    monthly: 21,
    tag: "Donor-wall listing",
    blurb: "Funds an actively threatened species. Signed botanical art, themed garden walk, Adopters' Open Day + guest.",
    perks: [
      "Signed botanical art print",
      "Themed garden walk · 1 admission",
      "Adopters' Open Day + 1 guest",
      "Donor-wall listing",
      "Name on shared adopters' plaque"
    ],
    color: "#5FB0A0",
    bg: "#D6EBE3"
  },
  {
    id: "endangered",
    name: "Endangered",
    fi: "Erittäin uhanalainen",
    price: 750,
    monthly: 63,
    tag: "Plaque by YOUR plant",
    blurb: "Limited-edition signed art, donor dinner with a seed-bank visit, an engraved plaque next to your specific plant, and an annual seed packet.",
    perks: [
      "Limited-edition signed art print",
      "Curated botany book",
      "Donor dinner + seed-bank visit",
      "Plaque next to YOUR plant",
      "Annual seed packet"
    ],
    color: "#1F3C2D",
    bg: "#CFD9D0"
  }
];

const CORPORATE_TIERS = [
  {
    name: "Corporate",
    fi: "Yritystaso",
    price: 2500,
    color: "#B25C3A",
    perks: [
      "Logo on greenhouse signage",
      "CSR-ready impact report",
      "Private event slot · 20 guests"
    ]
  }
];

const ASK_CITATIONS = [
  { id: "c1", source: "Phenology log", year: 2026, title: "Curator-maintained bloom register", page: "wk 19 · Spring 2026" },
  { id: "c2", source: "LIFE+ ESCAPE Final Report", year: 2017, title: "Ex-situ conservation of Finnish native plant species", page: "LIFE11 BIO/FI/000917 · 2012-2017" },
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
