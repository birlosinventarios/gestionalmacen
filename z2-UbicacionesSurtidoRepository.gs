/**
 * z2-UbicacionesSurtidoRepository
 *
 * @fileoverview Repositorio de solo lectura para la fuente lógica
 * UBICACIONES_SURTIDO.
 *
 * Centraliza la lectura, validación, normalización y consulta de ubicaciones de
 * surtido asociadas a productos. Mantiene una caché local durante la ejecución
 * actual de Google Apps Script y devuelve copias defensivas para impedir que el
 * código consumidor modifique accidentalmente el estado interno.
 *
 * Dependencias globales:
 * - getRowsByKey_(sourceKey).
 * - toNum_(value) y toStrUpper_(value).
 * - COL.UBICACIONES_SURTIDO con los índices de las columnas requeridas.
 *
 * Reglas de mantenimiento:
 * - La clave lógica de la fuente es UBICACIONES_SURTIDO.
 * - CODIGO identifica un registro utilizable y no debe estar vacío.
 * - IDUBICACION, BODEGA, PASILLO, ANAQUEL, REPISA e IDPRODUCTO se normalizan
 *   como valores numéricos para conservar el contrato histórico.
 * - CODIGO y UBICACION se normalizan en mayúsculas.
 * - Las consultas con criterios textuales vacíos devuelven [].
 * - Las consultas numéricas rechazan valores vacíos, no finitos o negativos.
 * - Las proyecciones conservan duplicados y el orden físico de la fuente.
 * - La caché es local a la ejecución y no sustituye CacheService.
 * - clearCache() debe invocarse cuando la fuente cambie en la misma ejecución.
 *
 * @author Sigifredo de la Cruz Ramos
 */
