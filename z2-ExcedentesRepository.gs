/**
 * ExcedentesRepository.gs
 * Lectura de hoja BD-EXCEDENTES
 */
const ExcedentesRepository = (() => {

  function _sheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName(SHEETS.EXCEDENTES);
    if (!hoja) throw new Error(`No se encontró la hoja: ${SHEETS.EXCEDENTES}`);
    return hoja;
  }

  function _leerExcedentes() {
    const values = _sheet().getDataRange().getValues();
    if (values.length < 2) return []; // sin datos
    return values.slice(1); // quitamos encabezado
  }

  function _normalizarFila(fila) {
    return {
      idunico: String(fila[COL.EXCEDENTES.IDUNICO] || "").trim().toUpperCase(),
      fecha: String(fila[COL.EXCEDENTES.FECHA] || "").trim(),
      hora: String(fila[COL.EXCEDENTES.HORA] || "").trim(),
      idproducto: String(fila[COL.EXCEDENTES.IDPRODUCTO] || "").trim().toUpperCase(),
      codigo: String(fila[COL.EXCEDENTES.CODIGO] || "").trim().toUpperCase(),
      descripcion: String(fila[COL.EXCEDENTES.DESCRIPCION] || "").trim().toUpperCase(),
      cantidad: String(fila[COL.EXCEDENTES.CANTIDAD] || "").trim().toUpperCase(),
      status: String(fila[COL.EXCEDENTES.STATUS] || "").trim().toUpperCase()

    };
  }

  return {

    // Devuelve todos los excedentes
    getAll: function() {
      return _leerExcedentes()
        .map(_normalizarFila)
        .filter(u => u.codigo !== "")
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
    },

    // Devuelve ultimos excedentes
    getUltimos: function(limit) {
      const all = _leerExcedentes()
        .map(_normalizarFila)
        .filter(t => t.fecha !== "");

      return all.slice(-limit); // últimos
    },

    // Devuelve todos los excedentes por idproducto   
    getPorIdProducto: function(idproducto) {
      const filtro = String(idproducto || "").trim().toUpperCase();

      return _leerExcedentes()
        .map(_normalizarFila)
        .filter(t => t.idproducto === filtro);
    },

    // Devuelve todos los excedentes por codigo    
    getPorCodigo: function(codigo) {
      const filtro = String(codigo || "").trim().toUpperCase();

      return _leerExcedentes()
        .map(_normalizarFila)
        .filter(t => t.codigo === filtro);
    },

    // Devuelve todos los excedentes por IDUNICO
    getPorIdUnico: function(idunico) {
      const filtro = String(idunico || "").trim().toUpperCase();

      return _leerExcedentes()
        .map(_normalizarFila)
        .filter(t => t.idunico === filtro);
    },

    // Devuelve todos los excedentes por STATUS
    getPorStatus: function(status) {
      const filtro = String(status || "").trim().toUpperCase();

      return _leerTraspasos()
        .map(_normalizarFila)
        .filter(t => t.status === filtro);
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



function debugExcedentesRepository() {

  // ===============================
  // 🎯 VARIABLES DE PRUEBA
  // ===============================

  const LIMITE = 50;
  const CODIGO_PRUEBA = "PLP-10X3";     
  const IDUNICO_PRUEBA = "20260515143815131121";
  const STATUS_PRUEBA = "ACOMODADO";
  const IDPRODUCTO_PRUEBA = "13112";  

  // ===============================
  //  getAll
  // ===============================

  const all = ExcedentesRepository.getAll();
  console.log("[getAll] total:", all.length);
  console.log("[getAll] muestra:", JSON.stringify(all.slice(0, 5), null, 2));

  // ===============================
  //  getUltimos
  // ===============================

  const ultimos = ExcedentesRepository.getUltimos(LIMITE);
  console.log(`[getUltimos(${LIMITE})] total:`, ultimos.length);
  console.log("[getUltimos] muestra:", JSON.stringify(ultimos.slice(0, 5), null, 2));

  // ===============================
  //  getPorCodigo
  // ===============================

  const porCodigo = ExcedentesRepository.getPorCodigo(CODIGO_PRUEBA);
  console.log(`[getPorCodigo(${CODIGO_PRUEBA})] total:`, porCodigo.length);
  console.log("[getPorCodigo] muestra:", JSON.stringify(porCodigo.slice(0, 5), null, 2));

  // ===============================
  //  getPorIdUnico
  // ===============================

  const porId = ExcedentesRepository.getPorIdUnico(IDUNICO_PRUEBA);
  console.log(`[getPorIdUnico(${IDUNICO_PRUEBA})] total:`, porId.length);
  console.log("[getPorIdUnico] muestra:", JSON.stringify(porId.slice(0, 5), null, 2));

  // ===============================
  //  getPorIdProducto
  // ===============================

  const porIdProducto = ExcedentesRepository.getPorIdProducto(IDPRODUCTO_PRUEBA);
  console.log(`[getPorIdProducto(${IDPRODUCTO_PRUEBA})] total:`, porIdProducto.length);
  console.log("[getPorIdProducto] muestra:", JSON.stringify(porIdProducto.slice(0, 5), null, 2));

  // ===============================
  //  getPorStatus
  // ===============================

  const porStatus = ExcedentesRepository.getPorStatus(STATUS_PRUEBA);
  console.log(`[getPorIdUnico(${STATUS_PRUEBA})] total:`, porStatus.length);
  console.log("[getPorIdUnico] muestra:", JSON.stringify(porStatus.slice(0, 5), null, 2));
}


