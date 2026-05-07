/**
 * OPERACIONES.GS - VERSIÓN GOLD (OPTIMIZADA PARA 16K SKU)
 */

const COL_BITACORA = {
  FECHA: 1, HORA: 2, TIPO: 3, SERIE: 4, B_SALIDA: 5, U_SALIDA: 6,
  B_ENTRADA: 7, U_ENTRADA: 8, SOLICITANTE: 9, CODIGO: 10, 
  DESC: 11, CANT: 12, FOLIO: 13, RESP: 14, IDUNICO: 15
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

      const fila = new Array(14).fill("");
      fila[COL_BITACORA.FECHA - 1] = config.fecha;
      fila[COL_BITACORA.HORA - 1] = config.hora;
      fila[COL_BITACORA.TIPO - 1] = item.tipo;
      fila[COL_BITACORA.SERIE - 1] = (serie || "").toString().toUpperCase();
      fila[COL_BITACORA.B_SALIDA - 1] = bSalida;
      fila[COL_BITACORA.U_SALIDA - 1] = uSalida;
      fila[COL_BITACORA.B_ENTRADA - 1] = bEntrada;
      fila[COL_BITACORA.U_ENTRADA - 1] = uEntrada;
      fila[COL_BITACORA.SOLICITANTE - 1] = item.solicitante;
      fila[COL_BITACORA.CODIGO - 1] = item.codigo.toUpperCase();
      fila[COL_BITACORA.DESC - 1] = item.descripcion.toUpperCase();
      fila[COL_BITACORA.CANT - 1] = Number(item.cantidad);
      fila[COL_BITACORA.FOLIO - 1] = ""; 
      fila[COL_BITACORA.RESP - 1] = ""; 
      
      return fila;
    });

    const startRow = hoja.getLastRow() + 1;
    hoja.getRange(startRow, 1, filasParaInsertar.length, 14).setValues(filasParaInsertar);
    
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
    
    // Mapeo según COL_BITACORA del motor GOLD
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
 * Calcula el balance virtual basado en la concatenación de Serie + Codigo
 */
function obtenerBalanceVirtualExcedentes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Bitacora-Traspasos");
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  // Mapeo dinámico de columnas (para evitar errores si mueves las columnas)
  const col = {
    tipo: headers.indexOf("Tipo de movimiento"),
    serie: headers.indexOf("Serie"),
    codigo: headers.indexOf("Codigo"),
    desc: headers.indexOf("Descripcion"),
    cant: headers.indexOf("Cantidad"),
    bodega: headers.indexOf("Bodega Entrada")
  };

  const balanceMap = {};

  data.forEach(fila => {
    const serie = fila[col.serie];
    const codigo = fila[col.codigo];
    const idVirtual = `${serie}-${codigo}`; // TU IDENTIFICADOR MAESTRO
    
    const tipo = (fila[col.tipo] || "").toString().toLowerCase();
    const cantidad = Number(fila[col.cant]) || 0;

    // Si la llave no existe en el mapa, la inicializamos
    if (!balanceMap[idVirtual]) {
      balanceMap[idVirtual] = {
        idVirtual: idVirtual,
        codigo: codigo,
        serie: serie,
        descripcion: fila[col.desc],
        cantidad: 0,
        bodega: fila[col.bodega]
      };
    }

    // Lógica de Balance Virtual
    if (tipo.includes("acomodo")) {
      balanceMap[idVirtual].cantidad += cantidad;
    } else if (tipo.includes("surtido")) {
      balanceMap[idVirtual].cantidad -= cantidad;
    }
  });

  // Convertimos el mapa a un array y filtramos lo que tiene stock
  return Object.values(balanceMap).filter(item => item.cantidad > 0);
}

/**
 * Calcula el balance consolidado de inventario agrupado estrictamente por IDUNICO.
 */
