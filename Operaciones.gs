
/**
 * OPERACIONES.GS
 * Refactorizado para trabajar con FILES / SHEETS
 * y eliminar dependencia de SpreadsheetApp.getActiveSpreadsheet()
 */

const COL_BT = {
  FECHA: 1,
  HORA: 2,
  TIPO: 3,
  SERIE: 4,
  B_SALIDA: 5,
  U_SALIDA: 6,
  B_ENTRADA: 7,
  U_ENTRADA: 8,
  SOLICITANTE: 9,
  CODIGO: 10,
  DESC: 11,
  CANT: 12,
  FOLIO: 13,
  RESP: 14,
  IDUNICO: 15
};

const COL_BDEXCED = {
  IDUNICO: 1,
  FECHA: 2,
  HORA: 3,
  IDPRODUCTO: 4,
  CODIGO: 5,
  DESCRIPCION: 6,
  CANTIDAD: 7,
  STATUS: 8
};


/**
 * Obtiene spreadsheet por sheetKey usando CONSTANTS
 */
function _getSpreadsheetBySheetKey_(sheetKey) {
  const config = SHEETS[sheetKey];
  if (!config) {
    throw new Error(`No existe configuración para SHEETS.${sheetKey}`);
  }
  return getSpreadsheetByFileKey_(config.file);
}

/**
 * Obtiene hoja por sheetKey usando CONSTANTS
 */
function _getSheetByKeySafe_(sheetKey) {
  const hoja = getSheetByKey_(sheetKey);
  if (!hoja) {
    throw new Error(`No se encontró la hoja configurada para SHEETS.${sheetKey}`);
  }
  return hoja;
}


/**
 * Procesa y guarda un lote de traspasos en la bitácora
 */
function procesarTraspasos(lote) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(30000);
    locked = true;

    const ssTraspasos = _getSpreadsheetBySheetKey_("TRASPASOS");
    const hoja = _getSheetByKeySafe_("TRASPASOS");

    const config = _obtenerContextoTemporal(ssTraspasos);
    const DEFAULT_VALUE = "1 - Almacen Birlos";

    const filasParaInsertar = lote.map(item => {
      const bSalida = item.bodegaSalida;
      const uSalida = item.ubiSalida;
      const bEntrada = item.bodegaEntrada;
      const uEntrada = item.ubiEntrada;

      const serie = (item.tipo === "Acomodo") ? uEntrada : uSalida;

      const cantidadAbsoluta = Math.abs(Number(item.cantidad || 0));
      const tipoMovimiento = String(item.tipo || "").trim().toUpperCase();

      let cantidadConSigno = cantidadAbsoluta;
      if (
        tipoMovimiento.includes("ACOMODO") ||
        tipoMovimiento.includes("ENTRADA") ||
        tipoMovimiento.includes("INGRESO")
      ) {
        cantidadConSigno = cantidadAbsoluta;
      } else {
        cantidadConSigno = -cantidadAbsoluta;
      }

      const fila = new Array(15).fill("");
      fila[COL_BT.FECHA - 1] = config.fecha;
      fila[COL_BT.HORA - 1] = config.hora;
      fila[COL_BT.TIPO - 1] = item.tipo;
      fila[COL_BT.SERIE - 1] = (serie || "").toString().toUpperCase();
      fila[COL_BT.B_SALIDA - 1] = bSalida;
      fila[COL_BT.U_SALIDA - 1] = uSalida;
      fila[COL_BT.B_ENTRADA - 1] = bEntrada;
      fila[COL_BT.U_ENTRADA - 1] = uEntrada;
      fila[COL_BT.SOLICITANTE - 1] = item.solicitante;
      fila[COL_BT.CODIGO - 1] = String(item.codigo || "").toUpperCase();
      fila[COL_BT.DESC - 1] = String(item.descripcion || "").toUpperCase();
      fila[COL_BT.CANT - 1] = cantidadConSigno;
      fila[COL_BT.FOLIO - 1] = "";
      fila[COL_BT.RESP - 1] = "";
      fila[COL_BT.IDUNICO - 1] = "";

      return fila;
    });

    const startRow = hoja.getLastRow() + 1;
    hoja.getRange(startRow, 1, filasParaInsertar.length, 15).setValues(filasParaInsertar);

    SpreadsheetApp.flush();
    return "✅ " + lote.length + " movimientos registrados correctamente.";

  } catch (e) {
    return "❌ Error crítico: " + e.message;
  } finally {
    if (locked) lock.releaseLock();
  }
}


