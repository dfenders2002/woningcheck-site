// Pure berekeningen (geen DOM): wensen-check, locatie, buurt, VvE, financiën, bod-range, rendement, eindoordeel.
// Alles is transparant: elke check geeft een status (ok/warn/fail/unknown), een label en een korte uitleg.

export const eur = (n, d = 0) => (n == null || Number.isNaN(n) ? '–' : new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: d, minimumFractionDigits: d }).format(n));
export const pct = (n, d = 0) => (n == null || Number.isNaN(n) ? '–' : `${(n * 100).toFixed(d).replace('.', ',')}%`);
export const num = (n, d = 0) => (n == null || Number.isNaN(n) ? '–' : new Intl.NumberFormat('nl-NL', { maximumFractionDigits: d }).format(n));
export const round1000 = (n) => Math.round(n / 1000) * 1000;

const ENERGY_RANK = { 'A++++': 9, 'A+++': 8, 'A++': 7, 'A+': 6, A: 5, B: 4, C: 3, D: 2, E: 1, F: 0, G: -1 };
const W = { must: 3, should: 2, nice: 1 };
// Elke check is één rij: status · label · uitkomst (value) · norm · toelichting (note).
const check = (id, label, status, value = '', norm = '', note = '', weight = 'should') => ({ id, label, status, value, norm, note, weight, detail: [value, note].filter(Boolean).join(' · ') });
const scoreOf = (items) => {
  const scored = items.filter((i) => i.status !== 'info');
  const total = scored.reduce((s, i) => s + W[i.weight], 0);
  const got = scored.reduce((s, i) => s + W[i.weight] * (i.status === 'ok' ? 1 : i.status === 'warn' ? 0.5 : 0), 0);
  return total ? Math.round((got / total) * 100) : 0;
};

// ---------- Wensenlijst ----------
export function wishChecks(listing, profile) {
  const l = listing.listing || {};
  const b = profile.budget;
  const yn = (v) => (v == null ? '?' : v ? 'ja' : 'nee');
  const bool = (v) => (v == null ? 'unknown' : v ? 'ok' : 'fail');
  const rules = {
    city: () => [/alphen/i.test(listing.address?.city || '') ? 'ok' : 'fail', listing.address?.city || '?', 'Alphen aan den Rijn', ''],
    price: () => [l.askingPrice == null ? 'unknown' : l.askingPrice <= b.max && l.askingPrice >= b.min ? 'ok' : l.askingPrice <= b.stretchMax ? 'warn' : 'fail', eur(l.askingPrice), `${eur(b.min)} – ${eur(b.max)}`, `rek tot ${eur(b.stretchMax)}`],
    singleFloor: () => [l.floors == null ? 'unknown' : l.floors === 1 ? 'ok' : 'fail', l.floors == null ? '?' : `${l.floors} woonlaag${l.floors === 1 ? '' : 'en'}`, '1 woonlaag', ''],
    buildYear: () => [l.buildYear == null ? 'unknown' : l.buildYear >= 2000 ? 'ok' : 'fail', l.buildYear ?? '?', '2000 of later', ''],
    moveInReady: () => [bool(l.moveInReady), yn(l.moveInReady), 'instapklaar', l.moveInReady ? 'volgens de makelaar' : ''],
    energyLabel: () => [l.energyLabel == null ? 'unknown' : (ENERGY_RANK[l.energyLabel] ?? -1) >= ENERGY_RANK.B ? 'ok' : 'fail', `label ${l.energyLabel ?? '?'}`, 'B of beter', l.energyLabelValidUntil ? `geldig tot ${l.energyLabelValidUntil}` : ''],
    bedrooms: () => [l.bedrooms == null ? 'unknown' : l.bedrooms >= 2 ? 'ok' : 'fail', `${l.bedrooms ?? '?'} slaapkamers`, 'minimaal 2', `${l.rooms ?? '?'} kamers totaal`],
    maxFloor: () => [l.floor == null ? 'unknown' : l.floor <= 3 ? 'ok' : 'fail', l.floor == null ? '?' : `${l.floor}e woonlaag`, 'max 3e', ''],
    lift: () => [bool(l.lift), yn(l.lift), 'lift aanwezig', ''],
    balcony: () => [bool(l.balcony), l.outdoorArea ? `${l.outdoorArea} m² buiten` : yn(l.balcony), 'balkon of terras', l.balconyType || ''],
    area: () => [l.livingArea == null ? 'unknown' : l.livingArea >= 80 ? 'ok' : l.livingArea >= 70 ? 'warn' : 'fail', `${l.livingArea ?? '?'} m²`, '80 m² of meer', l.outdoorArea ? `+ ${l.outdoorArea} m² buiten` : ''],
    bath: () => [bool(l.bath), l.bath ? 'ligbad' : l.bath === false ? 'alleen douche' : '?', 'ligbad', l.bath && l.shower ? 'ook douche' : ''],
    corner: () => [bool(l.corner), l.corner == null ? 'onbekend' : l.corner ? 'hoek' : 'tussen', 'hoekligging', l.cornerNote || ''],
    airco: () => [l.airco == null ? 'unknown' : l.airco ? 'ok' : 'warn', yn(l.airco), 'pluspunt', l.aircoRooms || ''],
    floorHeating: () => [l.floorHeating == null ? 'unknown' : l.floorHeating ? 'ok' : 'warn', yn(l.floorHeating), 'pluspunt', ''],
    parking: () => [l.ownParking == null ? 'unknown' : l.ownParking ? 'ok' : 'fail', yn(l.ownParking), 'eigen plek', l.parking || ''],
    setting: () => { const r = l.settingRating ?? (l.setting?.some((x) => /vrij uitzicht|water|park|groen/i.test(x)) ? 4 : l.setting ? 3 : null); return [r == null ? 'unknown' : r >= 4 ? 'ok' : r === 3 ? 'warn' : 'fail', r == null ? '?' : `${r}/5`, 'vrij uitzicht, water of groen', `${(l.setting || []).join(', ')}${l.settingNote ? ` — ${l.settingNote}` : ''}`]; },
    exterior: () => { const r = l.exteriorRating ?? null; return [r == null ? 'unknown' : r >= 4 ? 'ok' : r === 3 ? 'warn' : 'fail', r == null ? '?' : `${r}/5`, '4/5 of hoger', l.exteriorNote || 'beoordeeld op Funda-foto\'s']; },
  };
  const items = profile.wishes.map((w) => {
    const [status, value, norm, note] = rules[w.id] ? rules[w.id]() : ['unknown', '?', '', 'geen check gedefinieerd'];
    return check(w.id, w.label, status, String(value), norm, note, w.weight);
  });
  const mustFails = items.filter((i) => i.weight === 'must' && i.status === 'fail');
  return { items, score: scoreOf(items), mustFails };
}

