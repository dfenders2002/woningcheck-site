// Woningcheck — statische single-page app. Data uit data/*.json, berekeningen in analysis.js.
import { analyze, equity, maxAffordablePrice, eur, pct, num, round1000, overallAdvice, marketTiming, assumptionsList, rankListings, financeFor } from './analysis.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { ok: ['✅', 'Ja'], warn: ['⚠️', 'Deels'], fail: ['❌', 'Nee'], unknown: ['❔', 'Onbekend'], info: ['ℹ️', 'Info'] };
const OVERRIDES_KEY = 'woningcheck.overrides.v1';
const state = { profile: null, listings: [], market: null, overrides: {} };

function loadOverrides() { try { return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || '{}'); } catch { return {}; } }
function saveOverrides(o) { try { localStorage.setItem(OVERRIDES_KEY, JSON.stringify(o)); } catch { /* privémodus */ } }
function applyOverrides(profile, o) {
  const p = structuredClone(profile);
  for (const [path, value] of Object.entries(o)) {
    const keys = path.split('.'); let cur = p;
    for (const k of keys.slice(0, -1)) cur = cur[k] ??= {};
    cur[keys.at(-1)] = value;
  }
  return p;
}
const effectiveProfile = () => applyOverrides(state.profile, state.overrides);

// ---------- data laden (plaintext lokaal, versleuteld op GitHub Pages) ----------
const KEY_STORE = 'woningcheck.passphrase';
const vault = { manifest: null, key: null };
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(pass, manifest) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(manifest.salt), iterations: manifest.iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
async function loadBytes(rel) {
  if (!vault.manifest?.encrypted) { const r = await fetch(`./data/${rel}`); if (!r.ok) throw new Error(`${rel}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); }
  const r = await fetch(`./data/${rel}.enc`);
  if (!r.ok) throw new Error(`${rel}: ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, vault.key, buf.slice(12));
  return new Uint8Array(plain);
}
const loadJson = async (rel) => JSON.parse(new TextDecoder().decode(await loadBytes(rel)));
async function unlock(pass) {
  vault.key = await deriveKey(pass, vault.manifest);
  await loadJson('index.json');
  try { localStorage.setItem(KEY_STORE, pass); } catch { /* privémodus */ }
}
function renderLogin(message = '') {
  $('#app').innerHTML = `<section class="card login"><h1>🔒 Woningcheck</h1><p class="muted">Deze site bevat privégegevens. Vul het wachtwoord in dat je van Daan hebt gekregen.</p>
    <form id="login"><input type="password" name="pass" placeholder="wachtwoord" autocomplete="current-password" autofocus><button class="btn" type="submit">Openen</button></form>${message ? `<p class="muted">${esc(message)}</p>` : ''}</section>`;
  $('#login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const pass = new FormData(ev.target).get('pass').trim();
    ev.target.querySelector('button').textContent = 'Bezig…';
    try { await unlock(pass); await loadData(); route(); } catch (e) { console.warn('unlock', e); renderLogin('Wachtwoord klopt niet.'); }
  });
}
async function loadData() {
  if (vault.manifest === null) {
    vault.manifest = await fetch('./data/manifest.json').then((r) => (r.ok ? r.json() : { encrypted: false })).catch(() => ({ encrypted: false }));
    if (vault.manifest.encrypted && !vault.key) {
      let stored = null; try { stored = localStorage.getItem(KEY_STORE); } catch { /* privémodus */ }
      if (stored) { try { await unlock(stored); } catch { try { localStorage.removeItem(KEY_STORE); } catch { /* ignore */ } } }
      if (!vault.key) throw new NeedsLogin();
    }
  }
  const [profile, index] = await Promise.all([loadJson('profile.json'), loadJson('index.json')]);
  const listings = await Promise.all(index.listings.map((i) => loadJson(`listings/${i.id}.json`)));
  state.market = await loadJson('market.json').catch(() => null);
  state.profile = profile; state.listings = listings; state.overrides = loadOverrides();
}
class NeedsLogin extends Error {}
async function openDoc(ev) {
  const a = ev.target.closest('a[data-doc]'); if (!a || !vault.manifest?.encrypted) return;
  ev.preventDefault();
  const rel = a.dataset.doc;
  const win = window.open('', '_blank'); // synchroon binnen de klik, anders blokkeert de popup-blocker
  try {
    const bytes = await loadBytes(rel);
    const type = rel.endsWith('.pdf') ? 'application/pdf' : rel.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    if (win) win.location = url; else location.assign(url);
  } catch (e) { if (win) win.close(); alert(`Document kon niet worden geopend: ${e.message}`); }
}
document.addEventListener('click', openDoc);

// ---------- kleine bouwstenen ----------
const badge = (status, text) => `<span class="badge ${status}">${STATUS[status]?.[0] ?? ''} ${esc(text ?? STATUS[status]?.[1])}</span>`;
const scoreRing = (score, verdict) => explainable('score', `<div class="score" style="--p:${score}"><div class="score-inner"><b>${score}</b><small>${esc(verdict)}</small></div></div>`);
// Elke check op één rij: status · onderdeel · uitkomst · norm · toelichting.
const checkTable = (items) => `<div class="ctable"><div class="ctable-head"><span></span><span>Onderdeel</span><span>Uitkomst</span><span>Norm</span><span>Toelichting</span></div>${items.map((i) => `<div class="crow ${i.status}"><span class="ico">${STATUS[i.status]?.[0] ?? ''}</span><span class="lbl">${esc(i.label)}${i.weight === 'must' ? ' <span class="tag">must</span>' : i.weight === 'nice' ? ' <span class="tag light">plus</span>' : ''}</span><span class="val">${esc(i.value)}</span><span class="norm">${esc(i.norm)}</span><span class="nt">${esc(i.note)}</span></div>`).join('')}</div>`;
const checkRows = checkTable;
// Plus-/minpunten: icoon · onderdeel · uitkomst · toelichting.
const factRows = (items) => `<div class="facts">${items.map((i) => `<div class="fact ${i.status || ''}"><span class="ico">${i.icon ?? (STATUS[i.status]?.[0] ?? '')}</span><span class="lbl">${esc(i.label ?? i.title)}</span><span class="val">${esc(i.value ?? '')}</span><span class="nt">${esc(i.note ?? i.detail ?? '')}</span></div>`).join('')}</div>`;
const rowsOf = (arr) => (arr || []).map((x) => (typeof x === 'string' ? { title: x, detail: '' } : x));
const kv = (rows) => `<table class="kv">${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="r"><b>${esc(r[1])}</b></td>${r[2] != null ? `<td class="muted">${esc(r[2])}</td>` : ''}</tr>`).join('')}</table>`;
const section = (title, body, sub = '', key = null) => `<section class="card"><h2>${key ? explainable(key, `${esc(title)} ⓘ`) : esc(title)}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}${body}</section>`;
const list = (arr, cls = '') => `<ul class="${cls}">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

function wozChart(history) {
  if (!history?.length) return '';
  const max = Math.max(...history.map((h) => h.value));
  const w = 40, gap = 8, H = 120;
  const bars = history.map((h, i) => { const bh = (h.value / max) * (H - 30); const x = i * (w + gap); return `<g><rect x="${x}" y="${H - bh - 18}" width="${w}" height="${bh}" rx="4"/><text x="${x + w / 2}" y="${H - bh - 22}" text-anchor="middle" class="val">${Math.round(h.value / 1000)}k</text><text x="${x + w / 2}" y="${H - 4}" text-anchor="middle" class="yr">${String(h.year).slice(2)}</text></g>`; });
  return `<div class="chart-wrap"><svg class="woz" viewBox="0 0 ${history.length * (w + gap)} ${H}" preserveAspectRatio="xMinYMid meet">${bars.join('')}</svg></div>`;
}

const tone = (v) => (v >= 75 ? 'ok' : v >= 50 ? 'warn' : 'fail');
const vvePill = (a) => explainable('vve', a.vve.assessed ? `<span class="pill ${tone(a.vve.score)}">VvE ${a.vve.score}% · apart beoordeeld ⓘ</span>` : '<span class="pill unknown">VvE nog niet beoordeeld ⓘ</span>');
const breakdownBars = (a) => `<div class="breakdown">${a.breakdown.map((b) => explainable(b.id, `<div class="bd"><span class="bd-label">${esc(b.label)} <small>weegt ${Math.round(b.weight * 100)}%</small></span><span class="bd-bar"><i class="${tone(b.score)}" style="width:${b.score}%"></i></span><b>${b.score} ⓘ</b></div>`)).join('')}</div>`;
const ADVICE_ICON = { do: '👉', warn: '⚠️', ok: '✅', info: 'ℹ️' };
const renderAdvice = (advice) => `<div class="advice-grid">
  <div><h3>Oordeel</h3>${kv(advice.oordeel)}</div>
  ${advice.bod.length ? `<div><h3>Bod</h3>${kv(advice.bod)}</div>` : ''}
  ${advice.financiering.length ? `<div><h3>Financiering</h3>${kv(advice.financiering)}</div>` : ''}
  ${advice.letOp.length ? `<div><h3>Let op</h3>${factRows(advice.letOp.map((x) => ({ icon: x.icon, title: x.title, note: x.detail })))}</div>` : ''}
  <div><h3>Doen</h3><ol class="doen">${advice.doen.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>
</div>`;

