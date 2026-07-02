// Static content: factions, informants, seed claims, name pools, endings.

export const FACTIONS = [
  {
    id: 'guild',
    name: "Chandlers' Guild",
    short: 'Guild',
    color: '#d4a017',
    desc: 'The merchant cartel that owns the docks, the warehouses, and most of the council.',
    interests: ['commerce', 'scandal'],
  },
  {
    id: 'chancery',
    name: 'The Chancery',
    short: 'Chancery',
    color: '#7a8ca8',
    desc: "The harbor's secret police. They read your mail before you write it.",
    interests: ['security', 'occult', 'unrest'],
  },
  {
    id: 'undertow',
    name: 'The Undertow',
    short: 'Undertow',
    color: '#c0392b',
    desc: 'Dockworkers, debtors, and the dispossessed. They are done waiting politely.',
    interests: ['unrest', 'scandal', 'commerce'],
  },
];

export const INFORMANTS = [
  { id: 'ferret', name: 'The Ferret', desc: 'A customs clerk with sticky fingers and stickier ears.', unlock: null },
  { id: 'widow', name: 'Widow Cassel', desc: 'Runs a boarding house where sailors talk in their sleep.', unlock: null },
  { id: 'firebrand', name: 'The Firebrand', desc: 'A street preacher who smells riots coming. Appears when unrest boils.', unlock: 'unrest' },
  { id: 'antiquarian', name: 'The Antiquarian', desc: 'Deals in forgeries and worse. Found you once your name meant something.', unlock: 'notoriety' },
  { id: 'motherlow', name: 'Mother Low', desc: 'Banker to smugglers. Only talks to people with real coin.', unlock: 'coin' },
];

// topic -> which factions read the aggregate belief for it
export const TOPIC_META = {
  commerce: { spiceBase: 1.0 },
  security: { spiceBase: 1.1 },
  unrest:   { spiceBase: 1.3 },
  scandal:  { spiceBase: 1.5 },
  occult:   { spiceBase: 1.2 },
};

