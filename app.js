'use strict';
const KEY = 'finanzas-pareja-v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = n => Math.round(n * 100) / 100;

const defaults = () => ({
  config: { a: 'Persona A', b: 'Persona B', pct: 50, moneda: '$' },
  deudas: [],   // {id,tipo,persona,monto,fecha,vence,concepto,pagos:[{id,monto,fecha}]}
  gastos: []    // {id,tipo:'compra'|'liquidacion',pagador,monto,fecha,categoria,descripcion,pctA}
});
let db = load();

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d) return { ...defaults(), ...d, config: { ...defaults().config, ...d.config } };
  } catch (e) { /* storage vacío o corrupto */ }
  return defaults();
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* solo caché local */ }
  render();
  schedulePush();
}

const money = n => `${db.config.moneda}${round(n).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fdate = d => d ? new Date(d + 'T00:00').toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

/* ---------- cálculos ---------- */
const pagado = d => round(d.pagos.reduce((s, p) => s + p.monto, 0));
const saldo = d => round(d.monto - pagado(d));

// pagador: 'a' | 'b'. Devuelve totales y saldo neto.
function balance(gastos) {
  let pagoA = 0, pagoB = 0, cuotaA = 0, cuotaB = 0, liqA = 0, liqB = 0, total = 0;
  for (const g of gastos) {
    if (g.tipo === 'liquidacion') {
      if (g.pagador === 'a') liqA += g.monto; else liqB += g.monto;
      continue;
    }
    total += g.monto;
    if (g.pagador === 'a') pagoA += g.monto; else pagoB += g.monto;
    cuotaA += g.monto * g.pctA / 100;
    cuotaB += g.monto * (100 - g.pctA) / 100;
  }
  // netoA > 0: A puso de más y B le debe. Una liquidación de A a B reduce lo que A había adelantado.
  const netoA = round(pagoA - cuotaA + liqA - liqB);
  return { total: round(total), pagoA: round(pagoA), pagoB: round(pagoB), cuotaA: round(cuotaA), cuotaB: round(cuotaB), netoA };
}
const nombre = k => db.config[k];

/* ---------- render ---------- */
function render() {
  renderResumen(); renderDeudas(); renderHogar(); renderConfig();
}

function renderResumen() {
  const activas = db.deudas.filter(d => saldo(d) > 0);
  const meDeben = round(activas.filter(d => d.tipo === 'me-deben').reduce((s, d) => s + saldo(d), 0));
  const debo = round(activas.filter(d => d.tipo === 'debo').reduce((s, d) => s + saldo(d), 0));
  const b = balance(db.gastos);
  const vencidas = activas.filter(d => d.vence && d.vence < today());

  // saldo por persona
  const porPersona = {};
  activas.forEach(d => { porPersona[d.persona] = (porPersona[d.persona] || 0) + (d.tipo === 'me-deben' ? 1 : -1) * saldo(d); });
  const filas = Object.entries(porPersona).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
    .map(([p, v]) => `<tr><td>${esc(p)}</td><td class="r ${v >= 0 ? 'good' : 'bad'}">${v >= 0 ? 'te debe ' : 'le debes '}${money(Math.abs(v))}</td></tr>`).join('');

  $('#tab-resumen').innerHTML = `
    <div class="stats">
      <div class="stat"><div class="muted">Me deben</div><div class="n good">${money(meDeben)}</div></div>
      <div class="stat"><div class="muted">Yo debo</div><div class="n bad">${money(debo)}</div></div>
      <div class="stat"><div class="muted">Balance de deudas</div><div class="n ${meDeben - debo >= 0 ? 'good' : 'bad'}">${money(meDeben - debo)}</div></div>
      <div class="stat"><div class="muted">Gastos del hogar</div><div class="n">${money(b.total)}</div></div>
    </div>
    ${vencidas.length ? `<div class="card warn" style="margin-top:16px">⚠️ ${vencidas.length} deuda(s) vencida(s): ${vencidas.map(d => esc(d.persona)).join(', ')}</div>` : ''}
    <div class="card" style="margin-top:16px"><h2>Hogar</h2>${textoBalance(b)}</div>
    <div class="card"><h2>Saldo por persona</h2>
      ${filas ? `<table>${filas}</table>` : '<p class="muted">Sin deudas pendientes.</p>'}</div>`;
}

function textoBalance(b) {
  if (!b.total) return '<p class="muted">Aún no hay compras registradas.</p>';
  let msg;
  if (Math.abs(b.netoA) < 0.005) msg = '✅ Están a mano.';
  else if (b.netoA > 0) msg = `<b>${esc(nombre('b'))}</b> debe pagar <b class="bad">${money(b.netoA)}</b> a <b>${esc(nombre('a'))}</b>.`;
  else msg = `<b>${esc(nombre('a'))}</b> debe pagar <b class="bad">${money(-b.netoA)}</b> a <b>${esc(nombre('b'))}</b>.`;
  const pa = b.total ? b.pagoA / b.total * 100 : 0;
  return `
    <div class="callout">${msg}</div>
    <div class="bar split"><span style="width:${pa}%"></span><span style="width:${100 - pa}%"></span></div>
    <table>
      <tr><th></th><th class="r">${esc(nombre('a'))}</th><th class="r">${esc(nombre('b'))}</th></tr>
      <tr><td>Ha aportado</td><td class="r">${money(b.pagoA)}</td><td class="r">${money(b.pagoB)}</td></tr>
      <tr><td>Le corresponde</td><td class="r">${money(b.cuotaA)}</td><td class="r">${money(b.cuotaB)}</td></tr>
      <tr><td>Diferencia</td><td class="r ${b.netoA >= 0 ? 'good' : 'bad'}">${money(b.netoA)}</td><td class="r ${b.netoA <= 0 ? 'good' : 'bad'}">${money(-b.netoA)}</td></tr>
    </table>`;
}

function renderDeudas() {
  $('#personas').innerHTML = [...new Set(db.deudas.map(d => d.persona))].map(p => `<option value="${esc(p)}">`).join('');
  const ft = $('#f-tipo').value, fe = $('#f-estado').value;
  const lista = db.deudas.filter(d => (!ft || d.tipo === ft) && (!fe || (fe === 'pagada') === (saldo(d) <= 0)))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  $('#lista-deudas').innerHTML = lista.length ? lista.map(d => {
    const s = saldo(d), p = pagado(d), pct = Math.min(100, p / d.monto * 100);
    const venc = d.vence && s > 0 && d.vence < today();
    return `<div class="item">
      <div class="row between">
        <div><b>${esc(d.persona)}</b> <span class="badge ${d.tipo === 'me-deben' ? 'good' : 'bad'}">${d.tipo === 'me-deben' ? 'Me debe' : 'Le debo'}</span>
          ${s <= 0 ? '<span class="badge good">Pagada</span>' : ''}${venc ? '<span class="badge warn">Vencida</span>' : ''}
          <div class="muted">${esc(d.concepto || 'Sin concepto')} · ${fdate(d.fecha)}${d.vence ? ' · vence ' + fdate(d.vence) : ''}</div></div>
        <div style="text-align:right"><b>${money(s)}</b><div class="muted">de ${money(d.monto)}</div></div>
      </div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      ${d.pagos.length ? `<div class="muted">${d.pagos.map(x => `${fdate(x.fecha)}: ${money(x.monto)} <a href="#" data-delpago="${d.id}|${x.id}">✕</a>`).join(' · ')}</div>` : ''}
      <div class="pay">
        ${s > 0 ? `<input type="number" step="0.01" min="0.01" max="${s}" placeholder="Abono" data-abono="${d.id}">
        <button class="small primary" data-pagar="${d.id}">Registrar pago</button>
        <button class="small" data-liquidar="${d.id}">Pagar todo</button>` : ''}
        <button class="small danger" data-deldeuda="${d.id}">Eliminar</button>
      </div></div>`;
  }).join('') : '<p class="muted">No hay deudas con este filtro.</p>';
}

function mesesDisponibles() {
  return [...new Set(db.gastos.map(g => g.fecha.slice(0, 7)))].sort().reverse();
}

function renderHogar() {
  const fm = $('#f-mes'), prev = fm.value;
  const meses = mesesDisponibles();
  fm.innerHTML = '<option value="">Todo el tiempo</option>' + meses.map(m => `<option value="${m}">${m}</option>`).join('');
  fm.value = meses.includes(prev) ? prev : '';

  const sel = $('#form-gasto [name=pagador]');
  const cur = sel.value;
  sel.innerHTML = `<option value="a">${esc(nombre('a'))}</option><option value="b">${esc(nombre('b'))}</option>`;
  if (cur) sel.value = cur;
  $$('.nombreA').forEach(e => e.textContent = nombre('a'));
  const pctIn = $('#form-gasto [name=pctA]');
  if (!pctIn.value) pctIn.value = db.config.pct;

  const b = balance(db.gastos); // el balance de deuda siempre es acumulado
  $('#balance-hogar').innerHTML = `<h2>¿Quién debe a quién?</h2>${textoBalance(b)}
    ${Math.abs(b.netoA) >= 0.005 ? `<button id="btn-liquidar">Registrar que ya se pagaron ${money(Math.abs(b.netoA))}</button>` : ''}`;

  const lista = db.gastos.filter(g => !fm.value || g.fecha.startsWith(fm.value)).sort((x, y) => y.fecha.localeCompare(x.fecha));
  const bm = balance(lista);
  $('#lista-gastos').innerHTML = lista.length ? `
    ${fm.value ? `<p class="muted">Total del mes: ${money(bm.total)} · ${esc(nombre('a'))} puso ${money(bm.pagoA)}, ${esc(nombre('b'))} puso ${money(bm.pagoB)}</p>` : ''}
    <table>${lista.map(g => g.tipo === 'liquidacion'
      ? `<tr><td>${fdate(g.fecha)}</td><td>🤝 ${esc(nombre(g.pagador))} pagó a ${esc(nombre(g.pagador === 'a' ? 'b' : 'a'))}</td><td class="r">${money(g.monto)}</td><td><a href="#" data-delgasto="${g.id}">✕</a></td></tr>`
      : `<tr><td>${fdate(g.fecha)}</td><td>${esc(g.descripcion)}<div class="muted">${esc(g.categoria)} · pagó ${esc(nombre(g.pagador))} · ${g.pctA}/${100 - g.pctA}</div></td><td class="r">${money(g.monto)}</td><td><a href="#" data-delgasto="${g.id}">✕</a></td></tr>`).join('')}</table>`
    : '<p class="muted">Sin movimientos.</p>';
}

function renderConfig() {
  const f = $('#form-config');
  if (document.activeElement && f.contains(document.activeElement)) return;
  f.a.value = db.config.a; f.b.value = db.config.b; f.pct.value = db.config.pct; f.moneda.value = db.config.moneda;
}

/* ---------- eventos ---------- */
$('#tabs').addEventListener('click', e => {
  const t = e.target.dataset.tab; if (!t) return;
  $$('#tabs button').forEach(b => b.classList.toggle('active', b === e.target));
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + t));
});

$('#form-deuda').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, v = Object.fromEntries(new FormData(f));
  db.deudas.push({ id: uid(), tipo: v.tipo, persona: v.persona.trim(), monto: round(+v.monto), fecha: v.fecha, vence: v.vence, concepto: v.concepto.trim(), pagos: [] });
  f.reset(); f.fecha.value = today(); save();
});

$('#lista-deudas').addEventListener('click', e => {
  const t = e.target, ds = t.dataset;
  const find = id => db.deudas.find(d => d.id === id);
  if (ds.pagar) {
    const d = find(ds.pagar), v = round(+$(`[data-abono="${ds.pagar}"]`).value);
    if (!(v > 0)) return;
    d.pagos.push({ id: uid(), monto: Math.min(v, saldo(d)), fecha: today() }); save();
  } else if (ds.liquidar) {
    const d = find(ds.liquidar); d.pagos.push({ id: uid(), monto: saldo(d), fecha: today() }); save();
  } else if (ds.deldeuda) {
    if (confirm('¿Eliminar esta deuda y sus pagos?')) { db.deudas = db.deudas.filter(d => d.id !== ds.deldeuda); save(); }
  } else if (ds.delpago) {
    e.preventDefault();
    const [did, pid] = ds.delpago.split('|'), d = find(did); d.pagos = d.pagos.filter(p => p.id !== pid); save();
  }
});
$('#f-tipo').addEventListener('change', renderDeudas);
$('#f-estado').addEventListener('change', renderDeudas);

$('#form-gasto').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, v = Object.fromEntries(new FormData(f));
  const pct = Math.min(100, Math.max(0, +v.pctA));
  db.gastos.push({ id: uid(), tipo: 'compra', pagador: v.pagador, monto: round(+v.monto), fecha: v.fecha, categoria: v.categoria, descripcion: v.descripcion.trim(), pctA: pct });
  f.monto.value = ''; f.descripcion.value = ''; save();
});
$('#f-mes').addEventListener('change', renderHogar);

$('#balance-hogar').addEventListener('click', e => {
  if (e.target.id !== 'btn-liquidar') return;
  const b = balance(db.gastos);
  const deudor = b.netoA > 0 ? 'b' : 'a';
  db.gastos.push({ id: uid(), tipo: 'liquidacion', pagador: deudor, monto: Math.abs(b.netoA), fecha: today() });
  save();
});
$('#lista-gastos').addEventListener('click', e => {
  const id = e.target.dataset.delgasto; if (!id) return;
  e.preventDefault();
  if (confirm('¿Eliminar este movimiento?')) { db.gastos = db.gastos.filter(g => g.id !== id); save(); }
});

$('#form-config').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  db.config = { a: f.a.value.trim(), b: f.b.value.trim(), pct: Math.min(100, Math.max(0, +f.pct.value)), moneda: f.moneda.value.trim() };
  $('#form-gasto [name=pctA]').value = db.config.pct;
  save(); f.querySelector('button').blur();
});

$('#btn-export').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }));
  a.download = `finanzas-${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
});
$('#btn-import').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.deudas) || !Array.isArray(d.gastos)) throw 0;
    if (confirm('Esto reemplazará los datos actuales. ¿Continuar?')) { db = { ...defaults(), ...d }; save(); }
  } catch { alert('Archivo no válido.'); }
  e.target.value = '';
});
$('#btn-reset').addEventListener('click', () => {
  if (confirm('¿Borrar TODOS los datos? No se puede deshacer.')) { db = defaults(); save(); }
});

