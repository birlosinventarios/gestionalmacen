/**
 * UsuariosRepository.gs
 * Lectura de hoja USUARIOS
 */
const UbicacionesExcedentesRepository = (() => {

  function _sheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName(SHEETS.UBICACIONES_EXCEDENTES);
    if (!hoja) throw new Error(`No se encontró la hoja: ${SHEETS.UBICACIONES_EXCEDENTES}`);
    return hoja;
  }

  function _leerUbicacionesExcedentes() {
    const values = _sheet().getDataRange().getValues();
    if (values.length < 2) return []; // sin datos
    return values.slice(1); // quitamos encabezado
  }

  function _normalizarfila(fila) {
    return {
      id: fila[COL.UBICACIONES_EXCEDENTES.ID],
      bodega: String(fila[COL.UBICACIONES_EXCEDENTES.BODEGA] || "").trim().toUpperCase(), // Todo a mayusculas
      ubicacion: String(fila[COL.UBICACIONES_EXCEDENTES.UBICACION] || "").trim().toUpperCase()  // Todo a mayusculas
    };
  }

  return {

    // Devuelve objetos completos
    getAll: function() {
      return _leerUbicacionesExcedentes()
        .map(_normalizarfila)
        .filter(u => u.ubicacion !== "")
        .sort((a, b) => a.ubicacion.localeCompare(b.ubicacion));
    },

        // Devuelve solo bodegas (todos)
    getBodegasTodas: function() {
      return this.getAll().map(u => u.ubicacion);
    },

    // Devuelve solo ubicaciones (todos)
    getUbicacionesTodas: function() {
      return this.getAll().map(u => u.ubicacion);
    },
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


function debugUbicacionesExcedentesRepository() {
  // 1) Validar lectura directa (RAW) desde hoja
  debugSheetGeneric_(
    SHEETS.UBICACIONES_EXCEDENTES,
    (fila) => ({
      id: fila[COL.UBICACIONES_EXCEDENTES.ID],
      bodega: String(fila[COL.UBICACIONES_EXCEDENTES.BODEGA] || "").trim(),
      ubicacion: String(fila[COL.UBICACIONES_EXCEDENTES.UBICACION] || "").trim().toUpperCase()
    }),
    "UBICACIONES_EXCEDENTES"
  );

  // 2) Validar lo que regresa el repositorio (ya procesado)
  const all = UbicacionesExcedentesRepository.getAll();
  console.log("[UBICACIONES_EXCEDENTES][Repo] getAll() total:", all.length);
  console.log("[UBICACIONES_EXCEDENTES][Repo] getAll() muestra:", JSON.stringify(all.slice(0, 5), null, 2));

  const todos = UbicacionesExcedentesRepository.getUbicacionesTodas();
  console.log("[UBICACIONES_EXCEDENTES][Repo] getUbicacionesTodas() total:", todos.length);
  console.log("[UBICACIONES_EXCEDENTESc][Repo] getUbicacionesTodas() muestra:", JSON.stringify(todos.slice(0, 5), null, 2));
}