/**
 * Obtiene fecha/hora con la zona horaria del spreadsheet destino
 */
function _obtenerContextoTemporal(ss) {
  const zonaHoraria = ss.getSpreadsheetTimeZone();
  const ahora = new Date();

  return {
    fecha: Utilities.formatDate(ahora, zonaHoraria, "dd/MM/yyyy"),
    hora: Utilities.formatDate(ahora, zonaHoraria, "HH:mm:ss")
  };
}


/**
 * Genera el folio único:
 * marcatiempobase&idcodigo&#cajacorrespondiente
 */
function generarFolioUnico(item, config) {
  const marcaTiempoBase =
    config.fecha.split('/').reverse().join('') +
    config.hora.replace(/:/g, '');

  const idCodigo = String(item.codigo || "").trim().toUpperCase();

  const caja =
    (item.ubiEntrada && item.ubiEntrada !== "1 - Almacen Birlos")
      ? item.ubiEntrada
      : item.ubiSalida;

  return `${marcaTiempoBase}&${idCodigo}&#${caja}`;
}


/**
 * Registra folio y responsable del ERP en la fila correspondiente
 */
function registrarMovimientoSistema(numFila, folio, responsable) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(10000);
    locked = true;

    const hoja = _getSheetByKeySafe_("TRASPASOS");

    hoja.getRange(numFila, 13).setValue(String(folio || "").toUpperCase());
    hoja.getRange(numFila, 14).setValue(String(responsable || "").toUpperCase());

    SpreadsheetApp.flush();
    return true;

  } catch (e) {
    throw new Error("Error al actualizar la bitácora: " + e.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}


/**
 * Guarda lote de excedentes en BD-EXCEDENTES
 */
function guardarExcedentesEnBD(lote, config) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(20000);
    locked = true;

    const hoja = _getSheetByKeySafe_("EXCEDENTES");

    const filasParaInsertar = lote.map(item => {
      return [
        item.idUnico,       // Col A
        config.fecha,       // Col B
        config.hora,        // Col C
        item.id,            // Col D
        item.codigo,        // Col E
        item.descripcion,   // Col F
        item.cantidad,      // Col G
        "DISPONIBLE",       // Col H
        ""                  // Col I
      ];
    });

    const ultimaFila = hoja.getLastRow();
    hoja.getRange(ultimaFila + 1, 1, filasParaInsertar.length, 9).setValues(filasParaInsertar);

    SpreadsheetApp.flush();
    return true;

  } catch (e) {
    console.error("Error al guardar en BD-EXCEDENTES: " + e.message);
    throw new Error("Error en Base de Datos: " + e.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}


/**
 * Obtiene todos los registros de la bitácora para Historial
 */
function obtenerTodosLosRegistros() {
  try {
    const ssTraspasos = _getSpreadsheetBySheetKey_("TRASPASOS");
    const hoja = _getSheetByKeySafe_("TRASPASOS");

    const ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) return [];

    const limite = 500;
    const filaInicio = Math.max(2, ultimaFila - limite + 1);
    const numFilas = ultimaFila - filaInicio + 1;

    const data = hoja.getRange(filaInicio, 1, numFilas, 14).getValues();
    const zonaHoraria = ssTraspasos.getSpreadsheetTimeZone();

    return data.map((f, index) => {
      const filaReal = filaInicio + index;

      return {
        fila: filaReal,
        fecha: f[0] instanceof Date ? Utilities.formatDate(f[0], zonaHoraria, "dd/MM/yyyy") : f[0],
        hora: f[1] instanceof Date ? Utilities.formatDate(f[1], zonaHoraria, "HH:mm:ss") : f[1],
        tipo: f[2] || '---',
        serie: f[3] || '---',
        origen: f[4] || '---',
        uSalida: f[5] || '---',
        destino: f[6] || '---',
        uEntrada: f[7] || '---',
        solicitante: f[8] || '---',
        codigo: f[9] || 'SIN CODIGO',
        descripcion: f[10] || '',
        cantidad: f[11] || 0,
        folio: (f[12] === "" || f[12] === undefined) ? "" : f[12],
        responsable: (f[13] === "" || f[13] === undefined) ? "Sin asignar" : f[13],
        bodegaOriginal: f[2] === "Acomodo" ? (f[6] || "General") : (f[4] || "General")
      };
    }).reverse();

  } catch (e) {
    console.error("Error en obtenerTodosLosRegistros: " + e.toString());
    return [];
  }
}