// ~22 seed claims. trueAccuracy is hidden ground truth; plausibility is the public prior.
// `about` = faction implicated (or 'city'). `contradicts` links are made mutual at load.
export const SEED_CLAIMS = [
  {
    id: 'c01', topic: 'commerce', about: 'guild', informant: 'ferret',
    headline: "The Guild is shorting the grain reserve to spike bread prices",
    trueAccuracy: 0.78, plausibility: 0.45, spice: 1.4,
    contradicts: ['c02'],
    mutations: [
      "The Guild has already sold the grain reserve to foreign buyers",
      "There is no grain left in Brack Harbor at all — the silos are stage dressing",
    ],
  },
  {
    id: 'c02', topic: 'commerce', about: 'guild', informant: 'widow',
    headline: "The Guild is quietly stockpiling grain to give away before the vote",
    trueAccuracy: 0.15, plausibility: 0.40, spice: 0.9,
    contradicts: ['c01'],
    mutations: ["The Guild's charity grain is poisoned against the dock families"],
  },
  {
    id: 'c03', topic: 'scandal', about: 'guild', informant: 'ferret',
    headline: "Guildmaster Vance keeps a second ledger for council bribes",
    trueAccuracy: 0.85, plausibility: 0.55, spice: 1.6,
    contradicts: [],
    mutations: [
      "Vance's second ledger names half the Chancery as paid men",
      "Vance burned the second ledger and the clerk who kept it",
    ],
  },
  {
    id: 'c04', topic: 'security', about: 'chancery', informant: 'widow',
    headline: "The Chancery has an informant inside the dockworkers' benefit society",
    trueAccuracy: 0.70, plausibility: 0.50, spice: 1.3,
    contradicts: [],
    mutations: ["Half the benefit society are Chancery informants — the strike fund is a trap"],
  },
  {
    id: 'c05', topic: 'unrest', about: 'undertow', informant: 'ferret',
    headline: "The Undertow is stockpiling boat-hooks and lamp oil in the Saltrow cellars",
    trueAccuracy: 0.35, plausibility: 0.42, spice: 1.5,
    contradicts: ['c06'],
    mutations: ["The Saltrow cellars hold powder kegs stolen from the harbor battery"],
  },
  {
    id: 'c06', topic: 'unrest', about: 'undertow', informant: 'widow',
    headline: "The Undertow's leadership has agreed to stand down for Guild coin",
    trueAccuracy: 0.20, plausibility: 0.35, spice: 1.2,
    contradicts: ['c05'],
    mutations: ["Red Meg herself took a Guild pension and a cottage upriver"],
  },
  {
    id: 'c07', topic: 'scandal', about: 'chancery', informant: 'widow',
    headline: "Provost Ashe ordered the Wren Street fire to clear a surveillance nest",
    trueAccuracy: 0.55, plausibility: 0.30, spice: 1.7,
    contradicts: [],
    mutations: [
      "Nine bodies from the Wren Street fire were never on any tenant roll",
      "Ashe watched the Wren Street fire from a coach and forbade the pump crews",
    ],
  },
  {
    id: 'c08', topic: 'commerce', about: 'guild', informant: 'ferret',
    headline: "The insurance syndicate is refusing to cover Guild hulls next season",
    trueAccuracy: 0.62, plausibility: 0.48, spice: 1.0,
    contradicts: [],
    mutations: ["Three Guild ships were scuttled for the insurance before the refusal"],
  },
  {
    id: 'c09', topic: 'occult', about: 'city', informant: 'widow',
    headline: "Something in the harbor is taking swimmers — the tide-bell rings itself",
    trueAccuracy: 0.10, plausibility: 0.25, spice: 1.4,
    contradicts: [],
    mutations: ["The Chancery is feeding prisoners to whatever is in the harbor"],
  },
  {
    id: 'c10', topic: 'security', about: 'chancery', informant: 'ferret',
    headline: "The Chancery's cipher clerks have cracked the Guild's private post",
    trueAccuracy: 0.65, plausibility: 0.45, spice: 1.2,
    contradicts: [],
    mutations: ["The Chancery reads every letter that leaves Brack Harbor, private or not"],
  },
  {
    id: 'c11', topic: 'unrest', about: 'city', informant: 'widow',
    headline: "Bread will be rationed within the fortnight",
    trueAccuracy: 0.40, plausibility: 0.50, spice: 1.5,
    contradicts: [],
    mutations: ["Ration books are already printed with Guild seals on them"],
  },
  {
    id: 'c12', topic: 'scandal', about: 'undertow', informant: 'ferret',
    headline: "Red Meg's strike fund paid for her brother's gambling debts",
    trueAccuracy: 0.25, plausibility: 0.38, spice: 1.4,
    contradicts: [],
    mutations: ["The strike fund is empty — every clipped penny of it gambled away"],
  },
  {
    id: 'c13', topic: 'commerce', about: 'guild', informant: 'firebrand',
    headline: "The Guild plans to replace dock crews with indentured labor from the colonies",
    trueAccuracy: 0.45, plausibility: 0.40, spice: 1.6,
    contradicts: [],
    mutations: ["The first indenture ship is already anchored past the mole, waiting"],
  },
  {
    id: 'c14', topic: 'security', about: 'chancery', informant: 'firebrand',
    headline: "The Chancery keeps a black cell under the counting-house for people who ask questions",
    trueAccuracy: 0.60, plausibility: 0.35, spice: 1.5,
    contradicts: [],
    mutations: ["Prisoners in the black cell are traded to foreign agents for ciphers"],
  },
  {
    id: 'c15', topic: 'occult', about: 'chancery', informant: 'antiquarian',
    headline: "Provost Ashe consults a drowned oracle kept in a brine tank",
    trueAccuracy: 0.08, plausibility: 0.15, spice: 1.6,
    contradicts: [],
    mutations: ["The oracle demanded the Wren Street fire as an offering"],
  },
  {
    id: 'c16', topic: 'scandal', about: 'guild', informant: 'antiquarian',
    headline: "Guildmaster Vance's fortune began with a slaver's manifest he swore was burned",
    trueAccuracy: 0.72, plausibility: 0.35, spice: 1.7,
    contradicts: [],
    mutations: ["The manifest survives, and three council names are on its passenger bond"],
  },
  {
    id: 'c17', topic: 'commerce', about: 'city', informant: 'motherlow',
    headline: "The harbor mint has been striking coin at nine parts tin",
    trueAccuracy: 0.55, plausibility: 0.30, spice: 1.5,
    contradicts: [],
    mutations: ["Foreign banks already refuse Brack Harbor coin at any weight"],
  },
  {
    id: 'c18', topic: 'unrest', about: 'undertow', informant: 'firebrand',
    headline: "The Undertow has a list of doors to mark when the signal comes",
    trueAccuracy: 0.30, plausibility: 0.33, spice: 1.7,
    contradicts: [],
    mutations: ["Your door is on the Undertow's list"],
  },
  {
    id: 'c19', topic: 'security', about: 'city', informant: 'motherlow',
    headline: "A foreign fleet has been sighted twice beyond the fog line",
    trueAccuracy: 0.20, plausibility: 0.28, spice: 1.4,
    contradicts: [],
    mutations: ["The Guild has already negotiated the harbor's surrender terms"],
  },
  {
    id: 'c20', topic: 'scandal', about: 'chancery', informant: 'motherlow',
    headline: "The Chancery's pension fund is invested in the smuggling routes it polices",
    trueAccuracy: 0.68, plausibility: 0.40, spice: 1.5,
    contradicts: [],
    mutations: ["Chancery patrol schedules are for sale to any smuggler who pays the tithe"],
  },
  {
    id: 'c21', topic: 'unrest', about: 'city', informant: 'firebrand',
    headline: "The well water in Saltrow is making children sick, and someone upstream knows why",
    trueAccuracy: 0.58, plausibility: 0.45, spice: 1.5,
    contradicts: [],
    mutations: ["The Guild tannery has been draining into the Saltrow wells for a year"],
  },
  {
    id: 'c22', topic: 'occult', about: 'city', informant: 'antiquarian',
    headline: "The old sea-wall carvings are a warning calendar, and this year is marked",
    trueAccuracy: 0.05, plausibility: 0.18, spice: 1.3,
    contradicts: [],
    mutations: ["The founders drowned a district to buy the harbor's luck, and the debt is due"],
  },
];

