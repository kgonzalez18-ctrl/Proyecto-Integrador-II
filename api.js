/* Cliente para hablar con el servidor (que a su vez usa Oracle).
   Uso:  const filas = await API.get('/instituciones');
         await API.post('/grupos', { NOMBRE: 'Grupo A', CUPO: 20 });
         await API.put('/grupos/3', { CUPO: 25 });   await API.del('/grupos/3'); */
const API = (() => {
  const base = '/api';
  async function pedir(metodo, ruta, cuerpo) {
    const r = await fetch(base + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(datos.error || 'Error ' + r.status); e.status = r.status; throw e; }
    return datos;
  }
  return {
    get: ruta => pedir('GET', ruta),
    post: (ruta, c) => pedir('POST', ruta, c),
    put: (ruta, c) => pedir('PUT', ruta, c),
    del: ruta => pedir('DELETE', ruta)
  };
})();

/* ¿La cédula ya está registrada en Oracle? (excluirCorreo = correo original del registro que se edita) */
API.cedulaOcupada = function (cedula, excluirCorreo) {
  try {
    const x = new XMLHttpRequest();
    x.open('GET', '/api/cedula/' + encodeURIComponent(String(cedula).trim()) + '?excluir=' + encodeURIComponent(excluirCorreo || ''), false);
    x.send();
    return x.status === 200 && JSON.parse(x.responseText).ocupada === true;
  } catch (e) { return false; }   // sin servidor no se bloquea
};

/* Sincronización: cada vez que la app guarda en el navegador, copia los usuarios
   (docentes, estudiantes, coordinador, director) y las instituciones a Oracle. */
