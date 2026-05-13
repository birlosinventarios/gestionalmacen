/**
 * OPERACIONES.GS - VERSIÓN GOLD (OPTIMIZADA PARA 16K SKU)
 */

const COL_BT = {
  FECHA: 1, HORA: 2, TIPO: 3, SERIE: 4, B_SALIDA: 5, U_SALIDA: 6, B_ENTRADA: 7, U_ENTRADA: 8, SOLICITANTE: 9, CODIGO: 10, DESC: 11, CANT: 12, FOLIO: 13, RESP: 14,IDUNICO: 15
};

const COL_BDEXCED = {
  IDUNICO: 1, FECHA: 2,	HORA: 3, IDPRODUCTO: 4, CODIGO: 5, DESCRIPCION: 6, CANTIDAD: 7, STATUS: 8
};

function procesarTraspasos(lote) {
  const lock = LockService.getScriptLock();
  try {
    // Aumentamos a 30 seg el tiempo de espera por si hay mucha concurrencia
    lock.waitLock(30000); 

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('Bitacora-TRASPASOS');
    if (!hoja) throw new Error("La hoja 'Bitacora-TRASPASOS' no existe.");

    const config = _obtenerContextoTemporal(ss);
    const DEFAULT_VALUE = "1 - Almacen Birlos";

    const filasParaInsertar = lote.map(item => {
      // 1. Usamos directamente lo que viene del HTML (ya viene procesado)
      const bSalida = item.bodegaSalida;
      const uSalida = item.ubiSalida;
      const bEntrada = item.bodegaEntrada;
      const uEntrada = item.ubiEntrada;
      
      // La serie es la ubicación de destino si es Acomodo, o de origen si es Surtido
      const serie = (item.tipo === "Acomodo") ? uEntrada : uSalida;

      // --- NUEVA REGLA DE NEGOCIO PARA EL SIGNO DE LA CANTIDAD ---
      // 1. Forzamos que la cantidad de origen sea un número absoluto (sin signos)
      const cantidadAbsoluta = Math.abs(Number(item.cantidad || 0));
      
      // 2. Normalizamos el tipo de movimiento
      const tipoMovimiento = String(item.tipo || "").trim().toUpperCase();
      
      // 3. Si el tipo de movimiento es Acomodo, Ingreso o Entrada, se queda positivo.
      // En cualquier otro caso (Surtido, Traspaso, Salida, etc.), se escribe negativo.
      let cantidadConSigno = cantidadAbsoluta;
      if (tipoMovimiento.includes("ACOMODO") || tipoMovimiento.includes("ENTRADA") || tipoMovimiento.includes("INGRESO")) {
        cantidadConSigno = cantidadAbsoluta; // Positivo
      } else {
        cantidadConSigno = -cantidadAbsoluta; // Negativo
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
      fila[COL_BT.CODIGO - 1] = item.codigo.toUpperCase();
      fila[COL_BT.DESC - 1] = item.descripcion.toUpperCase();
      fila[COL_BT.CANT - 1] = cantidadConSigno; // <-- Aquí inyectamos el valor con signo calculado
      fila[COL_BT.FOLIO - 1] = ""; 
      fila[COL_BT.RESP - 1] = "";
      fila[COL_BT.IDUNICO - 1] = "";  
      
      return fila;
    });

    const startRow = hoja.getLastRow() + 1;
    hoja.getRange(startRow, 1, filasParaInsertar.length, 15).setValues(filasParaInsertar);
    
    // Forzamos el guardado inmediato
    SpreadsheetApp.flush(); 
    return "✅ " + lote.length + " movimientos registrados correctamente.";

  } catch (e) {
    return "❌ Error crítico: " + e.message;
  } finally {
    lock.releaseLock();
  }
}

function _obtenerContextoTemporal(ss) {
  const zonaHoraria = ss.getSpreadsheetTimeZone();
  const ahora = new Date();
  return {
    fecha: Utilities.formatDate(ahora, zonaHoraria, "dd/MM/yyyy"),
    hora: Utilities.formatDate(ahora, zonaHoraria, "HH:mm:ss")
  };
}

/**
 * Genera el folio único bajo el formato: marcatiempobase&idcodigo&#cajacorrespondiente
 */
function generarFolioUnico(item, config) {
  // Convertimos la fecha (dd/mm/yyyy) y hora (hh:mm:ss) en un solo string numérico
  // Ejemplo: 20260311153000
  const marcaTiempoBase = config.fecha.split('/').reverse().join('') + config.hora.replace(/:/g, '');
  
  const idCodigo = item.codigo.trim().toUpperCase();
  
  // Usamos la ubicación de entrada como referencia de "caja", 
  // si no existe (como en Surtido), usamos la de salida.
  const caja = (item.ubiEntrada && item.ubiEntrada !== "1 - Almacen Birlos") 
               ? item.ubiEntrada 
               : item.ubiSalida;

  return `${marcaTiempoBase}&${idCodigo}&#${caja}`;
}

/**
 * Registra los datos del ERP en la fila correspondiente
 */
function registrarMovimientoSistema(numFila, folio, responsable) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Espera hasta 10 seg
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('Bitacora-TRASPASOS');
    
    // Columna M es 13, Columna N es 14
    // Actualizamos el Folio (Col M)
    hoja.getRange(numFila, 13).setValue(folio.toString().toUpperCase());
    // Actualizamos el Responsable (Col N)
    hoja.getRange(numFila, 14).setValue(responsable.toUpperCase());
    
    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    throw new Error("Error al actualizar la bitácora: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Registra el lote de excedentes en la hoja BD-EXCEDENTES
 */
function guardarExcedentesEnBD(lote, config) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); 
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('BD-EXCEDENTES');
    if (!hoja) throw new Error("No se encontró la hoja 'BD-EXCEDENTES'");

    const filasParaInsertar = lote.map(item => {
      return [
        item.idUnico,        // Col A: Folio Único
        config.fecha,        // Col B: Fecha
        config.hora,         // Col C: Hora
        item.id,             // Col D: ID PRODUCTO (Viene del catálogo)
        item.codigo,         // Col E: Código
        item.descripcion,    // Col F: Descripción
        item.cantidad,       // Col G: Cantidad
        "DISPONIBLE",        // Col H: Estatus/Ubicación
        ""                   // Col I: Vacío
      ];
    });

    const ultimaFila = hoja.getLastRow();
    // Insertamos el bloque completo de datos (9 columnas de ancho)
    hoja.getRange(ultimaFila + 1, 1, filasParaInsertar.length, 9).setValues(filasParaInsertar);
    
    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    console.error("Error al guardar en BD-EXCEDENTES: " + e.message);
    throw new Error("Error en Base de Datos: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Obtiene todos los registros de la bitácora para el Historial
 * Mapea las 14 columnas del motor GOLD a objetos JSON
 */
function obtenerTodosLosRegistros() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('Bitacora-TRASPASOS');
    if (!hoja) return [];

    const ultimaFila = hoja.getLastRow();
    if (ultimaFila < 2) return [];

    // --- OPTIMIZACIÓN DE RENDIMIENTO ---
    // Cargamos solo los últimos 500 para evitar lentitud, pero puedes subirlo a 1000
    const limite = 500;
    const filaInicio = Math.max(2, ultimaFila - limite + 1);
    const numFilas = ultimaFila - filaInicio + 1;

    // Leemos el rango exacto (A-N son 14 columnas)
    const data = hoja.getRange(filaInicio, 1, numFilas, 14).getValues();
    const zonaHoraria = ss.getSpreadsheetTimeZone();

    // Procesamos y revertimos para que lo más nuevo esté arriba
    return data.map((f, index) => {
      // El ID de fila debe ser absoluto respecto a la hoja de cálculo
      const filaReal = filaInicio + index; 

      return {
        fila: filaReal,
        // Formateo estricto de fecha y hora para evitar errores en el HTML
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
        // Manejo especial para Folio (Col M) y Responsable (Col N)
        folio: (f[12] === "" || f[12] === undefined) ? "" : f[12],
        responsable: (f[13] === "" || f[13] === undefined) ? "Sin asignar" : f[13],
        // Propiedad para el agrupador visual en el HTML
        bodegaOriginal: f[2] === "Acomodo" ? (f[6] || "General") : (f[4] || "General")
      };
    }).reverse(); 

  } catch (e) {
    console.error("Error en obtenerTodosLosRegistros: " + e.toString());
    return [];
  }
}