// ---------- Locatie & buurt ----------
const band = (v, okMax, warnMax) => (v == null ? 'unknown' : v <= okMax ? 'ok' : v <= warnMax ? 'warn' : 'fail');
const km = (m) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const names = (arr, skip) => (arr || []).map((x) => x.name).filter((n) => n && n !== skip).slice(0, 3).join(', ');
const LOC_DEFAULT = { stationBikeMinOk: 15, stationBikeMinWarn: 25, supermarketWalkMinOk: 15, supermarketBikeMinWarn: 10, greenWalkMinOk: 10, greenWalkMinWarn: 15 };
let LOC = LOC_DEFAULT;
export function locationChecks(listing, profile) {
  LOC = { ...LOC_DEFAULT, ...(profile?.locationRules || {}) };
  const e = listing.enriched || {};
  const r = e.routes || {}, p = e.pois || {};
  const items = [];
  const st = r.station;
  items.push(check('station', 'Station (pa fietst)', band(st?.bikeMin, LOC.stationBikeMinOk, LOC.stationBikeMinWarn), st ? `${st.bikeMin} min 🚲` : '?', `≤ ${LOC.stationBikeMinOk} min fietsen`, st ? `${st.footMin} min 🚶 · ${st.drivingMin} min 🚗 · ${st.label}` : 'geen station binnen 6 km', 'should'));
  const d = r.daan;
  items.push(check('daan', 'Naar Daan', band(d?.bikeMin, 10, 20), d ? `${d.bikeMin} min 🚲` : '?', '≤ 10 min fietsen', d ? `${d.footMin ?? '–'} min 🚶 · ${d.drivingMin} min 🚗` : '', 'should'));
  const s = r.supermarket;
  const superStatus = !s ? 'unknown' : s.footMin <= LOC.supermarketWalkMinOk ? 'ok' : (s.bikeMin ?? 99) <= LOC.supermarketBikeMinWarn ? 'warn' : 'fail';
  items.push(check('supermarket', 'Supermarkt (ma)', superStatus, s ? `${s.footMin} min 🚶` : '?', `≤ ${LOC.supermarketWalkMinOk} min lopen of ≤ ${LOC.supermarketBikeMinWarn} min fietsen`, s ? `${s.bikeMin != null ? `${s.bikeMin} min 🚲 · ` : ''}${s.label}${names(p.supermarket, s.label) ? `; ook ${names(p.supermarket, s.label)}` : ''}` : 'geen binnen 1,5 km', 'should'));
  const h = r.doctors;
  items.push(check('doctors', 'Huisarts', band(h?.footMin, 15, 25), h ? `${h.footMin} min 🚶` : '?', '≤ 15 min lopen', h ? h.label : 'geen binnen 2 km', 'should'));
  const ap = r.pharmacy;
  items.push(check('pharmacy', 'Apotheek', band(ap?.footMin, 15, 25), ap ? `${ap.footMin} min 🚶` : '?', '≤ 15 min lopen', ap ? ap.label : 'geen binnen 2 km', 'nice'));
  const pk = r.green || r.park, dog = p.dogPark?.[0];
  const greens = [...(p.park || []), ...(p.green || [])].sort((a, b) => a.dist - b.dist);
  items.push(check('park', 'Uitlaatgebied (gras/park)', band(pk?.footMin, LOC.greenWalkMinOk, LOC.greenWalkMinWarn), pk ? `${pk.footMin} min 🚶` : '?', `≤ ${LOC.greenWalkMinOk} min lopen`, pk ? `${pk.label === 'park' || pk.label === 'grasveld/groen' ? 'grasveld/groen zonder naam' : pk.label}${names(greens, pk.label) ? `; ook ${names(greens, pk.label)}` : ''}${dog ? `; losloopgebied${dog.name ? ` ${dog.name}` : ''} op ${km(dog.dist)}` : ''}` : 'geen gras of park binnen 1,5 km', 'should'));
  const hosp = p.hospital?.[0];
  items.push(check('hospital', 'Ziekenhuis', hosp ? (hosp.dist <= 3000 ? 'ok' : hosp.dist <= 12000 ? 'warn' : 'fail') : 'unknown', hosp ? km(hosp.dist) : '?', '≤ 3 km', hosp?.name || '', 'nice'));
  const bus = p.busStop?.[0];
  items.push(check('bus', 'Bushalte', bus ? (bus.dist <= 400 ? 'ok' : 'warn') : 'unknown', bus ? `${num(bus.dist)} m` : '?', '≤ 400 m', bus?.name || '', 'nice'));
  const n = e.noise;
  items.push(check('noise', 'Geluidbronnen', n ? (n.majorRoads.length || n.rail.length ? 'warn' : 'ok') : 'unknown', n ? (n.majorRoads.length || n.rail.length ? [...n.majorRoads, ...n.rail].join(', ') : 'geen') : '?', 'geen drukke weg < 250 m, spoor < 200 m', '', 'nice'));
  const g = r.gouda;
  if (g) items.push(check('gouda', 'Naar Gouda', 'info', `${g.drivingMin} min 🚗`, '', `${g.bikeMin} min 🚲`, 'nice'));
  return { items, score: scoreOf(items) };
}

export function neighbourhoodChecks(listing) {
  const c = listing.enriched?.cbs;
  if (!c?.buurt?.naam) return { items: [check('cbs', 'Buurtcijfers', 'unknown', '?', '', 'nog niet verrijkt')], score: 0, rows: [] };
  const b = c.buurt, g = c.gemeente;
  const gem = (v, suffix = '%') => (v == null ? '' : `gemeente ${v}${suffix}`);
  const items = [];
  items.push(check('koop', 'Koopwoningen', b.percentageKoopwoningen == null ? 'unknown' : b.percentageKoopwoningen >= 55 ? 'ok' : b.percentageKoopwoningen >= 40 ? 'warn' : 'fail', `${b.percentageKoopwoningen ?? '?'}%`, '≥ 55%', gem(g.percentageKoopwoningen), 'should'));
  items.push(check('corp', 'Corporatiehuur', b.percHuurwoningenInBezitWoningcorporaties == null ? 'unknown' : b.percHuurwoningenInBezitWoningcorporaties <= 25 ? 'ok' : b.percHuurwoningenInBezitWoningcorporaties <= 45 ? 'warn' : 'fail', `${b.percHuurwoningenInBezitWoningcorporaties ?? '?'}%`, '≤ 25%', gem(g.percHuurwoningenInBezitWoningcorporaties), 'should'));
  const wozRatio = b.gemiddeldeWoningwaarde && g.gemiddeldeWoningwaarde ? b.gemiddeldeWoningwaarde / g.gemiddeldeWoningwaarde : null;
  items.push(check('woz', 'Gem. woningwaarde', wozRatio == null ? 'unknown' : wozRatio >= 1 ? 'ok' : wozRatio >= 0.8 ? 'warn' : 'fail', eur((b.gemiddeldeWoningwaarde || 0) * 1000), '≥ gemeente', `gemeente ${eur((g.gemiddeldeWoningwaarde || 0) * 1000)} (${pct(wozRatio - 1, 0)})`, 'should'));
  items.push(check('income', 'Lage inkomens', b.percentageHuishoudensMetLaagInkomen == null ? 'unknown' : b.percentageHuishoudensMetLaagInkomen <= g.percentageHuishoudensMetLaagInkomen + 3 ? 'ok' : b.percentageHuishoudensMetLaagInkomen <= g.percentageHuishoudensMetLaagInkomen + 12 ? 'warn' : 'fail', `${b.percentageHuishoudensMetLaagInkomen ?? '?'}%`, `≤ gemeente + 3%`, `gemeente ${g.percentageHuishoudensMetLaagInkomen}% · hoge inkomens ${b.percentageHuishoudensMetHoogInkomen}% (gemeente ${g.percentageHuishoudensMetHoogInkomen}%)`, 'should'));
  items.push(check('minimum', 'Rond sociaal minimum', b.percentageHuishoudensOnderOfRondSociaalMinimum == null ? 'unknown' : b.percentageHuishoudensOnderOfRondSociaalMinimum <= 6 ? 'ok' : b.percentageHuishoudensOnderOfRondSociaalMinimum <= 10 ? 'warn' : 'fail', `${b.percentageHuishoudensOnderOfRondSociaalMinimum ?? '?'}%`, '≤ 6%', gem(g.percentageHuishoudensOnderOfRondSociaalMinimum), 'nice'));
  const cr = listing.enriched?.crime;
  if (cr?.wijk?.per1000 != null && cr?.gemeente?.per1000 != null) {
    const ratio = cr.wijk.per1000 / (cr.gemeente.per1000 || 1);
    items.push(check('crime', 'Misdrijven per 1.000 inwoners', ratio <= 1.1 ? 'ok' : ratio <= 1.6 ? 'warn' : 'fail', `${String(cr.wijk.per1000).replace('.', ',')}`, '≤ gemeente', `wijk ${cr.wijk.naam} · gemeente ${String(cr.gemeente.per1000).replace('.', ',')} · NL ${String(cr.nl.per1000).replace('.', ',')} (${cr.period})`, 'should'));
    items.push(check('burglary', 'Woninginbraken per 1.000 inw.', cr.wijk.woninginbraakPer1000 <= (cr.gemeente.woninginbraakPer1000 || 0) * 1.2 ? 'ok' : 'warn', `${String(cr.wijk.woninginbraakPer1000).replace('.', ',')}`, '≤ gemeente', `gemeente ${String(cr.gemeente.woninginbraakPer1000).replace('.', ',')} · NL ${String(cr.nl.woninginbraakPer1000).replace('.', ',')}`, 'nice'));
  }
  items.push(check('age', '65-plussers', 'info', `${b.percentagePersonen65JaarEnOuder}%`, '', `${gem(g.percentagePersonen65JaarEnOuder)} · gezinnen ${b.percentageHuishoudensMetKinderen}% · alleenwonend ${b.percentageEenpersoonshuishoudens}%`, 'nice'));
  items.push(check('urban', 'Stedelijkheid', 'info', ['', 'zeer sterk (centrum)', 'sterk', 'matig', 'weinig', 'niet'][b.stedelijkheidAdressenPerKm2] || '?', '', `${num(b.bevolkingsdichtheidInwonersPerKm2)} inw/km² · ${b.percentageMeergezinswoning}% appartementen · ${b.percentageBouwjaarklasseVanaf2000}% na 2000`, 'nice'));
  const rows = [
    ['Inwoners', num(b.aantalInwoners), num(g.aantalInwoners)],
    ['Gem. woningwaarde (WOZ)', eur(b.gemiddeldeWoningwaarde * 1000), eur(g.gemiddeldeWoningwaarde * 1000)],
    ['Koopwoningen', `${b.percentageKoopwoningen}%`, `${g.percentageKoopwoningen}%`],
    ['Corporatiehuur', `${b.percHuurwoningenInBezitWoningcorporaties}%`, `${g.percHuurwoningenInBezitWoningcorporaties}%`],
    ['Huishoudens laag inkomen', `${b.percentageHuishoudensMetLaagInkomen}%`, `${g.percentageHuishoudensMetLaagInkomen}%`],
    ['Huishoudens hoog inkomen', `${b.percentageHuishoudensMetHoogInkomen}%`, `${g.percentageHuishoudensMetHoogInkomen}%`],
    ['Gem. inkomen per inwoner', b.gemiddeldInkomenPerInwoner ? eur(b.gemiddeldInkomenPerInwoner * 1000) : '–', g.gemiddeldInkomenPerInwoner ? eur(g.gemiddeldInkomenPerInwoner * 1000) : '–'],
    ['65-plussers', `${b.percentagePersonen65JaarEnOuder}%`, `${g.percentagePersonen65JaarEnOuder}%`],
    ['Gezinnen met kinderen', `${b.percentageHuishoudensMetKinderen}%`, `${g.percentageHuishoudensMetKinderen}%`],
    ['Eenpersoonshuishoudens', `${b.percentageEenpersoonshuishoudens}%`, `${g.percentageEenpersoonshuishoudens}%`],
    ['Herkomst Nederland', `${b.percentageMetHerkomstlandNederland}%`, `${g.percentageMetHerkomstlandNederland}%`],
    ['Appartementen', `${b.percentageMeergezinswoning}%`, `${g.percentageMeergezinswoning}%`],
    ['Bijstandsuitkeringen (aantal)', num(b.aantalPersonenMetEenAlgBijstandsuitkeringTot), num(g.aantalPersonenMetEenAlgBijstandsuitkeringTot)],
  ];
  return { items, score: scoreOf(items), rows, buurt: b.naam, gemeente: g.naam, narrative: neighbourhoodNarrative(b, g, cr, listing) };
}