// ---------- overzicht ----------
function renderOverview() {
  const profile = effectiveProfile();
  const eq = equity(profile);
  const maxAff = maxAffordablePrice(profile, eq);
  const entries = state.listings.map((l) => ({ listing: l, a: analyze(l, profile, state.market) }));
  const advice = overallAdvice(entries);
  const avgPrice = entries.length ? entries.reduce((s, e) => s + (e.listing.listing?.askingPrice || 0), 0) / entries.length : null;
  const timing = marketTiming(state.market, profile, eq, avgPrice);
  const { byScore } = rankListings(entries);
  const fold = (title, body, open = false) => `<details class="card fold" ${open ? 'open' : ''}><summary><h2>${title}</h2></summary>${body}</details>`;
  $('#app').innerHTML = `
    <h1 class="page-title">Woningen <span class="muted">(${entries.length})</span> <span class="muted small">gesorteerd op score</span></h1>
    <div class="grid">${byScore.map(({ listing, a }) => listingCard(listing, a)).join('')}</div>
    ${entries.length > 1 ? renderRanking(byScore) : ''}
    ${advice ? fold(esc(advice.headline), `${kv(advice.rows)}
      ${timing ? `<h3>Markt & timing: nu verkopen en kopen?</h3><p class="verdict ${esc(timing.tone)}">${esc(timing.verdict)}</p>${kv(timing.rows)}<p class="muted small">Bron: ${esc(timing.source)}; opgehaald ${esc(timing.updatedAt)}. Ververs met <code>node tools/enrich.mjs market</code>.</p>` : ''}`) : ''}
    <section class="card"><h2>Financiële ruimte</h2>
      ${tiles([
        { icon: '💶', label: 'Budget', value: `${eur(profile.budget.min)} – ${eur(profile.budget.max)}`, sub: `rek tot ${eur(profile.budget.stretchMax)}` },
        { icon: '🏡', label: 'Netto overwaarde Beukelaan', value: eur(eq.net), sub: eq.value ? `waarde ${eur(eq.value)} − schuld ${eur(eq.remaining)} − verkoopkosten` : '' },
        { icon: '🏦', label: 'Max. hypotheek op inkomen', value: eur(profile.income.maxMortgageFromIncome), sub: 'opgave pa' },
        { icon: '🎯', label: 'Maximaal betaalbaar', value: eur(round1000(maxAff)), sub: 'hypotheek + overwaarde − kosten koper' },
      ])}
      <p class="muted small">Score per woning = woning & wensen 45% + locatie 25% + buurt 10% + prijs & waarde 20%; de VvE staat er apart naast. <a href="#/profiel">Profiel & aannames</a></p>
    </section>
    ${fold('Aannames', kv(assumptionsList(profile, eq)))}
    ${entries.length > 1 ? fold('Vergelijking (alle cijfers)', renderCompare(entries, true)) : ''}
    ${fold('Woning toevoegen', `<p>Open de repo in Claude Code en typ <code>/woning &lt;funda-link&gt;</code>. De skill leest de Funda-pagina, haalt WOZ, buurtcijfers, BAG, voorzieningen en reistijden op, beoordeelt eventuele VvE-stukken in <code>data/listings/&lt;id&gt;/docs/</code>, en zet de woning online.</p><p class="muted">Handmatig kan ook: kopieer <code>data/listings/tolstraat-138.json</code>, vul de Funda-kenmerken in en draai <code>node tools/enrich.mjs &lt;id&gt;</code>.</p>`)}`;
}

function listingCard(l, a) {
  const li = l.listing || {};
  const photo = l.photos?.[0] ? `<div class="lc-photo" style="background-image:url('data/listings/${esc(l.id)}/${esc(l.photos[0])}')"></div>` : '';
  return `<a class="card listing-card" href="#/w/${esc(l.id)}">${photo}
    <div class="lc-head">${scoreRing(a.score, a.verdict)}<div><h3>${esc(l.address.street)} ${esc(l.address.number)}</h3><div class="muted">${esc(l.address.postcode)} ${esc(l.address.city)} · ${esc(li.type || '')}</div><div class="price">${eur(li.askingPrice)} <small>${/bieden/i.test(li.askingPriceType || '') ? 'bieden vanaf' : 'k.k.'}</small></div></div></div>
    ${breakdownBars(a)}
    <div class="pills">${vvePill(a)}${a.investment ? `${explainable('investment', `<span class="pill unknown">stijging ${pct(a.investment.expected, 1)}/jaar (informatief) ⓘ</span>`)}` : ''}</div>
    <div class="chips">${[`${li.livingArea ?? '?'} m²`, `${li.bedrooms ?? '?'} slaapk.`, `${li.floor != null ? `${li.floor}e etage` : ''}`, `bouwjaar ${li.buildYear ?? '?'}`, `label ${li.energyLabel ?? '?'}`, li.lift ? 'lift' : 'geen lift', li.outdoorArea ? `${li.outdoorArea} m² buiten` : ''].filter(Boolean).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
    <div class="lc-foot">${a.bid ? `<span>Bod <b>${eur(a.bid.low)} – ${eur(a.bid.high)}</b></span>` : ''}${a.finAsking ? `<span>±${eur(a.finAsking.monthlyTotal)} p/m bruto</span>` : ''}</div>
    ${a.flags.length ? `<div class="flags">${a.flags.map((f) => `<div>🚩 ${esc(f)}</div>`).join('')}</div>` : ''}
  </a>`;
}

function renderRanking(byScore) {
  const cell = (v) => `<td><span class="badge ${tone(v)}">${v}</span></td>`;
  return section('Ranglijst', `<div class="scroll"><table class="compare rank"><tr><th>#</th><th>Woning</th><th>${explainable('score', 'Score ⓘ')}</th><th>${explainable('wishes', 'Woning & wensen ⓘ')}</th><th>${explainable('location', 'Locatie ⓘ')}</th><th>${explainable('neighbourhood', 'Buurt ⓘ')}</th><th>${explainable('price', 'Prijs & waarde ⓘ')}</th><th>${explainable('vve', 'VvE (apart) ⓘ')}</th><th>${explainable('investment', 'Verwachte stijging ⓘ')}</th><th>${explainable('bid', 'Bod-range ⓘ')}</th><th>${explainable('monthly', 'Maandlast bruto ⓘ')}</th></tr>
    ${byScore.map(({ listing, a }, i) => `<tr><td>${i + 1}</td><td><a href="#/w/${esc(listing.id)}">${esc(listing.address.street)} ${esc(listing.address.number)}</a><div class="muted small">${eur(listing.listing?.askingPrice)}${/bieden/i.test(listing.listing?.askingPriceType || '') ? ' bieden vanaf' : ''}</div></td><td><b>${a.score}</b> <span class="muted small">${esc(a.verdict)}</span></td>${a.breakdown.map((b) => cell(b.score)).join('')}<td>${a.vve.assessed ? `<span class="badge ${tone(a.vve.score)}">${a.vve.score}</span>` : '<span class="badge unknown">?</span>'}</td><td>${a.investment ? `${pct(a.investment.expected, 1)}/jr` : '–'}</td><td>${a.bid ? `${eur(a.bid.low)} – ${eur(a.bid.high)}` : '–'}</td><td>${a.finAsking ? eur(a.finAsking.monthlyTotal) : '–'}</td></tr>`).join('')}
  </table></div>`, 'Score = woning & wensen 45% + locatie 25% + buurt 10% + prijs & waarde 20%. De VvE staat er los naast en telt niet mee, zodat woningen mét en zónder stukken eerlijk vergelijkbaar zijn.');
}

function renderCompare(entries, bare = false) {
  const rows = entries.map(({ listing, a }) => ({ l: listing, a })).sort((x, y) => y.a.score - x.a.score);
  const cell = (fn) => rows.map(({ l, a }) => `<td>${fn(l, a)}</td>`).join('');
  const li = (l) => l.listing || {};
  const wrap = (body) => (bare ? body : section('Vergelijking', body));
  return wrap(`<div class="scroll"><table class="compare"><tr><th></th>${rows.map(({ l }) => `<th><a href="#/w/${esc(l.id)}">${esc(l.address.street)} ${esc(l.address.number)}</a></th>`).join('')}</tr>
    <tr><td>Score</td>${cell((l, a) => `<b>${a.score}</b> ${esc(a.verdict)}`)}</tr>
    <tr><td>Vraagprijs</td>${cell((l) => `${eur(li(l).askingPrice)}${/bieden/i.test(li(l).askingPriceType || '') ? ' (bieden vanaf)' : ''}`)}</tr>
    <tr><td>WOZ (laatste)</td>${cell((l) => eur(l.enriched?.woz?.latest?.value))}</tr>
    <tr><td>Per m²</td>${cell((l) => eur(li(l).askingPrice / li(l).livingArea))}</tr>
    <tr><td>Bod-range</td>${cell((l, a) => (a.bid ? `${eur(a.bid.low)} – ${eur(a.bid.high)}` : '–'))}</tr>
    <tr><td>Maandlasten (bruto)</td>${cell((l, a) => (a.finAsking ? eur(a.finAsking.monthlyTotal) : '–'))}</tr>
    <tr><td>Wensen</td>${cell((l, a) => `${a.wishes.score}%`)}</tr>
    <tr><td>Locatie</td>${cell((l, a) => `${a.location.score}%`)}</tr>
    <tr><td>Buurt</td>${cell((l, a) => `${a.neighbourhood.score}%`)}</tr>
    <tr><td>VvE (apart)</td>${cell((l, a) => (a.vve.assessed ? `${a.vve.score}%` : 'niet beoordeeld'))}</tr>
    <tr><td>Verwachte stijging</td>${cell((l, a) => (a.investment ? `${pct(a.investment.expected, 1)}/jr` : '–'))}</tr>
    <tr><td>Eigen vermogen na 10 jr</td>${cell((l, a) => (a.investment ? eur(a.investment.projections.mid.equityH) : '–'))}</tr>
    <tr><td>m² / buiten</td>${cell((l) => `${li(l).livingArea ?? '?'} / ${li(l).outdoorArea ?? 0}`)}</tr>
    <tr><td>Bouwjaar / label</td>${cell((l) => `${li(l).buildYear ?? '?'} / ${li(l).energyLabel ?? '?'}`)}</tr>
    <tr><td>Etage / lift</td>${cell((l) => `${li(l).floor ?? '?'} / ${li(l).lift ? 'ja' : 'nee'}`)}</tr>
    <tr><td>Station (lopen)</td>${cell((l) => (l.enriched?.routes?.station ? `${l.enriched.routes.station.footMin} min` : '–'))}</tr>
    <tr><td>Daan (fiets)</td>${cell((l) => (l.enriched?.routes?.daan ? `${l.enriched.routes.daan.bikeMin} min` : '–'))}</tr>
    <tr><td>VvE p/m</td>${cell((l) => eur(li(l).vveMonthly ?? l.vve?.monthly))}</tr>
  </table></div>`);
}