(function () {
  const CLAVE = 'dem_datos_v3';
  let temporizador = null, ultimo = '';
  function resumen(crudo) {
    let d;
    try { d = JSON.parse(crudo) || {}; } catch (e) { return null; }
    const per = x => ({ nombre: x.nombre, cedula: x.cedula, correo: x.correo, telefono: x.telefono,
      estado: x.estado, password: x.password, programa: x.programa, semestre: x.semestre, grupoId: x.grupoId });
    const o = {
      docentes: (d.docentes || []).map(per),
      estudiantes: (d.estudiantes || []).map(per),
      instituciones: (d.instituciones || []).map(i => ({ nombre: i.nombre, nit: i.nit, direccion: i.direccion,
        telefono: i.telefono, correo: i.correo, contacto: i.contacto, ciudad: i.ciudad, convenio: i.convenio }))
    };
    const porId = {}, docPorId = {}, estPorId = {};
    (d.instituciones || []).forEach(i => { porId[i.id] = i; });
    (d.docentes || []).forEach(x => { docPorId[x.id] = x; });
    (d.estudiantes || []).forEach(x => { estPorId[x.id] = x; });
    o.practicas = (d.practicas || []).map(p => ({ id: p.id, nombre: p.nombre, programa: p.programa, semestre: p.semestre,
      horas: p.horas, inicio: p.inicio, fin: p.fin, descripcion: p.descripcion,
      nits: (p.institucionIds || []).map(i => porId[i] && porId[i].nit).filter(Boolean),
      docentes: (p.docenteIds || []).map(i => docPorId[i] && docPorId[i].correo).filter(Boolean) }));
    o.grupos = (d.grupos || []).map(g => ({ id: g.id, nombre: g.nombre, practicaId: g.practicaId, nit: (porId[g.institucionId] || {}).nit,
      docente: (docPorId[g.docenteId] || {}).correo, jornada: g.jornada, horario: g.horario, cupo: g.cupo }));
    o.asignaciones = (d.asignaciones || []).map(a => ({ id: a.id, estudiante: (estPorId[a.estudianteId] || {}).correo, grupoId: a.grupoId,
      estado: a.estado, tipo: a.tipo, grupoAnteriorId: a.grupoAnteriorId, fechaCreacion: a.fechaCreacion, fechaEnvio: a.fechaEnvio,
      fechaDecision: a.fechaDecision, motivo: a.motivo, observaciones: a.observaciones }));
    if (d.coordinador) o.coordinador = per(d.coordinador);
    if (d.director) o.director = per(d.director);
    return JSON.stringify(o);
  }
  // Lo que había la última vez que se sincronizó: sirve para saber qué se eliminó en la app.
  function claves(o) {
    return { docentes: (o.docentes || []).map(x => ({ correo: x.correo, cedula: x.cedula })),
      estudiantes: (o.estudiantes || []).map(x => ({ correo: x.correo, cedula: x.cedula })),
      instituciones: (o.instituciones || []).map(i => i.nit).filter(Boolean),
      practicas: (o.practicas || []).map(p => p.id),
      grupos: (o.grupos || []).map(g => g.id), asignaciones: (o.asignaciones || []).map(a => a.id) };
  }
  function eliminados(prev, act) {
    const e = {};
    ['docentes', 'estudiantes'].forEach(g => {
      const cor = new Set(act[g].map(x => String(x.correo || '').toLowerCase())), ced = new Set(act[g].map(x => String(x.cedula || '')));
      e[g] = (prev[g] || []).filter(x => !cor.has(String(x.correo || '').toLowerCase()) && !ced.has(String(x.cedula || '')));
    });
    ['instituciones', 'practicas', 'grupos', 'asignaciones'].forEach(g => { const s = new Set(act[g]); e[g] = (prev[g] || []).filter(x => !s.has(x)); });
    return e;
  }
  function enviar(crudo) {
    const r = resumen(crudo);
    if (!r) return;
    const o = JSON.parse(r), act = claves(o);
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem('dem_sync_prev')); } catch (e) { }
    if (prev) {
      const e = eliminados(prev, act);
      if (Object.keys(e).some(k => e[k].length)) o.eliminar = e;
    }
    const cuerpo = JSON.stringify(o);
    if (cuerpo === ultimo) return;
    ultimo = cuerpo;
    fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo })
      .then(x => x.json())
      .then(j => {
        if (j.errores && j.errores.length) console.warn('Oracle no guardó:', j.errores);
        try { localStorage.setItem('dem_sync_prev', JSON.stringify(act)); } catch (e) { }
      })
      .catch(() => { ultimo = ''; });
  }
  const original = Storage.prototype.setItem;
  // Agrega a los datos de la app lo que hay en Oracle y la app no tiene (otro navegador, otro PC, datos borrados).
  // Lo que este navegador ya conocía y borró no se vuelve a agregar: la sincronización lo elimina de Oracle.
  function fusionar(d, e, prev) {
    let n = 0;
    const lc = v => String(v || '').toLowerCase();
    const programa = (d.coordinador && d.coordinador.programa) || ((d.estudiantes || [])[0] || {}).programa || '';
    ['docentes', 'estudiantes'].forEach(g => {
      d[g] = d[g] || [];
      const cor = new Set(d[g].map(x => lc(x.correo))), ced = new Set(d[g].map(x => String(x.cedula || '')));
      const antes = (prev && prev[g]) || [];
      (e[g] || []).forEach(o => {
        if (cor.has(lc(o.correo)) || ced.has(String(o.cedula))) return;
        if (antes.some(v => lc(v.correo) === lc(o.correo) || String(v.cedula || '') === String(o.cedula))) return;
        const r = { id: (g === 'docentes' ? 'dc_o' : 'es_o') + o.iddb, password: '', nombre: o.nombre, cedula: String(o.cedula),
          correo: o.correo, telefono: o.telefono || '', estado: o.estado };
        if (g === 'estudiantes') Object.assign(r, { programa: o.programa || programa, semestre: parseInt(o.semestre, 10) || 1,
          grupoId: o.grupoid || null, horasReal: 0, actividades: [], evidencias: [] });
        d[g].push(r); n++;
      });
    });
    const docCor = {}, estCor = {};
    d.docentes.forEach(x => { docCor[lc(x.correo)] = x.id; });
    d.estudiantes.forEach(x => { estCor[lc(x.correo)] = x.id; });
    d.instituciones = d.instituciones || [];
    const nits = new Set(d.instituciones.map(i => String(i.nit || '')));
    const antesI = (prev && prev.instituciones) || [];
    (e.instituciones || []).forEach(o => {
      if (nits.has(String(o.nit)) || antesI.includes(o.nit)) return;
      d.instituciones.push({ id: 'in_o' + o.iddb, password: o.nit, nombre: o.nombre, nit: o.nit, tipo: '', ciudad: o.ciudad || '',
        direccion: o.direccion || '', telefono: o.telefono || '', correo: o.correo || '', contacto: o.contacto || '',
        convenio: { estado: o.cestado || '', numero: '', fechaInicio: o.cinicio || '', fechaFin: o.cfin || '', observaciones: '' } });
      n++;
    });
    d.practicas = d.practicas || [];
    const ids = new Set(d.practicas.map(p => p.id)), antesP = (prev && prev.practicas) || [];
    const porNit = {};
    d.instituciones.forEach(i => { porNit[i.nit] = i.id; });
    (e.practicas || []).forEach(o => {
      if (ids.has(o.id) || antesP.includes(o.id)) return;
      d.practicas.push({ id: o.id, nombre: o.nombre, programa: o.programa || programa, semestre: parseInt(o.semestre, 10) || 1,
        horas: o.horas, inicio: o.inicio || '', fin: o.fin || '', descripcion: o.descripcion || '',
        docenteIds: (o.docentes || []).map(x => docCor[lc(x)]).filter(Boolean),
        institucionIds: (o.nits || []).map(x => porNit[x]).filter(Boolean) });
      n++;
    });
    d.grupos = d.grupos || [];
    const gids = new Set(d.grupos.map(g => g.id)), antesG = (prev && prev.grupos) || [];
    (e.grupos || []).forEach(o => {
      if (gids.has(o.id) || antesG.includes(o.id)) return;
      d.grupos.push({ id: o.id, nombre: o.nombre, practicaId: o.practicaid, institucionId: porNit[o.nit] || '', docenteId: docCor[lc(o.docente)] || null,
        jornada: o.jornada || 'Mañana', horario: o.horario || '', cupo: Number(o.cupo) || 20 });
      n++;
    });
    d.asignaciones = d.asignaciones || [];
    const aids = new Set(d.asignaciones.map(a => a.id)), antesA = (prev && prev.asignaciones) || [];
    (e.asignaciones || []).forEach(o => {
      if (aids.has(o.id) || antesA.includes(o.id) || !estCor[lc(o.estudiante)]) return;
      d.asignaciones.push({ id: o.id, estudianteId: estCor[lc(o.estudiante)], grupoId: o.grupoid, estado: o.estado, tipo: o.tipo || 'Nueva',
        grupoAnteriorId: o.grupoanteriorid || null, fechaCreacion: o.fechacreacion || '', fechaEnvio: o.fechaenvio || null,
        fechaDecision: o.fechadecision || null, motivo: o.motivo || '', observaciones: o.observaciones || '' });
      n++;
    });
    return n;
  }
  function leerPrev() { try { return JSON.parse(localStorage.getItem('dem_sync_prev')); } catch (e) { return null; } }
  function hidratar(prev) {
    fetch('/api/estado').then(r => r.json()).then(e => {
      const raw = localStorage.getItem(CLAVE);
      if (!raw || !e || e.error) return;
      const d = JSON.parse(raw);
      if (!fusionar(d, e, prev)) return;
      original.call(localStorage, CLAVE, JSON.stringify(d));
      const t = Number(sessionStorage.getItem('dem_hid') || 0);
      if (Date.now() - t > 8000) { sessionStorage.setItem('dem_hid', String(Date.now())); location.reload(); }
    }).catch(() => { });
  }
  API._fusionar = fusionar;


  Storage.prototype.setItem = function (k, v) {
    original.apply(this, arguments);
    if (k === CLAVE) { clearTimeout(temporizador); temporizador = setTimeout(() => enviar(v), 700); }
  };
  window.addEventListener('load', () => {
    const prev0 = leerPrev();   // lo que se conocía ANTES de sincronizar
    try { enviar(localStorage.getItem(CLAVE)); } catch (e) { }
    hidratar(prev0);
  });
})();