// Uitleg in gewone taal: per kengetal wat het betekent voor pa & ma.
function neighbourhoodNarrative(b, g, cr, listing) {
  const rows = [];
  const d = (x, y) => (x == null || y == null ? 0 : x - y);
  const koop = b.percentageKoopwoningen, corp = b.percHuurwoningenInBezitWoningcorporaties;
  rows.push(['Type buurt', b.stedelijkheidAdressenPerKm2 === 1 ? 'Centrum, zeer stedelijk' : b.stedelijkheidAdressenPerKm2 === 2 ? 'Sterk stedelijk' : b.stedelijkheidAdressenPerKm2 === 3 ? 'Matig stedelijk' : 'Rustige woonwijk', b.stedelijkheidAdressenPerKm2 <= 2 ? 'Alles op loopafstand, maar reken op meer geluid, parkeerdruk en bezoekers dan in een woonwijk.' : 'Rustiger, meer groen, meer afhankelijk van fiets of auto.']);
  rows.push(['Koop of huur', `${koop}% koop, ${100 - koop}% huur (${corp}% corporatie)`, d(corp, g.percHuurwoningenInBezitWoningcorporaties) > 10 ? `Veel meer sociale huur dan gemiddeld in ${g.naam} (${g.percHuurwoningenInBezitWoningcorporaties}%): gemengde buurt met meer verloop en een minder homogene straat. Het complex zelf is koop.` : koop >= 60 ? 'Overwegend eigenaren: stabiele straat, meer sociale controle.' : 'Gemengde buurt, vergelijkbaar met de rest van de gemeente.']);
  const wozR = b.gemiddeldeWoningwaarde && g.gemiddeldeWoningwaarde ? b.gemiddeldeWoningwaarde / g.gemiddeldeWoningwaarde - 1 : null;
  if (wozR != null) rows.push(['Woningwaarde', `${eur(b.gemiddeldeWoningwaarde * 1000)} gemiddeld (${pct(wozR, 0)} t.o.v. gemeente)`, wozR < -0.1 ? `Goedkopere buurt: kleinere en oudere woningen eromheen. Dit appartement (${eur(listing.listing?.askingPrice)}) zit ruim in het hoogste segment van de buurt — fijn voor wonen, maar de buurt trekt de waarde niet omhoog.` : wozR > 0.1 ? 'Duurdere buurt dan gemiddeld: waardevast, gewilde omgeving.' : 'Gemiddelde buurt qua woningwaarde.']);
  rows.push(['Inkomen', `${b.percentageHuishoudensMetLaagInkomen}% lage, ${b.percentageHuishoudensMetHoogInkomen}% hoge inkomens`, d(b.percentageHuishoudensMetLaagInkomen, g.percentageHuishoudensMetLaagInkomen) > 5 ? `Lager inkomensprofiel dan ${g.naam} (${g.percentageHuishoudensMetLaagInkomen}% laag, ${g.percentageHuishoudensMetHoogInkomen}% hoog). Past bij veel sociale huur; zegt weinig over veiligheid, wel over voorzieningen en uitstraling.` : 'Inkomensprofiel vergelijkbaar met de gemeente.']);
  rows.push(['Wie wonen er', `${b.percentagePersonen65JaarEnOuder}% 65+, ${b.percentagePersonen25Tot45Jaar}% 25–45, ${b.percentageHuishoudensMetKinderen}% gezinnen, ${b.percentageEenpersoonshuishoudens}% alleen`, b.percentagePersonen65JaarEnOuder < g.percentagePersonen65JaarEnOuder - 3 ? 'Relatief jonge buurt met veel alleenwonenden; weinig leeftijdsgenoten van pa en ma in de straat, wel levendig.' : b.percentagePersonen65JaarEnOuder > g.percentagePersonen65JaarEnOuder + 3 ? 'Veel ouderen: rustig, veel leeftijdsgenoten.' : 'Gemengde leeftijdsopbouw.']);
  if (cr?.wijk?.per1000 != null) {
    const ratio = cr.wijk.per1000 / (cr.gemeente.per1000 || 1);
    rows.push(['Veiligheid', `${String(cr.wijk.per1000).replace('.', ',')} misdrijven per 1.000 inw. in wijk ${cr.wijk.naam}`, `${ratio > 1.5 ? 'Duidelijk meer' : ratio > 1.1 ? 'Iets meer' : 'Niet meer'} dan gemiddeld in ${g.naam} (${String(cr.gemeente.per1000).replace('.', ',')}) en Nederland (${String(cr.nl.per1000).replace('.', ',')}). Woninginbraken: ${String(cr.wijk.woninginbraakPer1000).replace('.', ',')} per 1.000 (gemeente ${String(cr.gemeente.woninginbraakPer1000).replace('.', ',')}). Centrumwijken scoren altijd hoger door winkeldiefstal en uitgaan; kijk vooral naar inbraak.`]);
  }
  const verdictParts = [];
  if (koop < 45 && corp > 35) verdictParts.push('gemengde centrumbuurt met veel sociale huur');
  else if (koop >= 60) verdictParts.push('stabiele koopbuurt');
  else verdictParts.push('gemengde buurt');
  if (wozR != null && wozR < -0.1) verdictParts.push('goedkoper dan de rest van Alphen');
  if (cr?.wijk?.per1000 != null) verdictParts.push(cr.wijk.per1000 / (cr.gemeente.per1000 || 1) > 1.3 ? 'meer criminaliteit dan gemiddeld (centrumeffect)' : 'veiligheid rond het gemiddelde');
  return { rows, conclusion: `Kort: ${verdictParts.join(', ')}. Loop er 's avonds een keer doorheen voordat je biedt.` };
}

// ---------- VvE ----------
export function vveChecks(listing) {
  const v = listing.vve;
  if (!v) return { items: [check('vve', 'VvE-stukken', 'unknown', 'niet ontvangen', '', 'jaarrekening, begroting, MJOP, notulen, reglement', 'must')], score: 0 };
  const units = v.units || null;
  const perUnit = units && v.reserveFund != null ? v.reserveFund / units : null;
  const dotPerUnit = units && v.annualDotation != null ? v.annualDotation / units : null;
  const m2 = listing.listing?.livingArea;
  const perM2 = m2 && v.monthly ? v.monthly / m2 : null;
  const items = [
    check('reserve', 'Reservefonds per appartement', perUnit == null ? 'unknown' : perUnit >= 5000 ? 'ok' : perUnit >= 2500 ? 'warn' : 'fail', perUnit == null ? '?' : eur(perUnit), '≥ €5.000', perUnit == null ? '' : `totaal ${eur(v.reserveFund)} (${v.reserveFundDate || ''})`, 'must'),
    check('mjop', 'Meerjarenonderhoudsplan', v.mjop ? 'ok' : 'fail', v.mjop ? 'aanwezig' : 'ontbreekt', 'verplicht', v.mjop || '', 'must'),
    check('dotation', 'Reservering per appartement per jaar', dotPerUnit == null ? 'unknown' : dotPerUnit >= 900 ? 'ok' : dotPerUnit >= 500 ? 'warn' : 'fail', dotPerUnit == null ? '?' : eur(dotPerUnit), '≥ €900', dotPerUnit == null ? '' : `totaal ${eur(v.annualDotation)}/jaar; wettelijk 0,5% van de herbouwwaarde`, 'should'),
    check('result', 'Exploitatieresultaat', v.result2025 == null ? 'unknown' : v.result2025 >= 0 ? 'ok' : 'warn', v.result2025 == null ? '?' : eur(v.result2025), 'positief', v.result2024 != null ? `jaar ervoor ${eur(v.result2024)}` : '', 'should'),
    check('arrears', 'Betalingsachterstanden', v.arrears == null ? 'unknown' : v.arrears <= (units || 1) * 100 ? 'ok' : v.arrears <= (units || 1) * 500 ? 'warn' : 'fail', v.arrears == null ? '?' : eur(v.arrears), `≤ ${eur((units || 1) * 100)}`, '', 'should'),
    check('manager', 'Beheer', v.manager ? 'ok' : 'warn', v.manager ? 'professioneel' : 'zelfbeheer', 'professioneel', v.manager || '', 'nice'),
    check('contribution', 'Maandbijdrage per m²', perM2 == null ? 'unknown' : perM2 <= 3.5 ? 'ok' : perM2 <= 4.5 ? 'warn' : 'fail', perM2 == null ? '?' : eur(perM2, 2), '≤ €3,50', perM2 == null ? '' : `${eur(v.monthly, 2)} per maand`, 'should'),
    check('risks', 'Risico\'s uit de notulen', !v.risks?.length ? 'ok' : 'warn', `${v.risks?.length || 0}`, 'liefst 0', v.risks?.length ? 'zie hieronder' : 'geen bijzonderheden', 'should'),
  ];
  return { items, score: scoreOf(items) };
}