// ---------- detail ----------
function renderDetail(id) {
  const l = state.listings.find((x) => x.id === id);
  if (!l) { $('#app').innerHTML = '<section class="card"><p>Woning niet gevonden.</p><a href="#/">← Terug</a></section>'; return; }
  const profile = effectiveProfile();
  const a = analyze(l, profile, state.market);
  const li = l.listing || {};
  const e = l.enriched || {};
  const fin = a.finAsking, bid = a.bid;
  const links = externalLinks(l);
  $('#app').innerHTML = `
    <a class="back" href="#/">← Alle woningen</a>
    <section class="card head">
      <div class="head-main">${scoreRing(a.score, a.verdict)}
        <div><h1>${esc(l.address.street)} ${esc(l.address.number)}</h1><div class="muted">${esc(l.address.postcode)} ${esc(l.address.city)} · ${esc(li.type || '')} · buurt ${esc(e.geo?.buurtnaam || li.fundaNeighborhood?.name || '?')}</div>
        <div class="price">${eur(li.askingPrice)} <small>${/bieden/i.test(li.askingPriceType || '') ? 'bieden vanaf' : 'k.k.'} · ${eur(li.askingPrice / (li.livingArea || 1))}/m²</small></div>
        <div class="chips">${[`${li.livingArea ?? '?'} m² wonen`, li.outdoorArea ? `${li.outdoorArea} m² buiten` : '', `${li.rooms ?? '?'} kamers / ${li.bedrooms ?? '?'} slaapk.`, li.floor != null ? `${li.floor}e woonlaag` : '', `bouwjaar ${li.buildYear ?? '?'}`, `label ${li.energyLabel ?? '?'}`, li.lift ? 'lift' : 'geen lift', li.ownParking ? 'eigen parkeerplaats' : ''].filter(Boolean).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
        <div class="pills">${vvePill(a)}${a.investment ? `${explainable('investment', `<span class="pill unknown">verwachte stijging ${pct(a.investment.expected, 1)}/jaar (informatief) ⓘ</span>`)}` : ''}</div>
        <div class="actions"><a class="btn" target="_blank" rel="noopener" href="${esc(l.url)}">Bekijk op Funda ↗</a>${li.agent ? `<span class="muted">${esc(li.agent)}${li.listedSince ? ` · op Funda sinds ${esc(li.listedSince)}` : ''}</span>` : ''}</div>
      </div>
      ${breakdownBars(a)}
      <p class="muted small">Score = woning & wensen 45% + locatie 25% + buurt 10% + prijs & waarde 20%; de VvE wordt apart beoordeeld en telt niet mee.</p>
      ${a.flags.length ? `<div class="flags">${a.flags.map((f) => `<div>🚩 ${esc(f)}</div>`).join('')}</div>` : ''}
    </section>
    ${l.photos?.length ? `<div class="photos">${l.photos.map((p) => `<a target="_blank" rel="noopener" href="data/listings/${esc(l.id)}/${esc(p)}"><img loading="lazy" src="data/listings/${esc(l.id)}/${esc(p)}" alt=""></a>`).join('')}</div>` : ''}
    ${tiles([
      { icon: '💶', label: 'Vraagprijs', value: eur(li.askingPrice), sub: `${eur(li.askingPrice / (li.livingArea || 1))}/m²` },
      a.bid ? { icon: '🎯', label: 'Openingsbod', value: eur(a.bid.opening), sub: `range ${eur(a.bid.low)} – ${eur(a.bid.high)}` } : null,
      fin ? { icon: '🏦', label: 'Hypotheek nodig', value: eur(fin.mortgage), sub: `${pct(fin.ltv)} van de koopsom`, tone: fin.fits ? 'ok' : 'fail' } : null,
      fin ? { icon: '📅', label: 'Maandlast bruto', value: eur(fin.monthlyTotal), sub: `±${eur(fin.monthlyNet)} netto` } : null,
      a.investment ? { icon: '📈', label: 'Verwachte stijging', value: `${pct(a.investment.expected, 1)}/jr`, sub: `${eur(a.investment.projections.mid.valueH)} over ${a.investment.projections.mid.H} jr` } : null,
      e.routes?.station ? { icon: '🚉', label: 'Station', value: `${e.routes.station.footMin} min`, sub: `lopen · ${e.routes.station.bikeMin} min fietsen` } : null,
      e.routes?.daan ? { icon: '🏠', label: 'Naar Daan', value: `${e.routes.daan.bikeMin} min`, sub: `fietsen · ${e.routes.daan.footMin ?? '–'} min lopen` } : null,
      e.woz?.latest ? { icon: '🏛️', label: 'WOZ-waarde', value: eur(e.woz.latest.value), sub: `peildatum 1-1-${e.woz.latest.year}` } : null,
    ])}
    ${section('Voor de bezichtiging', renderVisit(l, a), 'Af te vinken op je telefoon; vinkjes worden in deze browser onthouden.')}
    ${section(`Advies — ${esc(a.advice.headline)}`, renderAdvice(a.advice))}
    <div class="two">
      ${section(`Pluspunten (${a.plusesAll.length})`, factRows(a.plusesAll))}
      ${section(`Minpunten (${a.minusesAll.length})`, a.minusesAll.length ? factRows(a.minusesAll) : '<p class="muted">Geen.</p>')}
    </div>
    ${li.highlights?.length ? section('Wat de makelaar benadrukt', list(li.highlights)) : ''}
    ${section(`Wensenlijst — ${a.wishes.score}%`, wishGrid(a.wishes.items), 'Harde eisen (<span class="tag">must</span>) tellen 3×, wensen 2×, pluspunten 1×.', 'wishes')}
    ${bid ? section('Bod & waarde', renderBid(bid, profile), '', 'bid') : ''}
    ${fin ? section('Wat als ik anders bied?', renderWhatIf(l, a, profile), 'Schuif met bod, rente en eigen geld; alles rekent direct door.', 'monthly') : ''}
    ${fin ? section('Financiën', renderFinance(fin, a, profile, l), '', 'monthly') : ''}
    ${a.investment ? section('Investering & waardeontwikkeling', renderInvestment(a.investment, a.roi, e.woz, li.askingPrice), '', 'investment') : ''}
    ${section(`Locatie — ${a.location.score}%`, `<div id="map" class="map"></div>${renderRoutes(e)}${checkRows(a.location.items)}`, '', 'location')}
    ${section(`Buurt ${esc(a.neighbourhood.buurt || '')} — ${a.neighbourhood.score}%`, renderNeighbourhood(a.neighbourhood, li, links, e.cbs), 'Bron: CBS Kerncijfers wijken en buurten (PDOK), Funda buurtinfo.', 'neighbourhood')}
    ${section(a.vve.assessed ? `VvE — ${a.vve.score}% (apart beoordeeld, telt niet mee in de score)` : 'VvE — nog niet beoordeeld', renderVve(l.vve, a.vve), '', 'vve')}
    ${section('WOZ-verloop', e.woz ? `${wozChart(e.woz.history)}${kv(wozRows(e.woz, li))}<p class="muted small">Bron: Kadaster WOZ-waardeloket. Klik op ⓘ in de titel voor uitleg waarom de WOZ onder de vraagprijs ligt.</p>` : '<p class="muted">Nog niet opgehaald.</p>', '', 'woz')}
    ${section('Omgeving, bodem & bestemming', renderEnvironment(l.environment, links))}
    ${l.docs?.length ? section('Documenten', `<ul class="docs">${l.docs.map((d) => `<li><a target="_blank" rel="noopener" data-doc="listings/${esc(l.id)}/${esc(d.path)}" href="data/listings/${esc(l.id)}/${esc(d.path)}">📄 ${esc(d.label)}</a></li>`).join('')}</ul>`) : ''}
    ${l.notes?.length ? section('Notities', list(l.notes)) : ''}
    <p class="muted small">Gegevens verrijkt op ${esc(e.at || '?')}. Alle bedragen zijn indicaties op basis van openbare bronnen en aannames (zie <a href="#/profiel">aannames</a>); laat een taxatie en hypotheekadvies de cijfers bevestigen.</p>`;
  if (e.geo) setTimeout(() => drawMap(l, profile), 0);
}