/* Atajos para escribir correos: botones "@" y dominios comunes debajo de cada campo de correo
   (por si el teclado del PC no tiene la arroba a la mano). */
(function () {
  const ATAJOS = ['@', '@gmail.com', '@hotmail.com', '@outlook.com'];
  function esCorreo(i) {
    return i.tagName === 'INPUT' && !i.dataset.atajos && i.type !== 'password' &&
      (i.type === 'email' || /correo|email/i.test((i.id || '') + ' ' + (i.name || '') + ' ' + (i.placeholder || '')));
  }
  function poner(i, texto) {
    const v = i.value, p = v.indexOf('@');
    i.value = texto === '@' ? (p >= 0 ? v : v + '@') : (p >= 0 ? v.slice(0, p) : v) + texto;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.focus();
  }
  function agregar(i) {
    i.dataset.atajos = '1';
    const caja = document.createElement('div');
    caja.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px';
    ATAJOS.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = t; b.tabIndex = -1;
      b.style.cssText = 'font:inherit;font-size:12px;padding:3px 10px;border:1px solid currentColor;border-radius:999px;background:transparent;color:inherit;opacity:.75;cursor:pointer';
      b.onclick = () => poner(i, t);
      caja.appendChild(b);
    });
    i.insertAdjacentElement('afterend', caja);
  }
  function revisar(raiz) { if (raiz.querySelectorAll) raiz.querySelectorAll('input').forEach(i => { if (esCorreo(i)) agregar(i); }); }
  window.addEventListener('DOMContentLoaded', () => {
    revisar(document);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.tagName === 'INPUT' && esCorreo(n)) agregar(n); else revisar(n);
    }))).observe(document.body, { childList: true, subtree: true });
  });
})();