// ---------- Financiën ----------
export function annuity(principal, rate, years) {
  if (!principal || principal <= 0) return 0;
  const r = rate / 12, n = years * 12;
  return (principal * r) / (1 - (1 + r) ** -n);
}
export function remainingAfter(principal, rate, years, afterYears) {
  const r = rate / 12, n = years * 12, k = afterYears * 12;
  if (!principal || principal <= 0) return 0;
  return principal * ((1 + r) ** n - (1 + r) ** k) / ((1 + r) ** n - 1);
}

export function buyingCosts(price, a) {
  const rows = [
    ['Overdrachtsbelasting', price * a.transferTaxRate, `${pct(a.transferTaxRate)} (koper ouder dan 35, eigen bewoning)`],
    ['Notaris (leverings- + hypotheekakte)', a.notaryCost, 'schatting'],
    ['Hypotheekadvies & bemiddeling', a.advisorCost, 'schatting'],
    ['Taxatie', a.valuationCost, 'verplicht voor de bank'],
    ['Bouwkundige keuring', a.inspectionCost, 'aanbevolen bij aankoop'],
    ['Aankoopmakelaar', a.buyersAgentCost, 'optioneel'],
    ['Bankgarantie', price * a.bankGuaranteeRate, '±1% over de 10% waarborgsom'],
  ];
  const total = rows.reduce((s, r) => s + r[1], 0);
  return { rows, total, pctOfPrice: total / price };
}

export function equity(profile) {
  const ch = profile.currentHome;
  const woz = ch.woz?.latest?.value ?? null;
  const value = ch.estimatedValue ?? (woz ? woz * (1 + (ch.assumedMarketUpliftOverWoz ?? 0)) : null);
  const remaining = (ch.originalMortgage ?? 0) - (ch.paidOff ?? 0);
  const sellingCost = value ? value * profile.assumptions.sellingCostRate : 0;
  const net = value != null ? value - remaining - sellingCost : null;
  return { woz, wozYear: ch.woz?.latest?.year ?? null, value, remaining, sellingCost, net, wozHistory: ch.woz?.history || [] };
}

export function maxAffordablePrice(profile, eq) {
  const a = profile.assumptions;
  const fixed = a.notaryCost + a.advisorCost + a.valuationCost + a.inspectionCost + a.buyersAgentCost + a.movingCost;
  const cash = (profile.income.maxMortgageFromIncome || 0) + (eq.net || 0) - fixed;
  return cash / (1 + a.transferTaxRate + a.bankGuaranteeRate);
}

export function financeFor(price, listing, profile, eq) {
  const a = profile.assumptions;
  const kk = buyingCosts(price, a);
  const totalNeed = price + kk.total + a.movingCost;
  const mortgage = Math.max(0, totalNeed - (eq.net || 0));
  const maxMortgage = profile.income.maxMortgageFromIncome;
  const ltv = mortgage / price;
  const fits = mortgage <= maxMortgage && ltv <= 1;
  const monthlyMortgage = annuity(mortgage, a.interestRate, a.termYears);
  const interestY1 = mortgage * a.interestRate;
  const wozNow = listing.enriched?.woz?.latest?.value ?? price * 0.85;
  const taxBenefit = Math.max(0, interestY1 * (a.mortgageInterestDeductionRate ?? 0.37) - wozNow * (a.ewfRate ?? 0.0035) * (a.mortgageInterestDeductionRate ?? 0.37)) / 12;
  const m2 = listing.listing?.livingArea || 90;
  const monthly = [
    ['Hypotheek (annuïteit, bruto)', monthlyMortgage, `${eur(mortgage)} tegen ${pct(a.interestRate, 1)}, ${a.termYears} jaar`],
    ['VvE-bijdrage', listing.listing?.vveMonthly ?? listing.vve?.monthly ?? 0, 'incl. opstalverzekering en reservering onderhoud'],
    ['OZB (gemeente)', (wozNow * a.ozbRate) / 12, `${pct(a.ozbRate, 3)} van WOZ ${eur(wozNow)}`],
    ['Waterschap + riool + afval', (a.waterschapPerYear + a.rioolheffingPerYear + a.afvalstoffenheffingPerYear) / 12, 'gemeentelijke heffingen, schatting'],
    ['Energie (gas + stroom)', m2 * a.energyPerMonthPerM2, `label ${listing.listing?.energyLabel ?? '?'}, ${m2} m², schatting`],
    ['Inboedelverzekering e.d.', a.insurancePerMonth, 'schatting'],
    ['Eigen onderhoud binnen', a.maintenancePerMonth, 'reservering'],
  ];
  const monthlyTotal = monthly.reduce((s, r) => s + r[1], 0);
  return { price, kk, totalNeed, mortgage, maxMortgage, ltv, fits, monthlyMortgage, monthly, monthlyTotal, taxBenefit, monthlyNet: monthlyTotal - taxBenefit, ownMoney: Math.min(eq.net || 0, totalNeed) };
}

// ---------- Bod & waarde ----------
export function bidAnalysis(listing, profile, eq) {
  const l = listing.listing || {};
  const a = profile.assumptions;
  const asking = l.askingPrice;
  if (!asking) return null;
  const refPerM2 = l.fundaNeighborhood?.askingPerM2 || profile.market.alphenApartmentAskingPerM2;
  const refSource = l.fundaNeighborhood?.askingPerM2 ? `Funda: gem. vraagprijs/m² in ${l.fundaNeighborhood.name}` : 'aanname Alphen-appartementen';
  let m2Model = (l.livingArea || 0) * refPerM2 + (l.outdoorArea || 0) * a.outdoorAreaFactor * refPerM2 + (l.ownParking ? a.parkingSpotValue : 0);
  const adjustments = [];
  if (/penthouse/i.test(l.type || '') || l.topFloor) { m2Model *= 1 + a.topFloorPremium; adjustments.push(`+${pct(a.topFloorPremium)} bovenste laag / penthouse`); }
  const labelAdj = a.energyLabelAdjust?.[l.energyLabel] ?? 0;
  if (labelAdj) { m2Model *= 1 + labelAdj; adjustments.push(`${labelAdj > 0 ? '+' : ''}${pct(labelAdj)} energielabel ${l.energyLabel}`); }
  const woz = listing.enriched?.woz?.latest;
  let wozAnchor = null, wozYears = null;
  if (woz) {
    wozYears = (Date.now() - new Date(`${woz.year}-01-01`).getTime()) / (365.25 * 24 * 3600e3);
    wozAnchor = woz.value * (1 + a.marketUpliftOverWoz) ** wozYears;
  }
  const indicative = wozAnchor ? 0.6 * m2Model + 0.4 * wozAnchor : m2Model;
  const premium = asking / indicative - 1;
  const days = l.listedSince ? Math.max(1, Math.round((new Date(l.statsDate || Date.now()).getTime() - new Date(l.listedSince).getTime()) / 864e5)) : null;
  const savesPerDay = days && l.saves != null ? l.saves / days : null;
  const demand = savesPerDay == null ? 'onbekend' : savesPerDay >= 5 ? 'hoog' : savesPerDay >= 2 ? 'gemiddeld' : 'laag';
  const demandFactor = demand === 'hoog' ? 1.06 : demand === 'gemiddeld' ? 1.03 : 1.0;
  const biedenVanaf = /bieden vanaf/i.test(l.askingPriceType || '');
  let low = round1000(Math.min(asking * 0.96, indicative * 0.97));
  let high = round1000(Math.min(Math.max(asking * demandFactor, indicative * 1.03), profile.budget.stretchMax));
  let opening = round1000(Math.min(asking * (demand === 'hoog' ? 1.0 : demand === 'gemiddeld' ? 0.98 : 0.965), indicative * 1.0));
  if (biedenVanaf) { low = asking; opening = round1000(Math.max(asking * 1.01, Math.min(indicative, asking * 1.04))); high = round1000(Math.min(Math.max(asking * 1.08, indicative * 1.04), profile.budget.stretchMax)); }
  const maxAff = maxAffordablePrice(profile, eq);
  const ceiling = round1000(Math.min(profile.budget.max, maxAff));
  const rows = [
    ['m²-model', eur(round1000(m2Model)), `${l.livingArea} m² × ${eur(refPerM2)} (${refSource}) + ${l.outdoorArea || 0} m² buiten × ${a.outdoorAreaFactor}${l.ownParking ? ` + parkeerplaats ${eur(a.parkingSpotValue)}` : ''}${adjustments.length ? ` → ${adjustments.join(', ')}` : ''}`],
    ['WOZ-anker', woz ? eur(round1000(wozAnchor)) : '–', woz ? `WOZ ${eur(woz.value)} (1-1-${woz.year}) + ${pct(a.marketUpliftOverWoz)} per jaar × ${wozYears.toFixed(1).replace('.', ',')} jaar` : 'geen WOZ beschikbaar'],
    ...(woz ? [['Vraagprijs t.o.v. WOZ', pct(asking / woz.value - 1, 0), `WOZ ${eur(woz.value)} is de waarde per 1-1-${woz.year} (±${Math.round(wozYears * 12)} maanden oud); na de stijging sindsdien is +10% tot +20% normaal — ${asking / woz.value - 1 > 0.22 ? 'dit zit daar ruim boven: onderhandelingsargument' : asking / woz.value - 1 < 0.05 ? 'dit is scherp: vraagprijs rond of onder de WOZ' : 'dit is binnen de normale marge'}`]] : []),
    ['Indicatieve waarde', eur(round1000(indicative)), '60% m²-model + 40% WOZ-anker'],
    ['Vraagprijs t.o.v. waarde', pct(premium, 1), premium > 0.08 ? 'stevig geprijsd' : premium > 0.02 ? 'iets aan de hoge kant' : premium > -0.03 ? 'marktconform' : 'scherp geprijsd'],
    ['Belangstelling', demand, days ? `${l.saves ?? '?'}× bewaard, ${num(l.views)}× bekeken in ${days} dagen (${savesPerDay?.toFixed(1).replace('.', ',')}/dag)` : 'geen Funda-statistieken'],
    ...(biedenVanaf ? [['Bieden vanaf', eur(asking), `ondergrens; reken op ${eur(round1000(asking * 1.03))} – ${eur(round1000(asking * 1.08))}`]] : []),
    ['Plafond', eur(ceiling), `laagste van budget-max ${eur(profile.budget.max)} en maximaal betaalbaar ${eur(round1000(maxAff))}`],
  ];
  return { asking, biedenVanaf, refPerM2, refSource, m2Model, wozAnchor, indicative, premium, demand, days, savesPerDay, low, high, opening, ceiling, maxAff, rows };
}