function calcularBalancePorIDUnico() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const hoja = ss.getSheetByName('Bitacora-TRASPASOS') || ss.getSheetByName('Bitacora-Traspasos');
    
    if (!hoja) throw new Error("No se encontró la hoja 'Bitacora-TRASPASOS'");
    
    const valores = hoja.getDataRange().getValues();
    if (valores.length <= 1) return [];
    
    // Quitamos encabezados
    valores.shift();
    
    const mapaBalances = {};
    
    // Helper para obtener el índice correcto (ajustando el 1-based de tu config a 0-based de array)
    const getCol = (key) => COL_BITACORA[key] - 1;

    valores.forEach(fila => {
      // --- CORRECCIÓN CLAVE: Acceder por índices [n] ---
      const tipoMovimiento = String(fila[getCol('TIPO')] || "").trim().toUpperCase();
      const codigo = String(fila[getCol('CODIGO')] || "").trim();
      const descripcion = String(fila[getCol('DESC')] || "").trim();
      const cantidad = Number(fila[getCol('CANT')]) || 0; // Verifica si tu constante es CANT o CANTIDAD
      const idUnico = String(fila[getCol('IDUNICO')] || "").trim();
      
      const bEntrada = String(fila[getCol('B_ENTRADA')] || "").trim();
      const uEntrada = String(fila[getCol('U_ENTRADA')] || "").trim();

      // Saltamos registros sin ID Único asignado
      if (!idUnico) return;
      
      // Si el ID Único no ha sido registrado en el mapa, lo inicializamos
      if (!mapaBalances[idUnico]) {
        mapaBalances[idUnico] = {
          idUnico: idUnico,
          codigo: codigo,
          descripcion: descripcion,
          bodegaActual: bEntrada, 
          ubicacionActual: uEntrada,
          totalEntradas: 0,
          totalSalidas: 0,
          saldoDisponible: 0,
          historialMovimientos: 0
        };
      }
      
      // Lógica de ENTRADAS (Suman)
      if (tipoMovimiento.includes("ACOMODO") || tipoMovimiento.includes("ENTRADA") || tipoMovimiento.includes("INGRESO")) {
        mapaBalances[idUnico].totalEntradas += cantidad;
        
        // Actualizar ubicación a la última donde se acomodó
        if (bEntrada) mapaBalances[idUnico].bodegaActual = bEntrada;
        if (uEntrada) mapaBalances[idUnico].ubicacionActual = uEntrada;
      } 
      // Lógica de SALIDAS (Restan)
      else if (tipoMovimiento.includes("TRASPASO") || tipoMovimiento.includes("SALIDA") || tipoMovimiento.includes("SURTIDO")) {
        mapaBalances[idUnico].totalSalidas += cantidad;
      }
      
      mapaBalances[idUnico].historialMovimientos += 1;
    });
    
    // Convertir el mapa a un arreglo plano y calcular saldos finales
    const resultadoFinal = Object.values(mapaBalances).map(item => {
      item.saldoDisponible = item.totalEntradas - item.totalSalidas;
      return item;
    });
    
    // Solo enviamos los que tienen stock para no saturar el Gestor de Excedentes
    return resultadoFinal
      .filter(i => i.saldoDisponible > 0)
      .sort((a, b) => b.saldoDisponible - a.saldoDisponible);
    
  } catch (error) {
    console.error("Error en calcularBalancePorIDUnico: " + error.message);
    return [];
  }
}

function obtenerBalancesExcedentes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName('Bitacora-TRASPASOS') || ss.getSheetByName('Bitacora-Traspasos');
  if (!hoja) return [];

  const data = hoja.getDataRange().getValues();
  const mapaBalances = {};
  const getCol = (key) => COL_BITACORA[key] - 1;

  data.slice(1).forEach(fila => {
    const codigo = String(fila[getCol('CODIGO')]).trim();
    const serie = String(fila[getCol('SERIE')]).trim();
    let idUnico = String(fila[getCol('IDUNICO')]).trim();
    
    if (!idUnico) idUnico = `${codigo} | ${serie}`;
    if (!codigo) return;

    const tipo = String(fila[getCol('TIPO')]).toUpperCase();
    const cant = Number(fila[getCol('CANT')]) || 0;

    if (!mapaBalances[idUnico]) {
      mapaBalances[idUnico] = { idUnico, totalEntradas: 0, totalSalidas: 0, ubicacionActual: "" };
    }

    if (/ACOMODO|ENTRADA|INGRESO/.test(tipo)) {
      mapaBalances[idUnico].totalEntradas += cant;
      mapaBalances[idUnico].ubicacionActual = String(fila[getCol('U_ENTRADA')] || "");
    } else if (/TRASPASO|SALIDA|SURTIDO/.test(tipo)) {
      mapaBalances[idUnico].totalSalidas += cant;
    }
  });

  return Object.values(mapaBalances).map(item => {
    item.saldoDisponible = item.totalEntradas - item.totalSalidas;
    return item;
  });
}