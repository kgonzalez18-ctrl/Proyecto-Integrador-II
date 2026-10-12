/* =========================================================
   DOCENTE EN MARCHA
   CAPA DE DATOS Y UTILIDADES DEL ROL DOCENTE ASESOR

   - Todas las pantallas del docente leen y escriben aquí.
   - Los datos se guardan en localStorage (clave "dem_datos_v3")
     para que lo que se registre en una pantalla se vea en las demás.
   - Las estructuras usan los mismos nombres que ya existen en el
     rol estudiante (práctica, grupo, horas, evidencias revisadas,
     retroalimentaciones consultadas, evaluaciones disponibles...)
     para que ambos roles puedan leer la misma información.
========================================================= */

const DEM = (function () {

    const CLAVE = "dem_datos_v3";
    const NOTA_MINIMA = 3.0;
    const MESES = ["ene", "feb", "mar", "abr", "may", "jun",
                   "jul", "ago", "sep", "oct", "nov", "dic"];


    /* ==========================================
       UTILIDADES GENERALES
    ========================================== */

    const $ = (selector, raiz) => (raiz || document).querySelector(selector);
    const $$ = (selector, raiz) => Array.from((raiz || document).querySelectorAll(selector));

    function esc(texto) {
        return String(texto === undefined || texto === null ? "" : texto)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;")
            .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function uid(prefijo) {
        return prefijo + "_" + Date.now().toString(36) +
               Math.random().toString(36).slice(2, 6);
    }

    function aISO(fecha) {
        const a = fecha.getFullYear();
        const m = String(fecha.getMonth() + 1).padStart(2, "0");
        const d = String(fecha.getDate()).padStart(2, "0");
        return a + "-" + m + "-" + d;
    }

    function hoy() { return aISO(new Date()); }

    function sumarDias(n) {
        const f = new Date();
        f.setDate(f.getDate() + n);
        return aISO(f);
    }

    function diasEntre(a, b) {
        const x = new Date(a + "T00:00:00");
        const y = new Date(b + "T00:00:00");
        return Math.round((y - x) / 86400000);
    }

    function fmtFecha(iso) {
        if (!iso) return "—";
        const p = iso.split("-");
        return parseInt(p[2], 10) + " " + MESES[parseInt(p[1], 10) - 1] + " " + p[0];
    }

    function fmtHora(h) {
        if (!h) return "";
        const p = h.split(":");
        let hh = parseInt(p[0], 10);
        const suf = hh >= 12 ? "p. m." : "a. m.";
        hh = hh % 12 === 0 ? 12 : hh % 12;
        return hh + ":" + p[1] + " " + suf;
    }

    function iniciales(nombre) {
        const partes = String(nombre).trim().split(/\s+/);
        return ((partes[0] || "")[0] + (partes[1] || "")[0]).toUpperCase();
    }

    function slug(texto) {
        return String(texto).toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    }

    function r1(x) { return Math.round((x + 1e-9) * 10) / 10; }

    function fmtNota(n) {
        return (n === null || n === undefined || isNaN(n)) ? "—" : Number(n).toFixed(1);
    }

    function pillNota(n) {
        if (n === null || n === undefined || isNaN(n)) {
            return '<span class="grade-pill empty">—</span>';
        }
        return '<span class="grade-pill ' + (n < NOTA_MINIMA ? "fail" : "") + '">' +
               Number(n).toFixed(1) + "</span>";
    }

    function opciones(lista, seleccionado, vacio) {
        let h = vacio ? '<option value="">' + esc(vacio) + "</option>" : "";
        lista.forEach(o => {
            h += '<option value="' + esc(o.valor) + '"' +
                 (String(o.valor) === String(seleccionado) ? " selected" : "") +
                 ">" + esc(o.texto) + "</option>";
        });
        return h;
    }

    function valoracionDe(nota) {
        if (nota >= 4.5) return "Excelente";
        if (nota >= 4.0) return "Bueno";
        if (nota >= NOTA_MINIMA) return "Aceptable";
        return "Por mejorar";
    }


    /* ==========================================
       CÁLCULO DE NOTAS (RÚBRICAS Y CUESTIONARIOS)
       Escala de 0.0 a 5.0
    ========================================== */

    // Promedio de los puntajes asignados a cada respuesta.
    function notaCuestionario(respuestas) {
        if (!respuestas.length) return null;
        let total = 0;
        for (const r of respuestas) {
            if (r.puntaje === null || r.puntaje === "" || r.puntaje === undefined || isNaN(r.puntaje)) {
                return null;
            }
            total += Number(r.puntaje);
        }
        return r1(total / respuestas.length);
    }

    // Suma ponderada: (peso del criterio / 100) x puntaje del nivel elegido.
    function notaRubrica(rubrica, seleccion) {
        let total = 0;
        for (const c of rubrica.criterios) {
            const nivel = rubrica.niveles.find(n => n.id === seleccion[c.id]);
            if (!nivel) return null;
            total += (c.peso / 100) * nivel.puntaje;
        }
        return r1(total);
    }

    // Nota final = cuestionario y rúbrica según las ponderaciones configuradas.
    function notaFinal(nC, nR, conRubrica, pesoCuest, pesoRub) {
        if (nC === null) return null;
        if (!conRubrica) return nC;
        if (nR === null) return null;
        return r1((pesoCuest * nC + pesoRub * nR) / 100);
    }

    function pesoTotalRubrica(rubrica) {
        return rubrica.criterios.reduce((s, c) => s + Number(c.peso || 0), 0);
    }


    /* ==========================================
       ESTRUCTURA DE DATOS (INICIA VACÍA)

       Almacén único compartido por los 4 roles
       (clave "dem_datos_v3"). No hay datos precargados:

       docentes       -> { id, nombre, cedula, correo, telefono, facultad, programa, estado }
                         (los registra el Coordinador de práctica)
       practicas      -> { id, nombre, programa, semestre, horas, inicio, fin, descripcion,
                           institucionIds: [] }                     (Coordinador)
       instituciones  -> { id, nombre, ciudad, ..., convenio: {...} }  (Coordinador)
       grupos         -> { id, nombre, practicaId, institucionId, docenteId, jornada,
                           horario, cupo, + institucion, ciudad, inicio, fin }  (Coordinador)
       estudiantes    -> { id, nombre, cedula, programa, correo, semestre, estado,
                           grupoId (solo al aprobar el Director), horasReal,
                           actividades: [], evidencias: [] }        (Coordinador)
       asignaciones   -> { id, estudianteId, grupoId, estado }     (Coordinador -> Director)

       Lo que crea el propio docente (queda marcado con su docenteId
       o ligado a sus estudiantes):
       rubricas, cuestionarios, visitas, evaluaciones, retros
    ========================================== */

    function semilla() {
        return {
            docentes: [], practicas: [], instituciones: [], grupos: [], estudiantes: [],
            asignaciones: [], rubricas: [], cuestionarios: [], visitas: [], evaluaciones: [],
            retros: [], coordinador: null, director: null,
            config: { metaHoras: 80, metaNota: 3.5, metaAprobacion: 90, metaConvenios: 100, metaVisitas: 2 }
        };
    }


    /* ==========================================
       ALMACENAMIENTO
    ========================================== */

    function textoRetroVisita(v) {
        return "Fortalezas: " + v.fortalezas +
               "\n\nAspectos por mejorar: " + v.aspectosMejorar +
               "\n\nCompromisos: " + v.compromisos;
    }

    let datos = cargar();

    function cargar() {
        try {
            const crudo = localStorage.getItem(CLAVE);
            if (crudo) return Object.assign(semilla(), JSON.parse(crudo));
        } catch (e) { /* sin almacenamiento */ }
        const nuevo = semilla();
        guardar(nuevo);
        return nuevo;
    }

    function guardar(d) {
        try { localStorage.setItem(CLAVE, JSON.stringify(d || datos)); } catch (e) { /* ignorar */ }
    }

    function reiniciar() {
        try { localStorage.removeItem(CLAVE); } catch (e) { /* ignorar */ }
        window.location.reload();
    }



    /* ==========================================
       SESIÓN Y VISTA DEL DOCENTE
       Cada docente ve solo los estudiantes de los grupos que el
       coordinador le asignó (y el director aprobó) y lo que él creó.
    ========================================== */

    function leerSesion() {
        try { return JSON.parse(localStorage.getItem("dem_sesion")) || null; } catch (e) { return null; }
    }

    function docenteActual() {
        const ses = leerSesion();
        const lista = datos.docentes || [];
        if (ses && ses.cedula) {
            const d = lista.find(x => String(x.cedula) === String(ses.cedula));
            if (d) return d;
            if (ses.cedula === "admin123") return lista[0] || null;
        }
        return null;
    }

    const idDocente = () => { const d = docenteActual(); return d ? d.id : "sin_docente"; };
    const misGrupos = () => { const d = docenteActual(); return d ? datos.grupos.filter(g => g.docenteId === d.id) : []; };
    const misEstudiantes = () => {
        const ids = new Set(misGrupos().map(g => g.id));
        return datos.estudiantes.filter(e => e.grupoId && ids.has(e.grupoId));
    };
    const misIds = () => new Set(misEstudiantes().map(e => e.id));

    function coleccionDeEstudiantes(nombre) {
        return {
            get() { const s = misIds(); return datos[nombre].filter(x => s.has(x.estudianteId)); },
            set(nuevo) { const s = misIds(); datos[nombre] = datos[nombre].filter(x => !s.has(x.estudianteId)).concat(nuevo); }
        };
    }
    function coleccionPropia(nombre) {
        return {
            get() { const id = idDocente(); return datos[nombre].filter(x => x.docenteId === id); },
            set(nuevo) { const id = idDocente(); datos[nombre] = datos[nombre].filter(x => x.docenteId !== id).concat(nuevo); }
        };
    }

    const vista = {};
    Object.defineProperty(vista, "docente", { get: docenteActual, enumerable: true });
    Object.defineProperty(vista, "grupos", { get: misGrupos, enumerable: true });
    Object.defineProperty(vista, "estudiantes", { get: misEstudiantes, enumerable: true });
    Object.defineProperty(vista, "practicas", {
        get() { const ids = new Set(misGrupos().map(g => g.practicaId)); return datos.practicas.filter(p => ids.has(p.id)); },
        enumerable: true
    });
    ["visitas", "evaluaciones", "retros"].forEach(n => Object.defineProperty(vista, n, Object.assign(coleccionDeEstudiantes(n), { enumerable: true })));
    ["rubricas", "cuestionarios"].forEach(n => Object.defineProperty(vista, n, Object.assign(coleccionPropia(n), { enumerable: true })));

    // Agrega un registro nuevo al almacén completo (marcando al dueño si aplica)
    function agregar(coleccion, registro) {
        if (coleccion === "rubricas" || coleccion === "cuestionarios") registro.docenteId = idDocente();
        datos[coleccion].push(registro);
        return registro;
    }


    /* ==========================================
       CONSULTAS
    ========================================== */

    const porId = (lista, id) => lista.find(x => x.id === id);

    const estudiante = id => porId(datos.estudiantes, id);
    const grupo = id => porId(datos.grupos, id);
    const practica = id => porId(datos.practicas, id);
    const rubrica = id => porId(datos.rubricas, id);
    const cuestionario = id => porId(datos.cuestionarios, id);

    function grupoDe(est) { return grupo(est.grupoId); }
    function practicaDe(est) { return practica(grupoDe(est).practicaId); }

    function horasReglamentarias(est) { return practicaDe(est).horas; }
    function horasPendientes(est) { return Math.max(0, horasReglamentarias(est) - est.horasReal); }
    function progreso(est) {
        return Math.min(100, Math.round(est.horasReal / horasReglamentarias(est) * 100));
    }

    // Avance esperado según el tiempo transcurrido de la práctica
    function progresoEsperado(est) {
        const g = grupoDe(est);
        const total = diasEntre(g.inicio, g.fin);
        const paso = diasEntre(g.inicio, hoy());
        return Math.max(0, Math.min(100, Math.round(paso / total * 100)));
    }

    function estadoAvance(est) {
        const p = progreso(est);
        if (p >= 100) return "Completada";
        if (p < progresoEsperado(est) - 15) return "Rezagado";
        return "Al día";
    }

    function visitasDe(estId) {
        return datos.visitas.filter(v => v.estudianteId === estId)
            .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora));
    }

    function evaluacionesDe(estId) {
        return datos.evaluaciones.filter(e => e.estudianteId === estId);
    }

    function retrosDe(estId) {
        return datos.retros.filter(r => r.estudianteId === estId)
            .sort((a, b) => b.fecha.localeCompare(a.fecha));
    }

    function promedioEstudiante(estId) {
        const notas = evaluacionesDe(estId).filter(e => e.estado === "Calificada").map(e => e.nota);
        if (!notas.length) return null;
        return r1(notas.reduce((a, b) => a + b, 0) / notas.length);
    }

    function proximasVisitas(dias) {
        const limite = sumarDias(dias);
        return vista.visitas
            .filter(v => v.estado === "Programada" && v.fecha >= hoy() && v.fecha <= limite)
            .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
    }

    function evidenciasSinRevisar() {
        const lista = [];
        vista.estudiantes.forEach(e => e.evidencias.forEach(ev => {
            if (!ev.revisada) lista.push({ est: e, ev: ev });
        }));
        return lista;
    }


    /* ==========================================
       ESCRITURA COMPARTIDA
    ========================================== */

    // Crea o actualiza la retroalimentación asociada a una visita o evaluación.
    function upsertRetro(datosRetro) {
        let r = datos.retros.find(x => x.tipo === datosRetro.tipo && x.origenId === datosRetro.origenId);
        if (r) {
            Object.assign(r, datosRetro);
            r.fecha = hoy();
            r.consultada = false;
        } else {
            datos.retros.push(Object.assign({
                id: uid("rt"), fecha: hoy(), consultada: false
            }, datosRetro));
        }
    }

    function quitarRetro(tipo, origenId) {
        datos.retros = datos.retros.filter(x => !(x.tipo === tipo && x.origenId === origenId));
    }


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
        setTimeout(() => t.remove(), 3200);
    }

    function mostrarError(contenedor, mensaje) {
        const e = $(".form-error", contenedor);
        e.textContent = mensaje;
        e.classList.add("show");
        e.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }


    /* ==========================================
       MATRIZ DE RÚBRICA (se usa al evaluar y en Rúbricas)
    ========================================== */

    function htmlMatriz(rub, sel, editable) {
        let h = '<div class="rubric-wrap"><table class="rubric-table"><thead><tr><th>Criterio</th>';
        rub.niveles.forEach(n => {
            h += "<th>" + esc(n.nombre) + "<small>" + Number(n.puntaje).toFixed(1) + " pts</small></th>";
        });
        h += "</tr></thead><tbody>";
        rub.criterios.forEach(c => {
            h += '<tr><td class="criterion"><strong>' + esc(c.nombre) + "</strong><span>Peso " + c.peso + "%</span></td>";
            rub.niveles.forEach(n => {
                const elegido = sel[c.id] === n.id;
                const txt = c.descriptores[n.id];
                const contenido = txt ? esc(txt) : "<em>Sin descriptor</em>";
                if (editable) {
                    h += '<td><button type="button" class="rubric-cell selectable' + (elegido ? " selected" : "") +
                         '" data-crit="' + c.id + '" data-niv="' + n.id + '">' + contenido + "</button></td>";
                } else {
                    h += '<td><div class="rubric-cell' + (elegido ? " selected" : "") + '">' + contenido + "</div></td>";
                }
            });
            h += "</tr>";
        });
        return h + "</tbody></table></div>";
    }

    // Dibuja la matriz dentro de un contenedor y avisa cada vez que se elige un nivel.
    function montarMatriz(contenedor, rub, sel, alCambiar) {
        function dibujar() {
            contenedor.innerHTML = htmlMatriz(rub, sel, true);
            $$(".rubric-cell.selectable", contenedor).forEach(b => {
                b.onclick = () => {
                    sel[b.dataset.crit] = b.dataset.niv;
                    dibujar();
                    if (alCambiar) alCambiar();
                };
            });
        }
        dibujar();
    }


    /* ==========================================
       ENCABEZADO: NOTIFICACIONES, USUARIO, SESIÓN
    ========================================== */

    function iniciarPagina() {

        // Datos del docente en la barra lateral y el encabezado
        let nombreMostrar = "Docente";
        const yoDoc = docenteActual();
        if (yoDoc && yoDoc.nombre) {
            const partes = yoDoc.nombre.trim().split(/\s+/);
            nombreMostrar = partes.length >= 3 ? partes[0] + " " + partes[2] : partes.join(" ");
        }
        $$("[data-docente-iniciales]").forEach(e => { e.textContent = yoDoc ? iniciales(nombreMostrar) : "DO"; });
        $$("[data-docente-nombre]").forEach(e => { e.textContent = nombreMostrar; });

        // Notificaciones
        const items = [];
        const porCalificar = vista.evaluaciones.filter(e => e.estado === "Por calificar").length;
        if (porCalificar) {
            items.push({ href: "evaluaciones.html", titulo: porCalificar + (porCalificar === 1 ? " evaluación por calificar" : " evaluaciones por calificar"),
                         texto: "Hay respuestas esperando tu revisión y retroalimentación." });
        }
        const visitasProx = proximasVisitas(7).length;
        if (visitasProx) {
            items.push({ href: "visitas.html", titulo: visitasProx + (visitasProx === 1 ? " visita en los próximos 7 días" : " visitas en los próximos 7 días"),
                         texto: "Revisa la agenda de visitas programadas." });
        }
        const sinRevisar = evidenciasSinRevisar().length;
        if (sinRevisar) {
            items.push({ href: "estudiantes.html", titulo: sinRevisar + (sinRevisar === 1 ? " evidencia sin revisar" : " evidencias sin revisar"),
                         texto: "Los estudiantes entregaron evidencias pendientes de revisión." });
        }
        const rezagados = vista.estudiantes.filter(e => estadoAvance(e) === "Rezagado").length;
        if (rezagados) {
            items.push({ href: "estudiantes.html?avance=Rezagado", titulo: rezagados + (rezagados === 1 ? " estudiante rezagado" : " estudiantes rezagados"),
                         texto: "Su avance de horas está por debajo de lo esperado." });
        }

        const campana = $(".notification");
        if (campana) {
            campana.innerHTML = "♢" +
                (items.length ? '<span class="notif-badge">' + items.length + "</span>" : "") +
                '<div class="notif-panel"><div class="notif-head">Pendientes</div>' +
                (items.length
                    ? items.map(i => '<a class="notif-item" href="' + i.href + '"><strong>' + esc(i.titulo) +
                                     "</strong><span>" + esc(i.texto) + "</span></a>").join("")
                    : '<div class="notif-empty">No tienes pendientes por ahora.</div>') +
                "</div>";
            campana.onclick = function (e) {
                if (e.target.closest(".notif-item")) return;
                $(".notif-panel", campana).classList.toggle("open");
            };
            document.addEventListener("click", function (e) {
                if (!campana.contains(e.target)) $(".notif-panel", campana).classList.remove("open");
            });
        }

        // Cerrar ventanas con la tecla Escape
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") cerrarModal();
        });
    }

    function cerrarSesion() {
        const confirmar = confirm("¿Estás seguro de cerrar sesión?");
        if (confirmar) {
            window.location.replace("../inicio/index.html");
        }
    }

    function nombreDocente() {
        const d = docenteActual(); return d && d.nombre ? d.nombre : "—";
    }

    function periodo() {
        const f = new Date();
        return f.getFullYear() + "-" + (f.getMonth() < 6 ? "1" : "2");
    }

    function parametros() { return new URLSearchParams(window.location.search); }


    /* ==========================================
       API PÚBLICA
    ========================================== */

    return {
        // datos
        get datos() { return vista; },
        guardar, reiniciar, agregar, NOTA_MINIMA,
        // utilidades
        $, $$, esc, uid, hoy, sumarDias, diasEntre, fmtFecha, fmtHora, iniciales, r1, fmtNota, pillNota,
        opciones, valoracionDe, parametros, periodo, textoRetroVisita,
        // cálculos
        notaCuestionario, notaRubrica, notaFinal, pesoTotalRubrica,
        // consultas
        estudiante, grupo, practica, rubrica, cuestionario, grupoDe, practicaDe,
        horasReglamentarias, horasPendientes, progreso, progresoEsperado, estadoAvance,
        visitasDe, evaluacionesDe, retrosDe, promedioEstudiante, proximasVisitas, evidenciasSinRevisar,
        // escritura
        upsertRetro, quitarRetro,
        // interfaz
        abrirModal, cerrarModal, aviso, mostrarError, htmlMatriz, montarMatriz,
        iniciarPagina, cerrarSesion, nombreDocente
    };

})();