// ---------- Rendement & investering ----------
export function projectYears(price, fin, profile, g) {
  const a = profile.assumptions;
  const H = a.horizonYears;
  const valueH = price * (1 + g) ** H;
  const loanH = remainingAfter(fin.mortgage, a.interestRate, a.termYears, H);
  const repaid = fin.mortgage - loanH;
  const sell = valueH * a.sellingCostRate;
  const equityH = valueH - loanH - sell;
  const invested = fin.ownMoney;
  const gain = equityH - invested - repaid;
  return { g, H, valueH, loanH, repaid, equityH, invested, gain, annualized: invested + repaid > 0 ? (equityH / (invested + repaid)) ** (1 / H) - 1 : null };
}
export function roiScenarios(price, fin, profile) {
  const a = profile.assumptions;
  return { H: a.horizonYears, scenarios: a.appreciationScenarios.map((g) => projectYears(price, fin, profile, g)), breakEven: ((price + fin.kk.total) / (price * (1 - a.sellingCostRate))) ** (1 / a.horizonYears) - 1 };
}

export function investmentOutlook(listing, profile, bid, fin, market) {
  const a = profile.assumptions;
  const l = listing.listing || {};
  if (!l.askingPrice || !fin) return null;
  const longTerm = a.baseAppreciation ?? 0.03;
  const yoy = market?.national?.latest?.yoy;
  const base = yoy != null ? Math.min(0.06, Math.max(0.0, (longTerm + yoy / 100) / 2)) : longTerm;
  const factors = [[`Basis: gemiddelde van langjarig ${pct(longTerm)} en actuele CBS-stijging ${yoy != null ? pct(yoy / 100, 1) : '–'}`, base]];
  let g = base;
  const add = (label, delta) => { g += delta; factors.push([label, delta]); };
  const rank = ENERGY_RANK[l.energyLabel] ?? 4;
  if (rank >= 7) add(`Energielabel ${l.energyLabel}: gasloos/toekomstbestendig, geen verduurzamingskosten`, 0.005);
  else if (rank >= 5) add(`Energielabel ${l.energyLabel}: zuinig, beperkte toekomstige kosten`, 0.003);
  else if (rank === 4) add('Energielabel B: gasketel blijft, op termijn verduurzamen', -0.001);
  else add(`Energielabel ${l.energyLabel}: verduurzaming nodig`, -0.005);
  if (bid) {
    if (bid.premium <= -0.03) add('Vraagprijs onder de indicatieve waarde: marge bij aankoop', 0.004);
    else if (bid.premium >= 0.08) add('Vraagprijs ruim boven de indicatieve waarde: premie betaald', -0.004);
    else if (bid.premium >= 0.04) add('Vraagprijs iets boven de indicatieve waarde', -0.002);
  }
  if (l.buildYear >= 2020) add('Nieuwbouw: nauwelijks onderhoud de eerste 10 jaar', 0.002);
  else if (l.buildYear && l.buildYear < 2000) add('Ouder gebouw: hogere onderhoudslasten', -0.002);
  const cbs = listing.enriched?.cbs?.buurt;
  if (cbs?.percentageKoopwoningen >= 60) add('Buurt met veel koopwoningen: stabiele vraag', 0.002);
  else if (cbs?.percentageKoopwoningen != null && cbs.percentageKoopwoningen < 45) add('Buurt met veel huur: minder prijsdruk omhoog', -0.002);
  if (/penthouse/i.test(l.type || '') || (l.outdoorArea || 0) >= 30) add('Schaars segment (penthouse / grote buitenruimte)', 0.002);
  const woz = listing.enriched?.woz;
  const hist5 = woz?.growth5y ?? null;
  const first = woz?.history?.[0], latest = woz?.latest;
  const hist10 = first && latest && latest.year - first.year >= 8 ? (latest.value / first.value) ** (1 / (latest.year - first.year)) - 1 : null;
  const low = Math.max(-0.01, g - 0.015), high = g + 0.015;
  const projections = { low: projectYears(l.askingPrice, fin, profile, low), mid: projectYears(l.askingPrice, fin, profile, g), high: projectYears(l.askingPrice, fin, profile, high) };
  const score = Math.max(0, Math.min(100, Math.round(50 + (g - longTerm) * 2000 - (bid ? bid.premium * 100 : 0))));
  return { expected: g, low, high, base, factors, hist5, hist10, projections, score };
}

// ---------- Advies ----------
const riskTitle = (risk) => (typeof risk === 'string' ? risk.split(/ — |: |; /)[0] : risk.title);
const riskDetail = (risk) => (typeof risk === 'string' ? risk : risk.detail || '');
export function adviceFor(listing, r) {
  const vveValue = r.vve.assessed ? `${r.vve.score}% (${r.vve.score >= 75 ? 'gezond' : r.vve.score >= 50 ? 'aandachtspunten' : 'zwak'})` : 'niet beoordeeld';
  const oordeel = [
    ['Oordeel', `${r.verdict} · ${r.score}/100`, 'op woning, locatie, buurt en prijs'],
    ['VvE (apart)', vveValue, r.vve.assessed ? 'telt niet mee in de score' : 'aanname: gezond — stukken opvragen vóór een bod'],
    ...(r.wishes.mustFails.length ? [['Harde eis gemist', r.wishes.mustFails.map((m) => m.label).join(', '), 'reden om af te vallen']] : []),
  ];
  const compromises = r.wishes.items.filter((i) => i.weight !== 'must' && i.status === 'fail');
  if (compromises.length) oordeel.push(['Compromis', compromises.map((c) => c.label).join(', '), 'wensen die deze woning niet haalt']);
  const bod = r.bid ? [
    ['Openingsbod', eur(r.bid.opening), r.bid.biedenVanaf ? 'nooit onder "bieden vanaf"' : `${pct(r.bid.opening / r.bid.asking - 1, 1)} t.o.v. vraagprijs`],
    ['Bovengrens', eur(r.bid.high), 'onderhandelingsruimte'],
    ['Harde grens', eur(r.bid.ceiling), 'budget-max / maximaal betaalbaar'],
    ['Belangstelling', r.bid.demand, r.bid.days ? `${r.bid.days} dagen op Funda` : ''],
  ] : [];
  const financiering = r.finAsking ? [
    ['Past het?', r.finAsking.fits ? '✅ ja' : '❌ nee', r.finAsking.fits ? `ruimte ${eur(r.finAsking.maxMortgage - r.finAsking.mortgage)}` : `tekort ${eur(r.finAsking.mortgage - r.finAsking.maxMortgage)}`],
    ['Hypotheek', eur(r.finAsking.mortgage), `${pct(r.finAsking.ltv)} van de koopsom`],
    ['Maandlast', `${eur(r.finAsking.monthlyTotal)} bruto`, `±${eur(r.finAsking.monthlyNet)} netto`],
    ...(r.investment ? [['Verwachte stijging', `${pct(r.investment.expected, 1)} per jaar`, `${eur(r.investment.projections.mid.valueH)} over ${r.investment.projections.mid.H} jaar`]] : []),
  ] : [];
  const covered = new Set(compromises.map((c) => c.id));
  const letOp = [
    ...r.minusesAll.filter((x) => x.status === 'fail' && !covered.has(x.id)).slice(0, 3).map((m) => ({ icon: '❌', title: m.label, detail: [m.value, m.note].filter(Boolean).join(' · ') })),
    ...(r.vve.assessed ? (listing.vve.risks || []).slice(0, 3).map((risk) => ({ icon: '⚠️', title: `VvE: ${riskTitle(risk)}`, detail: riskDetail(risk) !== riskTitle(risk) ? riskDetail(risk) : '' })) : []),
  ];
  const doen = [
    'Bezichtigen met de checklist hierboven (geluid, licht, kozijnen, lift, berging, parkeren)',
    r.vve.assessed ? 'VvE-vragen stellen aan de makelaar vóór het bod' : 'VvE-stukken opvragen en laten beoordelen',
    'Bouwkundige keuring + financieringsvoorbehoud als ontbindende voorwaarden',
    'Hypotheekadviseur: pensioentoets en rentevaste periode bespreken',
  ];
  return { headline: `${r.verdict} — ${r.score}/100`, oordeel, bod, financiering, letOp, doen };
}

