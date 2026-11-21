import com.sun.net.httpserver.*;
import java.io.*;
import java.math.BigDecimal;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.SecureRandom;
import java.sql.*;
import java.util.*;
import java.util.concurrent.Executors;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Servidor web + API para Docente en Marcha. Se conecta a Oracle con JDBC (ojdbc8). */
public class Servidor {
    static Properties cfg = new Properties();
    static String url;
    // nombre -> {tabla, llave primaria, columnas permitidas, columnas de fecha}
    static Map<String, String[]> R = new LinkedHashMap<>();
    static void r(String n, String t, String pk, String cols, String f) { R.put(n, new String[]{t, pk, cols, f}); }
    static {
        r("personas", "PERSONAS", "ID_PERSONA", "TIPO_DOCUMENTO,NUMERO_DOCUMENTO,NOMBRES,APELLIDOS,CORREO,TELEFONO,DIRECCION,ESTADO,PROGRAMA,SEMESTRE", "");
        r("instituciones", "INSTITUCIONES", "ID_INSTITUCION", "NOMBRE,NIT,DIRECCION,TELEFONO,CORREO,NOMBRE_CONTACTO,ESTADO,CIUDAD,CONVENIO_ESTADO,CONVENIO_INICIO,CONVENIO_FIN", "CONVENIO_INICIO,CONVENIO_FIN");
        r("periodos", "PERIODOS_ACADEMICOS", "ID_PERIODO", "NOMBRE,FECHA_INICIO,FECHA_FIN,ESTADO", "FECHA_INICIO,FECHA_FIN");
        r("catalogo", "CATALOGO_PRACTICAS", "ID_CATALOGO", "NOMBRE,PROGRAMA,SEMESTRE,HORAS_REQUERIDAS,FECHA_INICIO,FECHA_FIN,DESCRIPCION,ESTADO", "FECHA_INICIO,FECHA_FIN");
        r("grupos", "GRUPOS", "ID_GRUPO", "NOMBRE,ID_CATALOGO,ID_INSTITUCION,ID_DOCENTE,JORNADA,HORARIO,CUPO,FECHA_INICIO,FECHA_FIN", "FECHA_INICIO,FECHA_FIN");
        r("asignaciones", "ASIGNACIONES", "ID_ASIGNACION", "ID_ESTUDIANTE,ID_GRUPO,ESTADO,FECHA_ENVIO,FECHA_DECISION", "FECHA_ENVIO,FECHA_DECISION");
        r("practicas", "PRACTICAS", "ID_PRACTICA", "ID_ESTUDIANTE,ID_DOCENTE_ASESOR,ID_INSTITUCION,ID_PERIODO,ID_CATALOGO,ID_GRUPO,NOMBRE,DESCRIPCION,FECHA_INICIO,FECHA_FIN,HORAS_REQUERIDAS,ESTADO", "FECHA_INICIO,FECHA_FIN");
        r("horas", "REGISTRO_HORAS", "ID_REGISTRO", "ID_PRACTICA,FECHA,HORA_INICIO,HORA_FIN,HORAS_CUMPLIDAS,OBSERVACIONES,ESTADO", "FECHA");
        r("actividades", "ACTIVIDADES", "ID_ACTIVIDAD", "ID_PRACTICA,NOMBRE,DESCRIPCION,FECHA_PROGRAMADA,HORAS_ESTIMADAS,REQUIERE_EVIDENCIA,ESTADO", "FECHA_PROGRAMADA");
        r("evidencias", "EVIDENCIAS", "ID_EVIDENCIA", "ID_ACTIVIDAD,NOMBRE_ARCHIVO,RUTA_ARCHIVO,TIPO_ARCHIVO,FECHA_CARGA,OBSERVACIONES,ESTADO", "FECHA_CARGA");
        r("visitas", "VISITAS", "ID_VISITA", "ID_PRACTICA,ID_DOCENTE,FECHA_VISITA,OBJETIVO,OBSERVACIONES,COMPROMISOS,FORTALEZAS,ASPECTOS_MEJORAR,ESTADO", "FECHA_VISITA");
        r("evaluaciones", "EVALUACIONES", "ID_EVALUACION", "ID_PRACTICA,ID_DOCENTE,FECHA_EVALUACION,CALIFICACION,OBSERVACIONES,FORTALEZAS,ASPECTOS_MEJORAR,ESTADO", "FECHA_EVALUACION");
        r("retros", "RETROALIMENTACIONES", "ID_RETROALIMENTACION", "ID_PRACTICA,ID_DOCENTE,FECHA,COMENTARIO,RECOMENDACIONES,ESTADO", "FECHA");
        r("rubricas", "RUBRICAS", "ID_RUBRICA", "ID_DOCENTE,NOMBRE,CRITERIOS", "");
        r("cuestionarios", "CUESTIONARIOS", "ID_CUESTIONARIO", "ID_DOCENTE,NOMBRE,PREGUNTAS", "");
        r("desempenos", "DESEMPENOS", "ID_DESEMPENO", "ID_PRACTICA,FECHA,CALIFICACION,COMENTARIOS,ESTADO", "FECHA");
        r("confirmaciones", "CONFIRMACIONES", "ID_CONFIRMACION", "ID_PRACTICA,FECHA,DETALLE,ESTADO", "FECHA");
    }