function renderBid(b, profile) {
  const span = Math.max(1, b.ceiling * 1.02 - b.indicative * 0.9);
  const posn = (v) => `${Math.max(0, Math.min(100, ((v - b.indicative * 0.9) / span) * 100))}%`;
  return `
    <div class="bid-range"><div class="bar"><div class="fill" style="left:${posn(b.low)};width:calc(${posn(b.high)} - ${posn(b.low)})"></div>
      <div class="mark ask" style="left:${posn(b.asking)}"><span>vraag ${eur(b.asking)}</span></div>
      <div class="mark ind" style="left:${posn(b.indicative)}"><span>indicatie ${eur(round1000(b.indicative))}</span></div>
      <div class="mark ceil" style="left:${posn(b.ceiling)}"><span>plafond ${eur(b.ceiling)}</span></div></div></div>
    ${kv([
      ['Openingsbod (advies)', eur(b.opening), b.biedenVanaf ? "'bieden vanaf' → nooit onder de vraagprijs" : b.demand === 'laag' ? 'vraag is laag → start onder de vraagprijs' : 'start dichtbij de vraagprijs'],
      ['Redelijke bod-range', `${eur(b.low)} – ${eur(b.high)}`, 'onderhandelingsruimte bij normale interesse'],
      ['Plafond', eur(b.ceiling), 'nooit boven: budget-max én maximaal betaalbaar'],
      ['Indicatieve waarde', eur(round1000(b.indicative)), `60% m²-model (${eur(round1000(b.m2Model))}) + 40% WOZ-anker (${eur(round1000(b.wozAnchor))})`],
      ['Vraagprijs t.o.v. indicatie', pct(b.premium, 1), b.premium > 0.08 ? 'stevig geprijsd' : b.premium > 0.02 ? 'iets aan de hoge kant' : b.premium > -0.03 ? 'marktconform' : 'scherp geprijsd'],
      ['Belangstelling', b.demand, b.days ? `${b.days} dagen op Funda` : ''],
    ])}
    <h3>Onderbouwing</h3>${kv(b.rows)}`;
}

function renderFinance(fin, a, profile, l) {
  const eq = a.eq;
  const finBid = a.finBid;
  return `
    <h3>Eigen inbreng uit de verkoop van ${esc(profile.currentHome.address.split(',')[0])}</h3>
    ${kv([
      ['WOZ-waarde huidige woning', eur(eq.woz), eq.wozYear ? `peildatum 1-1-${eq.wozYear} (Kadaster)` : ''],
      ['Geschatte marktwaarde', eur(eq.value), `WOZ + ${pct(profile.currentHome.assumedMarketUpliftOverWoz)} (aanname; laat een makelaar waarderen)`],
      ['Restschuld hypotheek', eur(eq.remaining), `${eur(profile.currentHome.originalMortgage)} − ${eur(profile.currentHome.paidOff)} afgelost (aanname)`],
      ['Verkoopkosten', eur(eq.sellingCost), `${pct(profile.assumptions.sellingCostRate, 1)} makelaar + notaris`],
      ['Netto overwaarde', eur(eq.net), 'beschikbaar als eigen geld'],
    ])}
    <h3>Financiering bij de vraagprijs ${eur(fin.price)}</h3>
    ${kv([
      ['Koopsom + kosten koper + verhuizing', eur(fin.totalNeed), `k.k. ${eur(fin.kk.total)} (${pct(fin.kk.pctOfPrice, 1)}) + verhuizing ${eur(profile.assumptions.movingCost)}`],
      ['Eigen geld ingebracht', eur(fin.ownMoney), 'hele overwaarde ingezet'],
      ['Benodigde hypotheek', eur(fin.mortgage), `${pct(fin.ltv, 0)} van de koopsom`],
      ['Past binnen max. hypotheek?', fin.fits ? '✅ Ja' : '❌ Nee', `max ${eur(fin.maxMortgage)} op inkomen; ruimte ${eur(fin.maxMortgage - fin.mortgage)}`],
      ...(finBid ? [['Bij openingsbod ' + eur(finBid.price), `hypotheek ${eur(finBid.mortgage)}`, `maandlast ${eur(finBid.monthlyMortgage)} bruto`]] : []),
    ])}
    <h3>Waar komt het geld vandaan</h3>
    ${stackedBar([['Eigen geld (overwaarde)', fin.ownMoney], ['Hypotheek', fin.mortgage]], fin.totalNeed)}
    <h3>Kosten koper (eenmalig)</h3>
    ${kv([...fin.kk.rows.map((r) => [r[0], eur(r[1]), r[2]]), ['Totaal kosten koper', eur(fin.kk.total), pct(fin.kk.pctOfPrice, 1)]])}
    <h3>Maandlasten (schatting)</h3>
    ${stackedBar(fin.monthly.filter((r) => r[1] > 0), fin.monthlyTotal)}
    ${kv([...fin.monthly.map((r) => [r[0], eur(r[1]), r[2]]), ['Totaal bruto per maand', eur(fin.monthlyTotal), ''], ['Belastingvoordeel (renteaftrek − eigenwoningforfait)', `− ${eur(fin.taxBenefit)}`, 'eerste jaar, ±37% tarief'], ['Netto per maand', eur(fin.monthlyNet), 'indicatie']])}
    <div class="note">💡 <b>Leeftijd en hypotheek:</b> pa is ${esc(String(ageOf(profile.buyers.fatherBirthMonth)))} en de hypotheek loopt ${profile.assumptions.termYears} jaar. De bank toetst het deel ná de AOW-leeftijd op het verwachte pensioeninkomen (mijnpensioenoverzicht.nl). Een deel aflossingsvrij (max 50% van de waarde) verlaagt de maandlast maar geeft geen renteaftrek. ${fin.mortgage > profile.assumptions.nhgLimit ? `NHG is niet mogelijk (grens ${eur(profile.assumptions.nhgLimit)}).` : 'NHG mogelijk → lagere rente.'}</div>`;
}

function ageOf(birthMonth) { if (!birthMonth) return '?'; const [y, m] = birthMonth.split('-').map(Number); const now = new Date(); let age = now.getFullYear() - y; if (now.getMonth() + 1 < m) age--; return age; }

function renderInvestment(inv, roi, woz, price) {
  const p = inv.projections;
  const cols = [['Laag', p.low], ['Verwacht', p.mid], ['Hoog', p.high]];
  return `${projectionChart(inv, price)}${kv([
    ['Verwachte waardestijging', `${pct(inv.expected, 1)} per jaar`, `bandbreedte ${pct(inv.low, 1)} – ${pct(inv.high, 1)}`],
    ['Historie van dit adres (WOZ)', inv.hist5 != null ? `${pct(inv.hist5, 1)} per jaar` : '–', `${inv.hist5 != null ? 'laatste 5 jaar' : ''}${inv.hist10 != null && woz?.history?.[0] ? `; ${pct(inv.hist10, 1)} per jaar sinds ${woz.history[0].year}` : ''}`],
    ['Investeringsscore', `${inv.score}/100`, 'verwachte stijging plus prijs t.o.v. indicatieve waarde; alleen bedoeld om woningen onderling te vergelijken'],
  ])}
  <h3>Hoe de verwachting is opgebouwd</h3>
  <table class="kv">${inv.factors.map(([t, d], i) => `<tr><td>${esc(t)}</td><td class="r"><b>${i === 0 ? pct(d, 1) : `${d >= 0 ? '+' : '−'}${pct(Math.abs(d), 1)}`}</b></td></tr>`).join('')}<tr><td><b>Verwachting</b></td><td class="r"><b>${pct(inv.expected, 1)}</b></td></tr></table>
  <h3>Over ${p.mid.H} jaar</h3>
  <div class="scroll"><table class="compare"><tr><th></th>${cols.map(([n, x]) => `<th>${n} ${pct(x.g, 1)}</th>`).join('')}</tr>
    <tr><td>Waarde</td>${cols.map(([, x]) => `<td>${eur(x.valueH)}</td>`).join('')}</tr>
    <tr><td>Restschuld</td>${cols.map(([, x]) => `<td>${eur(x.loanH)}</td>`).join('')}</tr>
    <tr><td>Eigen vermogen in de woning</td>${cols.map(([, x]) => `<td><b>${eur(x.equityH)}</b></td>`).join('')}</tr>
    <tr><td>Winst t.o.v. inbreng + aflossing</td>${cols.map(([, x]) => `<td class="${x.gain >= 0 ? 'pos' : 'neg'}">${eur(x.gain)}</td>`).join('')}</tr>
    <tr><td>Rendement op eigen geld</td>${cols.map(([, x]) => `<td>${pct(x.annualized, 1)} / jaar</td>`).join('')}</tr>
  </table></div>
  <p class="muted small">Break-even: ${pct(roi.breakEven, 2)} stijging per jaar om kosten koper en verkoopkosten terug te verdienen. Woonlasten (rente, VvE) zijn hier niet afgetrokken; dat is wat je anders aan huur kwijt zou zijn. Waardestijging is onzeker — de bandbreedte is ±1,5%.</p>`;
}