// Ambient rumors the city generates on its own (no informant, never on the market).
// Keeps the world moving even when the player sits on their hands.
export const AMBIENT_TEMPLATES = [
  { topic: 'commerce', about: 'guild', headline: 'The Guild is weighing thumbs on the fish scales again', trueAccuracy: 0.5, plausibility: 0.5, spice: 1.1, mutations: [] },
  { topic: 'security', about: 'chancery', headline: 'The Chancery pulled a man off the night ferry and nobody has seen him since', trueAccuracy: 0.45, plausibility: 0.4, spice: 1.2, mutations: [] },
  { topic: 'unrest', about: 'city', headline: 'The lamplighters have not been paid in a month', trueAccuracy: 0.6, plausibility: 0.5, spice: 1.1, mutations: [] },
  { topic: 'scandal', about: 'guild', headline: 'A Guild factor was seen burning papers on the tideline at dawn', trueAccuracy: 0.35, plausibility: 0.4, spice: 1.3, mutations: [] },
  { topic: 'unrest', about: 'undertow', headline: 'Saltrow toughs are collecting a "safety tithe" from the market stalls', trueAccuracy: 0.4, plausibility: 0.45, spice: 1.2, mutations: [] },
  { topic: 'occult', about: 'city', headline: 'The fog came in against the wind three nights running', trueAccuracy: 0.2, plausibility: 0.3, spice: 1.1, mutations: [] },
  { topic: 'commerce', about: 'city', headline: 'Two grain barges turned back at the mole without unloading', trueAccuracy: 0.55, plausibility: 0.45, spice: 1.2, mutations: [] },
  { topic: 'scandal', about: 'chancery', headline: 'A Chancery clerk drinks on credit no clerk should have', trueAccuracy: 0.5, plausibility: 0.45, spice: 1.1, mutations: [] },
];