export function marketTiming(market, profile, eq, typicalPrice) {
  if (!market?.national?.latest) return null;
  const n = market.national.latest, apt = market.byType?.appartement?.latest, sfh = market.byType?.eengezins?.latest, reg = market.region?.latest;
  const recent = market.national.series.slice(-3);
  const momAvg = recent.reduce((s, r) => s + (r.mom || 0), 0) / (recent.length || 1);
  const tone = n.yoy >= 3 ? 'up' : n.yoy >= 0 ? 'flat' : 'down';
  const signed = (v, d = 1) => `${v >= 0 ? '+' : '−'}${pct(Math.abs(v) / 100, d)}`;
  const rows = [
    ['Landelijk', `${signed(n.yoy)} per jaar`, `CBS ${n.label} · ${signed(momAvg)} per maand (laatste 3 mnd) · gem. verkoopprijs ${eur(n.avgPrice)}`],
    ...(apt ? [['Appartementen', `${signed(apt.yoy)} per jaar`, `${apt.label} · gem. ${eur(apt.avgPrice)}`]] : []),
    ...(sfh ? [['Eengezinswoningen', `${signed(sfh.yoy)} per jaar`, `${sfh.label} · gem. ${eur(sfh.avgPrice)}${apt ? (sfh.yoy > apt.yoy ? ' · huizen stijgen sneller dan appartementen: gunstig voor deze stap' : ' · appartementen stijgen sneller: wachten maakt de stap duurder') : ''}`]] : []),
    ...(reg ? [['Zuid-Holland', `${signed(reg.yoy)} per jaar`, reg.label]] : []),
  ];
  const wh = eq.wozHistory || [];
  if (wh.length >= 2) {
    const last = wh[wh.length - 1], prev = wh[wh.length - 2], five = wh.find((h) => h.year === last.year - 5);
    rows.push(['Beukelaan (WOZ)', `${signed((last.value / prev.value - 1) * 100)} in 1 jaar`, `${eur(prev.value)} → ${eur(last.value)}${five ? ` · ${pct((last.value / five.value) ** (1 / 5) - 1, 1)} per jaar over 5 jaar` : ''} · WOZ loopt ruim een jaar achter`]);
  }
  const [by, bm] = (profile.buyers.fatherBirthMonth || '1971-02').split('-').map(Number);
  const deadline = new Date(by + (profile.buyers.buyBeforeAge || 57), bm - 1, 1);
  const monthsLeft = Math.max(0, Math.round((deadline - Date.now()) / (30.44 * 864e5)));
  rows.push(['Deadline pa', deadline.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }), `${monthsLeft} maanden · reken 2–3 maanden van bod tot overdracht`]);
  const step = typicalPrice && eq.value ? typicalPrice - eq.value : null;
  if (step != null) rows.push(['Prijsverschil', `${step >= 0 ? '+' : '−'}${eur(Math.abs(step))}`, `appartement t.o.v. waarde Beukelaan${step > 0 ? ` · groeit bij ${signed(n.yoy)} met ±${eur(step * n.yoy / 100)} per jaar` : ' · wachten kost weinig'}`]);
  const verdict = tone === 'up'
    ? `Stijgende markt, jullie verkopen én kopen erin: timing is geen gok. Nu zoeken, kopen met financieringsvoorbehoud, daarna de Beukelaan verkopen (overbrugging op ±${eur(eq.net)} overwaarde).`
    : tone === 'flat'
      ? 'Vlakke markt: kies op de woning, niet op timing. Eerst verkopen met een lange opleverdatum is de veiligste route.'
      : 'Dalende markt: eerst verkopen, dan kopen, en scherp onderhandelen.';
  return { tone, rows, verdict, updatedAt: market.updatedAt, source: market.source };
}

export function assumptionsList(profile, eq) {
  const a = profile.assumptions, ch = profile.currentHome;
  return [
    ['Waarde Beukelaan', eur(eq.value), `WOZ ${eur(eq.woz)} (${eq.wozYear}) + ${pct(ch.assumedMarketUpliftOverWoz)}; laat een makelaar taxeren`],
    ['Restschuld', eur(eq.remaining), `${eur(ch.originalMortgage)} oorspronkelijk − ${eur(ch.paidOff)} afgelost (opgave pa, niet gecontroleerd)`],
    ['Max. hypotheek', eur(profile.income.maxMortgageFromIncome), 'opgave pa op basis van inkomen; pensioentoets nog niet meegenomen'],
    ['Hypotheekrente', pct(a.interestRate, 1), `${a.termYears} jaar annuïtair; werkelijke rente hangt af van rentevaste periode en LTV`],
    ['Kosten koper', `${pct(a.transferTaxRate)} + ±${eur(a.notaryCost + a.advisorCost + a.valuationCost + a.inspectionCost + a.buyersAgentCost)}`, 'overdrachtsbelasting + notaris, advies, taxatie, keuring, aankoopmakelaar'],
    ['Waardestijging', `${pct(a.baseAppreciation ?? 0.03)} langjarig`, 'gecombineerd met de actuele CBS-stijging en per woning bijgesteld (label, prijs, bouwjaar, buurt)'],
    ['VvE zonder stukken', 'gezond', 'telt niet mee in de score; wordt apart beoordeeld zodra de stukken er zijn'],
    ['Buitenruimte / parkeerplaats', `${a.outdoorAreaFactor}× m²-prijs / ${eur(a.parkingSpotValue)}`, 'in het m²-model voor de indicatieve waarde'],
    ['Verkoopkosten', pct(a.sellingCostRate, 1), 'makelaar + notaris bij verkoop'],
  ];
}

export function rankListings(entries) {
  const byScore = [...entries].sort((x, y) => y.a.score - x.a.score);
  const byInvestment = [...entries].sort((x, y) => (y.a.investment?.score ?? 0) - (x.a.investment?.score ?? 0));
  const byMonthly = [...entries].filter((e) => e.a.finAsking).sort((x, y) => x.a.finAsking.monthlyTotal - y.a.finAsking.monthlyTotal);
  return { byScore, byInvestment, byMonthly };
}

export function overallAdvice(entries) {
  if (!entries.length) return null;
  const name = (e) => `${e.listing.address.street} ${e.listing.address.number}`;
  const { byScore, byInvestment, byMonthly } = rankListings(entries);
  const best = byScore[0], inv = byInvestment[0], cheap = byMonthly[0];
  const rows = [
    ['Beste op score', `${name(best)} (${best.a.score})`, byScore.length > 1 ? `daarna ${byScore.slice(1).map((e) => `${name(e)} (${e.a.score})`).join(', ')} · aanname: alle VvE's gezond` : ''],
  ];
  const notAssessed = entries.filter((e) => !e.a.vve.assessed);
  const weak = entries.filter((e) => e.a.vve.assessed && e.a.vve.score < 60);
  if (notAssessed.length) rows.push(['VvE nog niet beoordeeld', notAssessed.map(name).join(', '), 'een zwakke VvE kan de volgorde omgooien']);
  if (weak.length) rows.push(['Zwakke VvE', weak.map(name).join(', '), 'extra voorzichtig']);
  if (inv?.a.investment) rows.push(['Beste investering', `${name(inv)} (${pct(inv.a.investment.expected, 1)}/jr)`, inv.a.investment.factors.slice(1, 4).map((f) => f[0].split(':')[0]).join(', ')]);
  if (cheap) rows.push(['Laagste maandlast', `${name(cheap)} (${eur(cheap.a.finAsking.monthlyTotal)})`, 'bruto per maand bij de vraagprijs']);
  return { headline: `Advies: ${name(best)}`, best, rows };
}