const PRIO = { 3: ['🔴', 'hoog'], 2: ['🟠', 'middel'], 1: ['⚪', 'laag'] };
function qChecklist(id, group, items) {
  let done = []; try { done = JSON.parse(localStorage.getItem(CHECKS_KEY(id)) || '[]'); } catch { /* ignore */ }
  return `<ul class="checklist qlist" data-listing="${esc(id)}">${items.map((it, i) => { const key = `${group}:${it.text || it.title}`.slice(0, 120); const on = done.includes(key); const [pi, pl] = PRIO[it.priority] || ['', '']; return `<li class="${on ? 'done' : ''}"><label><input type="checkbox" data-key="${esc(key)}" ${on ? 'checked' : ''}><span class="qbody"><span class="qtext">${it.icon ? `${it.icon} ` : ''}${pi ? `<em class="prio p${it.priority}" title="prioriteit ${pl}">${pi}</em>` : ''}${esc(it.text || it.title)}${it.value ? ` <b>${esc(it.value)}</b>` : ''}</span>${it.why || it.note ? `<span class="qwhy">${esc(it.why || it.note)}</span>` : ''}${it.tag ? `<em class="qtag">${esc(it.tag)}</em>` : ''}</span></label></li>`; }).join('')}</ul>`;
}
function renderVisit(l, a) {
  const v = a.visit;
  const foldQ = (title, items, group, open = false) => `<details class="fold-inner" ${open ? 'open' : ''}><summary>${esc(title)} <span class="muted">(${items.length})</span></summary>${qChecklist(l.id, group, items)}</details>`;
  return `<div class="visit">
    <p class="muted small">🔴 hoog · 🟠 middel · ⚪ laag. Onder elke vraag staat waarom die voor deze woning telt.</p>
    <h3>Top 5 — eerst stellen</h3>${qChecklist(l.id, 'q', v.top)}
    ${foldQ('Vragen aan makelaar en verkoper', v.groups.woning, 'q')}
    ${foldQ('Vragen over de VvE', v.groups.vve, 'q')}
    ${foldQ('Zelf checken tijdens de rondgang', v.groups.rondgang, 's')}
    ${foldQ('Minpunten om te bevestigen', v.minuses, 'm')}
  </div>`;
}

function wozRows(woz, li) {
  const h = woz.history || [];
  const latest = woz.latest;
  const months = latest ? Math.round((Date.now() - new Date(`${latest.year}-01-01`).getTime()) / (30.44 * 864e5)) : null;
  const rows = [
    ['Laatste WOZ', eur(latest?.value), `peildatum 1-1-${latest?.year}: de markt van ±${months} maanden geleden`],
    ['Vraagprijs t.o.v. WOZ', li.askingPrice && latest ? pct(li.askingPrice / latest.value - 1, 0) : '–', 'normaal +10% tot +20% in een stijgende markt; meer = stevig geprijsd, minder = scherp'],
    ['Groei 5 jaar', pct(woz.growth5y, 1) + ' per jaar', h.length ? `${eur(h.find((x) => x.year === latest.year - 5)?.value)} → ${eur(latest.value)}` : ''],
  ];
  const drops = h.filter((x, i) => i > 0 && x.value < h[i - 1].value * 0.95).map((x, _, arr) => x);
  for (const d of drops) { const prev = h[h.indexOf(d) - 1]; rows.push(['Opvallend', `${d.year}: ${pct(d.value / prev.value - 1, 0)}`, `${eur(prev.value)} → ${eur(d.value)}: daling wijst op een bezwaar van de eigenaar of herwaardering; vraag ernaar (lagere WOZ = lagere OZB, maar ook lager anker)`]); }
  return rows;
}

function renderRoutes(e) {
  const r = e.routes || {};
  const item = (key, icon, label) => { const x = r[key]; if (!x) return ''; return `<div class="route"><div class="route-ico">${icon}</div><div><b>${esc(label || x.label)}</b><div class="muted">${[x.footMin != null ? `🚶 ${x.footMin} min` : '', x.bikeMin != null ? `🚲 ${x.bikeMin} min` : '', x.drivingMin != null ? `🚗 ${x.drivingMin} min` : ''].filter(Boolean).join(' · ')}</div></div></div>`; };
  return `<div class="routes">${item('station', '🚉')}${item('daan', '🏠', 'Daan (Sacharovlaan)')}${item('gouda', '🏡', 'Beukelaan, Gouda')}${item('supermarket', '🛒')}${item('park', '🌳', r.park?.label === 'park' ? 'Dichtstbijzijnde park' : r.park?.label)}${item('doctors', '🩺')}${item('pharmacy', '💊')}</div>`;
}

function renderNeighbourhood(n, li, links, cbs) {
  const funda = li.fundaNeighborhood ? `<p class="muted">Funda: buurt ${esc(li.fundaNeighborhood.name)} — ${num(li.fundaNeighborhood.residents)} inwoners, ${pct(li.fundaNeighborhood.familiesWithKids)} gezinnen met kinderen, gem. vraagprijs ${eur(li.fundaNeighborhood.askingPerM2)}/m².</p>` : '';
  const c = (arguments[3] || {});
  const bars = c.buurt ? pairedBars([['Koopwoningen', c.buurt.percentageKoopwoningen ?? 0, c.gemeente.percentageKoopwoningen ?? 0], ['Corporatiehuur', c.buurt.percHuurwoningenInBezitWoningcorporaties ?? 0, c.gemeente.percHuurwoningenInBezitWoningcorporaties ?? 0], ['Laag inkomen', c.buurt.percentageHuishoudensMetLaagInkomen ?? 0, c.gemeente.percentageHuishoudensMetLaagInkomen ?? 0], ['Hoog inkomen', c.buurt.percentageHuishoudensMetHoogInkomen ?? 0, c.gemeente.percentageHuishoudensMetHoogInkomen ?? 0], ['65-plussers', c.buurt.percentagePersonen65JaarEnOuder ?? 0, c.gemeente.percentagePersonen65JaarEnOuder ?? 0], ['Gezinnen met kinderen', c.buurt.percentageHuishoudensMetKinderen ?? 0, c.gemeente.percentageHuishoudensMetKinderen ?? 0]]) : '';
  const table = n.rows?.length ? `${bars}<div class="scroll"><table class="compare"><tr><th></th><th>${esc(n.buurt)}</th><th>${esc(n.gemeente)}</th></tr>${n.rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="muted">${esc(r[2])}</td></tr>`).join('')}</table></div>` : '';
  const story = n.narrative ? `<h3>Wat betekent dit</h3><div class="facts">${n.narrative.rows.map((r) => `<div class="fact"><span class="ico">💬</span><span class="lbl">${esc(r[0])}</span><span class="val">${esc(r[1])}</span><span class="nt">${esc(r[2])}</span></div>`).join('')}</div><p class="verdict flat">${esc(n.narrative.conclusion)}</p>` : '';
  return `${checkRows(n.items)}${story}${funda}${table}<p class="links">${links.filter((x) => x.group === 'buurt').map((x) => `<a target="_blank" rel="noopener" href="${esc(x.url)}">${esc(x.label)} ↗</a>`).join('')}</p>`;
}

function renderVve(v, checks) {
  if (!v) return `${checkRows(checks.items)}<p class="muted">Leg de VvE-stukken (jaarrekening, begroting, MJOP, notulen, reglement) in <code>data/listings/&lt;id&gt;/docs/</code> en laat <code>/woning</code> ze beoordelen.</p>`;
  const units = v.units || 1;
  return `${tiles([
    { icon: '💰', label: 'Reservefonds per appartement', value: eur(v.reserveFund / units), sub: `totaal ${eur(v.reserveFund)}`, tone: v.reserveFund / units >= 5000 ? 'ok' : v.reserveFund / units >= 2500 ? 'warn' : 'fail' },
    { icon: '🔧', label: 'Reservering per appartement per jaar', value: eur(v.annualDotation / units), sub: `totaal ${eur(v.annualDotation)}` },
    { icon: '📆', label: 'Maandbijdrage', value: eur(v.monthly, 2), sub: v.monthlyBreakdown ? 'opbouw hieronder' : '' },
    { icon: '📊', label: 'Resultaat laatste boekjaar', value: eur(v.result2025), sub: v.result2024 != null ? `jaar ervoor ${eur(v.result2024)}` : '', tone: v.result2025 >= 0 ? 'ok' : 'warn' },
  ])}${kv([
    ['Vereniging', v.name, v.kvk ? `KvK ${v.kvk}, opgericht ${v.founded || ''}` : ''],
    ['Appartementen', num(v.units), v.breukdeel ? `aandeel ${v.breukdeel}` : ''],
    ['Maandbijdrage', eur(v.monthly, 2), v.monthlyBreakdown || ''],
    ['Reservefonds', eur(v.reserveFund), `${v.reserveFundDate || ''}${v.reserveFundPrev ? ` (jaar ervoor ${eur(v.reserveFundPrev)})` : ''}`],
    ['Reservering per jaar', eur(v.annualDotation), v.annualDotationPrev ? `vorig jaar ${eur(v.annualDotationPrev)}` : ''],
    ['Begroting totaal', eur(v.budgetTotal), ''],
    ['Beheer', v.manager || '–', v.board || ''],
    ['MJOP', v.mjop || '–', v.mjopReserveLow ? `laagste stand ${eur(v.mjopReserveLow.amount)} in ${v.mjopReserveLow.year}` : ''],
    ['Verzekering', v.insurance || '–', ''],
  ])}
  ${checkRows(checks.items)}
  ${v.mjopBigItems?.length ? `<h3>Grote posten in het MJOP</h3>${factRows(rowsOf(v.mjopBigItems).map((x) => ({ icon: '🔧', title: x.title.split(':')[0], note: x.title.includes(':') ? x.title.split(':').slice(1).join(':').trim() : x.detail })))}` : ''}
  ${v.positives?.length ? `<h3>Sterk</h3>${factRows(rowsOf(v.positives).map((x) => ({ icon: '✅', ...x })))}` : ''}
  ${v.risks?.length ? `<h3>Risico's & aandachtspunten</h3>${factRows(rowsOf(v.risks).map((x) => ({ icon: '⚠️', ...x })))}` : ''}
  ${v.rules?.length ? `<h3>Regels die ertoe doen</h3>${factRows(rowsOf(v.rules).map((x) => ({ icon: '📜', ...x })))}` : ''}
  ${v.questions?.length ? `<h3>Open vragen uit de stukken</h3>${factRows(rowsOf(v.questions).map((x) => ({ icon: '❓', ...x })))}` : ''}`;
}

function renderEnvironment(env, links) {
  const labels = { zoning: 'Bestemmingsplan', soil: 'Bodem', foundation: 'Fundering', energy: 'Energie', flood: 'Overstroming' };
  const rows = env ? Object.entries(labels).filter(([k]) => env[k]).map(([k, label]) => { const x = env[k]; return typeof x === 'string' ? { icon: 'ℹ️', title: label, note: x } : { icon: STATUS[x.status]?.[0] ?? 'ℹ️', title: label, value: x.value, note: x.note }; }) : [];
  return `${rows.length ? factRows(rows) : '<p class="muted">Nog niet beoordeeld.</p>'}<p class="links">${links.filter((x) => x.group === 'omgeving').map((x) => `<a target="_blank" rel="noopener" href="${esc(x.url)}">${esc(x.label)} ↗</a>`).join('')}</p>`;
}

function externalLinks(l) {
  const g = l.enriched?.geo || {};
  const addr = encodeURIComponent(`${l.address.street} ${l.address.number} ${l.address.city}`);
  const pc = (l.address.postcode || '').replace(/\s/g, '');
  return [
    { group: 'buurt', label: 'Leefbaarometer', url: `https://www.leefbaarometer.nl/kaart/#kaart?locatie=${encodeURIComponent(l.address.city)}` },
    { group: 'buurt', label: 'AlleCijfers buurt', url: `https://allecijfers.nl/buurt/${encodeURIComponent((g.buurtnaam || '').toLowerCase().replace(/\s+/g, '-'))}-${encodeURIComponent(l.address.city.toLowerCase().replace(/\s+/g, '-'))}/` },
    { group: 'buurt', label: 'Misdaadcijfers (politie)', url: 'https://data.politie.nl/#/Politie/nl/dataset/47022NED/table' },
    { group: 'buurt', label: 'Google Maps', url: `https://www.google.com/maps/search/?api=1&query=${addr}` },
    { group: 'omgeving', label: 'Geluidkaart (Atlas Leefomgeving)', url: 'https://www.atlasleefomgeving.nl/kaarten' },
    { group: 'omgeving', label: 'Overstromingsrisico', url: `https://overstroomik.nl/?postcode=${pc}` },
    { group: 'omgeving', label: 'Bodemloket', url: 'https://www.bodemloket.nl/kaart' },
    { group: 'omgeving', label: 'Omgevingsloket (regels op de kaart)', url: 'https://omgevingswet.overheid.nl/regels-op-de-kaart/' },
    { group: 'omgeving', label: 'Energielabel controleren (EP-online)', url: 'https://www.ep-online.nl/' },
    { group: 'omgeving', label: 'Kadaster (WOZ-waardeloket)', url: 'https://www.wozwaardeloket.nl/' },
    { group: 'omgeving', label: 'Funderingsviewer', url: 'https://www.kcaf.nl/funderingsviewer/' },
  ];
}