/* ---------- sincronización (Supabase) ---------- */
const cfg = window.SUPABASE_CONFIG || {};
const remoteOn = !!(cfg.url && cfg.anonKey && window.supabase);
let sb = null, household = null, pushTimer = null, lastSynced = '';

const setSync = t => { $('#sync').textContent = t; };
const norm = d => ({ ...defaults(), ...d, config: { ...defaults().config, ...(d && d.config) } });

function schedulePush() {
  if (!household) return;
  setSync('Guardando…');
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 400);
}
async function push() {
  const snap = JSON.stringify(db);
  const { error } = await sb.from('households')
    .update({ data: db, updated_at: new Date().toISOString() }).eq('id', household.id);
  if (error) { setSync('⚠️ Sin sincronizar'); console.error(error); return; }
  lastSynced = snap; setSync('☁️ Sincronizado');
}

function showOverlay(html) { $('#overlay-box').innerHTML = html; $('#overlay').hidden = false; }
const hideOverlay = () => { $('#overlay').hidden = true; };

function authScreen() {
  showOverlay(`<h2>Iniciar sesión</h2>
    <form id="f-auth">
      <label>Correo <input name="email" type="email" required autocomplete="email"></label>
      <label>Contraseña <input name="password" type="password" minlength="6" required autocomplete="current-password"></label>
      <div class="err" id="auth-err"></div>
      <button class="primary" data-mode="in">Entrar</button>
      <button type="button" id="btn-signup">Crear cuenta</button>
    </form>`);
  const form = $('#f-auth'), err = $('#auth-err');
  const go = async mode => {
    err.textContent = '';
    const cred = { email: form.email.value.trim(), password: form.password.value };
    const { data, error } = mode === 'up' ? await sb.auth.signUp(cred) : await sb.auth.signInWithPassword(cred);
    if (error) { err.textContent = error.message; return; }
    if (!data.session) { err.textContent = 'Revisa tu correo para confirmar la cuenta y luego inicia sesión.'; return; }
    afterAuth(data.session.user);
  };
  form.addEventListener('submit', e => { e.preventDefault(); go('in'); });
  $('#btn-signup').addEventListener('click', () => form.reportValidity() && go('up'));
}