// ---------- Bezichtiging: vragen met prioriteit en 'waarom', minpunten, rondgang ----------
// priority: 3 = hoog (🔴), 2 = middel (🟠), 1 = laag (⚪). group: 'woning' (verkoper/makelaar), 'vve', 'rondgang'.
const Q = (text, why, priority = 2, group = 'woning') => ({ text, why, priority, group });
const WISH_QUESTIONS = {
  corner: Q('Is het een hoekappartement en aan welke kanten zitten ramen? Hoe is de lichtinval in de ochtend en de middag?', 'Lichtinval is een wens van ma; alleen te beoordelen ter plekke en per dagdeel.', 2),
  floorHeating: Q('Is er vloerverwarming (in welke ruimtes) en hoe wordt er verwarmd en gekoeld?', 'Wens; bepaalt comfort en toekomstige verduurzamingskosten.', 2),
  airco: Q('Is er airco, wie heeft die geplaatst en met toestemming van de VvE? Is er een onderhoudscontract?', 'Buitenunits aan gevel of op terras vallen onder VvE-regels; zonder toestemming kan verwijdering geëist worden.', 2),
  bath: Q('Is er ruimte en aansluiting om alsnog een ligbad te plaatsen?', 'Wens van pa; een bad plaatsen kost €3.000–6.000 als het kan.', 2),
  lift: Q('Werkt de lift betrouwbaar? Hoe oud is hij, wanneer was de laatste keuring en wie onderhoudt hem?', 'Ouders wonen boven de begane grond; een lift die vaak stilstaat is dagelijks probleem.', 3),
  balcony: Q('Op welke windrichting ligt het balkon/terras en hoeveel uur zon in zomer en winter?', 'Buitenruimte is een wens; zon per seizoen zie je niet op de foto\'s.', 2),
  parking: Q('Hoort de parkeerplaats bij de koopsom of is het een apart appartementsrecht of huur? Hoe zit het met bezoekersparkeren?', 'Losse parkeerplaats kan €15.000–35.000 schelen; bezoek van kinderen moet kunnen parkeren.', 2),
  moveInReady: Q('Wat moet er echt nog gebeuren voor jullie erin kunnen (keuken, badkamer, vloer, schilderwerk)?', 'Instapklaar is een harde eis; makelaarstaal is rekbaar.', 3),
  energyLabel: Q('Wat waren de energiekosten (gas en stroom) van het laatste jaar? Leeftijd van cv-ketel of warmtepomp?', 'Maandlasten en vervangingskosten (ketel ±€2.500, warmtepomp ±€8.000).', 2),
  maxFloor: Q('Op welke verdieping precies en wat zit er boven en onder (dak, buren, garage)?', 'Max 3e etage is een eis; wat erboven zit bepaalt geluid en lekkagerisico.', 2),
};
const GENERIC_QUESTIONS = [
  Q('Waarom verkopen de eigenaren en hoe snel willen ze leveren (opleverdatum)?', 'Motief en tijdsdruk bepalen je onderhandelingspositie.', 3),
  Q('Zijn er al biedingen of bezichtigingen geweest? Hoe loopt het biedproces (vraagprijs, inschrijving, deadline)?', 'Bepaalt of je onder de vraagprijs kunt openen of moet overbieden.', 3),
  Q('Zijn er ooit lekkages, vocht- of schimmelproblemen geweest in de woning of het gebouw?', 'Verkoper heeft meldingsplicht; verborgen gebreken zijn de duurste verrassing.', 3),
  Q('Hoe gehorig is het: wat hoor je van buren boven, onder en naast? Zijn er klachten of geschillen bekend?', 'Geluid is de meest genoemde spijtfactor bij appartementen en is niet te verbouwen.', 3),
  Q('Wat blijft er achter (lijst van zaken: gordijnen, lampen, apparatuur, vloer) en wat nemen ze mee?', 'Voorkomt discussie bij de overdracht; zonwering en airco zijn dure posten.', 2),
  Q('Is de woning volle eigendom (geen erfpacht)? Zijn er bouwplannen in de omgeving die uitzicht of rust veranderen?', 'Erfpacht en bouwplannen drukken de waarde en het woongenot.', 2),
  Q('Mogen we een bouwkundige keuring laten doen en een financieringsvoorbehoud opnemen?', 'Ontbindende voorwaarden beschermen de koop; sommige verkopers weigeren.', 2),
  Q('Zijn er huisregels die voor ons tellen: huisdieren, harde vloeren, verhuur, zonwering, airco?', 'Staat in het huishoudelijk reglement; beperkt wat je mag veranderen.', 1, 'vve'),
  Q('Mogen we de notulen van de laatste twee jaar, jaarrekening, begroting, MJOP, splitsingsakte en reglement ontvangen?', 'Zonder stukken is de VvE niet te beoordelen; die telt hier apart mee.', 3, 'vve'),
  Q('Hoogte van de maandbijdrage, stand van het reservefonds, gepland groot onderhoud en eventuele extra bijdragen de komende jaren?', 'Een eenmalige heffing van €5.000–15.000 per appartement komt voor bij achterstallig onderhoud.', 3, 'vve'),
];
const ON_SITE = [
  Q('Sta 2 minuten stil in woonkamer en slaapkamer: hoor je verkeer, buren, lift, installaties?', 'Geluid is niet te verbouwen.', 3, 'rondgang'),
  Q('Lichtinval per ruimte en windrichting van balkon/terras (kompas op je telefoon).', 'Wens: licht en zon.', 2, 'rondgang'),
  Q('Kozijnen en ramen: hout of kunststof, schilderwerk, condens tussen het glas, hang- en sluitwerk.', 'Houtrot en lekkende kozijnen zijn dure VvE-posten.', 3, 'rondgang'),
  Q('Badkamer en keuken: kitranden, schimmel, waterdruk (douche aanzetten), afvoer, leeftijd apparatuur.', 'Vochtplekken verraden lekkage; apparatuur ouder dan 10 jaar = vervangen.', 2, 'rondgang'),
  Q('Plafonds en wanden: vochtplekken, verkleuring, scheuren, bobbels in verf of stuc.', 'Eerste tekenen van lekkage of zetting.', 3, 'rondgang'),
  Q('Meterkast: aantal groepen, aardlekschakelaars, glasvezel, ruimte voor laadpaal of airco.', 'Uitbreiden kost €1.000–2.500.', 1, 'rondgang'),
  Q('Gemeenschappelijk: entree, galerij/trappenhuis, lift, berging, fietsenstalling, parkeerplaats, netheid en verlichting.', 'Staat van het gebouw zegt meer over de VvE dan de brochure.', 2, 'rondgang'),
  Q('Uitzicht en privacy: wie kijkt naar binnen, hoe dicht staan buren, zicht vanaf het terras?', 'Privacy op een terras bepaalt of je hem echt gebruikt.', 2, 'rondgang'),
  Q('Bereik en gemak: mobiel bereik, afstand lift tot voordeur, drempels, gelijkvloers en rolstoelvriendelijk?', 'Ouders willen hier lang blijven wonen.', 2, 'rondgang'),
  Q('Loop na afloop 10 minuten door de buurt en naar de supermarkt: sfeer, parkeerdruk, geluid, onderhoud van de straat.', 'Buurtcijfers zijn gemiddelden; de straat zelf zie je alleen zo.', 2, 'rondgang'),
];
const VVE_KEYWORDS = /lekkage|reservefonds|extra bijdrage|heffing|lift|herbouw|schade|dotatie/i;
function listingSpecificQuestions(listing, r) {
  const l = listing.listing || {}; const v = listing.vve; const out = [];
  const top = l.topFloor === true || /penthouse|onder dak|bovenste/i.test(`${l.type || ''} ${l.cornerNote || ''} ${(l.highlights || []).join(' ')}`);
  if (top) out.push(Q('Dak en lekkage: is er ooit lekkage geweest bij dit appartement of bij de buren onder het dak? Wanneer is de dakbedekking voor het laatst geïnspecteerd of vervangen, en hoe watert het terras af (afvoeren, kitvoegen, dakrand)?', `Bovenste laag onder een plat dak${l.outdoorArea ? ` met ${l.outdoorArea} m² terras` : ''}: regenwater komt hier het eerst binnen. ${v?.risks?.some((x) => /lekkage/i.test(riskDetail(x))) ? 'Het complex had al lekkages via de kitvoegen.' : ''}`.trim(), 3));
  if (top) out.push(Q('Terras: wat ligt er nu (tegels, vlonders) en is daar VvE-toestemming voor? Mag er zonwering, een pergola of terrasbeglazing komen?', 'Bij dit complex is voor terrastegels expliciet toestemming en een draagkrachtmeting nodig (notulen 2025).', 2, 'vve'));
  if (/hout/i.test(`${l.insulation || ''} ${(v?.risks || []).map(riskDetail).join(' ')}`)) out.push(Q('Zijn de houten kozijnen en dorpels van dit appartement bij de laatste schilderbeurt en het houtrotherstel meegenomen, en is de afwerking binnen netjes opgeleverd?', 'Houten kozijnen: terugkerende schilder- en houtrotpost voor de VvE; bij 138 zijn in 2025 dorpels vervangen.', 3, 'vve'));
  if (/gas/i.test(l.heating || '')) out.push(Q('Hoe oud is de cv-ketel, wanneer was het laatste onderhoud en is er een onderhoudscontract?', 'Gasketel blijft voorlopig nodig (label B); vervanging kost ±€2.500 en gas wordt duurder.', 2));
  if (l.airco) out.push(Q('Waar staan de airco-buitenunits, wie heeft ze geplaatst, is er VvE-toestemming en wanneer was het laatste onderhoud?', 'Units op terras of gevel vallen onder de VvE; zonder toestemming kan verwijdering geëist worden.', 2, 'vve'));
  if (v?.risks?.some((x) => /lift/i.test(riskDetail(x)))) out.push(Q('Is de lift inmiddels structureel gerepareerd? Hoe vaak stond hij het afgelopen jaar stil en wat dekt het onderhoudscontract?', 'Ouders op de 3e verdieping: een onbetrouwbare lift is een dagelijks probleem; notulen 2025 melden langdurige uitval.', 3, 'vve'));
  if (l.ownParking && /bijdrage|vve/i.test(l.parking || '')) out.push(Q('Zit de parkeerplaats in de koopsom en in de VvE-bijdrage, en is de plek toegewezen (nummer) of vrij?', 'Parkeerplaats is hier onderdeel van de bijdrage (€826/jaar); bij verkoop apart appartementsrecht?', 2, 'vve'));
  const cbs = listing.enriched?.cbs?.buurt;
  if (cbs?.stedelijkheidAdressenPerKm2 === 1) out.push(Q('Hoe is het geluid \'s avonds en in het weekend (horeca, centrum, evenementen, laden en lossen)?', 'Zeer stedelijke buurt in het centrum; overdag stil zegt niets over de avond.', 3));
  if (l.buildYear && l.buildYear >= 2000 && l.buildYear <= 2012) out.push(Q('Wanneer is het MJOP voor het laatst geactualiseerd en welke grote posten staan er voor de komende 5 jaar?', `Gebouw uit ${l.buildYear}: na 15–20 jaar komen dak, schilderwerk en installaties tegelijk.`, 2, 'vve'));
  if (/bieden vanaf/i.test(l.askingPriceType || '')) out.push(Q('Wat verwacht de verkoper boven de "bieden vanaf"-prijs en zijn er al biedingen?', 'Bieden vanaf = ondergrens; zonder indicatie bied je blind.', 3));
  return out;
}
const TOPIC_KEYS = [/\blift\b/i, /lekkage|kitvoeg|dakbedekking/i, /airco/i, /herbouwwaarde|dotatie/i, /parkeerplaats/i, /extra bijdrage|eenmalige heffing/i, /bieden vanaf/i, /houtrot|kozijn/i, /cv-ketel|warmtepomp/i];
export function visitChecklist(listing, r) {
  const questions = [];
  const seen = new Set();
  const topics = new Set();
  const add = (q, tag) => {
    if (!q?.text || seen.has(q.text)) return;
    const keys = TOPIC_KEYS.filter((re) => re.test(q.text)).map(String);
    if (keys.some((k) => topics.has(k))) return; // zelfde onderwerp al gevraagd (specifiekere vraag ging voor)
    keys.forEach((k) => topics.add(k));
    seen.add(q.text); questions.push({ ...q, tag });
  };
  for (const q of listingSpecificQuestions(listing, r)) add(q, 'deze woning');
  for (const q of listing.vve?.questions || []) add(Q(q, 'Open punt uit de VvE-stukken.', VVE_KEYWORDS.test(q) ? 3 : 2, 'vve'), 'VvE-stukken');
  for (const i of r.wishes.items) if ((i.status === 'unknown' || i.status === 'warn') && WISH_QUESTIONS[i.id]) add(WISH_QUESTIONS[i.id], 'wens');
  if (r.vve.assessed) for (const risk of (listing.vve.risks || []).slice(0, 5)) add(Q(`Wat is de actuele stand van: ${riskTitle(risk).replace(/\.$/, '')}?`, riskDetail(risk) !== riskTitle(risk) ? riskDetail(risk) : 'Risico uit de notulen.', 3, 'vve'), 'risico');
  for (const q of GENERIC_QUESTIONS) add(q, 'algemeen');
  questions.sort((a, b) => b.priority - a.priority);
  const minuses = [...r.minusesAll.map((i) => ({ icon: STATUS[i.status]?.[0] ?? '', title: i.label, value: i.value, note: i.note, priority: i.status === 'fail' ? 3 : 2 }))];
  if (r.vve.assessed) for (const risk of listing.vve.risks || []) minuses.push({ icon: '⚠️', title: `VvE: ${riskTitle(risk)}`, value: '', note: riskDetail(risk) !== riskTitle(risk) ? riskDetail(risk) : '', priority: /lekkage|lift|extra bijdrage|heffing/i.test(riskDetail(risk)) ? 3 : 2 });
  minuses.sort((a, b) => b.priority - a.priority);
  const groups = {
    woning: questions.filter((q) => q.group === 'woning'),
    vve: questions.filter((q) => q.group === 'vve'),
    rondgang: ON_SITE.map((q) => ({ ...q, tag: 'zelf checken' })),
  };
  const top = questions.filter((q) => q.priority === 3).slice(0, 5);
  return { questions, groups, top, minuses };
}
const STATUS = { ok: ['✅'], warn: ['⚠️'], fail: ['❌'], unknown: ['❔'], info: ['ℹ️'] };

