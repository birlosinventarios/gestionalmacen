/**
 * ExcedentesRepository.gs
 *
 * Repositorio de solo lectura para la hoja BD-EXCEDENTES.
 *
 * Responsabilidades:
 * - Leer y normalizar los registros de excedentes.
 * - Exponer consultas por identificador, fecha, producto, código, estado y
 *   responsable de impresión.
 * - Proporcionar una lectura optimizada para la construcción del estado
 *   operativo de excedentes.
 * - Mantener una caché en memoria durante la ejecución actual.
 *
 * Consideraciones:
 * - Este Repository no registra ni modifica excedentes.
 * - RESPONSABLEIMPRESION debe ser escrito por la capa de persistencia que
 *   procesa la generación original de etiquetas.
 * - La identidad del responsable debe resolverse en el servidor y no debe
 *   confiarse a datos enviados por el navegador.
 *
 * Dependencias esperadas:
 * - Constants.gs
 * - UtilidadesDatos.gs
 * - SHEETS.EXCEDENTES
 * - COL.EXCEDENTES
 * - getRowsByKey_()
 * - getSheetByKey_()
 * - toStrUpper_()
 * - toDate_()
 * - toTime_()
 * - toNum_()
 * - sameDate_()
 * - sameTime_()
 */
const ExcedentesRepository = (() => {
  "use strict";

  const SHEET_KEY = "EXCEDENTES";
  const PERF_PREFIX = "[APPALMACEN][EXCEDENTES_REPOSITORY_PERF]";

  /**
   * Caché en memoria de la ejecución actual.
   *
   * No persiste entre ejecuciones independientes de Apps Script.
   * @type {Array<Object>|null}
   */
  let cache_ = null;

  /**
   * Normaliza un valor para búsquedas textuales insensibles a minúsculas.
   *
   * @param {*} value Valor de entrada.
   * @return {string}
   */
  function _normalizeText_(value) {
    return toStrUpper_(value || "");
  }

  /**
   * Calcula el ancho mínimo requerido para leer todos los campos definidos
   * en COL.EXCEDENTES, incluido RESPONSABLEIMPRESION.
   *
   * @return {number}
   */
  function _sourceWidth_() {
    const columns = COL && COL.EXCEDENTES;

    if (!columns) {
      throw new Error("No existe COL.EXCEDENTES.");
    }

    const indexes = Object.keys(columns).map(function(columnName) {
      return Number(columns[columnName]);
    });

    if (!indexes.length) {
      throw new Error("COL.EXCEDENTES no contiene índices configurados.");
    }

    indexes.forEach(function(index) {
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(
          "COL.EXCEDENTES contiene un índice inválido: " + index + "."
        );
      }
    });

    return Math.max.apply(null, indexes) + 1;
  }

  /**
   * Valida que el contrato mínimo requerido para RESPONSABLEIMPRESION exista.
   *
   * @return {boolean}
   */
  function _assertConfiguration_() {
    if (!COL || !COL.EXCEDENTES) {
      throw new Error("No existe COL.EXCEDENTES.");
    }

    if (!Number.isInteger(COL.EXCEDENTES.RESPONSABLEIMPRESION)) {
      throw new Error(
        "No existe COL.EXCEDENTES.RESPONSABLEIMPRESION o su índice no es válido."
      );
    }

    if (COL.EXCEDENTES.RESPONSABLEIMPRESION !== 8) {
      throw new Error(
        "RESPONSABLEIMPRESION debe ocupar el índice 8 de BD-EXCEDENTES."
      );
    }

    _sourceWidth_();
    return true;
  }

  /**
   * Lee todas las filas mediante la utilidad estándar del proyecto.
   *
   * @return {Array<Array<*>>}
   */
  function _readSource_() {
    _assertConfiguration_();
    return getRowsByKey_(SHEET_KEY);
  }

  /**
   * Lee las filas físicas requeridas para construir el estado de excedentes.
   *
   * La lectura incluye RESPONSABLEIMPRESION para que las capas consumidoras
   * puedan atribuir el origen de la impresión sin realizar una segunda lectura.
   *
   * @return {Array<Array<*>>}
   */
  function _readSourceForEstado_() {
    _assertConfiguration_();

    const sheet = getSheetByKey_(SHEET_KEY);
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return [];
    }

    return sheet
      .getRange(2, 1, lastRow - 1, _sourceWidth_())
      .getValues();
  }

  /**
   * Normaliza una fila completa de BD-EXCEDENTES.
   *
   * @param {Array<*>} row Fila física.
   * @param {number} rowNumber Número real de fila en la hoja.
   * @return {{
   *   rowNumber:number,
   *   idunico:string,
   *   fechaexcedente:*,
   *   horaexcedente:*,
   *   idproducto:string,
   *   codigo:string,
   *   descripcion:string,
   *   cantidad:number,
   *   status:string,
   *   responsableImpresion:string
   * }}
   */
  function _normalize_(row, rowNumber) {
    const source = Array.isArray(row) ? row : [];
    const columns = COL.EXCEDENTES;

    return {
      rowNumber: Number(rowNumber || 0),
      idunico: _normalizeText_(source[columns.IDUNICO]),
      fechaexcedente: toDate_(source[columns.FECHA] || ""),
      horaexcedente: toTime_(source[columns.HORA] || ""),
      idproducto: _normalizeText_(source[columns.IDPRODUCTO]),
      codigo: _normalizeText_(source[columns.CODIGO]),
      descripcion: _normalizeText_(source[columns.DESCRIPCION]),
      cantidad: toNum_(source[columns.CANTIDAD] || 0),
      status: _normalizeText_(source[columns.STATUS]),
      responsableImpresion: _normalizeText_(
        source[columns.RESPONSABLEIMPRESION]
      )
    };
  }

  /**
   * Normaliza una fila para la consolidación del estado de excedentes.
   *
   * @param {Array<*>} row Fila física.
   * @return {Object}
   */
  function _normalizeForEstado_(row) {
    const source = Array.isArray(row) ? row : [];
    const columns = COL.EXCEDENTES;
    const fecha = source[columns.FECHA];
    const hora = source[columns.HORA];

    return {
      idunico: _normalizeText_(source[columns.IDUNICO]),
      fechaexcedente: fecha instanceof Date ? fecha : toDate_(fecha),
      horaexcedente: hora instanceof Date ? hora : toTime_(hora),
      idproducto: _normalizeText_(source[columns.IDPRODUCTO]),
      codigo: _normalizeText_(source[columns.CODIGO]),
      descripcion: _normalizeText_(source[columns.DESCRIPCION]),
      cantidad: toNum_(source[columns.CANTIDAD] || 0),
      status: _normalizeText_(source[columns.STATUS]),
      responsableImpresion: _normalizeText_(
        source[columns.RESPONSABLEIMPRESION]
      )
    };
  }

  /**
   * Obtiene y normaliza todo el origen una sola vez por ejecución.
   *
   * @return {Array<Object>}
   */
  function _getData_() {
    if (cache_ !== null) {
      return cache_;
    }

    const source = _readSource_();

    cache_ = source
      .map(function(row, index) {
        return _normalize_(row, index + 2);
      })
      .filter(function(item) {
        return Boolean(item.codigo);
      });

    console.log("[CACHE] Excedentes cargados", {
      total: cache_.length,
      conResponsableImpresion: cache_.filter(function(item) {
        return Boolean(item.responsableImpresion);
      }).length
    });

    return cache_;
  }

  /**
   * Devuelve una copia superficial del conjunto en memoria.
   *
   * @return {Array<Object>}
   */
  function _copyData_() {
    return _getData_().slice();
  }

  /**
   * Obtiene los valores de una propiedad normalizada.
   *
   * @param {string} field Nombre de propiedad.
   * @return {Array<*>}
   */
  function _getField_(field) {
    return _getData_().map(function(item) {
      return item[field];
    });
  }

  /**
   * Filtra por igualdad textual normalizada.
   *
   * @param {string} field Propiedad del objeto normalizado.
   * @param {*} value Valor buscado.
   * @return {Array<Object>}
   */
  function _filterByText_(field, value) {
    const filter = _normalizeText_(value);

    if (!filter) {
      return [];
    }

    return _getData_().filter(function(item) {
      return item[field] === filter;
    });
  }

  /**
   * Devuelve todos los excedentes ordenados por código.
   *
   * @return {Array<Object>}
   */
  function getAll() {
    return _copyData_().sort(function(a, b) {
      return a.codigo.localeCompare(b.codigo, "es", {
        numeric: true,
        sensitivity: "base"
      });
    });
  }

  /**
   * Devuelve todos los excedentes en su orden físico de origen.
   *
   * @return {Array<Object>}
   */
  function getAllRaw() {
    return _copyData_();
  }

  /**
   * Devuelve los excedentes necesarios para construir el estado operativo.
   *
   * Esta ruta evita la caché normal porque está instrumentada para medir
   * lectura y normalización de forma independiente.
   *
   * @return {Array<Object>}
   */
  function getAllForEstado() {
    const totalStartedAt = Date.now();
    const readStartedAt = Date.now();
    const source = _readSourceForEstado_();
    const readMs = Date.now() - readStartedAt;
    const normalizeStartedAt = Date.now();
    const result = [];
    let withPrintOwner = 0;

    for (let index = 0; index < source.length; index += 1) {
      const item = _normalizeForEstado_(source[index]);

      if (!item.idunico) {
        continue;
      }

      if (item.responsableImpresion) {
        withPrintOwner += 1;
      }

      result.push(item);
    }

    const normalizeMs = Date.now() - normalizeStartedAt;

    console.log(
      PERF_PREFIX + " " +
      JSON.stringify({
        operation: "GET_ALL_FOR_ESTADO",
        totalMs: Date.now() - totalStartedAt,
        readMs: readMs,
        normalizeMs: normalizeMs,
        sourceRows: source.length,
        resultRows: result.length,
        rowsWithPrintOwner: withPrintOwner,
        width: _sourceWidth_()
      })
    );

    return result;
  }

  /**
   * Devuelve los últimos registros según su orden físico.
   *
   * @param {number} limit Número máximo de registros.
   * @return {Array<Object>}
   */
  function getUltimos(limit) {
    const normalizedLimit = Math.max(0, Math.floor(Number(limit || 0)));

    if (!normalizedLimit) {
      return [];
    }

    return _getData_().slice(-normalizedLimit);
  }

  function getPorIdUnico(idunico) {
    return _filterByText_("idunico", idunico);
  }

  function getPorFecha(fechaexcedente) {
    return _getData_().filter(function(item) {
      return sameDate_(item.fechaexcedente, fechaexcedente);
    });
  }

  function getPorHora(horaexcedente) {
    return _getData_().filter(function(item) {
      return sameTime_(item.horaexcedente, horaexcedente);
    });
  }

  function getPorIdProducto(idproducto) {
    return _filterByText_("idproducto", idproducto);
  }

  function getPorCodigo(codigo) {
    return _filterByText_("codigo", codigo);
  }

  function getPorDescripcion(descripcion) {
    return _filterByText_("descripcion", descripcion);
  }

  function getPorStatus(status) {
    return _filterByText_("status", status);
  }

  /**
   * Devuelve los excedentes atribuidos al responsable de impresión indicado.
   *
   * @param {*} responsable Responsable normalizado.
   * @return {Array<Object>}
   */
  function getPorResponsableImpresion(responsable) {
    return _filterByText_("responsableImpresion", responsable);
  }

  function getIdProductos() {
    return _getField_("idproducto");
  }

  function getCodigos() {
    return _getField_("codigo");
  }

  function getIdUnicos() {
    return _getField_("idunico");
  }

  function getStatus() {
    return _getField_("status");
  }

  /**
   * Devuelve la columna normalizada de responsables de impresión.
   * Puede contener valores vacíos en registros históricos.
   *
   * @return {Array<string>}
   */
  function getResponsablesImpresion() {
    return _getField_("responsableImpresion");
  }

  /**
   * Invalida la caché en memoria de la ejecución actual.
   *
   * Debe ejecutarse después de insertar, actualizar o eliminar excedentes.
   *
   * @return {boolean}
   */
  function clearCache() {
    cache_ = null;
    console.log("[CACHE] Excedentes limpio");
    return true;
  }

  return Object.freeze({
    getAll: getAll,
    getAllRaw: getAllRaw,
    getAllForEstado: getAllForEstado,
    getUltimos: getUltimos,
    getPorIdUnico: getPorIdUnico,
    getPorFecha: getPorFecha,
    getPorHora: getPorHora,
    getPorIdProducto: getPorIdProducto,
    getPorCodigo: getPorCodigo,
    getPorDescripcion: getPorDescripcion,
    getPorStatus: getPorStatus,
    getPorResponsableImpresion: getPorResponsableImpresion,
    getIdProductos: getIdProductos,
    getCodigos: getCodigos,
    getIdUnicos: getIdUnicos,
    getStatus: getStatus,
    getResponsablesImpresion: getResponsablesImpresion,
    clearCache: clearCache
  });
})();
