/**
 * UsuariosRepository.gs
 * Lectura de hoja USUARIOS
 */
const UsuariosRepository = (() => {

  function _sheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName(SHEETS.USUARIOS);
    if (!hoja) throw new Error(`No se encontró la hoja: ${SHEETS.USUARIOS}`);
    return hoja;
  }

  function _leerUsuarios() {
    const values = _sheet().getDataRange().getValues();
    if (values.length < 2) return []; // sin datos
    return values.slice(1); // quitamos encabezado
  }

  function _normalizarfila(fila) {
    return {
      id: fila[COL.USUARIOS.ID],
      nombre: String(fila[COL.USUARIOS.NOMBRE] || "").trim().toUpperCase(), // Todo a mayusculas
      rol: String(fila[COL.USUARIOS.ROL] || "").trim().toUpperCase()  // Todo a mayusculas
    };
  }

  return {

    // Devuelve objetos completos
    getAll: function() {
      return _leerUsuarios()
        .map(_normalizarfila)
        .filter(u => u.nombre !== "")
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    },

    // Devuelve solo nombres (todos)
    getNombresTodos: function() {
      return this.getAll().map(u => u.nombre);
    },

    // Devuelve solo nombres de responsables (incluye ADMIN si así lo defines)
    getNombresResponsables: function() {
      return this.getAll()
        .filter(u => u.rol === "RESPONSABLE" )
        .map(u => u.nombre);
    }

  };

})();


/**
 * Plantilla genérica de Debug para hojas con encabezados en fila 1.
 * - sheetName: nombre de la hoja (SHEETS.X)
 * - mapFn: función que mapea fila(array) -> objeto
 * - label: etiqueta para logs
 */
function debugSheetGeneric_(sheetName, mapFn, label) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(sheetName);

  if (!hoja) {
    console.error(`[${label}] No se encontró la hoja:`, sheetName);
    return;
  }

  const values = hoja.getDataRange().getValues();

  console.log(`==================================================`);
  console.log(`[${label}] Hoja: ${sheetName}`);
  console.log(`[${label}] Filas totales (incluye encabezado):`, values.length);

  if (values.length === 0) {
    console.warn(`[${label}] Hoja vacía.`);
    return;
  }

  console.log(`[${label}] Encabezados (fila 1):`, values[0]);
  console.log(`[${label}] Muestra RAW (primeras 5 filas):`, JSON.stringify(values.slice(0, 5), null, 2));

  // Quitar encabezado
  const rows = values.slice(1);

  console.log(`[${label}] Filas de datos (sin encabezado):`, rows.length);
  console.log(`[${label}] Muestra RAW datos (primeras 5):`, JSON.stringify(rows.slice(0, 5), null, 2));

  // Mapear a objetos (si hay mapFn)
  if (typeof mapFn === "function") {
    const mapped = rows.map(mapFn);

    console.log(`[${label}] Muestra MAPEADA (primeras 5):`, JSON.stringify(mapped.slice(0, 5), null, 2));

    // Validaciones rápidas
    const nulos = mapped.filter(o => !o).length;
    console.log(`[${label}] Objetos nulos/undefined mapeados:`, nulos);
  }

  console.log(`==================================================`);
} 


function debugUsuariosRepository() {
  // 1) Validar lectura directa (RAW) desde hoja
  debugSheetGeneric_(
    SHEETS.USUARIOS,
    (fila) => ({
      id: fila[COL.USUARIOS.ID],
      nombre: String(fila[COL.USUARIOS.NOMBRE] || "").trim(),
      rol: String(fila[COL.USUARIOS.ROL] || "").trim().toUpperCase()
    }),
    "USUARIOS"
  );

  // 2) Validar lo que regresa el repositorio (ya procesado)
  const all = UsuariosRepository.getAll();
  console.log("[USUARIOS][Repo] getAll() total:", all.length);
  console.log("[USUARIOS][Repo] getAll() muestra:", JSON.stringify(all.slice(0, 5), null, 2));

  const todos = UsuariosRepository.getNombresTodos();
  console.log("[USUARIOS][Repo] getNombresTodos() total:", todos.length);
  console.log("[USUARIOS][Repo] getNombresTodos() muestra:", JSON.stringify(todos.slice(0, 5), null, 2));

  const resp = UsuariosRepository.getNombresResponsables();
  console.log("[USUARIOS][Repo] getNombresResponsables() total:", resp.length);
  console.log("[USUARIOS][Repo] getNombresResponsables() muestra:", JSON.stringify(resp.slice(0, 5), null, 2));
}