function drawMap(l, profile) {
  if (!window.L || !$('#map')) return;
  const g = l.enriched.geo;
  const map = L.map('map', { scrollWheelZoom: false }).setView([g.lat, g.lon], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
  const pin = (lat, lon, label, cls) => L.marker([lat, lon], { icon: L.divIcon({ className: `pin ${cls}`, html: `<span>${label}</span>`, iconSize: [30, 30], iconAnchor: [15, 30] }) }).addTo(map);
  pin(g.lat, g.lon, '🏢', 'home').bindPopup(`<b>${esc(l.address.street)} ${esc(l.address.number)}</b>`);
  for (const ref of profile.references || []) if (ref.lat && Math.abs(ref.lat - g.lat) < 0.08) pin(ref.lat, ref.lon, ref.icon || '📍', 'ref').bindPopup(esc(ref.label));
  const p = l.enriched.pois || {};
  const cats = { station: '🚉', supermarket: '🛒', park: '🌳', dogPark: '🐕', doctors: '🩺', pharmacy: '💊', hospital: '🏥' };
  for (const [k, icon] of Object.entries(cats)) for (const poi of (p[k] || []).slice(0, k === 'park' ? 4 : 2)) if (poi.lat) pin(poi.lat, poi.lon, icon, 'poi').bindPopup(`${icon} ${esc(poi.name || k)} · ${num(poi.dist)} m`);
}

// ---------- profiel & aannames ----------
const FIELDS = [
  ['budget.max', 'Budget maximum (ma)', 'eur'], ['budget.stretchMax', 'Budget rek (pa)', 'eur'], ['income.maxMortgageFromIncome', 'Max. hypotheek op inkomen', 'eur'],
  ['currentHome.originalMortgage', 'Oorspronkelijke hypotheek Beukelaan', 'eur'], ['currentHome.paidOff', 'Afgelost', 'eur'], ['currentHome.assumedMarketUpliftOverWoz', 'Marktwaarde boven WOZ (Beukelaan)', 'pct'],
  ['assumptions.interestRate', 'Hypotheekrente', 'pct'], ['assumptions.termYears', 'Looptijd (jaar)', 'num'], ['assumptions.marketUpliftOverWoz', 'Marktstijging per jaar boven WOZ (nieuwe woning)', 'pct'],
  ['assumptions.parkingSpotValue', 'Waarde eigen parkeerplaats', 'eur'], ['assumptions.outdoorAreaFactor', 'Waarde buitenruimte (factor van m²-prijs)', 'num'], ['assumptions.buyersAgentCost', 'Aankoopmakelaar', 'eur'], ['assumptions.advisorCost', 'Hypotheekadvies', 'eur'],
];
const getPath = (o, p) => p.split('.').reduce((c, k) => c?.[k], o);
function renderProfile() {
  const profile = effectiveProfile();
  const eq = equity(profile);
  const maxAff = maxAffordablePrice(profile, eq);
  $('#app').innerHTML = `<a class="back" href="#/">← Alle woningen</a>
    <section class="card"><h1>Financieel profiel</h1>
      ${kv([
        ['Kopers', profile.buyers.label, profile.buyers.note],
        ['Inkomen', `${eur(profile.income.grossMonthly)} bruto/maand`, profile.income.note],
        ['Huidige woning', profile.currentHome.address, profile.currentHome.note],
        ['WOZ huidige woning', eur(eq.woz), eq.wozYear ? `peildatum 1-1-${eq.wozYear}` : ''],
        ['Geschatte marktwaarde', eur(eq.value), ''], ['Restschuld', eur(eq.remaining), ''], ['Netto overwaarde', eur(eq.net), 'na verkoopkosten'],
        ['Max. betaalbare koopsom', eur(round1000(maxAff)), 'hypotheek + overwaarde − kosten koper − verhuizing'],
      ])}
      ${eq.wozHistory?.length ? `<h3>WOZ-verloop ${esc(profile.currentHome.address.split(',')[0])}</h3>${wozChart(eq.wozHistory)}` : ''}
    </section>
    ${(() => { const t = marketTiming(state.market, profile, eq, profile.budget.max); return t ? `<section class="card"><h2>Markt & timing</h2><p class="verdict ${esc(t.tone)}">${esc(t.verdict)}</p>${kv(t.rows)}<p class="muted small">Bron: ${esc(t.source)}; opgehaald ${esc(t.updatedAt)}.</p></section>` : ''; })()}
    ${section('Aannames', kv(assumptionsList(profile, eq)))}
    <section class="card"><h2>Wensenlijst</h2>${kv(profile.wishes.map((w) => [w.label, w.weight === 'must' ? 'harde eis' : w.weight === 'should' ? 'wens' : 'pluspunt']))}</section>
    <section class="card"><h2>Aannames aanpassen</h2><p class="muted">Wijzigingen worden alleen in deze browser bewaard en direct doorgerekend. Structurele wijzigingen horen in <code>data/profile.json</code>.</p>
      <form id="assumptions">${FIELDS.map(([path, label, type]) => { const v = getPath(profile, path); const shown = type === 'pct' ? (v * 100).toFixed(2) : v; return `<label><span>${esc(label)}</span><input name="${path}" data-type="${type}" type="number" step="${type === 'pct' ? '0.05' : type === 'num' ? '0.05' : '1000'}" value="${shown}">${type === 'pct' ? '<em>%</em>' : type === 'eur' ? '<em>€</em>' : ''}</label>`; }).join('')}
      <div class="actions"><button type="submit" class="btn">Opslaan</button><button type="button" class="btn secondary" id="reset">Terug naar standaard</button></div></form>
    </section>`;
  $('#assumptions').addEventListener('submit', (ev) => { ev.preventDefault(); const o = {}; for (const inp of ev.target.querySelectorAll('input')) { const v = Number(inp.value); if (Number.isNaN(v)) continue; o[inp.name] = inp.dataset.type === 'pct' ? v / 100 : v; } state.overrides = o; saveOverrides(o); renderProfile(); });
  $('#reset').addEventListener('click', () => { state.overrides = {}; saveOverrides({}); renderProfile(); });
}

// ---------- thema ----------
const THEME_KEY = 'woningcheck.theme';
function applyTheme(t) { document.documentElement.dataset.theme = t; const b = $('#theme'); if (b) b.textContent = t === 'dark' ? '☀️' : '🌙'; }
function initTheme() {
  let t = null; try { t = localStorage.getItem(THEME_KEY); } catch { /* privémodus */ }
  applyTheme(t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#theme')?.addEventListener('click', () => { const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; applyTheme(next); try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ } });
}
initTheme();

// ---------- uitleg bij ratings (hover = title, klik = popover) ----------
const EXPLAIN = {
  score: ['Totaalscore', 'Score 0–100 = {weights}. Verwachte waardestijging telt bewust niet mee (informatief). Een harde eis die niet gehaald wordt maakt de score maximaal 44; als de financiering niet past maximaal 55. De VvE telt niet mee, zodat woningen mét en zónder stukken vergelijkbaar blijven. Labels: 75+ Sterke kandidaat, 60+ Kansrijk, 45+ Twijfelgeval, lager Afvaller.'],
  wishes: ['Woning & wensen', 'Elke wens uit het profiel wordt gecheckt tegen de Funda-kenmerken. Harde eisen tellen 3×, wensen 2×, pluspunten 1×. ✅ = alle punten, ⚠️ = de helft, ❌ of ❔ (onbekend) = geen punten. Vraag de onbekende punten na bij de bezichtiging.'],
  neighbourhood: ['Buurt', 'CBS-kerncijfers van de buurt vergeleken met de gemeente: aandeel koopwoningen (≥55% goed), corporatiehuur (≤25% goed), gemiddelde WOZ t.o.v. gemeente, lage en hoge inkomens, huishoudens rond het sociaal minimum, plus politiecijfers van de wijk (misdrijven en woninginbraken per 1.000 inwoners over de laatste 12 maanden, t.o.v. gemeente). Leeftijdsopbouw en stedelijkheid zijn informatief en tellen niet mee.'],
  location: ['Locatie', 'Station op fietsafstand (pa fietst; ≤15 min goed, ≤25 deels), Daan ≤10 min fietsen, supermarkt ≤15 min lopen of ≤10 min fietsen (ma), huisarts en apotheek ≤15 min lopen, uitlaatgebied (gras, park, losloopgebied) ≤10 min lopen, ziekenhuis ≤3 km, bushalte ≤400 m, geen drukke weg <250 m of spoor <200 m. Reistijden via OpenStreetMap/OSRM. Zelfde weging als de wensen.'],
  woz: ['WOZ-waarde', 'De WOZ is de waarde die de gemeente vaststelt op 1 januari van het jaar vóór het belastingjaar; de WOZ van 2026 beschrijft dus de markt van 1-1-2025, ruim anderhalf jaar geleden. Gemeenten waarderen bovendien conservatief en met standaardmodellen die penthouses, dakterrassen en eigen parkeerplaatsen onderschatten. In een stijgende markt ligt een vraagprijs daarom normaal 10–20% boven de laatste WOZ. Zit een vraagprijs er ruim boven, dan is dat een onderhandelingsargument; zit hij eronder (zoals bij Aziëlaan), dan is dat scherp geprijsd. Daarom weegt de WOZ hier maar 40% mee in de indicatieve waarde, met een opslag van 8% per jaar sinds de peildatum.'],
  price: ['Prijs & waarde', 'Start op 70, minus 200 × het percentage dat de vraagprijs boven onze indicatieve waarde ligt (of plus als eronder), plus 20 als de financiering past bij de vraagprijs. Marktconform en betaalbaar ≈ 90; 10% te duur ≈ 70. De indicatieve waarde = 60% m²-model (buurtprijs per m², buitenruimte, parkeerplaats, penthouse, label) + 40% WOZ-anker.'],
  vve: ['VvE-beoordeling', 'Aparte score uit de VvE-stukken: reservefonds per appartement (≥€5.000 goed), MJOP aanwezig, jaarlijkse reservering per appartement (≥€900 goed), positief resultaat, betalingsachterstanden, professioneel beheer, maandbijdrage per m² (≤€3,50 goed) en het aantal risico\'s uit de notulen. Telt bewust niet mee in de totaalscore.'],
  investment: ['Verwachte waardestijging', 'Basis = gemiddelde van de langjarige 3% en de actuele CBS-prijsstijging. Daarna bijgesteld: energielabel (A++ +0,5%, A +0,3%, B −0,1%, C of lager −0,5%), vraagprijs t.o.v. indicatieve waarde (±0,4%), nieuwbouw +0,2% / ouder dan 2000 −0,2%, koopbuurt +0,2% / huurbuurt −0,2%, schaars segment +0,2%. Bandbreedte ±1,5%. De investeringsscore (0–100) = 50 + 2000 × (verwachting − 3%) − 100 × premie boven de waarde; alleen om woningen onderling te vergelijken.'],
  bid: ['Bod-range', 'Indicatieve waarde = 60% m²-model + 40% WOZ-anker. Range: onderkant = laagste van 96% vraagprijs en 97% waarde; bovenkant = hoogste van vraagprijs × vraagfactor (laag 1,00 / gemiddeld 1,03 / hoog 1,06) en 103% waarde. Openingsbod = 96,5% van de vraagprijs bij lage belangstelling, 98% bij gemiddelde, 100% bij hoge, maar nooit boven de waarde. Bij "bieden vanaf" nooit onder de vraagprijs. Plafond = laagste van budget-max en maximaal betaalbaar.'],
  monthly: ['Maandlasten', 'Annuïteitenhypotheek tegen de aangenomen rente + VvE-bijdrage + OZB over de WOZ + waterschap/riool/afval + energie (€/m² × m²) + verzekering + eigen onderhoud. Netto = bruto minus belastingvoordeel (renteaftrek ±37% minus eigenwoningforfait).'],
};
function explainText(key) {
  const e = EXPLAIN[key]; if (!e) return null;
  const W = { wishes: 0.5, location: 0.2, neighbourhood: 0.1, price: 0.2, ...(state.profile?.scoreWeights || {}) };
  const weights = `woning & wensen ${Math.round(W.wishes * 100)}% + locatie ${Math.round(W.location * 100)}% + buurt ${Math.round(W.neighbourhood * 100)}% + prijs & waarde ${Math.round(W.price * 100)}%`;
  return [e[0], e[1].replace('{weights}', weights)];
}
function explainable(key, inner, cls = '') { const e = explainText(key); return e ? `<span class="explainable ${cls}" data-explain="${key}" title="${esc(e[1])}" tabindex="0">${inner}</span>` : inner; }
function showExplain(key) {
  const e = explainText(key); if (!e) return;
  let d = $('#explain'); if (!d) { d = document.createElement('dialog'); d.id = 'explain'; document.body.appendChild(d); d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); }); }
  d.innerHTML = `<h3>${esc(e[0])}</h3><p>${esc(e[1])}</p><button class="btn" type="button" id="explain-close">Sluiten</button>`;
  $('#explain-close').addEventListener('click', () => d.close());
  d.showModal();
}
document.addEventListener('click', (ev) => { const el = ev.target.closest('[data-explain]'); if (el) { ev.preventDefault(); ev.stopPropagation(); showExplain(el.dataset.explain); } });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.dataset?.explain) showExplain(ev.target.dataset.explain); });