// ---------- Eindoordeel ----------
export function analyze(listing, profile, market = null) {
  const eq = equity(profile);
  const wishes = wishChecks(listing, profile);
  const location = locationChecks(listing, profile);
  const neighbourhood = neighbourhoodChecks(listing);
  const vveRaw = vveChecks(listing);
  const vve = { ...vveRaw, assessed: !!listing.vve };
  const bid = bidAnalysis(listing, profile, eq);
  const price = listing.listing?.askingPrice || 0;
  const finAsking = price ? financeFor(price, listing, profile, eq) : null;
  const finBid = bid ? financeFor(bid.opening, listing, profile, eq) : null;
  const roi = finAsking ? roiScenarios(price, finAsking, profile) : null;
  const investment = investmentOutlook(listing, profile, bid, finAsking, market);
  const priceScore = bid ? Math.max(0, Math.min(100, Math.round(70 - bid.premium * 200 + (finAsking?.fits ? 20 : -20)))) : 50;
  const W = { wishes: 0.5, location: 0.2, neighbourhood: 0.1, price: 0.2, ...(profile.scoreWeights || {}) };
  const breakdown = [
    { id: 'wishes', label: 'Woning & wensen', score: wishes.score, weight: W.wishes },
    { id: 'location', label: 'Locatie', score: location.score, weight: W.location },
    { id: 'neighbourhood', label: 'Buurt', score: neighbourhood.score, weight: W.neighbourhood },
    { id: 'price', label: 'Prijs & waarde', score: priceScore, weight: W.price },
  ];
  let score = Math.round(breakdown.reduce((s, b) => s + b.score * b.weight, 0));
  const flags = [];
  if (wishes.mustFails.length) { score = Math.min(score, 44); flags.push(`Harde eis niet gehaald: ${wishes.mustFails.map((m) => m.label).join(', ')}`); }
  if (finAsking && !finAsking.fits) { score = Math.min(score, 55); flags.push('Financiering past niet binnen de maximale hypotheek + overwaarde bij de vraagprijs'); }
  if (price > profile.budget.max) flags.push(`Vraagprijs boven het budget-maximum van ${eur(profile.budget.max)}`);
  if (vve.assessed && vve.score < 50) flags.push(`VvE scoort zwak (${vve.score}%) — zie de VvE-beoordeling`);
  const verdict = score >= 75 ? 'Sterke kandidaat' : score >= 60 ? 'Kansrijk' : score >= 45 ? 'Twijfelgeval' : 'Afvaller';
  const all = [...wishes.items, ...location.items, ...neighbourhood.items, ...(vve.assessed ? vve.items : [])];
  const plusesAll = all.filter((i) => i.status === 'ok');
  const minusesAll = [...all.filter((i) => i.status === 'fail'), ...all.filter((i) => i.status === 'warn')];
  const pluses = plusesAll.filter((i) => i.weight !== 'nice').slice(0, 6);
  const minuses = minusesAll.slice(0, 6);
  const result = { eq, wishes, location, neighbourhood, vve, bid, finAsking, finBid, roi, investment, score, breakdown, verdict, flags, pluses, minuses, plusesAll, minusesAll, priceScore };
  result.advice = adviceFor(listing, result);
  result.visit = visitChecklist(listing, result);
  return result;
}