/**
 * Actualiza una fila completa desde la edición manual del Historial
 */
function actualizarRegistroDesdeHistorialCompleto(numFila, datos) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('Bitacora-TRASPASOS');
    
    // Mapeo según COL_BT del motor GOLD
    // datos viene del frontend con: folio, responsable, origen, destino, cantidad, serie
    
    const rango = hoja.getRange(numFila, 1, 1, 14);
    
    // Actualizamos solo las columnas permitidas en la edición
    hoja.getRange(numFila, 4).setValue(datos.serie.toUpperCase());       // Col D (Serie)
    hoja.getRange(numFila, 5).setValue(datos.origen);                    // Col E (Origen)
    hoja.getRange(numFila, 7).setValue(datos.destino);                   // Col G (Destino)
    hoja.getRange(numFila, 12).setValue(Number(datos.cantidad));        // Col L (Cantidad)
    hoja.getRange(numFila, 13).setValue(datos.folio.toUpperCase());      // Col M (Folio)
    hoja.getRange(numFila, 14).setValue(datos.responsable.toUpperCase());// Col N (Responsable)

    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    throw new Error("Error al actualizar: " + e.message);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Obtiene de forma paralela la información de Bitacora-TRASPASOS y BD-EXCEDENTES.
 * Imprime un mapa analítico en consola y entrega los datos estructurados.
 * @return {Object} Contenedor con listas 'movimientosBitacora' y 'baseExcedentes'
 */