    // ---------- JSON minimo ----------
    static class J {
        final String s; int i;
        J(String s) { this.s = s; }
        Object v() {
            ws(); char c = s.charAt(i);
            if (c == '{') {
                i++; Map<String, Object> m = new LinkedHashMap<>(); ws();
                if (s.charAt(i) == '}') { i++; return m; }
                while (true) { ws(); String k = str(); ws(); i++; m.put(k, v()); ws(); if (s.charAt(i++) == '}') return m; }
            }
            if (c == '[') {
                i++; List<Object> l = new ArrayList<>(); ws();
                if (s.charAt(i) == ']') { i++; return l; }
                while (true) { l.add(v()); ws(); if (s.charAt(i++) == ']') return l; }
            }
            if (c == '"') return str();
            int j = i;
            while (i < s.length() && ",}] \n\r\t".indexOf(s.charAt(i)) < 0) i++;
            String t = s.substring(j, i);
            if (t.equals("null")) return null;
            if (t.equals("true")) return Boolean.TRUE;
            if (t.equals("false")) return Boolean.FALSE;
            return new BigDecimal(t);
        }
        String str() {
            i++; StringBuilder b = new StringBuilder();
            while (s.charAt(i) != '"') {
                char c = s.charAt(i++);
                if (c == '\\') {
                    c = s.charAt(i++);
                    switch (c) {
                        case 'n': b.append('\n'); break;
                        case 't': b.append('\t'); break;
                        case 'r': b.append('\r'); break;
                        case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                        default: b.append(c);
                    }
                } else b.append(c);
            }
            i++; return b.toString();
        }
        void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }
    }

    static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default: if (c < 32) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    @SuppressWarnings("unchecked")
    static String toJson(Object o) {
        if (o == null) return "null";
        if (o instanceof Map) {
            StringBuilder b = new StringBuilder("{"); boolean p = false;
            for (Map.Entry<String, Object> e : ((Map<String, Object>) o).entrySet()) {
                if (p) b.append(','); p = true; b.append(q(e.getKey())).append(':').append(toJson(e.getValue()));
            }
            return b.append('}').toString();
        }
        if (o instanceof List) {
            StringBuilder b = new StringBuilder("["); boolean p = false;
            for (Object e : (List<Object>) o) { if (p) b.append(','); p = true; b.append(toJson(e)); }
            return b.append(']').toString();
        }
        if (o instanceof BigDecimal) return ((BigDecimal) o).toPlainString();
        if (o instanceof Number || o instanceof Boolean) return o.toString();
        return q(o.toString());
    }

    // ---------- Base de datos ----------
    static Connection db() throws SQLException {
        return DriverManager.getConnection(url, cfg.getProperty("usuario", "").trim(), cfg.getProperty("clave", "").trim());
    }

    static void args(PreparedStatement ps, Object... a) throws SQLException {
        for (int i = 0; i < a.length; i++) { if (a[i] == null) ps.setNull(i + 1, Types.VARCHAR); else ps.setObject(i + 1, a[i]); }
    }

    static List<Map<String, Object>> consulta(Connection c, String sql, Object... a) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            args(ps, a);
            try (ResultSet rs = ps.executeQuery()) {
                ResultSetMetaData md = rs.getMetaData();
                List<Map<String, Object>> out = new ArrayList<>();
                while (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    for (int i = 1; i <= md.getColumnCount(); i++) {
                        int t = md.getColumnType(i); Object v;
                        if (t == Types.CLOB) v = rs.getString(i);
                        else if (t == Types.DATE || t == Types.TIMESTAMP) {
                            Timestamp ts = rs.getTimestamp(i);
                            v = ts == null ? null : new java.text.SimpleDateFormat("yyyy-MM-dd").format(ts);
                        } else v = rs.getObject(i);
                        row.put(md.getColumnName(i), v);
                    }
                    out.add(row);
                }
                return out;
            }
        }
    }

    static void exec(Connection c, String sql, Object... a) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) { args(ps, a); ps.executeUpdate(); }
    }

    static long seq(Connection c, String s) throws SQLException {
        return ((Number) consulta(c, "SELECT " + s + ".NEXTVAL AS N FROM dual").get(0).get("N")).longValue();
    }

    static Set<String> set(String csv) { return new HashSet<>(Arrays.asList(csv.split(","))); }

    @SuppressWarnings("unchecked")
    static Map<String, Object> vals(String[] cf, Object body) {
        Map<String, Object> in = new HashMap<>(), out = new LinkedHashMap<>();
        if (body instanceof Map) for (Map.Entry<String, Object> e : ((Map<String, Object>) body).entrySet()) in.put(e.getKey().toUpperCase(), e.getValue());
        for (String k : cf[2].split(",")) if (in.containsKey(k)) out.put(k, in.get(k));
        return out;
    }

    static void bind(PreparedStatement ps, int i, Object v, boolean fecha) throws SQLException {
        if (v == null || "".equals(v)) ps.setNull(i, Types.VARCHAR);
        else if (fecha) ps.setDate(i, java.sql.Date.valueOf(v.toString().substring(0, 10)));
        else if (v instanceof BigDecimal) ps.setBigDecimal(i, (BigDecimal) v);
        else ps.setString(i, v.toString());
    }

    static void insertar(Connection c, String[] cf, long id, Map<String, Object> v) throws SQLException {
        StringBuilder cols = new StringBuilder(cf[1]), marks = new StringBuilder("?");
        for (String k : v.keySet()) { cols.append(',').append(k); marks.append(",?"); }
        try (PreparedStatement ps = c.prepareStatement("INSERT INTO " + cf[0] + " (" + cols + ") VALUES (" + marks + ")")) {
            ps.setLong(1, id); int i = 2; Set<String> f = set(cf[3]);
            for (Map.Entry<String, Object> e : v.entrySet()) bind(ps, i++, e.getValue(), f.contains(e.getKey()));
            ps.executeUpdate();
        }
    }

    // ---------- Claves ----------
    static byte[] pb(String p, byte[] s) throws Exception {
        return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1").generateSecret(new PBEKeySpec(p.toCharArray(), s, 10000, 256)).getEncoded();
    }
    static String hex(byte[] b) { StringBuilder s = new StringBuilder(); for (byte x : b) s.append(String.format("%02x", x)); return s.toString(); }
    static byte[] unhex(String h) { byte[] b = new byte[h.length() / 2]; for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16); return b; }
    static String hash(String p) throws Exception { byte[] s = new byte[8]; new SecureRandom().nextBytes(s); return "pbkdf2$" + hex(s) + "$" + hex(pb(p, s)); }
    static boolean check(String p, String h) throws Exception {
        if (!h.startsWith("pbkdf2$")) return p.equals(h);          // clave antigua sin cifrar
        String[] x = h.split("\\$"); return hex(pb(p, unhex(x[1]))).equals(x[2]);
    }
    static String str(Object o) { return o == null ? "" : o.toString(); }

    // ---------- HTTP ----------
    static byte[] leer(InputStream in) throws IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
        while ((n = in.read(b)) > 0) o.write(b, 0, n);
        return o.toByteArray();
    }
    static void enviar(HttpExchange x, int code, String tipo, byte[] data) throws IOException {
        x.getResponseHeaders().set("Content-Type", tipo);
        x.sendResponseHeaders(code, data.length == 0 ? -1 : data.length);
        if (data.length > 0) try (OutputStream o = x.getResponseBody()) { o.write(data); }
        x.close();
    }
    static void json(HttpExchange x, int code, Object o) throws IOException {
        enviar(x, code, "application/json; charset=utf-8", toJson(o).getBytes(StandardCharsets.UTF_8));
    }
    static Map<String, Object> mapa(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    static void handle(HttpExchange x) throws IOException {
        try {
            String path = x.getRequestURI().getPath();
            if (path.equals("/ver")) ver(x);
            else if (path.startsWith("/api/")) api(x, x.getRequestMethod(), path.substring(5).split("/"));
            else estatico(x, path);
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
            try { json(x, 500, mapa("error", String.valueOf(e.getMessage()))); } catch (Exception ignorar) { }
        }
    }

    static void estatico(HttpExchange x, String path) throws IOException {
        if (path.equals("/")) path = "/inicio/index.html";
        Path root = Paths.get(cfg.getProperty("web", "..")).toAbsolutePath().normalize();
        Path f = root.resolve("." + path).normalize();
        if (!f.startsWith(root) || f.startsWith(root.resolve("servidor")) || !Files.isRegularFile(f)) {
            enviar(x, 404, "text/plain; charset=utf-8", "No encontrado".getBytes(StandardCharsets.UTF_8)); return;
        }
        String n = f.getFileName().toString().toLowerCase(), t = "application/octet-stream";
        if (n.endsWith(".html")) t = "text/html; charset=utf-8"; else if (n.endsWith(".css")) t = "text/css; charset=utf-8";
        else if (n.endsWith(".js")) t = "application/javascript; charset=utf-8"; else if (n.endsWith(".png")) t = "image/png";
        else if (n.endsWith(".jpg") || n.endsWith(".jpeg")) t = "image/jpeg"; else if (n.endsWith(".svg")) t = "image/svg+xml";
        else if (n.endsWith(".json")) t = "application/json";
        enviar(x, 200, t, Files.readAllBytes(f));
    }

    @SuppressWarnings("unchecked")
    static void api(HttpExchange x, String m, String[] p) throws Exception {
        Map<String, Object> body = new HashMap<>();
        if (m.equals("POST") || m.equals("PUT")) {
            String txt = new String(leer(x.getRequestBody()), StandardCharsets.UTF_8).trim();
            if (!txt.isEmpty()) body = (Map<String, Object>) new J(txt).v();
        }
        String a = p[0];
        try (Connection c = db()) {
            if (a.equals("salud")) { consulta(c, "SELECT 1 AS X FROM dual"); json(x, 200, mapa("ok", true)); return; }
            if (a.equals("login") && m.equals("POST")) { login(x, c, body); return; }
            if (a.equals("usuarios") && m.equals("POST")) { usuario(x, c, body); return; }
            if (a.equals("sync") && m.equals("POST")) { sync(x, c, body); return; }
            if (a.equals("estado") && m.equals("GET")) { estado(x, c); return; }
            if (a.equals("cedula") && p.length == 2 && m.equals("GET")) {
                String ex = param(x, "excluir").trim().toLowerCase();
                List<Map<String, Object>> r = ex.isEmpty()
                    ? consulta(c, "SELECT 1 AS X FROM PERSONAS WHERE NUMERO_DOCUMENTO = ?", p[1].trim())
                    : consulta(c, "SELECT 1 AS X FROM PERSONAS WHERE NUMERO_DOCUMENTO = ? AND LOWER(CORREO) <> ?", p[1].trim(), ex);
                json(x, 200, mapa("ocupada", !r.isEmpty())); return;
            }
            if (a.equals("config")) {
                if (m.equals("GET")) {
                    Map<String, Object> o = new LinkedHashMap<>();
                    for (Map<String, Object> r : consulta(c, "SELECT CLAVE, VALOR FROM CONFIG_PROGRAMA")) o.put(str(r.get("CLAVE")), r.get("VALOR"));
                    json(x, 200, o); return;
                }
                if (m.equals("PUT") && p.length == 2) {
                    BigDecimal v = new BigDecimal(str(body.get("valor")));
                    exec(c, "DELETE FROM CONFIG_PROGRAMA WHERE CLAVE = ?", p[1]);
                    exec(c, "INSERT INTO CONFIG_PROGRAMA (CLAVE, VALOR) VALUES (?, ?)", p[1], v);
                    json(x, 200, mapa("ok", true)); return;
                }
            }
            if (a.equals("catalogo") && p.length == 3 && p[2].equals("instituciones") && m.equals("PUT")) {
                c.setAutoCommit(false);
                try {
                    exec(c, "DELETE FROM CATALOGO_INSTITUCIONES WHERE ID_CATALOGO = ?", Long.parseLong(p[1]));
                    for (Object id : (List<Object>) body.getOrDefault("ids", new ArrayList<>()))
                        exec(c, "INSERT INTO CATALOGO_INSTITUCIONES (ID_CATALOGO, ID_INSTITUCION) VALUES (?, ?)", Long.parseLong(p[1]), ((BigDecimal) id).longValue());
                    c.commit(); json(x, 200, mapa("ok", true));
                } catch (Exception e) { c.rollback(); throw e; }
                return;
            }
            String[] cf = R.get(a);
            if (cf == null) { json(x, 404, mapa("error", "Recurso no existe")); return; }
            crud(x, c, m, p, cf, body);
        }
    }

    static void crud(HttpExchange x, Connection c, String m, String[] p, String[] cf, Map<String, Object> body) throws Exception {
        if (m.equals("GET") && p.length == 1) {
            Set<String> ok = set(cf[2]); ok.add(cf[1]);
            StringBuilder w = new StringBuilder(); List<Object> a = new ArrayList<>();
            String q = x.getRequestURI().getRawQuery();
            if (q != null) for (String kv : q.split("&")) {
                String[] s = kv.split("=", 2); String k = URLDecoder.decode(s[0], "UTF-8").toUpperCase();
                if (s.length == 2 && ok.contains(k)) { w.append(a.isEmpty() ? " WHERE " : " AND ").append(k).append(" = ?"); a.add(URLDecoder.decode(s[1], "UTF-8")); }
            }
            json(x, 200, consulta(c, "SELECT * FROM " + cf[0] + w + " ORDER BY " + cf[1], a.toArray())); return;
        }
        if (m.equals("GET") && p.length == 2) {
            List<Map<String, Object>> r = consulta(c, "SELECT * FROM " + cf[0] + " WHERE " + cf[1] + " = ?", Long.parseLong(p[1]));
            if (r.isEmpty()) json(x, 404, mapa("error", "No existe")); else json(x, 200, r.get(0)); return;
        }
        if (m.equals("POST") && p.length == 1) {
            long id = seq(c, "SEQ_" + cf[0]);
            insertar(c, cf, id, vals(cf, body));
            json(x, 201, mapa(cf[1], id)); return;
        }
        if (m.equals("PUT") && p.length == 2) {
            Map<String, Object> v = vals(cf, body);
            if (v.isEmpty()) { json(x, 400, mapa("error", "Nada que actualizar")); return; }
            StringBuilder s = new StringBuilder(); Set<String> f = set(cf[3]);
            for (String k : v.keySet()) s.append(s.length() > 0 ? "," : "").append(k).append(" = ?");
            try (PreparedStatement ps = c.prepareStatement("UPDATE " + cf[0] + " SET " + s + " WHERE " + cf[1] + " = ?")) {
                int i = 1; for (Map.Entry<String, Object> e : v.entrySet()) bind(ps, i++, e.getValue(), f.contains(e.getKey()));
                ps.setLong(i, Long.parseLong(p[1])); ps.executeUpdate();
            }
            json(x, 200, mapa("ok", true)); return;
        }
        if (m.equals("DELETE") && p.length == 2) {
            exec(c, "DELETE FROM " + cf[0] + " WHERE " + cf[1] + " = ?", Long.parseLong(p[1]));
            json(x, 200, mapa("ok", true)); return;
        }
        json(x, 405, mapa("error", "Metodo no permitido"));
    }

    static void login(HttpExchange x, Connection c, Map<String, Object> b) throws Exception {
        String u = str(b.get("usuario")).trim().toLowerCase(), clave = str(b.get("clave")), rol = str(b.get("rol")).toUpperCase();
        if (rol.equals("INSTITUCION")) {
            List<Map<String, Object>> r = consulta(c, "SELECT ID_INSTITUCION, NOMBRE, NIT FROM INSTITUCIONES WHERE LOWER(CORREO) = ?", u);
            if (!r.isEmpty() && !str(r.get(0).get("NIT")).isEmpty() && str(r.get(0).get("NIT")).equals(clave))
                json(x, 200, mapa("ok", true, "rol", "institucion", "usuario", u, "id", r.get(0).get("ID_INSTITUCION"), "nombre", r.get(0).get("NOMBRE")));
            else json(x, 401, mapa("ok", false));
            return;
        }
        List<Map<String, Object>> r = consulta(c,
            "SELECT u.ID_USUARIO, u.CLAVE, p.ID_PERSONA, p.NOMBRES, p.APELLIDOS FROM USUARIOS u " +
            "JOIN PERSONAS p ON p.ID_PERSONA = u.ID_PERSONA JOIN ROLES r ON r.ID_ROL = u.ID_ROL " +
            "WHERE LOWER(u.NOMBRE_USUARIO) = ? AND u.ESTADO = 'A' AND UPPER(r.NOMBRE) LIKE ?", u, rol + "%");
        if (r.isEmpty() || !check(clave, str(r.get(0).get("CLAVE")))) { json(x, 401, mapa("ok", false)); return; }
        Map<String, Object> f = r.get(0); String guardada = str(f.get("CLAVE"));
        exec(c, "UPDATE USUARIOS SET ULTIMO_ACCESO = SYSDATE, CLAVE = ? WHERE ID_USUARIO = ?", guardada.startsWith("pbkdf2$") ? guardada : hash(clave), f.get("ID_USUARIO"));
        json(x, 200, mapa("ok", true, "rol", rol.toLowerCase(), "usuario", u, "id", f.get("ID_PERSONA"), "nombre", str(f.get("NOMBRES")) + " " + str(f.get("APELLIDOS"))));
    }

    /** Crea persona + usuario. La clave inicial es el numero de documento. */
    static void usuario(HttpExchange x, Connection c, Map<String, Object> b) throws Exception {
        String[] cf = R.get("personas"); String rol = str(b.get("rol")).toUpperCase();
        Map<String, Object> v = vals(cf, b.get("persona"));
        c.setAutoCommit(false);
        try {
            long id = seq(c, "SEQ_PERSONAS");
            insertar(c, cf, id, v);
            List<Map<String, Object>> r = consulta(c, "SELECT ID_ROL FROM ROLES WHERE UPPER(NOMBRE) LIKE ? AND ROWNUM = 1", rol + "%");
            if (r.isEmpty()) throw new Exception("El rol no existe: " + rol);
            exec(c, "INSERT INTO USUARIOS (ID_USUARIO, ID_PERSONA, ID_ROL, NOMBRE_USUARIO, CLAVE, FECHA_CREACION, ESTADO) VALUES (?, ?, ?, ?, ?, SYSDATE, 'A')",
                seq(c, "SEQ_USUARIOS"), id, r.get(0).get("ID_ROL"), str(v.get("CORREO")).toLowerCase(), hash(str(v.get("NUMERO_DOCUMENTO"))));
            c.commit(); json(x, 201, mapa("ID_PERSONA", id));
        } catch (Exception e) { c.rollback(); throw e; }
    }

    // ---------- Sincronizacion: copia a Oracle lo que la app guarda en el navegador ----------
    static String cut(Object o, int n) { String s = str(o).trim(); return s.length() > n ? s.substring(0, n) : s; }
    static Object nul(String s) { return s.isEmpty() ? null : s; }

    @SuppressWarnings("unchecked")
    static void sync(HttpExchange x, Connection c, Map<String, Object> b) throws Exception {
        int n = 0; List<Object> errores = new ArrayList<>();
        String[][] grupos = {{"docentes", "DOCENTE"}, {"estudiantes", "ESTUDIANTE"}};
        for (String[] g : grupos)
            if (b.get(g[0]) instanceof List) for (Object o : (List<Object>) b.get(g[0])) n += persona(c, g[1], (Map<String, Object>) o, errores);
        if (b.get("coordinador") instanceof Map) n += persona(c, "COORDINADOR", (Map<String, Object>) b.get("coordinador"), errores);
        if (b.get("director") instanceof Map) n += persona(c, "DIRECTOR", (Map<String, Object>) b.get("director"), errores);
        if (b.get("instituciones") instanceof List)
            for (Object o : (List<Object>) b.get("instituciones")) n += institucion(c, (Map<String, Object>) o, errores);
        if (b.get("practicas") instanceof List)
            for (Object o : (List<Object>) b.get("practicas")) n += practica(c, (Map<String, Object>) o, errores);
        if (b.get("grupos") instanceof List)
            for (Object o : (List<Object>) b.get("grupos")) n += grupo(c, (Map<String, Object>) o, errores);
        if (b.get("asignaciones") instanceof List)
            for (Object o : (List<Object>) b.get("asignaciones")) n += asignacion(c, (Map<String, Object>) o, errores);
        if (b.get("eliminar") instanceof Map) {
            Map<String, Object> e = (Map<String, Object>) b.get("eliminar");
            if (e.get("asignaciones") instanceof List) for (Object o : (List<Object>) e.get("asignaciones")) n += borrarAsignacion(c, str(o), errores);
            if (e.get("grupos") instanceof List) for (Object o : (List<Object>) e.get("grupos")) n += borrarGrupo(c, str(o), errores);
            if (e.get("practicas") instanceof List) for (Object o : (List<Object>) e.get("practicas")) n += borrarPractica(c, str(o), errores);
            if (e.get("instituciones") instanceof List) for (Object o : (List<Object>) e.get("instituciones")) n += borrarInstitucion(c, str(o), errores);
            String[][] pr = {{"docentes", "DOCENTE"}, {"estudiantes", "ESTUDIANTE"}};
            for (String[] g : pr)
                if (e.get(g[0]) instanceof List) for (Object o : (List<Object>) e.get(g[0])) {
                    Map<String, Object> q = (Map<String, Object>) o; n += borrarPersona(c, g[1], str(q.get("correo")), str(q.get("cedula")), errores);
                }
        }
        for (Object e : errores) System.err.println("Sync: " + e);
        json(x, 200, mapa("ok", true, "sincronizados", n, "errores", errores));
    }

    static int persona(Connection c, String rol, Map<String, Object> p, List<Object> err) {
        String correo = cut(p.get("correo"), 120).toLowerCase();
        if (correo.isEmpty()) return 0;
        try {
            String ced = cut(p.get("cedula"), 20), nombre = str(p.get("nombre")).trim();
            if (ced.isEmpty()) ced = cut(correo, 20);
            int sp = nombre.indexOf(' ');
            String nombres = cut(sp < 0 ? nombre : nombre.substring(0, sp), 80), apellidos = sp < 0 ? "-" : cut(nombre.substring(sp + 1), 80);
            if (nombres.isEmpty()) nombres = "-";
            if (apellidos.isEmpty()) apellidos = "-";
            String estado = "Inactivo".equalsIgnoreCase(str(p.get("estado"))) ? "I" : "A";
            String dig = str(p.get("semestre")).replaceAll("\\D", "");
            Object sem = dig.isEmpty() ? null : Integer.valueOf(dig.length() > 2 ? dig.substring(0, 2) : dig);
            Object prog = nul(cut(p.get("programa"), 100)), tel = nul(cut(p.get("telefono"), 20)), gapp = nul(cut(p.get("grupoId"), 40));
            List<Map<String, Object>> f = consulta(c, "SELECT ID_PERSONA FROM PERSONAS WHERE LOWER(CORREO) = ?", correo);
            if (f.isEmpty() && !cut(p.get("cedula"), 20).isEmpty())   // si cambio el correo, se reconoce por la cedula
                f = consulta(c, "SELECT ID_PERSONA FROM PERSONAS WHERE NUMERO_DOCUMENTO = ?", ced);
            Object id;
            if (f.isEmpty()) {
                long nid = seq(c, "SEQ_PERSONAS");
                exec(c, "INSERT INTO PERSONAS (ID_PERSONA, TIPO_DOCUMENTO, NUMERO_DOCUMENTO, NOMBRES, APELLIDOS, CORREO, TELEFONO, ESTADO, PROGRAMA, SEMESTRE, GRUPO_APP) VALUES (?, 'CC', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    nid, ced, nombres, apellidos, correo, tel, estado, prog, sem, gapp);
                id = nid;
            } else {
                id = f.get(0).get("ID_PERSONA");
                exec(c, "UPDATE PERSONAS SET NUMERO_DOCUMENTO = NVL(?, NUMERO_DOCUMENTO), CORREO = ?, NOMBRES = ?, APELLIDOS = ?, TELEFONO = ?, ESTADO = ?, PROGRAMA = ?, SEMESTRE = ?, GRUPO_APP = ? WHERE ID_PERSONA = ?",
                    nul(cut(p.get("cedula"), 20)), correo, nombres, apellidos, tel, estado, prog, sem, gapp, id);
                exec(c, "UPDATE USUARIOS SET NOMBRE_USUARIO = ? WHERE ID_PERSONA = ?", correo, id);
            }
            String clave = str(p.get("password")); boolean sinClave = clave.isEmpty(); if (sinClave) clave = ced;
            List<Map<String, Object>> u = consulta(c, "SELECT u.ID_USUARIO, u.CLAVE FROM USUARIOS u JOIN ROLES r ON r.ID_ROL = u.ID_ROL WHERE u.ID_PERSONA = ? AND UPPER(r.NOMBRE) LIKE ?", id, rol + "%");
            if (u.isEmpty()) {
                List<Map<String, Object>> r = consulta(c, "SELECT ID_ROL FROM ROLES WHERE UPPER(NOMBRE) LIKE ? AND ROWNUM = 1", rol + "%");
                if (r.isEmpty()) throw new Exception("Rol no existe: " + rol);
                exec(c, "INSERT INTO USUARIOS (ID_USUARIO, ID_PERSONA, ID_ROL, NOMBRE_USUARIO, CLAVE, FECHA_CREACION, ESTADO) VALUES (?, ?, ?, ?, ?, SYSDATE, ?)",
                    seq(c, "SEQ_USUARIOS"), id, r.get(0).get("ID_ROL"), correo, hash(clave), estado);
            } else {
                Object uid = u.get(0).get("ID_USUARIO");
                exec(c, "UPDATE USUARIOS SET ESTADO = ? WHERE ID_USUARIO = ?", estado, uid);
                if (!sinClave && !check(clave, str(u.get(0).get("CLAVE")))) exec(c, "UPDATE USUARIOS SET CLAVE = ? WHERE ID_USUARIO = ?", hash(clave), uid);
            }
            return 1;
        } catch (Exception e) { err.add(correo + ": " + e.getMessage()); return 0; }
    }

    @SuppressWarnings("unchecked")
    static int institucion(Connection c, Map<String, Object> i, List<Object> err) {
        String nit = cut(i.get("nit"), 20);
        if (nit.isEmpty()) return 0;
        try {
            Map<String, Object> cv = i.get("convenio") instanceof Map ? (Map<String, Object>) i.get("convenio") : new HashMap<String, Object>();
            String nombre = cut(i.get("nombre"), 120); if (nombre.isEmpty()) nombre = "-";
            String ini = str(cv.get("fechaInicio")), fin = str(cv.get("fechaFin"));
            Object di = ini.length() >= 10 ? java.sql.Date.valueOf(ini.substring(0, 10)) : null;
            Object df = fin.length() >= 10 ? java.sql.Date.valueOf(fin.substring(0, 10)) : null;
            Object dir = nul(cut(i.get("direccion"), 150)), tel = nul(cut(i.get("telefono"), 20)), cor = nul(cut(i.get("correo"), 120).toLowerCase()),
                   con = nul(cut(i.get("contacto"), 100)), ciu = nul(cut(i.get("ciudad"), 80)), ce = nul(cut(cv.get("estado"), 20));
            List<Map<String, Object>> f = consulta(c, "SELECT ID_INSTITUCION FROM INSTITUCIONES WHERE NIT = ?", nit);
            if (f.isEmpty())
                exec(c, "INSERT INTO INSTITUCIONES (ID_INSTITUCION, NOMBRE, NIT, DIRECCION, TELEFONO, CORREO, NOMBRE_CONTACTO, ESTADO, CIUDAD, CONVENIO_ESTADO, CONVENIO_INICIO, CONVENIO_FIN) VALUES (?, ?, ?, ?, ?, ?, ?, 'A', ?, ?, ?, ?)",
                    seq(c, "SEQ_INSTITUCIONES"), nombre, nit, dir, tel, cor, con, ciu, ce, di, df);
            else
                exec(c, "UPDATE INSTITUCIONES SET NOMBRE = ?, DIRECCION = ?, TELEFONO = ?, CORREO = ?, NOMBRE_CONTACTO = ?, CIUDAD = ?, CONVENIO_ESTADO = ?, CONVENIO_INICIO = ?, CONVENIO_FIN = ? WHERE ID_INSTITUCION = ?",
                    nombre, dir, tel, cor, con, ciu, ce, di, df, f.get(0).get("ID_INSTITUCION"));
            return 1;
        } catch (Exception e) { err.add("NIT " + nit + ": " + e.getMessage()); return 0; }
    }

    @SuppressWarnings("unchecked")
    static int practica(Connection c, Map<String, Object> p, List<Object> err) {
        String idApp = cut(p.get("id"), 40);
        if (idApp.isEmpty()) return 0;
        try {
            String nombre = cut(p.get("nombre"), 120); if (nombre.isEmpty()) nombre = "-";
            String dsem = str(p.get("semestre")).replaceAll("\\D", ""), dh = str(p.get("horas")).replaceAll("\\D", "");
            Object sem = dsem.isEmpty() ? null : Integer.valueOf(dsem.length() > 2 ? dsem.substring(0, 2) : dsem);
            Integer horas = dh.isEmpty() ? Integer.valueOf(0) : Integer.valueOf(dh.length() > 5 ? dh.substring(0, 5) : dh);
            String ini = str(p.get("inicio")), fin = str(p.get("fin"));
            Object di = ini.length() >= 10 ? java.sql.Date.valueOf(ini.substring(0, 10)) : null;
            Object df = fin.length() >= 10 ? java.sql.Date.valueOf(fin.substring(0, 10)) : null;
            Object prog = nul(cut(p.get("programa"), 100)), desc = nul(cut(p.get("descripcion"), 500));
            List<Map<String, Object>> f = consulta(c, "SELECT ID_CATALOGO FROM CATALOGO_PRACTICAS WHERE ID_APP = ?", idApp);
            Object id;
            if (f.isEmpty()) {
                long nid = seq(c, "SEQ_CATALOGO_PRACTICAS");
                exec(c, "INSERT INTO CATALOGO_PRACTICAS (ID_CATALOGO, ID_APP, NOMBRE, PROGRAMA, SEMESTRE, HORAS_REQUERIDAS, FECHA_INICIO, FECHA_FIN, DESCRIPCION) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    nid, idApp, nombre, prog, sem, horas, di, df, desc);
                id = nid;
            } else {
                id = f.get(0).get("ID_CATALOGO");
                exec(c, "UPDATE CATALOGO_PRACTICAS SET NOMBRE = ?, PROGRAMA = ?, SEMESTRE = ?, HORAS_REQUERIDAS = ?, FECHA_INICIO = ?, FECHA_FIN = ?, DESCRIPCION = ? WHERE ID_CATALOGO = ?",
                    nombre, prog, sem, horas, di, df, desc, id);
            }
            exec(c, "DELETE FROM CATALOGO_INSTITUCIONES WHERE ID_CATALOGO = ?", id);
            Set<String> vistos = new HashSet<>();
            if (p.get("nits") instanceof List)
                for (Object nit : (List<Object>) p.get("nits")) {
                    if (!vistos.add(cut(nit, 20))) continue;
                    List<Map<String, Object>> i = consulta(c, "SELECT ID_INSTITUCION FROM INSTITUCIONES WHERE NIT = ?", cut(nit, 20));
                    if (!i.isEmpty()) exec(c, "INSERT INTO CATALOGO_INSTITUCIONES (ID_CATALOGO, ID_INSTITUCION) VALUES (?, ?)", id, i.get(0).get("ID_INSTITUCION"));
                }
            exec(c, "DELETE FROM CATALOGO_DOCENTES WHERE ID_CATALOGO = ?", id);
            Set<String> dv = new HashSet<>();
            if (p.get("docentes") instanceof List)
                for (Object co : (List<Object>) p.get("docentes")) {
                    String k = cut(co, 120).toLowerCase();
                    if (k.isEmpty() || !dv.add(k)) continue;
                    Object pid = idPorCorreo(c, k);
                    if (pid != null) exec(c, "INSERT INTO CATALOGO_DOCENTES (ID_CATALOGO, ID_PERSONA) VALUES (?, ?)", id, pid);
                }
            return 1;
        } catch (Exception e) { err.add("Practica " + str(p.get("nombre")) + ": " + e.getMessage()); return 0; }
    }

    static String param(HttpExchange x, String n) throws Exception {
        String q = x.getRequestURI().getRawQuery();
        if (q != null) for (String kv : q.split("&")) { String[] s = kv.split("=", 2); if (s[0].equals(n) && s.length == 2) return URLDecoder.decode(s[1], "UTF-8"); }
        return "";
    }

    /** Quita el acceso del rol; si la persona no tiene mas accesos, la borra y deja libre su cedula. */
    static int borrarPersona(Connection c, String rol, String correo, String cedula, List<Object> err) {
        String co = cut(correo, 120).toLowerCase(), ce = cut(cedula, 20);
        if (co.isEmpty() && ce.isEmpty()) return 0;
        try {
            int n = 0;
            for (Map<String, Object> f : consulta(c, "SELECT ID_PERSONA FROM PERSONAS WHERE LOWER(CORREO) = ? OR NUMERO_DOCUMENTO = ?", co, ce)) {
                Object id = f.get("ID_PERSONA");
                exec(c, "DELETE FROM USUARIOS WHERE ID_PERSONA = ? AND ID_ROL IN (SELECT ID_ROL FROM ROLES WHERE UPPER(NOMBRE) LIKE ?)", id, rol + "%");
                if (!consulta(c, "SELECT 1 AS X FROM USUARIOS WHERE ID_PERSONA = ?", id).isEmpty()) continue;
                exec(c, "DELETE FROM CATALOGO_DOCENTES WHERE ID_PERSONA = ?", id);
                try { exec(c, "DELETE FROM PERSONAS WHERE ID_PERSONA = ?", id); }
                catch (SQLException e) {
                    if (e.getErrorCode() != 2292) throw e;      // tiene registros asociados: se inactiva y se libera la cedula
                    exec(c, "UPDATE PERSONAS SET ESTADO = 'I', NUMERO_DOCUMENTO = 'ELIM' || ID_PERSONA, CORREO = 'eliminado' || ID_PERSONA || '@eliminado' WHERE ID_PERSONA = ?", id);
                }
                n++;
            }
            return n;
        } catch (Exception e) { err.add("Eliminar " + co + ": " + e.getMessage()); return 0; }
    }

    static int borrarPractica(Connection c, String idApp, List<Object> err) {
        if (idApp.isEmpty()) return 0;
        try {
            int n = 0;
            for (Map<String, Object> f : consulta(c, "SELECT ID_CATALOGO FROM CATALOGO_PRACTICAS WHERE ID_APP = ?", idApp)) {
                exec(c, "DELETE FROM CATALOGO_INSTITUCIONES WHERE ID_CATALOGO = ?", f.get("ID_CATALOGO"));
                exec(c, "DELETE FROM CATALOGO_DOCENTES WHERE ID_CATALOGO = ?", f.get("ID_CATALOGO"));
                exec(c, "DELETE FROM CATALOGO_PRACTICAS WHERE ID_CATALOGO = ?", f.get("ID_CATALOGO")); n++;
            }
            return n;
        } catch (Exception e) { err.add("Eliminar practica " + idApp + ": " + e.getMessage()); return 0; }
    }

    static int borrarInstitucion(Connection c, String nit, List<Object> err) {
        if (nit.isEmpty()) return 0;
        try {
            int n = 0;
            for (Map<String, Object> f : consulta(c, "SELECT ID_INSTITUCION FROM INSTITUCIONES WHERE NIT = ?", nit)) {
                exec(c, "DELETE FROM CATALOGO_INSTITUCIONES WHERE ID_INSTITUCION = ?", f.get("ID_INSTITUCION"));
                exec(c, "DELETE FROM INSTITUCIONES WHERE ID_INSTITUCION = ?", f.get("ID_INSTITUCION")); n++;
            }
            return n;
        } catch (Exception e) { err.add("Eliminar institucion " + nit + ": " + e.getMessage()); return 0; }
    }

    // ---------- Pagina /ver: la base de datos en tablas ordenadas ----------
    static String esc(Object o) {
        String t = o instanceof BigDecimal ? ((BigDecimal) o).toPlainString() : str(o);
        return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    static String tabla(String titulo, List<Map<String, Object>> filas) {
        StringBuilder b = new StringBuilder("<h2>" + esc(titulo) + " <small>(" + filas.size() + ")</small></h2>");
        if (filas.isEmpty()) return b.append("<p class='v'>Sin registros.</p>").toString();
        b.append("<div class='t'><table><thead><tr>");
        for (String k : filas.get(0).keySet()) b.append("<th>").append(esc(k)).append("</th>");
        b.append("</tr></thead><tbody>");
        for (Map<String, Object> f : filas) {
            b.append("<tr>");
            for (Object v : f.values()) b.append("<td>").append(esc(v)).append("</td>");
            b.append("</tr>");
        }
        return b.append("</tbody></table></div>").toString();
    }

    static void ver(HttpExchange x) throws Exception {
        try (Connection c = db()) {
            String html = "<!DOCTYPE html><html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
                + "<title>Base de datos</title><style>"
                + "body{font-family:system-ui,sans-serif;margin:24px;color:#1f2937;background:#f8fafc}"
                + "h1{font-size:22px}h2{font-size:17px;margin-top:28px}small,.v{color:#6b7280;font-weight:400}"
                + ".t{overflow-x:auto}table{border-collapse:collapse;min-width:100%;font-size:14px}"
                + "th,td{padding:8px 12px;border:1px solid #d9dee5;text-align:left;white-space:nowrap}th{background:#eef2f7}"
                + "tr:nth-child(even) td{background:rgba(127,127,127,.07)}"
                + "@media(prefers-color-scheme:dark){body{color:#e5e7eb;background:#0f172a}th{background:#1e293b}th,td{border-color:#334155}small,.v{color:#94a3b8}}"
                + "</style></head><body><h1>Base de datos · Docente en Marcha</h1><p class='v'>Recarga la p\u00e1gina (F5) para ver los cambios.</p>"
                + tabla("Usuarios", consulta(c, "SELECT r.NOMBRE AS ROL, p.NOMBRES || ' ' || p.APELLIDOS AS NOMBRE, p.NUMERO_DOCUMENTO AS CEDULA, p.CORREO, p.TELEFONO, p.PROGRAMA, p.SEMESTRE AS SEM, u.ESTADO AS EST FROM USUARIOS u JOIN PERSONAS p ON p.ID_PERSONA = u.ID_PERSONA JOIN ROLES r ON r.ID_ROL = u.ID_ROL ORDER BY r.NOMBRE, p.APELLIDOS"))
                + tabla("Pr\u00e1cticas", consulta(c, "SELECT c.NOMBRE AS PRACTICA, c.PROGRAMA, c.SEMESTRE AS SEM, c.HORAS_REQUERIDAS AS HORAS, c.FECHA_INICIO AS INICIO, c.FECHA_FIN AS FIN, (SELECT COUNT(*) FROM CATALOGO_INSTITUCIONES ci WHERE ci.ID_CATALOGO = c.ID_CATALOGO) AS INSTITUCIONES FROM CATALOGO_PRACTICAS c ORDER BY c.NOMBRE"))
                + tabla("Instituciones", consulta(c, "SELECT NOMBRE, NIT, CIUDAD, CORREO, NOMBRE_CONTACTO AS CONTACTO, CONVENIO_ESTADO AS CONVENIO, CONVENIO_INICIO AS INICIO, CONVENIO_FIN AS FIN FROM INSTITUCIONES ORDER BY NOMBRE"))
                + tabla("Grupos", consulta(c, "SELECT g.NOMBRE AS GRUPO, c.NOMBRE AS PRACTICA, i.NOMBRE AS INSTITUCION, p.NOMBRES || ' ' || p.APELLIDOS AS DOCENTE, g.JORNADA, g.HORARIO, g.CUPO FROM GRUPOS g LEFT JOIN CATALOGO_PRACTICAS c ON c.ID_CATALOGO = g.ID_CATALOGO LEFT JOIN INSTITUCIONES i ON i.ID_INSTITUCION = g.ID_INSTITUCION LEFT JOIN PERSONAS p ON p.ID_PERSONA = g.ID_DOCENTE ORDER BY c.NOMBRE, g.NOMBRE"))
                + tabla("Asignaciones", consulta(c, "SELECT pe.NOMBRES || ' ' || pe.APELLIDOS AS ESTUDIANTE, g.NOMBRE AS GRUPO, a.ESTADO, a.TIPO, a.FECHA_CREACION AS CREADA, a.FECHA_ENVIO AS ENVIADA, a.FECHA_DECISION AS DECISION FROM ASIGNACIONES a JOIN PERSONAS pe ON pe.ID_PERSONA = a.ID_ESTUDIANTE JOIN GRUPOS g ON g.ID_GRUPO = a.ID_GRUPO ORDER BY pe.APELLIDOS"))
                + "</body></html>";
            enviar(x, 200, "text/html; charset=utf-8", html.getBytes(StandardCharsets.UTF_8));
        }
    }

    // ---------- Estado: lo que hay en Oracle, para cargarlo en la app ----------
    static List<Map<String, Object>> lower(List<Map<String, Object>> l) {
        List<Map<String, Object>> o = new ArrayList<>();
        for (Map<String, Object> m : l) {
            Map<String, Object> n = new LinkedHashMap<>();
            for (Map.Entry<String, Object> e : m.entrySet()) n.put(e.getKey().toLowerCase(), e.getValue());
            o.add(n);
        }
        return o;
    }

    static void estado(HttpExchange x, Connection c) throws Exception {
        exec(c, "UPDATE CATALOGO_PRACTICAS SET ID_APP = 'pr_o' || ID_CATALOGO WHERE ID_APP IS NULL");
        String base = "SELECT p.ID_PERSONA AS IDDB, CASE WHEN p.APELLIDOS = '-' THEN p.NOMBRES ELSE p.NOMBRES || ' ' || p.APELLIDOS END AS NOMBRE, "
            + "p.NUMERO_DOCUMENTO AS CEDULA, p.CORREO, p.TELEFONO, p.PROGRAMA, p.SEMESTRE, p.GRUPO_APP AS GRUPOID, CASE WHEN u.ESTADO = 'A' THEN 'Activo' ELSE 'Inactivo' END AS ESTADO "
            + "FROM USUARIOS u JOIN PERSONAS p ON p.ID_PERSONA = u.ID_PERSONA JOIN ROLES r ON r.ID_ROL = u.ID_ROL WHERE UPPER(r.NOMBRE) LIKE ? ORDER BY p.ID_PERSONA";
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("docentes", lower(consulta(c, base, "DOCENTE%")));
        o.put("estudiantes", lower(consulta(c, base, "ESTUDIANTE%")));
        o.put("instituciones", lower(consulta(c, "SELECT ID_INSTITUCION AS IDDB, NOMBRE, NIT, CIUDAD, DIRECCION, TELEFONO, CORREO, NOMBRE_CONTACTO AS CONTACTO, "
            + "CONVENIO_ESTADO AS CESTADO, CONVENIO_INICIO AS CINICIO, CONVENIO_FIN AS CFIN FROM INSTITUCIONES WHERE NIT IS NOT NULL ORDER BY ID_INSTITUCION")));
        Map<String, List<Object>> nits = new HashMap<>();
        for (Map<String, Object> r : consulta(c, "SELECT ci.ID_CATALOGO AS K, i.NIT FROM CATALOGO_INSTITUCIONES ci JOIN INSTITUCIONES i ON i.ID_INSTITUCION = ci.ID_INSTITUCION")) {
            String k = str(r.get("K"));
            if (!nits.containsKey(k)) nits.put(k, new ArrayList<Object>());
            nits.get(k).add(r.get("NIT"));
        }
        List<Map<String, Object>> pr = lower(consulta(c, "SELECT ID_CATALOGO AS IDDB, ID_APP AS ID, NOMBRE, PROGRAMA, SEMESTRE, HORAS_REQUERIDAS AS HORAS, "
            + "FECHA_INICIO AS INICIO, FECHA_FIN AS FIN, DESCRIPCION FROM CATALOGO_PRACTICAS ORDER BY ID_CATALOGO"));
        Map<String, List<Object>> docs = new HashMap<>();
        for (Map<String, Object> r : consulta(c, "SELECT cd.ID_CATALOGO AS K, LOWER(p.CORREO) AS CORREO FROM CATALOGO_DOCENTES cd JOIN PERSONAS p ON p.ID_PERSONA = cd.ID_PERSONA")) {
            String k = str(r.get("K"));
            if (!docs.containsKey(k)) docs.put(k, new ArrayList<Object>());
            docs.get(k).add(r.get("CORREO"));
        }
        for (Map<String, Object> r : pr) {
            String k = str(r.get("iddb"));
            r.put("nits", nits.containsKey(k) ? nits.get(k) : new ArrayList<Object>());
            r.put("docentes", docs.containsKey(k) ? docs.get(k) : new ArrayList<Object>());
        }
        o.put("practicas", pr);
        o.put("grupos", lower(consulta(c, "SELECT g.ID_APP AS ID, g.NOMBRE, cp.ID_APP AS PRACTICAID, i.NIT, LOWER(p.CORREO) AS DOCENTE, g.JORNADA, g.HORARIO, g.CUPO "
            + "FROM GRUPOS g JOIN CATALOGO_PRACTICAS cp ON cp.ID_CATALOGO = g.ID_CATALOGO LEFT JOIN INSTITUCIONES i ON i.ID_INSTITUCION = g.ID_INSTITUCION "
            + "LEFT JOIN PERSONAS p ON p.ID_PERSONA = g.ID_DOCENTE WHERE g.ID_APP IS NOT NULL ORDER BY g.ID_GRUPO")));
        o.put("asignaciones", lower(consulta(c, "SELECT a.ID_APP AS ID, LOWER(pe.CORREO) AS ESTUDIANTE, g.ID_APP AS GRUPOID, a.ESTADO, a.TIPO, a.GRUPO_ANTERIOR AS GRUPOANTERIORID, "
            + "a.FECHA_CREACION AS FECHACREACION, a.FECHA_ENVIO AS FECHAENVIO, a.FECHA_DECISION AS FECHADECISION, a.MOTIVO, a.OBSERVACIONES "
            + "FROM ASIGNACIONES a JOIN PERSONAS pe ON pe.ID_PERSONA = a.ID_ESTUDIANTE JOIN GRUPOS g ON g.ID_GRUPO = a.ID_GRUPO WHERE a.ID_APP IS NOT NULL ORDER BY a.ID_ASIGNACION")));
        json(x, 200, o);
    }

    // ---------- Grupos y asignaciones ----------
    static Object idPorNit(Connection c, String nit) throws SQLException {
        if (nit.trim().isEmpty()) return null;
        List<Map<String, Object>> r = consulta(c, "SELECT ID_INSTITUCION FROM INSTITUCIONES WHERE NIT = ?", cut(nit, 20));
        return r.isEmpty() ? null : r.get(0).get("ID_INSTITUCION");
    }
    static Object idPorCorreo(Connection c, String correo) throws SQLException {
        if (correo.trim().isEmpty()) return null;
        List<Map<String, Object>> r = consulta(c, "SELECT ID_PERSONA FROM PERSONAS WHERE LOWER(CORREO) = ?", cut(correo, 120).toLowerCase());
        return r.isEmpty() ? null : r.get(0).get("ID_PERSONA");
    }
    static Object fecha(Object o) { String t = str(o); return t.length() >= 10 ? java.sql.Date.valueOf(t.substring(0, 10)) : null; }
    static Object entero(Object o, int max) {
        String d = str(o).replaceAll("\\D", "");
        return d.isEmpty() ? null : Integer.valueOf(d.length() > max ? d.substring(0, max) : d);
    }

    static int grupo(Connection c, Map<String, Object> g, List<Object> err) {
        String idApp = cut(g.get("id"), 40);
        if (idApp.isEmpty()) return 0;
        try {
            List<Map<String, Object>> cat = consulta(c, "SELECT ID_CATALOGO FROM CATALOGO_PRACTICAS WHERE ID_APP = ?", cut(g.get("practicaId"), 40));
            if (cat.isEmpty()) throw new Exception("la practica del grupo no esta en Oracle");
            Object inst = idPorNit(c, str(g.get("nit"))), doc = idPorCorreo(c, str(g.get("docente")));
            String nombre = cut(g.get("nombre"), 100); if (nombre.isEmpty()) nombre = "-";
            Object jor = nul(cut(g.get("jornada"), 30)), hor = nul(cut(g.get("horario"), 100)), cupo = entero(g.get("cupo"), 4);
            List<Map<String, Object>> f = consulta(c, "SELECT ID_GRUPO FROM GRUPOS WHERE ID_APP = ?", idApp);
            if (f.isEmpty())
                exec(c, "INSERT INTO GRUPOS (ID_GRUPO, ID_APP, NOMBRE, ID_CATALOGO, ID_INSTITUCION, ID_DOCENTE, JORNADA, HORARIO, CUPO) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    seq(c, "SEQ_GRUPOS"), idApp, nombre, cat.get(0).get("ID_CATALOGO"), inst, doc, jor, hor, cupo);
            else
                exec(c, "UPDATE GRUPOS SET NOMBRE = ?, ID_CATALOGO = ?, ID_INSTITUCION = ?, ID_DOCENTE = ?, JORNADA = ?, HORARIO = ?, CUPO = ? WHERE ID_GRUPO = ?",
                    nombre, cat.get(0).get("ID_CATALOGO"), inst, doc, jor, hor, cupo, f.get(0).get("ID_GRUPO"));
            return 1;
        } catch (Exception e) { err.add("Grupo " + str(g.get("nombre")) + ": " + e.getMessage()); return 0; }
    }

    static int asignacion(Connection c, Map<String, Object> a, List<Object> err) {
        String idApp = cut(a.get("id"), 40);
        if (idApp.isEmpty()) return 0;
        try {
            Object est = idPorCorreo(c, str(a.get("estudiante")));
            if (est == null) throw new Exception("el estudiante no esta en Oracle");
            List<Map<String, Object>> gr = consulta(c, "SELECT ID_GRUPO FROM GRUPOS WHERE ID_APP = ?", cut(a.get("grupoId"), 40));
            if (gr.isEmpty()) throw new Exception("el grupo no esta en Oracle");
            Object estado = nul(cut(a.get("estado"), 40)), tipo = nul(cut(a.get("tipo"), 10)), ant = nul(cut(a.get("grupoAnteriorId"), 40));
            Object mot = nul(cut(a.get("motivo"), 500)), obs = nul(cut(a.get("observaciones"), 500));
            Object fc = fecha(a.get("fechaCreacion")), fe = fecha(a.get("fechaEnvio")), fd = fecha(a.get("fechaDecision"));
            List<Map<String, Object>> f = consulta(c, "SELECT ID_ASIGNACION FROM ASIGNACIONES WHERE ID_APP = ?", idApp);
            if (f.isEmpty())
                exec(c, "INSERT INTO ASIGNACIONES (ID_ASIGNACION, ID_APP, ID_ESTUDIANTE, ID_GRUPO, ESTADO, TIPO, GRUPO_ANTERIOR, FECHA_CREACION, FECHA_ENVIO, FECHA_DECISION, MOTIVO, OBSERVACIONES) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    seq(c, "SEQ_ASIGNACIONES"), idApp, est, gr.get(0).get("ID_GRUPO"), estado == null ? "Borrador" : estado, tipo, ant, fc, fe, fd, mot, obs);
            else
                exec(c, "UPDATE ASIGNACIONES SET ID_ESTUDIANTE = ?, ID_GRUPO = ?, ESTADO = ?, TIPO = ?, GRUPO_ANTERIOR = ?, FECHA_CREACION = ?, FECHA_ENVIO = ?, FECHA_DECISION = ?, MOTIVO = ?, OBSERVACIONES = ? WHERE ID_ASIGNACION = ?",
                    est, gr.get(0).get("ID_GRUPO"), estado == null ? "Borrador" : estado, tipo, ant, fc, fe, fd, mot, obs, f.get(0).get("ID_ASIGNACION"));
            return 1;
        } catch (Exception e) { err.add("Asignacion " + idApp + ": " + e.getMessage()); return 0; }
    }

    static int borrarAsignacion(Connection c, String idApp, List<Object> err) {
        if (idApp.isEmpty()) return 0;
        try { exec(c, "DELETE FROM ASIGNACIONES WHERE ID_APP = ?", idApp); return 1; }
        catch (Exception e) { err.add("Eliminar asignacion " + idApp + ": " + e.getMessage()); return 0; }
    }

    static int borrarGrupo(Connection c, String idApp, List<Object> err) {
        if (idApp.isEmpty()) return 0;
        try {
            exec(c, "DELETE FROM ASIGNACIONES WHERE ID_GRUPO IN (SELECT ID_GRUPO FROM GRUPOS WHERE ID_APP = ?)", idApp);
            exec(c, "DELETE FROM GRUPOS WHERE ID_APP = ?", idApp);
            return 1;
        } catch (Exception e) { err.add("Eliminar grupo " + idApp + ": " + e.getMessage()); return 0; }
    }

    public static void main(String[] args) throws Exception {
        try (InputStream in = new FileInputStream("config.properties")) { cfg.load(in); }
        Class.forName("oracle.jdbc.OracleDriver");
        url = "jdbc:oracle:thin:@" + cfg.getProperty("host", "").trim() + ":" + cfg.getProperty("puerto", "1521").trim() + ":" + cfg.getProperty("sid", "ORCL").trim();
        try (Connection c = db()) { System.out.println("Conexion exitosa a Oracle"); }
        catch (SQLException e) { System.err.println("No se pudo conectar a Oracle: " + e.getMessage()); System.exit(1); }
        int port = Integer.parseInt(cfg.getProperty("web_puerto", "3000").trim());
        HttpServer s = HttpServer.create(new InetSocketAddress(port), 0);
        s.createContext("/", Servidor::handle);
        s.setExecutor(Executors.newFixedThreadPool(4));
        s.start();
        System.out.println("Abre http://localhost:" + port + "/inicio/index.html");
    }
}