function householdScreen(user) {
  showOverlay(`<h2>Tu hogar</h2>
    <p class="muted">Crea un hogar nuevo o únete al de tu pareja con su código.</p>
    <form id="f-hh">
      <div class="err" id="hh-err"></div>
      <button type="button" class="primary" id="btn-create">Crear hogar nuevo</button>
      <label>Código del hogar <input name="code" placeholder="ej. a1b2c3d4"></label>
      <button>Unirme con código</button>
    </form>`);
  const err = $('#hh-err');
  $('#btn-create').addEventListener('click', async () => {
    const { error } = await sb.rpc('create_household');
    if (error) err.textContent = error.message; else afterAuth(user);
  });
  $('#f-hh').addEventListener('submit', async e => {
    e.preventDefault();
    const code = e.target.code.value.trim();
    if (!code) { err.textContent = 'Escribe el código.'; return; }
    const { error } = await sb.rpc('join_household', { p_code: code });
    if (error) err.textContent = error.message; else afterAuth(user);
  });
}

async function afterAuth(user) {
  const { data: m } = await sb.from('household_members').select('household_id').eq('user_id', user.id).maybeSingle();
  if (!m) return householdScreen(user);
  const { data: h, error } = await sb.from('households').select('id,code,data').eq('id', m.household_id).single();
  if (error) { showOverlay(`<p class="err">${esc(error.message)}</p>`); return; }
  household = h;
  hideOverlay();
  $('#cuenta').hidden = false;
  $('#cuenta-email').textContent = user.email;
  $('#cuenta-code').textContent = h.code;

  const remoteEmpty = !h.data || !Object.keys(h.data).length;
  if (remoteEmpty) { schedulePush(); }          // primer uso: sube lo que hubiera en local
  else { db = norm(h.data); lastSynced = JSON.stringify(db); localStorage.setItem(KEY, lastSynced); render(); }
  setSync('☁️ Sincronizado');

  sb.channel('hh-' + h.id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${h.id}` }, p => {
      const incoming = JSON.stringify(norm(p.new.data));
      if (incoming === JSON.stringify(db)) return;   // eco de mi propio guardado
      db = JSON.parse(incoming);
      try { localStorage.setItem(KEY, incoming); } catch (e) { /* ignorar */ }
      render(); setSync('☁️ Actualizado');
    }).subscribe();
}

async function initRemote() {
  sb = window.supabase.createClient(cfg.url, cfg.anonKey);
  $('#btn-logout').addEventListener('click', async () => {
    await sb.auth.signOut();
    localStorage.removeItem(KEY); location.reload();
  });
  const { data } = await sb.auth.getSession();
  if (data.session) afterAuth(data.session.user); else authScreen();
}

$('#form-deuda').fecha.value = today();
$('#form-gasto').fecha.value = today();
render();
if (remoteOn) initRemote(); else setSync('Modo local (sin nube)');
