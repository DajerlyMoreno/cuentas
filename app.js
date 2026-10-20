'use strict';
const KEY = 'finanzas-pareja-v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = n => Math.round(n * 100) / 100;

/* ---------- fechas (siempre hora local) ---------- */
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const fdate = d => d ? new Date(d + 'T00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' }) : '';
function dayLabel(f) {
  if (f === today()) return 'Hoy';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (f === ymd(y)) return 'Ayer';
  return new Date(f + 'T00:00').toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' });
}
function weekStart(fecha) {            // lunes de la semana de 'YYYY-MM-DD'
  const d = new Date(fecha + 'T00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}
function weekEnd(ws) { const d = new Date(ws + 'T00:00'); d.setDate(d.getDate() + 6); return ymd(d); }
const weekLabel = ws => `${fdate(ws)} – ${fdate(weekEnd(ws))}`;
function prevWeeks(n) {                // últimas n semanas, la actual primero
  const out = []; const d = new Date(weekStart(today()) + 'T00:00');
  for (let i = 0; i < n; i++) { out.push(ymd(d)); d.setDate(d.getDate() - 7); }
  return out;
}

/* ---------- datos ---------- */
const defaults = () => ({
  config: { a: 'Persona A', b: 'Persona B', pct: 50, moneda: '$' },
  gastos: []    // {id,tipo:'compra'|'liquidacion',pagador,monto,fecha,creado,categoria,descripcion,pctA}
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

const money = n => {
  const v = round(n);
  return `${db.config.moneda}${v.toLocaleString('es', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
};
const nombre = k => db.config[k];
const otro = k => (k === 'a' ? 'b' : 'a');
const CAT = { 'Supermercado': '🛒', 'Servicios': '💡', 'Renta': '🏠', 'Limpieza': '🧼', 'Muebles / Hogar': '🛋️', 'Salud': '💊', 'Ocio': '🎬', 'Otro': '🧾' };
const emoji = g => g.tipo === 'liquidacion' ? '💸' : (CAT[g.categoria] || '🧾');

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ---------- cálculos ---------- */
// netoA > 0: A puso de más y B le debe. Un pago de A a B reduce lo que A había adelantado.
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
  const netoA = round(pagoA - cuotaA + liqA - liqB);
  return { total: round(total), pagoA: round(pagoA), pagoB: round(pagoB), cuotaA: round(cuotaA), cuotaB: round(cuotaB), netoA };
}

// Movimientos "vivos": todo lo ocurrido desde la última vez que quedaron a mano.
// Sin importar su fecha: mientras haya deuda, se ve de qué es.
const orden = g => g.creado || Date.parse(g.fecha + 'T00:00');
function pendientes() {
  const todos = [...db.gastos].sort((x, y) => orden(x) - orden(y));
  let cur = [];
  for (const g of todos) {
    cur.push(g);
    if (Math.abs(balance(cur).netoA) < 0.005) cur = [];
  }
  return cur;
}

/* ---------- bloqueo de registros ---------- */
const HORA = 3600000;
// Solo se puede modificar durante la primera hora; los registros sin marca de creación (anteriores) quedan bloqueados.
const editable = g => !!g.creado && Date.now() - g.creado < HORA;
const minsLeft = g => Math.max(1, Math.ceil((g.creado + HORA - Date.now()) / 60000));

/* ---------- render ---------- */
function render() {
  renderInicio(); renderMovs(); renderResumen(); renderConfig(); renderForm();
}

function renderInicio() {
  const pend = pendientes(), b = balance(pend);
  const deuda = Math.abs(b.netoA) >= 0.005;
  const deudor = b.netoA > 0 ? 'b' : 'a', acre = otro(deudor);
  let html = `<div class="hero"><div class="hero-label">Saldo a pagar</div>`;
  if (deuda) {
    html += `<div class="hero-amount">${money(Math.abs(b.netoA))}</div>
      <div class="hero-sub"><b>${esc(nombre(deudor))}</b> le debe a <b>${esc(nombre(acre))}</b></div>
      <button class="hero-btn" id="btn-pagar">Registrar pago</button>`;
  } else {
    html += `<div class="hero-amount">${money(0)}</div><div class="hero-sub">✅ Están a mano</div>`;
  }
  html += '</div>';

  if (deuda) {
    const bruto = round(b.pagoA - b.cuotaA);           // diferencia antes de pagos
    const pagado = round(Math.abs(bruto) - Math.abs(b.netoA));
    const filas = ['a', 'b'].map(k => `
      <div class="line"><span>${esc(nombre(k))}</span><span>compró <b>${money(b['pago' + k.toUpperCase()])}</b> · le tocaba <b>${money(b['cuota' + k.toUpperCase()])}</b></span></div>`).join('');
    html += `<div class="card"><h2>¿Por qué se debe?</h2>
      <p class="expl">En total se compraron <b>${money(b.total)}</b> para el hogar y cada quien debía poner su parte:</p>
      ${filas}
      <p class="expl"><b>${esc(nombre(acre))}</b> puso <b>${money(Math.abs(bruto))}</b> de más, y eso es lo que <b>${esc(nombre(deudor))}</b> le debe.
      ${pagado > 0.005 && (bruto > 0) === (b.netoA > 0) ? `Ya se pagaron ${money(pagado)}, falta <b>${money(Math.abs(b.netoA))}</b>.` : ''}</p>
    </div>`;

    const compras = pend.filter(g => g.tipo === 'compra');
    html += `<h2 style="margin:18px 4px 8px">Compras sin saldar</h2>`;
    for (const k of ['a', 'b']) {
      const items = compras.filter(g => g.pagador === k).sort((x, y) => y.fecha.localeCompare(x.fecha));
      const sum = round(items.reduce((s, g) => s + g.monto, 0));
      html += `<div class="card"><div class="buyer"><h3>🛍️ Compró ${esc(nombre(k))}</h3><b>${money(sum)}</b></div>
        ${items.length ? items.map(g => `<div class="mini"><span>${emoji(g)} ${esc(g.descripcion)}<br><span class="muted">${fdate(g.fecha)} · ${esc(g.categoria)}${g.pctA !== 50 ? ` · ${g.pctA}/${100 - g.pctA}` : ''}</span></span><b>${money(g.monto)}</b></div>`).join('')
          : '<p class="muted" style="margin:0">Nada por ahora.</p>'}
      </div>`;
    }
    const pagos = pend.filter(g => g.tipo === 'liquidacion');
    if (pagos.length) {
      html += `<div class="card"><h3>💸 Pagos ya hechos</h3>${pagos.map(g => `<div class="mini"><span>${esc(nombre(g.pagador))} pagó a ${esc(nombre(otro(g.pagador)))}<br><span class="muted">${fdate(g.fecha)}</span></span><b class="good">${money(g.monto)}</b></div>`).join('')}</div>`;
    }
  } else {
    html += '<p class="muted" style="text-align:center">Toca <b>+</b> para registrar una compra del hogar.</p>';
  }
  $('#tab-inicio').innerHTML = html;
}

function renderMovs() {
  const fv = $('#f-vista'), fp = $('#f-periodo'), prev = fp.value;
  const keyOf = f => fv.value === 'semana' ? weekStart(f) : fv.value === 'mes' ? f.slice(0, 7) : '';
  let periodos = [];
  if (fv.value !== 'todo') periodos = [...new Set(db.gastos.map(g => keyOf(g.fecha)).concat(keyOf(today())))].sort().reverse();
  fp.hidden = fv.value === 'todo';
  fp.innerHTML = periodos.map(p => `<option value="${p}">${fv.value === 'semana' ? weekLabel(p) : new Date(p + '-01T00:00').toLocaleDateString('es', { month: 'long', year: 'numeric' })}</option>`).join('');
  fp.value = periodos.includes(prev) ? prev : (periodos[0] || '');
  const sel = fv.value === 'todo' ? '' : fp.value;

  const lista = db.gastos.filter(g => !sel || keyOf(g.fecha) === sel)
    .sort((x, y) => y.fecha.localeCompare(x.fecha) || orden(y) - orden(x));
  const bm = balance(lista);
  $('#movs-total').innerHTML = lista.length ? `<div class="card"><div class="buyer"><span class="muted">Total gastado</span><b style="font-size:20px">${money(bm.total)}</b></div>
    <div class="muted">${esc(nombre('a'))} puso ${money(bm.pagoA)} · ${esc(nombre('b'))} puso ${money(bm.pagoB)}</div></div>` : '';

  let html = '', dia = '';
  for (const g of lista) {
    if (g.fecha !== dia) { dia = g.fecha; html += `<div class="day">${esc(dayLabel(dia))}</div>`; }
    const ed = editable(g);
    const titulo = g.tipo === 'liquidacion' ? `${esc(nombre(g.pagador))} pagó a ${esc(nombre(otro(g.pagador)))}` : esc(g.descripcion);
    const sub = g.tipo === 'liquidacion' ? 'Pago entre ustedes'
      : `Pagó ${esc(nombre(g.pagador))} · ${esc(g.categoria)}${g.pctA !== 50 ? ` · ${g.pctA}/${100 - g.pctA}` : ''}`;
    html += `<div class="mov ${g.tipo === 'liquidacion' ? 'pago' : ''} tap" data-mov="${g.id}">
      <div class="ico">${emoji(g)}</div>
      <div class="mov-body"><div class="mov-t">${titulo}</div><div class="muted">${sub}</div></div>
      <div class="mov-r"><div class="mov-a">${money(g.monto)}</div><div class="muted">${ed ? `✎ ${minsLeft(g)} min` : '🔒'}</div></div></div>`;
  }
  $('#lista-gastos').innerHTML = html || '<p class="muted" style="text-align:center;margin-top:30px">Sin movimientos en este periodo.</p>';
}

function gastoSemanal() {
  const filas = prevWeeks(8).map(ws => ({ ws, ...balance(db.gastos.filter(g => g.tipo === 'compra' && weekStart(g.fecha) === ws)) }));
  const [act, ant] = filas;
  const max = Math.max(...filas.map(f => f.total), 0.01);
  const prom = filas.reduce((s, f) => s + f.total, 0) / filas.length;
  const dif = act.total - ant.total;
  const cambio = ant.total > 0 ? `<span class="${dif > 0 ? 'bad' : 'good'}">${dif > 0 ? '▲' : '▼'} ${Math.abs(dif / ant.total * 100).toFixed(0)}% vs. semana pasada</span>` : weekLabel(act.ws);
  return `<div class="card"><h2>Gasto semanal</h2>
    <div class="stats" style="margin-bottom:12px">
      <div class="stat"><div class="muted">Esta semana</div><div class="n">${money(act.total)}</div><div class="muted">${cambio}</div></div>
      <div class="stat"><div class="muted">Promedio (8 sem.)</div><div class="n">${money(prom)}</div></div>
    </div>
    <table>${filas.map(f => `<tr><td style="white-space:nowrap">${weekLabel(f.ws)}</td>
      <td style="width:45%"><div class="bar split" style="width:${f.total / max * 100}%;min-width:${f.total ? 4 : 0}px"><span style="flex:${f.pagoA};background:var(--primary)"></span><span style="flex:${f.pagoB}"></span></div></td>
      <td class="r">${money(f.total)}</td></tr>`).join('')}</table>
    <p class="muted"><span style="color:var(--primary)">■</span> ${esc(nombre('a'))} &nbsp; <span style="color:var(--accent)">■</span> ${esc(nombre('b'))}</p></div>`;
}

function renderResumen() {
  const mes = today().slice(0, 7);
  const delMes = db.gastos.filter(g => g.tipo === 'compra' && g.fecha.startsWith(mes));
  const b = balance(delMes);
  const porCat = {};
  delMes.forEach(g => { porCat[g.categoria] = (porCat[g.categoria] || 0) + g.monto; });
  const cats = Object.entries(porCat).sort((x, y) => y[1] - x[1]);
  const maxC = cats.length ? cats[0][1] : 1;
  const nombreMes = new Date(mes + '-01T00:00').toLocaleDateString('es', { month: 'long' });

  $('#tab-resumen').innerHTML = `${gastoSemanal()}
    <div class="card"><h2>Lo que compró cada uno en ${esc(nombreMes)}</h2>
      ${delMes.length ? `
      <div class="line"><span>${esc(nombre('a'))}</span><b>${money(b.pagoA)}</b></div>
      <div class="line"><span>${esc(nombre('b'))}</span><b>${money(b.pagoB)}</b></div>
      <div class="line total"><span>Total</span><span>${money(b.total)}</span></div>` : '<p class="muted">Aún no hay compras este mes.</p>'}
    </div>
    ${cats.length ? `<div class="card"><h2>Por categoría</h2>
      ${cats.map(([c, v]) => `<div style="margin-bottom:10px"><div class="buyer" style="margin:0"><span>${CAT[c] || '🧾'} ${esc(c)}</span><b>${money(v)}</b></div><div class="bar"><span style="display:block;height:100%;width:${v / maxC * 100}%;background:var(--primary)"></span></div></div>`).join('')}
    </div>` : ''}`;
}

function renderConfig() {
  const f = $('#form-config');
  if (document.activeElement && f.contains(document.activeElement)) return;
  f.a.value = db.config.a; f.b.value = db.config.b; f.pct.value = db.config.pct; f.moneda.value = db.config.moneda;
}

function renderForm() {                       // nombres en el formulario de compra
  $('#pg-a').textContent = nombre('a'); $('#pg-b').textContent = nombre('b');
  $$('.nombreA').forEach(e => { e.textContent = nombre('a'); });
  $('#pct-def').textContent = `${db.config.pct}/${100 - db.config.pct}`;
}

/* ---------- navegación ---------- */
function showTab(t) {
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + t));
  $('#fab').hidden = t === 'config';
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) showTab(t.dataset.tab);
  if (e.target.closest('[data-close]')) closeSheets();
});

/* ---------- compra: crear / editar / eliminar ---------- */
let editId = null;
const sheetGasto = $('#sheet-gasto');
function closeSheets() { $$('.sheet').forEach(s => { s.hidden = true; }); editId = null; }

function openGasto(g) {
  const f = $('#form-gasto');
  editId = g ? g.id : null;
  f.pagador.value = g ? g.pagador : (f.pagador.value || 'a');
  f.monto.value = g ? g.monto : '';
  f.descripcion.value = g ? g.descripcion : '';
  f.categoria.value = g ? g.categoria : 'Supermercado';
  f.fecha.value = g ? g.fecha : today();
  f.pctA.value = g ? g.pctA : db.config.pct;
  $('#form-gasto-titulo').textContent = g ? 'Editar compra' : 'Nueva compra';
  $('#btn-gasto').textContent = g ? 'Guardar cambios' : 'Guardar compra';
  $('#btn-del-gasto').hidden = !g;
  $('#aviso-hora').textContent = g ? `Te quedan ${minsLeft(g)} min para modificarla.` : 'Podrás editarla o borrarla durante 1 hora; después queda bloqueada.';
  $('#form-gasto details').open = !!g && g.pctA !== db.config.pct;
  sheetGasto.hidden = false;
  if (!g) f.monto.focus();
}
$('#fab').addEventListener('click', () => openGasto(null));

$('#form-gasto').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, v = Object.fromEntries(new FormData(f));
  const datos = { pagador: v.pagador, monto: round(+v.monto), fecha: v.fecha, categoria: v.categoria, descripcion: v.descripcion.trim(), pctA: Math.min(100, Math.max(0, +v.pctA)) };
  if (!(datos.monto > 0)) return;
  if (editId) {
    const g = db.gastos.find(x => x.id === editId);
    if (!g || !editable(g)) { toast('Pasó más de una hora: ya no se puede modificar.'); closeSheets(); render(); return; }
    Object.assign(g, datos);
  } else {
    db.gastos.push({ id: uid(), tipo: 'compra', creado: Date.now(), ...datos });
  }
  closeSheets(); save();
  toast('Guardado ✓');
});
$('#btn-del-gasto').addEventListener('click', () => {
  const g = db.gastos.find(x => x.id === editId);
  if (!g || !editable(g)) { toast('Pasó más de una hora: es inmutable.'); closeSheets(); render(); return; }
  if (!confirm('¿Eliminar esta compra?')) return;
  db.gastos = db.gastos.filter(x => x.id !== editId);
  closeSheets(); save();
});

$('#lista-gastos').addEventListener('click', e => {
  const row = e.target.closest('[data-mov]'); if (!row) return;
  const g = db.gastos.find(x => x.id === row.dataset.mov);
  if (!g) return;
  if (!editable(g)) { toast('🔒 Pasó más de una hora: este registro es inmutable.'); return; }
  if (g.tipo === 'compra') openGasto(g);
  else if (confirm('¿Eliminar este pago?')) { db.gastos = db.gastos.filter(x => x.id !== g.id); save(); }
});
$('#f-vista').addEventListener('change', () => { $('#f-periodo').innerHTML = ''; renderMovs(); });
$('#f-periodo').addEventListener('change', renderMovs);
setInterval(render, 60000); // bloquea los registros cuando se cumple la hora

/* ---------- registrar pago ---------- */
$('#tab-inicio').addEventListener('click', e => {
  if (e.target.id !== 'btn-pagar') return;
  const b = balance(pendientes());
  const deuda = Math.abs(b.netoA);
  if (deuda < 0.005) return;
  const deudor = b.netoA > 0 ? 'b' : 'a';
  $('#pago-box').innerHTML = `<h2>Registrar pago</h2>
    <p class="muted"><b>${esc(nombre(deudor))}</b> le paga a <b>${esc(nombre(otro(deudor)))}</b>. Puedes pagar todo o una parte.</p>
    <form id="form-pago">
      <label class="field">Monto
        <input name="monto" class="big" type="number" inputmode="decimal" step="0.01" min="0.01" max="${deuda}" value="${deuda}" required>
      </label>
      <button class="primary wide">Confirmar pago</button>
    </form>`;
  $('#sheet-pago').hidden = false;
  $('#form-pago').addEventListener('submit', ev => {
    ev.preventDefault();
    const m = Math.min(round(+ev.target.monto.value), deuda);
    if (!(m > 0)) return;
    db.gastos.push({ id: uid(), tipo: 'liquidacion', pagador: deudor, monto: m, fecha: today(), creado: Date.now() });
    closeSheets(); save(); toast('Pago registrado ✓');
  });
});

/* ---------- ajustes ---------- */
$('#form-config').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  db.config = { a: f.a.value.trim(), b: f.b.value.trim(), pct: Math.min(100, Math.max(0, +f.pct.value)), moneda: f.moneda.value.trim() };
  save(); f.querySelector('button').blur(); toast('Guardado ✓');
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
    if (!Array.isArray(d.gastos)) throw 0;
    if (confirm('Esto reemplazará los datos actuales. ¿Continuar?')) { db = { ...defaults(), ...d, config: { ...defaults().config, ...d.config } }; save(); }
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

render();
if (remoteOn) initRemote(); else setSync('Modo local (sin nube)');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* sin PWA, sigue funcionando */ }));
}