const UbicacionesSurtidoRepository = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    SOURCE_KEY: "UBICACIONES_SURTIDO",
    LOCALE: "es-MX",
    LOG_PREFIX: "[UbicacionesSurtidoRepository]"
  });

  /** @private @const {!Array<string>} */
  const REQUIRED_COLUMNS = Object.freeze([
    "IDUBICACION",
    "CODIGO",
    "BODEGA",
    "PASILLO",
    "ANAQUEL",
    "REPISA",
    "IDPRODUCTO",
    "UBICACION"
  ]);

  /** @private @const {!Array<string>} */
  const PROJECTABLE_FIELDS = Object.freeze([
    "bodega",
    "pasillo",
    "anaquel",
    "repisa",
    "ubicacion"
  ]);

  /**
   * Caché normalizada de la ejecución actual.
   *
   * null indica que la fuente aún no se ha leído o que la caché fue invalidada.
   * Un arreglo vacío representa una lectura válida sin registros utilizables.
   *
   * @private
   * @type {?Array<!Object>}
   */
  let cache_ = null;

  /**
   * Verifica que las dependencias funcionales requeridas estén disponibles.
   *
   * @return {void}
   * @throws {Error} Si falta alguna dependencia global.
   * @private
   */
  function _validateDependencies_() {
    const dependencyStatus = [
      ["getRowsByKey_", typeof getRowsByKey_],
      ["toNum_", typeof toNum_],
      ["toStrUpper_", typeof toStrUpper_]
    ];

    const missingFunctions = dependencyStatus
      .filter(function (dependency) {
        return dependency[1] !== "function";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingFunctions.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan dependencias globales: ` +
          `${missingFunctions.join(", ")}.`
      );
    }
  }

  /**
   * Obtiene y valida el contrato físico de columnas.
   *
   * @return {!Object} Mapa validado de índices de columna.
   * @throws {Error} Si la configuración es inexistente, incompleta o ambigua.
   * @private
   */
  function _getColumns_() {
    if (
      typeof COL === "undefined" ||
      !COL ||
      !COL.UBICACIONES_SURTIDO ||
      typeof COL.UBICACIONES_SURTIDO !== "object"
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} No existe COL.UBICACIONES_SURTIDO.`
      );
    }

    const columns = COL.UBICACIONES_SURTIDO;
    const missingColumns = REQUIRED_COLUMNS.filter(function (columnName) {
      return !Object.prototype.hasOwnProperty.call(columns, columnName);
    });

    if (missingColumns.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan columnas requeridas: ` +
          `${missingColumns.join(", ")}.`
      );
    }

    const usedIndexes = Object.create(null);
    REQUIRED_COLUMNS.forEach(function (columnName) {
      const index = columns[columnName];

      if (!Number.isInteger(index) || index < 0) {
        throw new Error(
          `${CFG.LOG_PREFIX} COL.UBICACIONES_SURTIDO.${columnName} contiene ` +
            `el índice inválido "${index}".`
        );
      }

      if (Object.prototype.hasOwnProperty.call(usedIndexes, index)) {
        throw new Error(
          `${CFG.LOG_PREFIX} Las columnas ${usedIndexes[index]} y ` +
            `${columnName} comparten el índice ${index}.`
        );
      }

      usedIndexes[index] = columnName;
    });

    return columns;
  }

  /**
   * Lee todas las filas físicas de la fuente configurada.
   *
   * @return {!Array<!Array<*>>} Filas obtenidas del origen.
   * @throws {Error} Si la fuente no devuelve un arreglo.
   * @private
   */
  function _readSource_() {
    _validateDependencies_();
    _getColumns_();

    const rows = getRowsByKey_(CFG.SOURCE_KEY);
    if (!Array.isArray(rows)) {
      throw new Error(
        `${CFG.LOG_PREFIX} La fuente ${CFG.SOURCE_KEY} no devolvió un arreglo.`
      );
    }

    return rows;
  }

  /**
   * Convierte una fila física al contrato normalizado del repositorio.
   *
   * @param {!Array<*>} row Fila física de UBICACIONES_SURTIDO.
   * @param {number=} rowIndex Índice base cero utilizado para diagnóstico.
   * @return {!Object} Entidad normalizada e inmutable.
   * @throws {TypeError} Si la fila no es un arreglo.
   * @private
   */
  function _normalizeRow_(row, rowIndex = -1) {
    if (!Array.isArray(row)) {
      const position = rowIndex >= 0 ? ` en el índice ${rowIndex}` : "";
      throw new TypeError(
        `${CFG.LOG_PREFIX} La fila${position} tiene un formato inválido.`
      );
    }

    const columns = _getColumns_();
    return Object.freeze({
      idubicacion: toNum_(row[columns.IDUBICACION]),
      codigo: toStrUpper_(row[columns.CODIGO]),
      bodega: toNum_(row[columns.BODEGA]),
      pasillo: toNum_(row[columns.PASILLO]),
      anaquel: toNum_(row[columns.ANAQUEL]),
      repisa: toNum_(row[columns.REPISA]),
      idproducto: toNum_(row[columns.IDPRODUCTO]),
      ubicacion: toStrUpper_(row[columns.UBICACION])
    });
  }

  /**
   * Crea una copia independiente de una entidad almacenada en caché.
   *
   * @param {!Object} item Entidad normalizada.
   * @return {!Object} Copia defensiva para el consumidor.
   * @private
   */
  function _copyItem_(item) {
    return {
      idubicacion: item.idubicacion,
      codigo: item.codigo,
      bodega: item.bodega,
      pasillo: item.pasillo,
      anaquel: item.anaquel,
      repisa: item.repisa,
      idproducto: item.idproducto,
      ubicacion: item.ubicacion
    };
  }

  /**
   * Obtiene la colección normalizada y la conserva durante la ejecución actual.
   *
   * @return {!Array<!Object>} Caché interna; no debe exponerse directamente.
   * @private
   */
  function _getCachedData_() {
    if (cache_ !== null) {
      return cache_;
    }

    cache_ = _readSource_()
      .map(function (row, index) {
        return _normalizeRow_(row, index);
      })
      .filter(function (item) {
        return Boolean(item.codigo);
      });

    console.log(
      `${CFG.LOG_PREFIX} Caché cargada: ${cache_.length} registro(s).`
    );

    return cache_;
  }

  /**
   * Filtra la caché y devuelve copias independientes.
   *
   * @param {function(!Object): boolean} predicate Criterio de selección.
   * @return {!Array<!Object>} Coincidencias como copias defensivas.
   * @private
   */
  function _filterAndCopy_(predicate) {
    if (typeof predicate !== "function") {
      throw new TypeError(
        `${CFG.LOG_PREFIX} El criterio de filtrado debe ser una función.`
      );
    }

    return _getCachedData_().filter(predicate).map(_copyItem_);
  }

  /**
   * Proyecta una propiedad pública permitida.
   *
   * @param {string} field Propiedad por proyectar.
   * @return {!Array<*>} Valores en el orden físico de la fuente.
   * @throws {Error} Si el campo solicitado no está autorizado.
   * @private
   */
  function _getField_(field) {
    if (!PROJECTABLE_FIELDS.includes(field)) {
      throw new Error(
        `${CFG.LOG_PREFIX} La proyección "${field}" no está permitida.`
      );
    }

    return _getCachedData_().map(function (item) {
      return item[field];
    });
  }

  /**
   * Normaliza un criterio numérico de consulta.
   *
   * Se evita interpretar una cadena vacía como cero. El valor cero se conserva
   * como criterio válido para mantener compatibilidad con datos históricos.
   *
   * @param {*} value Valor solicitado.
   * @return {?number} Número finito y no negativo, o null si no es válido.
   * @private
   */
  function _normalizeNumericFilter_(value) {
    if (value === null || typeof value === "undefined" || value === "") {
      return null;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      return null;
    }

    return toNum_(value);
  }

  /**
   * Compara registros por código con orden alfanumérico natural.
   *
   * @param {!Object} left Primer registro.
   * @param {!Object} right Segundo registro.
   * @return {number} Resultado compatible con Array.prototype.sort().
   * @private
   */
  function _compareByCode_(left, right) {
    return left.codigo.localeCompare(right.codigo, CFG.LOCALE, {
      numeric: true,
      sensitivity: "base"
    });
  }

  /**
   * Devuelve todos los registros válidos ordenados por código.
   *
   * @return {!Array<!Object>} Copias independientes ordenadas por código.
   */
  function getAll() {
    return _getCachedData_().map(_copyItem_).sort(_compareByCode_);
  }

  /**
   * Busca ubicaciones mediante coincidencia exacta de código normalizado.
   *
   * @param {*} codigo Código solicitado.
   * @return {!Array<!Object>} Coincidencias en el orden físico de la fuente.
   */
  function getPorCodigo(codigo) {
    const filter = toStrUpper_(codigo);
    if (!filter) {
      return [];
    }

    return _filterAndCopy_(function (item) {
      return item.codigo === filter;
    });
  }

  /** @param {*} bodega @return {!Array<!Object>} */
  function getPorBodega(bodega) {
    const filter = _normalizeNumericFilter_(bodega);
    if (filter === null) {
      return [];
    }
    return _filterAndCopy_(function (item) {
      return item.bodega === filter;
    });
  }

  /** @param {*} pasillo @return {!Array<!Object>} */
  function getPorPasillo(pasillo) {
    const filter = _normalizeNumericFilter_(pasillo);
    if (filter === null) {
      return [];
    }
    return _filterAndCopy_(function (item) {
      return item.pasillo === filter;
    });
  }

  /** @param {*} anaquel @return {!Array<!Object>} */
  function getPorAnaquel(anaquel) {
    const filter = _normalizeNumericFilter_(anaquel);
    if (filter === null) {
      return [];
    }
    return _filterAndCopy_(function (item) {
      return item.anaquel === filter;
    });
  }

  /** @param {*} repisa @return {!Array<!Object>} */
  function getPorRepisa(repisa) {
    const filter = _normalizeNumericFilter_(repisa);
    if (filter === null) {
      return [];
    }
    return _filterAndCopy_(function (item) {
      return item.repisa === filter;
    });
  }

  /** @param {*} idproducto @return {!Array<!Object>} */
  function getPorIdProducto(idproducto) {
    const filter = _normalizeNumericFilter_(idproducto);
    if (filter === null) {
      return [];
    }
    return _filterAndCopy_(function (item) {
      return item.idproducto === filter;
    });
  }

  /**
   * Busca ubicaciones mediante coincidencia exacta del texto normalizado.
   *
   * @param {*} ubicacion Ubicación solicitada.
   * @return {!Array<!Object>} Coincidencias en el orden físico de la fuente.
   */
  function getPorUbicacion(ubicacion) {
    const filter = toStrUpper_(ubicacion);
    if (!filter) {
      return [];
    }

    return _filterAndCopy_(function (item) {
      return item.ubicacion === filter;
    });
  }

  /** @return {!Array<number>} Bodegas en orden físico, incluidos duplicados. */
  function getBodegas() {
    return _getField_("bodega");
  }

  /** @return {!Array<number>} Pasillos en orden físico, incluidos duplicados. */
  function getPasillos() {
    return _getField_("pasillo");
  }

  /** @return {!Array<number>} Anaqueles en orden físico, incluidos duplicados. */
  function getAnaqueles() {
    return _getField_("anaquel");
  }

  /** @return {!Array<number>} Repisas en orden físico, incluidos duplicados. */
  function getRepisas() {
    return _getField_("repisa");
  }

  /** @return {!Array<string>} Ubicaciones en orden físico, incluidos duplicados. */
  function getUbicaciones() {
    return _getField_("ubicacion");
  }

  /**
   * Invalida la caché local para que la siguiente consulta relea la fuente.
   *
   * @return {void}
   */
  function clearCache() {
    cache_ = null;
    console.log(`${CFG.LOG_PREFIX} Caché invalidada.`);
  }

  return Object.freeze({
    getAll,
    getPorCodigo,
    getPorBodega,
    getPorPasillo,
    getPorAnaquel,
    getPorRepisa,
    getPorIdProducto,
    getPorUbicacion,
    getBodegas,
    getPasillos,
    getAnaqueles,
    getRepisas,
    getUbicaciones,
    clearCache
  });
})();
