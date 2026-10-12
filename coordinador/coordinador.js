/* =========================================================
   DOCENTE EN MARCHA
   CAPA DE DATOS Y UTILIDADES (COORDINADOR Y DIRECTOR)

   - Usa el MISMO almacén que el rol docente y el rol estudiante
     (localStorage, clave "dem_datos_v3"), por eso todo cuadra:
     lo que el coordinador crea lo ve el director y el docente.
   - No hay datos precargados: todo se crea desde las pantallas.

   Flujo general de la plataforma:
     Coordinador: registra instituciones, prácticas, docentes,
                  estudiantes y grupos, y prepara las asignaciones.
     Director:    aprueba o rechaza las asignaciones, supervisa y
                  genera reportes e indicadores.
     Docente:     cuando una asignación se aprueba, el estudiante
                  aparece en su panel para visitas y evaluaciones.
========================================================= */

const DEM = (function () {

    const CLAVE = "dem_datos_v3";
    const CLAVE_SESION = "dem_sesion";
    const NOTA_MINIMA = 3.0;
    const MESES = ["ene", "feb", "mar", "abr", "may", "jun",
                   "jul", "ago", "sep", "oct", "nov", "dic"];


    /* ==========================================
       UTILIDADES GENERALES
    ========================================== */

    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

    function esc(t) {
        return String(t === undefined || t === null ? "" : t)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    const uid = p => p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    function aISO(f) {
        return f.getFullYear() + "-" + String(f.getMonth() + 1).padStart(2, "0") + "-" + String(f.getDate()).padStart(2, "0");
    }
    const hoy = () => aISO(new Date());
    function sumarDias(n) { const f = new Date(); f.setDate(f.getDate() + n); return aISO(f); }
    function diasEntre(a, b) { return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000); }

    function fmtFecha(iso) {
        if (!iso) return "—";
        const p = iso.split("-");
        return parseInt(p[2], 10) + " " + MESES[parseInt(p[1], 10) - 1] + " " + p[0];
    }

    function iniciales(nombre) {
        const p = String(nombre || "").trim().split(/\s+/);
        return ((p[0] || "")[0] + ((p[1] || "")[0] || "")).toUpperCase();
    }

    const r1 = x => Math.round((x + 1e-9) * 10) / 10;
    const fmtNota = n => (n === null || n === undefined || isNaN(n)) ? "—" : Number(n).toFixed(1);
    const pct = (a, b) => b > 0 ? Math.min(100, Math.round(a / b * 100)) : 0;

    function pillNota(n) {
        if (n === null || n === undefined || isNaN(n)) return '<span class="grade-pill empty">—</span>';
        return '<span class="grade-pill ' + (n < NOTA_MINIMA ? "fail" : "") + '">' + Number(n).toFixed(1) + "</span>";
    }

    function opciones(lista, sel, vacio) {
        let h = vacio ? '<option value="">' + esc(vacio) + "</option>" : "";
        lista.forEach(o => {
            h += '<option value="' + esc(o.valor) + '"' + (String(o.valor) === String(sel) ? " selected" : "") + ">" + esc(o.texto) + "</option>";
        });
        return h;
    }

    function valoracionDe(nota) {
        if (nota >= 4.5) return "Excelente";
        if (nota >= 4.0) return "Bueno";
        if (nota >= NOTA_MINIMA) return "Aceptable";
        return "Por mejorar";
    }
    const CLASE_VALORACION = { "Excelente": "badge-green", "Bueno": "badge-teal", "Aceptable": "badge-amber", "Por mejorar": "badge-red" };

    const badge = (texto, clase) => '<span class="badge ' + (clase || "") + '">' + esc(texto) + "</span>";
    const parametros = () => new URLSearchParams(window.location.search);
    function periodo() { const f = new Date(); return f.getFullYear() + "-" + (f.getMonth() < 6 ? "1" : "2"); }
    const promedio = lista => lista.length ? r1(lista.reduce((a, b) => a + b, 0) / lista.length) : null;


    /* ==========================================
       ALMACENAMIENTO
    ========================================== */

    function vacio() {
        return {
            docentes: [], practicas: [], instituciones: [], grupos: [], estudiantes: [],
            asignaciones: [], rubricas: [], cuestionarios: [], visitas: [], evaluaciones: [],
            retros: [], coordinador: null, director: null,
            config: { metaHoras: 80, metaNota: 3.5, metaAprobacion: 90, metaConvenios: 100, metaVisitas: 2 }
        };
    }

    let datos = cargar();

    function cargar() {
        try {
            const crudo = localStorage.getItem(CLAVE);
            if (crudo) {
                const d = Object.assign(vacio(), JSON.parse(crudo));
                d.config = Object.assign(vacio().config, d.config || {});
                return d;
            }
        } catch (e) { /* sin almacenamiento */ }
        return vacio();
    }

    // Mantiene sincronizados los datos que el docente y el estudiante leen de cada grupo
    function sincronizar() {
        datos.grupos.forEach(g => {
            const i = porId(datos.instituciones, g.institucionId);
            const p = porId(datos.practicas, g.practicaId);
            g.institucion = i ? i.nombre : "";
            g.ciudad = i ? i.ciudad : "";
            g.inicio = p ? p.inicio : "";
            g.fin = p ? p.fin : "";
        });
    }

    function guardar() {
        sincronizar();
        try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch (e) { /* ignorar */ }
    }

    function reiniciar() {
        try { localStorage.removeItem(CLAVE); } catch (e) { /* ignorar */ }
        window.location.reload();
    }


    /* ==========================================
       CONSULTAS Y CÁLCULOS
    ========================================== */

    const porId = (lista, id) => lista.find(x => x.id === id);
    const docente = id => porId(datos.docentes, id);
    const practica = id => porId(datos.practicas, id);
    const institucion = id => porId(datos.instituciones, id);
    const grupo = id => porId(datos.grupos, id);
    const estudiante = id => porId(datos.estudiantes, id);
    const cuestionario = id => porId(datos.cuestionarios, id);

    function estadoPractica(p) {
        const h = hoy();
        if (h < p.inicio) return "Planeada";
        if (h > p.fin) return "Finalizada";
        return "En curso";
    }

    // Convenio: Sin convenio / En trámite / Vigente / Vencido
    function estadoConvenio(i) {
        const c = i.convenio || {};
        if (c.estado === "Firmado") return c.fechaFin && c.fechaFin < hoy() ? "Vencido" : "Vigente";
        if (c.estado === "En trámite") return "En trámite";
        return "Sin convenio";
    }
    const convenioVigente = i => estadoConvenio(i) === "Vigente";
    const CLASE_CONVENIO = { "Vigente": "badge-green", "En trámite": "badge-amber", "Vencido": "badge-red", "Sin convenio": "badge-red" };
    const CLASE_PRACTICA = { "Planeada": "badge-blue", "En curso": "badge-green", "Finalizada": "" };

    const gruposDePractica = id => datos.grupos.filter(g => g.practicaId === id);
    const estudiantesDeGrupo = id => datos.estudiantes.filter(e => e.grupoId === id);
    const estudiantesAsignados = () => datos.estudiantes.filter(e => e.grupoId && grupo(e.grupoId));
    const estudiantesDePractica = id => estudiantesAsignados().filter(e => grupo(e.grupoId).practicaId === id);

    const asignacionesDe = estId => datos.asignaciones.filter(a => a.estudianteId === estId);
    const ESTADOS_ACTIVOS = ["Borrador", "Pendiente de aprobación"];

    // Asignación vigente de un estudiante (la que aún se está tramitando)
    function asignacionEnTramite(estId) {
        return datos.asignaciones.find(a => a.estudianteId === estId && ESTADOS_ACTIVOS.includes(a.estado));
    }

    // Cupos usados de un grupo: aprobados + los que están en trámite
    function cupoUsado(grupoId) {
        const ids = new Set(estudiantesDeGrupo(grupoId).map(e => e.id));
        datos.asignaciones.forEach(a => {
            if (a.grupoId === grupoId && ESTADOS_ACTIVOS.includes(a.estado)) ids.add(a.estudianteId);
        });
        return ids.size;
    }

    function practicaDeEstudiante(e) { const g = e.grupoId && grupo(e.grupoId); return g ? practica(g.practicaId) : null; }
    function horasReg(e) { const p = practicaDeEstudiante(e); return p ? p.horas : 0; }
    function progreso(e) { return pct(e.horasReal || 0, horasReg(e)); }

    function progresoEsperado(e) {
        const g = e.grupoId && grupo(e.grupoId);
        if (!g || !g.inicio || !g.fin) return 0;
        const total = diasEntre(g.inicio, g.fin);
        return Math.max(0, Math.min(100, total > 0 ? Math.round(diasEntre(g.inicio, hoy()) / total * 100) : 0));
    }

    function estadoAvance(e) {
        if (!e.grupoId) return "Sin asignar";
        const p = progreso(e);
        if (p >= 100) return "Completada";
        if (p < progresoEsperado(e) - 15) return "Rezagado";
        return "Al día";
    }
    const CLASE_AVANCE = { "Al día": "badge-green", "Rezagado": "badge-red", "Completada": "badge-teal", "Sin asignar": "" };

    const evaluacionesDe = estId => datos.evaluaciones.filter(x => x.estudianteId === estId);
    const calificadasDe = estId => evaluacionesDe(estId).filter(x => x.estado === "Calificada");
    const promedioEstudiante = estId => promedio(calificadasDe(estId).map(x => x.nota));
    const visitasDe = estId => datos.visitas.filter(v => v.estudianteId === estId)
        .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
    const visitasRealizadasDe = estId => visitasDe(estId).filter(v => v.estado === "Realizada");
    const retrosDe = estId => datos.retros.filter(r => r.estudianteId === estId);

    // ---- estadísticas agrupadas (las usan seguimiento, indicadores y reportes) ----

    function estadisticas(estudiantes) {
        const ids = new Set(estudiantes.map(e => e.id));
        const cal = datos.evaluaciones.filter(x => x.estado === "Calificada" && ids.has(x.estudianteId));
        const vis = datos.visitas.filter(v => v.estado === "Realizada" && ids.has(v.estudianteId));
        const horasReal = estudiantes.reduce((s, e) => s + (e.horasReal || 0), 0);
        const horasTot = estudiantes.reduce((s, e) => s + horasReg(e), 0);
        const aprob = cal.filter(x => x.nota >= NOTA_MINIMA).length;
        return {
            estudiantes: estudiantes.length,
            horasReal, horasTot, cumplimiento: pct(horasReal, horasTot),
            evaluaciones: cal.length,
            porCalificar: datos.evaluaciones.filter(x => x.estado === "Por calificar" && ids.has(x.estudianteId)).length,
            promedio: promedio(cal.map(x => x.nota)),
            aprobacion: cal.length ? Math.round(aprob / cal.length * 100) : null,
            visitas: vis.length,
            visitasPorEstudiante: estudiantes.length ? r1(vis.length / estudiantes.length) : 0,
            rezagados: estudiantes.filter(e => estadoAvance(e) === "Rezagado").length
        };
    }

    const estadisticasPractica = id => estadisticas(estudiantesDePractica(id));
    const estadisticasGrupo = id => estadisticas(estudiantesDeGrupo(id));
    const estadisticasDocente = id => {
        const gs = datos.grupos.filter(g => g.docenteId === id);
        return estadisticas(estudiantesAsignados().filter(e => gs.some(g => g.id === e.grupoId)));
    };

    // ---- validación de una asignación (estudiante → grupo → docente → institución → práctica) ----

    function validarAsignacion(a) {
        const e = estudiante(a.estudianteId);
        const g = grupo(a.grupoId);
        const checks = [];
        const add = (ok, texto, obligatorio) => checks.push({ ok, texto, obligatorio: obligatorio !== false });

        add(!!e && e.estado === "Activo", "El estudiante está activo");
        add(!!g, "El grupo existe");
        if (!g) return checks;
        const p = practica(g.practicaId);
        const i = institucion(g.institucionId);
        const d = g.docenteId ? docente(g.docenteId) : null;

        add(!!d && d.estado === "Activo", d ? "El docente asesor está activo" : "El grupo tiene docente asesor responsable");
        add(!!i && convenioVigente(i), i ? "La institución tiene convenio vigente (" + estadoConvenio(i) + ")" : "El grupo tiene institución receptora");
        add(!!p && p.institucionIds.includes(g.institucionId), "La institución está asociada a la práctica");
        add(!!p && estadoPractica(p) !== "Finalizada", "La práctica no ha finalizado");

        const usados = cupoUsado(g.id);
        add(usados <= g.cupo, "El grupo tiene cupo disponible (" + Math.min(usados, g.cupo) + "/" + g.cupo + ")");

        if (e && p) {
            add(!p.programa || e.programa === p.programa, "El programa del estudiante coincide con el de la práctica", false);
            add(Number(e.semestre) === Number(p.semestre), "El semestre del estudiante coincide con el de la práctica", false);
        }
        return checks;
    }

    const asignacionValida = a => validarAsignacion(a).filter(c => c.obligatorio).every(c => c.ok);


    /* ==========================================
       VENTANAS (MODALES) Y AVISOS
    ========================================== */

    function cerrarModal() {
        const o = $("#modal-overlay");
        if (o) { o.classList.remove("open"); o.innerHTML = ""; }
        document.body.style.overflow = "";
    }

    function abrirModal(op) {
        let o = $("#modal-overlay");
        if (!o) {
            o = document.createElement("div");
            o.id = "modal-overlay";
            o.className = "modal-overlay";
            document.body.appendChild(o);
        }
        o.innerHTML =
            '<div class="modal ' + (op.tam || "") + '">' +
              '<div class="modal-header"><div>' +
                (op.tag ? '<p class="section-tag">' + esc(op.tag) + "</p>" : "") +
                (op.encabezado ? op.encabezado : "<h3>" + esc(op.titulo) + "</h3>") +
                (op.sub ? '<p class="modal-sub">' + esc(op.sub) + "</p>" : "") +
              '</div><button type="button" class="modal-close" title="Cerrar">×</button></div>' +
              '<div class="modal-body">' + (op.cuerpo || "") + "</div>" +
              (op.pie ? '<div class="modal-footer">' + op.pie + "</div>" : "") +
            "</div>";
        o.classList.add("open");
        o.scrollTop = 0;
        document.body.style.overflow = "hidden";
        $(".modal-close", o).onclick = cerrarModal;
        return $(".modal", o);
    }

    function aviso(mensaje, tipo) {
        const t = document.createElement("div");
        t.className = "toast" + (tipo === "error" ? " error" : "");
        t.textContent = mensaje;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3400);
    }

    function mostrarError(mensaje) {
        const e = $(".modal .form-error");
        if (!e) return aviso(mensaje, "error");
        e.textContent = mensaje;
        e.classList.add("show");
        e.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    /*
       Formulario genérico en ventana.
       campos: [{ k, label, tipo, req, full, opciones, vacio, hint, ph, min, max, step, valor, refresca }]
       tipos: text | email | number | date | select | textarea | checkbox | seccion | html
       "opciones" puede ser una función(valores) para listas que dependen de otros campos.
    */
    function formModal(op) {
        const campos = op.campos;
        const valores = Object.assign({}, op.valores || {});

        function opcionesDe(c, vals) { return typeof c.opciones === "function" ? c.opciones(vals) : (c.opciones || []); }

        function leer() {
            const v = {};
            campos.forEach(c => {
                if (c.tipo === "seccion" || c.tipo === "html") return;
                const el = $("#fc-" + c.k);
                if (!el) { v[c.k] = valores[c.k]; return; }
                if (c.tipo === "checkbox") v[c.k] = el.checked;
                else if (c.tipo === "number") v[c.k] = el.value === "" ? null : parseFloat(el.value);
                else if (c.tipo === "select") v[c.k] = el.value;
                else v[c.k] = el.value.trim();
            });
            return v;
        }

        function campoHTML(c) {
            if (c.tipo === "seccion") return '<div class="form-section-title">' + esc(c.label) + "</div>";
            if (c.tipo === "html") return '<div class="form-field full">' + c.html + "</div>";
            const val = valores[c.k] !== undefined && valores[c.k] !== null ? valores[c.k] : (c.valor !== undefined ? c.valor : "");
            const id = 'id="fc-' + c.k + '"';
            const obligatorio = c.req ? ' <span class="req">*</span>' : "";
            let ctrl;
            if (c.tipo === "select") {
                ctrl = '<select class="select-input" ' + id + (c.deshabilitado ? " disabled" : "") + ">" +
                       opciones(opcionesDe(c, valores), val, c.vacio) + "</select>";
            } else if (c.tipo === "textarea") {
                ctrl = '<textarea class="text-area" ' + id + (c.ph ? ' placeholder="' + esc(c.ph) + '"' : "") + ">" + esc(val) + "</textarea>";
            } else if (c.tipo === "checkbox") {
                return '<div class="form-field full"><label class="check-row"><input type="checkbox" ' + id + (val ? " checked" : "") + "><span>" + esc(c.label) + "</span></label></div>";
            } else {
                ctrl = '<input class="text-input" type="' + (c.tipo || "text") + '" ' + id + ' value="' + esc(val) + '"' +
                       (c.ph ? ' placeholder="' + esc(c.ph) + '"' : "") +
                       (c.min !== undefined ? ' min="' + c.min + '"' : "") + (c.max !== undefined ? ' max="' + c.max + '"' : "") +
                       (c.step !== undefined ? ' step="' + c.step + '"' : "") + (c.deshabilitado ? " disabled" : "") + ">";
            }
            return '<div class="form-field' + (c.full ? " full" : "") + '"><label for="fc-' + c.k + '">' + esc(c.label) + obligatorio + "</label>" +
                   ctrl + (c.hint ? '<p class="form-hint">' + esc(c.hint) + "</p>" : "") + "</div>";
        }

        const m = abrirModal({
            tam: op.tam === undefined ? "wide" : op.tam,
            tag: op.tag, titulo: op.titulo, sub: op.sub,
            cuerpo: (op.antes || "") + '<div class="form-grid">' + campos.map(campoHTML).join("") + '</div><div class="form-error"></div>',
            pie: (op.pieIzq ? '<span class="footer-left">' + op.pieIzq + "</span>" : "") +
                 '<button type="button" class="secondary-button" id="fm-cancelar">Cancelar</button>' +
                 '<button type="button" class="primary-button" id="fm-guardar">' + esc(op.guardarTxt || "Guardar") + "</button>"
        });

        // Listas dependientes: se recalculan al cambiar un campo marcado con "refresca"
        function refrescar() {
            const actual = leer();
            campos.filter(c => c.tipo === "select" && typeof c.opciones === "function").forEach(c => {
                const el = $("#fc-" + c.k);
                const lista = c.opciones(actual);
                const previo = el.value;
                el.innerHTML = opciones(lista, lista.some(o => String(o.valor) === previo) ? previo : "", c.vacio);
            });
            if (op.alCambiar) op.alCambiar(leer(), { $: $ });
        }
        campos.filter(c => c.refresca).forEach(c => { $("#fc-" + c.k).addEventListener("change", refrescar); });
        if (op.alCambiar) op.alCambiar(leer(), { $: $ });

        $("#fm-cancelar").onclick = cerrarModal;
        $("#fm-guardar").onclick = function () {
            const v = leer();
            for (const c of campos) {
                if (!c.req || c.tipo === "checkbox") continue;
                if (v[c.k] === "" || v[c.k] === null || v[c.k] === undefined || (c.tipo === "number" && isNaN(v[c.k]))) {
                    return mostrarError("Completa el campo «" + c.label + "».");
                }
            }
            const error = op.validar ? op.validar(v) : null;
            if (error) return mostrarError(error);
            op.guardar(v);
        };
        return m;
    }


    /* ==========================================
       TABLAS, BARRAS Y EXPORTACIÓN
    ========================================== */

    function tablaHTML(cabeceras, filas, vacioTexto) {
        const ths = cabeceras.map(h => "<th>" + h + "</th>").join("");
        const cuerpo = filas.length
            ? filas.map(f => "<tr>" + f.map((c, i) => '<td' + (cabeceras[i] === "" ? ' class="actions"' : "") + ">" + c + "</td>").join("") + "</tr>").join("")
            : '<tr><td colspan="' + cabeceras.length + '" class="table-empty">' + esc(vacioTexto || "Sin registros.") + "</td></tr>";
        return '<div class="table-card"><div class="table-scroll"><table class="data-table"><thead><tr>' + ths +
               "</tr></thead><tbody>" + cuerpo + "</tbody></table></div></div>";
    }

    const persona = (nombre, sub) =>
        '<div class="person-cell"><div class="mini-avatar">' + iniciales(nombre) + "</div><div><strong>" +
        esc(nombre) + "</strong><span>" + esc(sub || "") + "</span></div></div>";

    function barra(p, bajo) {
        return '<div class="progress"><div class="progress-bar ' + (bajo ? "low" : p >= 100 ? "done" : "") + '" style="width:' + Math.max(0, Math.min(100, p)) + '%"></div></div>';
    }

    // Gráfico de barras horizontales: items = [{ etq, valor, max, texto }]
    function barrasHTML(items, vacioTexto) {
        if (!items.length) return '<div class="list-empty">' + esc(vacioTexto || "Aún no hay información para graficar.") + "</div>";
        return items.map(i =>
            '<div class="bar-row"><div class="bar-label">' + esc(i.etq) + '</div><div class="bar-track"><div class="bar-fill ' + (i.clase || "") +
            '" style="width:' + (i.max > 0 ? Math.max(0, Math.min(100, i.valor / i.max * 100)) : 0) + '%"></div></div><div class="bar-value">' +
            esc(i.texto !== undefined ? i.texto : i.valor) + "</div></div>").join("");
    }

    function vacioCard(icono, titulo, texto) {
        return '<div class="empty-card"><div class="empty-icon">' + icono + "</div><h3>" + esc(titulo) + "</h3><p>" + esc(texto) + "</p></div>";
    }


    // Cadena de una asignación: Estudiante → Grupo → Docente → Institución → Práctica
    function cadenaHTML(a, textoEstudiante) {
        const e = estudiante(a.estudianteId), g = grupo(a.grupoId);
        const p = g && practica(g.practicaId), d = g && g.docenteId && docente(g.docenteId), i = g && institucion(g.institucionId);
        const pasos = [
            ["ESTUDIANTE", textoEstudiante || (e ? e.nombre : "—"), e ? e.programa + " · " + e.semestre + ".º semestre" : "", !e && !textoEstudiante],
            ["GRUPO", g ? g.nombre : "—", g ? g.jornada + " · cupo " + g.cupo : "", !g],
            ["DOCENTE ASESOR", d ? d.nombre : "Sin asignar", d ? d.estado : "", !d || d.estado !== "Activo"],
            ["INSTITUCIÓN", i ? i.nombre : "—", i ? "Convenio " + estadoConvenio(i).toLowerCase() : "", !i || !convenioVigente(i)],
            ["PRÁCTICA", p ? p.nombre : "—", p ? p.horas + " h · " + estadoPractica(p) : "", !p || estadoPractica(p) === "Finalizada"]
        ];
        return '<div class="chain">' + pasos.map(x => '<div class="chain-step' + (x[3] ? " bad" : "") + '"><span>' + x[0] + "</span><strong>" +
            esc(x[1]) + "</strong><small>" + esc(x[2]) + "</small></div>").join("") + "</div>";
    }

    function checksHTML(checks) {
        return '<ul class="check-list">' + checks.map(c => {
            const cls = c.ok ? "ok" : (c.obligatorio ? "fail" : "warn");
            return '<li><span class="check-mark ' + cls + '">' + (c.ok ? "✓" : (c.obligatorio ? "✕" : "!")) + "</span><span>" +
                   esc(c.texto) + (!c.ok && !c.obligatorio ? " (advertencia)" : "") + "</span></li>";
        }).join("") + "</ul>";
    }

    function descargarCSV(nombre, filas) {
        const csv = "\ufeff" + filas.map(f => f.map(c => {
            const t = String(c === null || c === undefined ? "" : c);
            return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
        }).join(";")).join("\r\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        a.download = nombre + ".csv";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }


    /* ==========================================
       ENCABEZADO: PERFIL, NOTIFICACIONES, SESIÓN
    ========================================== */

    // cfg: { perfil: "coordinador" | "director", iniciales: "CO", notificaciones: () => [{href, titulo, texto}] }
    function iniciarPagina(cfg) {
        const p = datos[cfg.perfil];
        let nombre = cfg.nombreRol;
        if (p && p.nombre) {
            const partes = p.nombre.trim().split(/\s+/);
            nombre = partes.length >= 3 ? partes[0] + " " + partes[2] : partes.join(" ");
        }
        $$("[data-user-iniciales]").forEach(e => { e.textContent = p && p.nombre ? iniciales(nombre) : cfg.iniciales; });
        $$("[data-user-nombre]").forEach(e => { e.textContent = nombre; });

        const items = cfg.notificaciones ? cfg.notificaciones() : [];
        const campana = $(".notification");
        if (campana) {
            campana.innerHTML = "♢" + (items.length ? '<span class="notif-badge">' + items.length + "</span>" : "") +
                '<div class="notif-panel"><div class="notif-head">Pendientes</div>' +
                (items.length
                    ? items.map(i => '<a class="notif-item" href="' + i.href + '"><strong>' + esc(i.titulo) + "</strong><span>" + esc(i.texto) + "</span></a>").join("")
                    : '<div class="notif-empty">No tienes pendientes por ahora.</div>') + "</div>";
            campana.onclick = e => { if (!e.target.closest(".notif-item")) $(".notif-panel", campana).classList.toggle("open"); };
            document.addEventListener("click", e => { if (!campana.contains(e.target)) $(".notif-panel", campana).classList.remove("open"); });
        }
        document.addEventListener("keydown", e => { if (e.key === "Escape") cerrarModal(); });
    }

    function cerrarSesion() {
        if (confirm("¿Estás seguro de cerrar sesión?")) {
            try { localStorage.removeItem(CLAVE_SESION); } catch (e) { /* ignorar */ }
            window.location.replace("../inicio/index.html");
        }
    }


    /* ==========================================
       API PÚBLICA
    ========================================== */

    return {
        get datos() { return datos; },
        guardar, reiniciar, NOTA_MINIMA,
        $, $$, esc, uid, hoy, sumarDias, diasEntre, fmtFecha, iniciales, r1, pct, fmtNota, pillNota, opciones,
        badge, parametros, periodo, promedio, valoracionDe, CLASE_VALORACION,
        docente, practica, institucion, grupo, estudiante, cuestionario,
        estadoPractica, estadoConvenio, convenioVigente, CLASE_CONVENIO, CLASE_PRACTICA,
        gruposDePractica, estudiantesDeGrupo, estudiantesAsignados, estudiantesDePractica,
        asignacionesDe, asignacionEnTramite, cupoUsado, ESTADOS_ACTIVOS,
        practicaDeEstudiante, horasReg, progreso, progresoEsperado, estadoAvance, CLASE_AVANCE,
        evaluacionesDe, calificadasDe, promedioEstudiante, visitasDe, visitasRealizadasDe, retrosDe,
        estadisticas, estadisticasPractica, estadisticasGrupo, estadisticasDocente,
        validarAsignacion, asignacionValida,
        abrirModal, cerrarModal, aviso, mostrarError, formModal,
        tablaHTML, persona, barra, barrasHTML, vacioCard, descargarCSV, cadenaHTML, checksHTML,
        iniciarPagina, cerrarSesion
    };

})();


/* =========================================================
   CONFIGURACIÓN DEL ROL: COORDINADOR DE PRÁCTICA
========================================================= */

const CFG = {
    perfil: "coordinador",
    iniciales: "CO",
    nombreRol: "Coordinador",
    notificaciones: function () {
        const D = DEM.datos;
        const items = [];
        const rech = D.asignaciones.filter(a => a.estado === "Rechazada").length;
        if (rech) items.push({ href: "asignaciones.html", titulo: rech + (rech === 1 ? " asignación rechazada" : " asignaciones rechazadas"), texto: "El director devolvió asignaciones que debes corregir." });
        const borr = D.asignaciones.filter(a => a.estado === "Borrador").length;
        if (borr) items.push({ href: "asignaciones.html", titulo: borr + (borr === 1 ? " asignación sin enviar" : " asignaciones sin enviar"), texto: "Están preparadas pero aún no van al director." });
        const sin = D.estudiantes.filter(e => e.estado === "Activo" && !e.grupoId && !D.asignaciones.some(a => a.estudianteId === e.id && a.estado !== "Reemplazada")).length;
        if (sin) items.push({ href: "estudiantes.html", titulo: sin + (sin === 1 ? " estudiante sin asignar" : " estudiantes sin asignar"), texto: "Aún no tienen grupo de práctica." });
        const sd = D.grupos.filter(g => !g.docenteId).length;
        if (sd) items.push({ href: "grupos.html", titulo: sd + (sd === 1 ? " grupo sin docente" : " grupos sin docente"), texto: "Asigna un docente asesor responsable." });
        const lim = DEM.sumarDias(30);
        const conv = D.instituciones.filter(i => { const e = DEM.estadoConvenio(i); return e === "Vencido" || (e === "Vigente" && i.convenio.fechaFin <= lim); }).length;
        if (conv) items.push({ href: "instituciones.html", titulo: conv + (conv === 1 ? " convenio vencido o por vencer" : " convenios vencidos o por vencer"), texto: "Renueva los convenios con las instituciones." });
        const rez = D.estudiantes.filter(e => DEM.estadoAvance(e) === "Rezagado").length;
        if (rez) items.push({ href: "seguimiento.html", titulo: rez + (rez === 1 ? " estudiante rezagado" : " estudiantes rezagados"), texto: "Su avance de horas está por debajo de lo esperado." });
        return items;
    }
};