export const FIRST_NAMES = [
  'Maren', 'Odo', 'Perrin', 'Sable', 'Tamsin', 'Uld', 'Vesper', 'Wren', 'Ambrose', 'Briga',
  'Caspar', 'Delia', 'Edmund', 'Fenna', 'Gideon', 'Hesper', 'Ivo', 'Jessa', 'Kell', 'Lena',
  'Mord', 'Nessa', 'Osric', 'Petra', 'Quill', 'Rosamund', 'Silas', 'Thea', 'Ulric', 'Vida',
];

export const LAST_NAMES = [
  'Holt', 'Crane', 'Saltmarsh', 'Vey', 'Ashdown', 'Brack', 'Coldwater', 'Dunmore', 'Eeling',
  'Fairweather', 'Gorse', 'Harrow', 'Ketch', 'Lowtide', 'Marsh', 'Netley', 'Oyster', 'Pike',
  'Quay', 'Rudd', 'Sorrel', 'Tarwater', 'Undercroft', 'Vane', 'Wharf', 'Yarrow',
];

export const DISTRICTS = ['Saltrow', 'The Shambles', 'Candle Hill', 'The Mole', 'Wren Street'];

export const ARCHETYPES = {
  skeptic:    { share: 0.15, gullibility: [0.15, 0.35], skepticism: [0.7, 1.0], influence: [0.8, 1.3] },
  conformist: { share: 0.35, gullibility: [0.45, 0.70], skepticism: [0.3, 0.6], influence: [0.6, 1.1] },
  zealot:     { share: 0.15, gullibility: [0.65, 0.90], skepticism: [0.1, 0.3], influence: [0.9, 1.5] },
  connector:  { share: 0.15, gullibility: [0.40, 0.60], skepticism: [0.3, 0.6], influence: [1.6, 2.4] },
  gossip:     { share: 0.20, gullibility: [0.55, 0.80], skepticism: [0.2, 0.4], influence: [1.3, 2.0] },
};

export const ENDINGS = {
  cityInFlames: {
    id: 'cityInFlames', title: 'City in Flames',
    text: 'Unrest passed the point where anyone could sell it back down. Brack Harbor burned for three nights. What you traded in is ash now — and so is the market for it.',
  },
  companyTown: {
    id: 'companyTown', title: 'Company Town',
    text: "The Chandlers' Guild owns everything worth owning, including the truth. Prices are stable, wages are scrip, and every rumor now clears through a Guild broker with a stamped license.",
  },
  panopticon: {
    id: 'panopticon', title: 'Panopticon',
    text: 'The Chancery no longer needs informants; the city informs on itself out of habit. Nothing is whispered in Brack Harbor that is not transcribed.',
  },
  theFlood: {
    id: 'theFlood', title: 'The Flood',
    text: 'The Undertow rose and did not recede. Committees run the docks now. They remember who fed them the truth — and who fed them everything else.',
  },
  unmasked: {
    id: 'unmasked', title: 'Unmasked',
    text: 'Your name, your face, your ledger of lies — all of it published on every corner. The mob reached your door before the Chancery did. It was not a rescue.',
  },
  grayEminence: {
    id: 'grayEminence', title: 'Gray Eminence',
    text: 'You walked away rich, unnamed, and owed favors by every power in the harbor. Somewhere in the city, three factions still act on things you invented. You sleep fine.',
  },
};