// ---------- wat-als sliders ----------
const whatIfState = {};
function renderWhatIf(l, a, profile) {
  const fin = a.finAsking; const b = a.bid; const eq = a.eq;
  const st = whatIfState[l.id] ||= { price: b?.opening ?? fin.price, rate: profile.assumptions.interestRate, own: eq.net || 0 };
  const min = Math.round(Math.min(b?.low ?? fin.price * 0.9, fin.price * 0.9) / 1000) * 1000, max = Math.round(Math.max(b?.ceiling ?? fin.price * 1.15, fin.price * 1.15) / 1000) * 1000;
  return `<div class="whatif" data-listing="${esc(l.id)}">
    <div class="wi-controls">
      <label><span>Mijn bod</span><input type="range" name="price" min="${min}" max="${max}" step="1000" value="${st.price}"><b data-out="price">${eur(st.price)}</b></label>
      <label><span>Hypotheekrente</span><input type="range" name="rate" min="2.5" max="6.5" step="0.1" value="${(st.rate * 100).toFixed(1)}"><b data-out="rate">${pct(st.rate, 1)}</b></label>
      <label><span>Eigen geld inzetten</span><input type="range" name="own" min="0" max="${Math.round((eq.net || 0) / 1000) * 1000}" step="5000" value="${st.own}"><b data-out="own">${eur(st.own)}</b></label>
    </div>
    <div class="wi-out">${whatIfOut(l, a, profile, st)}</div>
  </div>`;
}
function whatIfOut(l, a, profile, st) {
  const p = structuredClone(profile); p.assumptions.interestRate = st.rate;
  const f = financeFor(st.price, l, p, { ...a.eq, net: st.own });
  const base = a.finAsking;
  const diff = st.price - base.price;
  return tiles([
    { icon: '💶', label: 'Bod t.o.v. vraagprijs', value: `${diff >= 0 ? '+' : '−'}${eur(Math.abs(diff))}`, sub: `${pct(st.price / base.price - 1, 1)}${a.bid ? ` · waarde ${pct(st.price / a.bid.indicative - 1, 1)}` : ''}`, tone: a.bid && st.price > a.bid.ceiling ? 'fail' : a.bid && st.price > a.bid.high ? 'warn' : 'ok' },
    { icon: '🏦', label: 'Hypotheek nodig', value: eur(f.mortgage), sub: `${pct(f.ltv)} van de koopsom · max ${eur(f.maxMortgage)}`, tone: f.fits ? 'ok' : 'fail' },
    { icon: '📅', label: 'Maandlast bruto', value: eur(f.monthlyTotal), sub: `hypotheek ${eur(f.monthlyMortgage)} · ${f.monthlyTotal - base.monthlyTotal >= 0 ? '+' : '−'}${eur(Math.abs(f.monthlyTotal - base.monthlyTotal))} t.o.v. vraagprijs` },
    { icon: '🧾', label: 'Maandlast netto', value: eur(f.monthlyNet), sub: 'na belastingvoordeel (jaar 1)' },
    { icon: '💸', label: 'Kosten koper', value: eur(f.kk.total), sub: pct(f.kk.pctOfPrice, 1) },
    { icon: f.fits ? '✅' : '❌', label: 'Past de financiering?', value: f.fits ? 'Ja' : 'Nee', sub: f.fits ? `ruimte ${eur(f.maxMortgage - f.mortgage)}` : `tekort ${eur(f.mortgage - f.maxMortgage)}`, tone: f.fits ? 'ok' : 'fail' },
  ]);
}
document.addEventListener('input', (ev) => {
  const wi = ev.target.closest('.whatif'); if (!wi) return;
  const id = wi.dataset.listing; const l = state.listings.find((x) => x.id === id); if (!l) return;
  const st = whatIfState[id]; const v = Number(ev.target.value);
  if (ev.target.name === 'price') st.price = v; else if (ev.target.name === 'rate') st.rate = v / 100; else if (ev.target.name === 'own') st.own = v;
  wi.querySelector('[data-out=price]').textContent = eur(st.price); wi.querySelector('[data-out=rate]').textContent = pct(st.rate, 1); wi.querySelector('[data-out=own]').textContent = eur(st.own);
  const profile = effectiveProfile(); const a = analyze(l, profile, state.market);
  wi.querySelector('.wi-out').innerHTML = whatIfOut(l, a, profile, st);
});