/**
 * Actualiza una fila completa desde Historial
 */
function actualizarRegistroDesdeHistorialCompleto(numFila, datos) {
  const lock = LockService.getScriptLock();
  let locked = false;

  try {
    lock.waitLock(10000);
    locked = true;

    const hoja = _getSheetByKeySafe_("TRASPASOS");

    hoja.getRange(numFila, 4).setValue(String(datos.serie || "").toUpperCase());        // D
    hoja.getRange(numFila, 5).setValue(datos.origen || "");                             // E
    hoja.getRange(numFila, 7).setValue(datos.destino || "");                            // G
    hoja.getRange(numFila, 12).setValue(Number(datos.cantidad || 0));                   // L
    hoja.getRange(numFila, 13).setValue(String(datos.folio || "").toUpperCase());       // M
    hoja.getRange(numFila, 14).setValue(String(datos.responsable || "").toUpperCase()); // N

    SpreadsheetApp.flush();
    return true;

  } catch (e) {
    throw new Error("Error al actualizar: " + e.message);
  } finally {
    if (locked) lock.releaseLock();
  }
}


/**
 * Obtiene bitácora y BD-EXCEDENTES usando hojas configuradas
 */
function obtenerInformacionExcedentes() {
  const respuestaMaestra = {
    movimientosBitacora: [],
    baseExcedentes: []
  };

  // --- BLOQUE 1: BITÁCORA TRASPASOS ---
  try {
    const hojaBT = _getSheetByKeySafe_("TRASPASOS");

    const valoresBT = hojaBT.getDataRange().getValues();
    if (valoresBT.length > 1) {
      respuestaMaestra.movimientosBitacora = valoresBT.slice(1)
        .filter(fila => fila[COL_BT.CODIGO - 1])
        .map((fila, index) => {
          let fechaProcesada = "";
          try {
            if (fila[COL_BT.FECHA - 1] instanceof Date) {
              fechaProcesada = Utilities.formatDate(fila[COL_BT.FECHA - 1], "GMT-6", "yyyy-MM-dd");
            } else if (fila[COL_BT.FECHA - 1]) {
              fechaProcesada = String(fila[COL_BT.FECHA - 1]);
            }
          } catch (e) {
            fechaProcesada = "";
          }

          return {
            eidFila: index + 2,
            efecha: fechaProcesada,
            etipo: String(fila[COL_BT.TIPO - 1]).toUpperCase().trim(),
            eserie: String(fila[COL_BT.SERIE - 1]).trim(),
            ebodegaEntrada: String(fila[COL_BT.B_ENTRADA - 1]).trim(),
            ebodegaSalida: String(fila[COL_BT.B_SALIDA - 1]).trim(),
            ecodigo: String(fila[COL_BT.CODIGO - 1]).trim(),
            edescripcion: String(fila[COL_BT.DESC - 1]).trim(),
            ecantidad: Number(fila[COL_BT.CANT - 1] || 0),
            efolio: String(fila[COL_BT.FOLIO - 1]).trim(),
            eresponsable: String(fila[COL_BT.RESP - 1]).trim(),
            eidUnico: String(fila[COL_BT.IDUNICO - 1]).trim()
          };
        });
    }

  } catch (err) {
    console.error("❌ Fallo crítico leyendo TRASPASOS:", err.message);
  }

  // --- BLOQUE 2: BD-EXCEDENTES ---
  try {
    const hojaBD = _getSheetByKeySafe_("EXCEDENTES");

    const valoresBD = hojaBD.getDataRange().getValues();
    if (valoresBD.length > 1) {
      respuestaMaestra.baseExcedentes = valoresBD.slice(1)
        .filter(fila => fila[COL_BDEXCED.IDUNICO - 1])
        .map((fila, index) => {
          let fechaProcesada = "";
          try {
            if (fila[COL_BDEXCED.FECHA - 1] instanceof Date) {
              fechaProcesada = Utilities.formatDate(fila[COL_BDEXCED.FECHA - 1], "GMT-6", "yyyy-MM-dd");
            } else if (fila[COL_BDEXCED.FECHA - 1]) {
              fechaProcesada = String(fila[COL_BDEXCED.FECHA - 1]);
            }
          } catch (e) {
            fechaProcesada = "";
          }

          return {
            eidFila: index + 2,
            eidUnico: String(fila[COL_BDEXCED.IDUNICO - 1]).trim(),
            efecha: fechaProcesada,
            ehora: String(fila[COL_BDEXCED.HORA - 1]).trim(),
            eidProducto: String(fila[COL_BDEXCED.IDPRODUCTO - 1]).trim(),
            ecodigo: String(fila[COL_BDEXCED.CODIGO - 1]).trim(),
            edescripcion: String(fila[COL_BDEXCED.DESCRIPCION - 1]).trim(),
            ecantidad: Number(fila[COL_BDEXCED.CANTIDAD - 1] || 0),
            eubicacion: String(fila[COL_BDEXCED.STATUS - 1]).trim()
          };
        });
    }

  } catch (err) {
    console.error("❌ Fallo crítico leyendo EXCEDENTES:", err.message);
  }

  ejecutarMapeoConsola(respuestaMaestra);
  return respuestaMaestra;
}