function obtenerInformacionExcedentes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const respuestaMaestra = {
    movimientosBitacora: [],
    baseExcedentes: []
  };

  // --- BLOQUE 1: PROCESAMIENTO DE BITÁCORA TRASPASOS ---
  try {
    const hojaBT = ss.getSheetByName('Bitacora-TRASPASOS');
    if (hojaBT) {
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
            } catch(e) { fechaProcesada = ""; }

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
    }
  } catch (err) {
    console.error("❌ Fallo crítico leyendo Bitacora-TRASPASOS: " + err.message);
  }

  // --- BLOQUE 2: PROCESAMIENTO DE BD-EXCEDENTES ---
  try {
    const hojaBD = ss.getSheetByName('BD-EXCEDENTES');
    if (hojaBD) {
      const valoresBD = hojaBD.getDataRange().getValues();
      if (valoresBD.length > 1) {
        respuestaMaestra.baseExcedentes = valoresBD.slice(1)
          .filter(fila => fila[COL_BDEXCED.IDUNICO - 1]) // Asegurar que tenga ID único para evitar filas muertas
          .map((fila, index) => {
            let fechaProcesada = "";
            try {
              if (fila[COL_BDEXCED.FECHA - 1] instanceof Date) {
                fechaProcesada = Utilities.formatDate(fila[COL_BDEXCED.FECHA - 1], "GMT-6", "yyyy-MM-dd");
              } else if (fila[COL_BDEXCED.FECHA - 1]) {
                fechaProcesada = String(fila[COL_BDEXCED.FECHA - 1]);
              }
            } catch(e) { fechaProcesada = ""; }

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
    }
  } catch (err) {
    console.error("❌ Fallo crítico leyendo BD-EXCEDENTES: " + err.message);
  }

  // --- BLOQUE 3: MAPEO ANALÍTICO POR CONSOLA (DIAGNÓSTICO PREMIUM) ---
  ejecutarMapeoConsola(respuestaMaestra);

  return respuestaMaestra;
}

/**
 * Genera un reporte pulcro y formateado en la consola del servidor con métricas de la carga.
 * @param {Object} datos 
 */
function ejecutarMapeoConsola(datos) {
  const totalBitacora = datos.movimientosBitacora.length;
  const totalExcedentesBase = datos.baseExcedentes.length;
  
  console.log("======================================================");
  console.log("📊 REPORTE DE EXTRACCIÓN Y CONSOLIDACIÓN DE DATOS");
  console.log("======================================================");
  console.log(`⏱️ Timestamp Ejecución: ${Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd HH:mm:ss")}`);
  console.log(`📥 Registros procesados en Bitacora-TRASPASOS: ${totalBitacora}`);
  console.log(`📥 Registros consolidados en BD-EXCEDENTES: ${totalExcedentesBase}`);
  console.log("------------------------------------------------------");
  
  if (totalExcedentesBase > 0) {
    console.log("🔍 Muestra del mapeo estructural (Primer Registro de BD-EXCEDENTES):");
    console.log(JSON.stringify(datos.baseExcedentes, null, 2));
    
    // Auditoría de integridad básica en caliente
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