// ---------- visuals ----------
const tiles = (items) => `<div class="tiles">${items.filter(Boolean).map((t) => `<div class="tile ${t.tone || ''}"><div class="tile-icon">${t.icon || ''}</div><div class="tile-value">${t.value}</div><div class="tile-label">${esc(t.label)}</div>${t.sub ? `<div class="tile-sub">${esc(t.sub)}</div>` : ''}</div>`).join('')}</div>`;
const WISH_ICONS = { setting: '🌅', exterior: '🏛️', city: '📍', price: '💶', singleFloor: '↔️', buildYear: '🏗️', moveInReady: '🔑', energyLabel: '⚡', bedrooms: '🛏️', maxFloor: '🏢', lift: '🛗', balcony: '🌤️', area: '📐', bath: '🛁', corner: '🔆', airco: '❄️', floorHeating: '🔥', parking: '🚗' };
const wishGrid = (items) => `<div class="wish-grid">${items.map((i) => `<div class="wish ${i.status}"><div class="wish-top"><span class="wish-icon">${WISH_ICONS[i.id] || '•'}</span><span class="wish-status">${STATUS[i.status]?.[0] ?? ''}</span></div><b>${esc(i.label)}</b>${i.weight === 'must' ? '<span class="tag">must</span>' : i.weight === 'nice' ? '<span class="tag light">plus</span>' : ''}<div class="wish-val">${esc(i.value)}</div><div class="muted small">norm: ${esc(i.norm || '–')}${i.note ? ` · ${esc(i.note)}` : ''}</div></div>`).join('')}</div>`;
const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#db2777', '#64748b'];
function stackedBar(rows, total) {
  return `<div class="stack"><div class="stack-bar">${rows.map((r, i) => `<i style="width:${((r[1] / total) * 100).toFixed(1)}%;background:${PALETTE[i % PALETTE.length]}" title="${esc(r[0])}"></i>`).join('')}</div><div class="legend">${rows.map((r, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(r[0])} <b>${eur(r[1])}</b></span>`).join('')}</div></div>`;
}
function projectionChart(inv, price) {
  const H = inv.projections.mid.H, W = 640, Hh = 200, padL = 56, padB = 24, padT = 12;
  const series = [['low', inv.low, '#94a3b8'], ['mid', inv.expected, '#2563eb'], ['high', inv.high, '#16a34a']];
  const max = price * (1 + inv.high) ** H * 1.05, min = price * 0.9;
  const x = (t) => padL + (t / H) * (W - padL - 12), y = (v) => padT + (1 - (v - min) / (max - min)) * (Hh - padT - padB);
  const path = (g) => Array.from({ length: H + 1 }, (_, t) => `${t ? 'L' : 'M'}${x(t).toFixed(1)},${y(price * (1 + g) ** t).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min));
  return `<svg class="proj" viewBox="0 0 ${W} ${Hh}">${ticks.map((v) => `<g><line x1="${padL}" x2="${W - 12}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="tick">${Math.round(v / 1000)}k</text></g>`).join('')}${[0, 5, H].map((t) => `<text x="${x(t)}" y="${Hh - 6}" text-anchor="middle" class="tick">${t === 0 ? 'nu' : `+${t} jr`}</text>`).join('')}${series.map(([k, g, c]) => `<path d="${path(g)}" fill="none" stroke="${c}" stroke-width="${k === 'mid' ? 3 : 2}" ${k === 'mid' ? '' : 'stroke-dasharray="6 4"'}/>`).join('')}${series.map(([k, g, c]) => `<text x="${x(H) - 4}" y="${y(price * (1 + g) ** H) - 6}" text-anchor="end" fill="${c}" class="lbl">${pct(g, 1)} → ${eur(price * (1 + g) ** H)}</text>`).join('')}</svg>`;
}
function pairedBars(rows) {
  return `<div class="paired">${rows.map(([label, a, b]) => { const max = Math.max(a, b, 1); return `<div class="pair"><div class="pair-label">${esc(label)}</div><div class="pair-bars"><div><i class="a" style="width:${(a / max) * 100}%"></i><span>${a}%</span></div><div><i class="b" style="width:${(b / max) * 100}%"></i><span>${b}%</span></div></div></div>`; }).join('')}<div class="legend"><span><i class="a"></i>buurt</span><span><i class="b"></i>gemeente</span></div></div>`;
}
const CHECKS_KEY = (id) => `woningcheck.checks.${id}`;
function checklist(id, group, items) {
  let done = []; try { done = JSON.parse(localStorage.getItem(CHECKS_KEY(id)) || '[]'); } catch { /* ignore */ }
  return `<ul class="checklist" data-listing="${esc(id)}">${items.map((it, i) => { const key = `${group}:${i}`; return `<li class="${done.includes(key) ? 'done' : ''}"><label><input type="checkbox" data-key="${key}" ${done.includes(key) ? 'checked' : ''}><span>${it.tag ? `<em class="qtag">${esc(it.tag)}</em> ` : ''}${it.status ? `${STATUS[it.status]?.[0] ?? ''} ` : ''}${esc(it.text)}</span></label></li>`; }).join('')}</ul>`;
}
document.addEventListener('change', (ev) => {
  const box = ev.target.closest('.checklist input[type=checkbox]'); if (!box) return;
  const id = box.closest('.checklist').dataset.listing; const key = box.dataset.key;
  let done = []; try { done = JSON.parse(localStorage.getItem(CHECKS_KEY(id)) || '[]'); } catch { /* ignore */ }
  done = box.checked ? [...new Set([...done, key])] : done.filter((k) => k !== key);
  try { localStorage.setItem(CHECKS_KEY(id), JSON.stringify(done)); } catch { /* ignore */ }
  box.closest('li').classList.toggle('done', box.checked);
});

// ---------- router ----------
function route() {
  const h = location.hash || '#/';
  if (!state.profile) { if (vault.manifest?.encrypted && !vault.key) renderLogin(); return; }
  window.scrollTo(0, 0);
  if (h.startsWith('#/w/')) renderDetail(decodeURIComponent(h.slice(4)));
  else if (h === '#/profiel') renderProfile();
  else renderOverview();
}
window.addEventListener('hashchange', route);
loadData().then(route).catch((e) => { if (e instanceof NeedsLogin) renderLogin(); else $('#app').innerHTML = `<section class="card"><p>Kon de data niet laden: ${esc(e.message)}</p></section>`; });