/**
 * Reporte analítico en consola
 */
function ejecutarMapeoConsola(datos) {
  const totalBitacora = datos.movimientosBitacora.length;
  const totalExcedentesBase = datos.baseExcedentes.length;

  console.log("======================================================");
  console.log("📊 REPORTE DE EXTRACCIÓN Y CONSOLIDACIÓN DE DATOS");
  console.log("======================================================");
  console.log(`⏱️ Timestamp Ejecución: ${Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd HH:mm:ss")}`);
  console.log(`📥 Registros procesados en Bitácora-TRASPASOS: ${totalBitacora}`);
  console.log(`📥 Registros consolidados en BD-EXCEDENTES: ${totalExcedentesBase}`);
  console.log("------------------------------------------------------");

  if (totalExcedentesBase > 0) {
    console.log("🔍 Muestra del mapeo estructural (Primer Registro de BD-EXCEDENTES):");
    console.log(JSON.stringify(datos.baseExcedentes, null, 2));

    const sinCodigo = datos.baseExcedentes.filter(e => !e.ecodigo).length;
    const cantidadCero = datos.baseExcedentes.filter(e => e.ecantidad <= 0).length;

    if (sinCodigo > 0 || cantidadCero > 0) {
      console.warn(`🚨 Advertencia de Consistencia: Se detectaron ${sinCodigo} registros sin SKU y ${cantidadCero} con stock <= 0.`);
    } else {
      console.log("✅ Verificación de integridad: Estructura de BD-EXCEDENTES sin anomalías.");
    }
  } else {
    console.warn("⚠️ Advertencia: La hoja 'BD-EXCEDENTES' devolvió 0 registros activos.");
  }

  console.log("======================================================");
}
