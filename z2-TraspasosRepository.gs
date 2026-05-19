/**
 * UsuariosRepository.gs
 * Lectura de hoja Bitacora-TRASPASOS
 */
const TraspasosRepository = (() => {

  function _sheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName(SHEETS.TRASPASOS);
    if (!hoja) throw new Error(`No se encontró la hoja: ${SHEETS.TRASPASOS}`);
    return hoja;
  }

  function _leerTraspasos() {
    const values = _sheet().getDataRange().getValues();
    if (values.length < 2) return []; // sin datos
    return values.slice(1); // quitamos encabezado
  }

  function _normalizarFila(fila) {
    return {
      fecha: String(fila[COL.TRASPASOS.FECHA] || "").trim(),
      hora: String(fila[COL.TRASPASOS.HORA] || "").trim(),
      tipomovimiento: String(fila[COL.TRASPASOS.TIPOMOVIMIENTO] || "").trim().toUpperCase(),
      serie: String(fila[COL.TRASPASOS.SERIE] || "").trim().toUpperCase(),
      bodega_salida: String(fila[COL.TRASPASOS.BODEGA_SALIDA] || "").trim().toUpperCase(),
      ubicacion_salida: String(fila[COL.TRASPASOS.UBICACION_SALIDA] || "").trim().toUpperCase(),
      bodega_entrada: String(fila[COL.TRASPASOS.BODEGA_ENTRADA] || "").trim().toUpperCase(),
      ubicacion_entrada: String(fila[COL.TRASPASOS.UBICACION_ENTRADA] || "").trim().toUpperCase(),
      solicitante: String(fila[COL.TRASPASOS.SOLICITANTE] || "").trim().toUpperCase(),
      codigo: String(fila[COL.TRASPASOS.CODIGO] || "").trim().toUpperCase(),
      descripcion: String(fila[COL.TRASPASOS.DESCRIPCION] || "").trim().toUpperCase(),
      cantidad: String(fila[COL.TRASPASOS.CANTIDAD] || "").trim().toUpperCase(),
      folio: String(fila[COL.TRASPASOS.FOLIO] || "").trim().toUpperCase(),
      responsable: String(fila[COL.TRASPASOS.RESPONSABLE] || "").trim().toUpperCase(),
      idunico: String(fila[COL.TRASPASOS.IDUNICO] || "").trim().toUpperCase()
    };
  }

  return {

    // Devuelve todos los traspasos
    getAll: function() {
      return _leerTraspasos()
        .map(_normalizarFila)
        .filter(u => u.codigo !== "")
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
    },

    // Devuelve ultimos traspasos
    getUltimos: function(limit) {
      const all = _leerTraspasos()
        .map(_normalizarFila)
        .filter(t => t.fecha !== "");

      return all.slice(-limit); // últimos
    },

    // Devuelve todos los traspasos por codigo    
    getPorCodigo: function(codigo) {
      const filtro = String(codigo || "").trim().toUpperCase();

      return _leerTraspasos()
        .map(_normalizarFila)
        .filter(t => t.codigo === filtro);
    },

    // Devuelve todos los traspasos por IDUNICO
    getPorIdUnico: function(idunico) {
      const filtro = String(idunico || "").trim().toUpperCase();

      return _leerTraspasos()
        .map(_normalizarFila)
        .filter(t => t.idunico === filtro);
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



function debugTraspasosRepository() {

  // ===============================
  // 🎯 VARIABLES DE PRUEBA
  // ===============================

  const LIMITE = 50;
  const CODIGO_PRUEBA = "PLP-10X3";     
  const IDUNICO_PRUEBA = "20260515143815131121";

  // ===============================
  // ✅ getAll
  // ===============================

  const all = TraspasosRepository.getAll();
  console.log("[getAll] total:", all.length);
  console.log("[getAll] muestra:", JSON.stringify(all.slice(0, 5), null, 2));

  // ===============================
  // ✅ getUltimos
  // ===============================

  const ultimos = TraspasosRepository.getUltimos(LIMITE);
  console.log(`[getUltimos(${LIMITE})] total:`, ultimos.length);
  console.log("[getUltimos] muestra:", JSON.stringify(ultimos.slice(0, 5), null, 2));

  // ===============================
  // ✅ getPorCodigo
  // ===============================

  const porCodigo = TraspasosRepository.getPorCodigo(CODIGO_PRUEBA);
  console.log(`[getPorCodigo(${CODIGO_PRUEBA})] total:`, porCodigo.length);
  console.log("[getPorCodigo] muestra:", JSON.stringify(porCodigo.slice(0, 5), null, 2));

  // ===============================
  // ✅ getPorIdUnico
  // ===============================

  const porId = TraspasosRepository.getPorIdUnico(IDUNICO_PRUEBA);
  console.log(`[getPorIdUnico(${IDUNICO_PRUEBA})] total:`, porId.length);
  console.log("[getPorIdUnico] muestra:", JSON.stringify(porId.slice(0, 5), null, 2));

}


