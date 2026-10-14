/**
 * z2-MaxMinRepository
 *
 * @fileoverview Repositorio de solo lectura para la parametrización de niveles
 * mínimos y máximos de inventario almacenada en la fuente lógica MAXMIN.
 *
 * Centraliza la lectura, validación y normalización de los parámetros por código.
 * Mantiene una caché local durante la ejecución actual de Google Apps Script y
 * entrega copias defensivas para impedir que los consumidores modifiquen el
 * estado interno del repositorio.
 *
 * Dependencias globales:
 * - COL.MAXMIN.CODIGO, COL.MAXMIN.MINIMO y COL.MAXMIN.MAXIMO.
 * - getRowsByKey_(sourceKey).
 * - toStrUpper_(value) y toNum_(value).
 * - Consola de Google Apps Script para mensajes de diagnóstico.
 *
 * Reglas de mantenimiento:
 * - La clave lógica de la fuente es MAXMIN.
 * - CODIGO identifica un registro válido y no debe estar vacío.
 * - MINIMO y MAXIMO se normalizan como valores numéricos.
 * - Los registros con parámetros son aquellos donde MINIMO o MAXIMO es mayor
 *   que cero. Esta regla conserva el comportamiento histórico del módulo.
 * - Los registros sin parámetros tienen MINIMO y MAXIMO menores o iguales a cero.
 * - La caché es local a la ejecución y no sustituye CacheService.
 * - clearCache() debe invocarse si la fuente cambia dentro de la misma ejecución.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const MaxMinRepository = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    SOURCE_KEY: "MAXMIN",
    LOG_PREFIX: "[MaxMinRepository]"
  });

  /** @private @const {!Array<string>} */
  const REQUIRED_COLUMNS = Object.freeze([
    "CODIGO",
    "MINIMO",
    "MAXIMO"
  ]);

  /** @private @const {!Array<string>} */
  const PROJECTABLE_FIELDS = Object.freeze([
    "codigo",
    "minimo",
    "maximo"
  ]);

  /**
   * Caché normalizada de la ejecución actual.
   *
   * @private
   * @type {?Array<!Object>}
   */
  let cache_ = null;

  /**
   * Verifica la existencia de las funciones globales requeridas.
   *
   * @return {void}
   * @throws {Error} Si falta alguna dependencia funcional.
   * @private
   */
  function _validateDependencies_() {
    const dependencyStatus = [
      ["getRowsByKey_", typeof getRowsByKey_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_]
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
   * Obtiene y valida el contrato de columnas de la fuente MAXMIN.
   *
   * @return {!Object} Mapa validado de índices de columna.
   * @throws {Error} Si la configuración no existe, está incompleta o contiene
   *   índices inválidos o duplicados.
   * @private
   */
  function _getColumns_() {
    if (
      typeof COL === "undefined" ||
      !COL ||
      !COL.MAXMIN ||
      typeof COL.MAXMIN !== "object"
    ) {
      throw new Error(`${CFG.LOG_PREFIX} No existe COL.MAXMIN.`);
    }

    const columns = COL.MAXMIN;
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
          `${CFG.LOG_PREFIX} COL.MAXMIN.${columnName} contiene el índice ` +
            `inválido "${index}".`
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
   * Lee todas las filas de la fuente lógica configurada.
   *
   * @return {!Array<!Array<*>>} Filas físicas obtenidas del origen.
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
   * @param {!Array<*>} row Fila física del origen.
   * @param {number=} rowIndex Índice base cero empleado para diagnóstico.
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
      codigo: toStrUpper_(row[columns.CODIGO]),
      minimo: toNum_(row[columns.MINIMO]),
      maximo: toNum_(row[columns.MAXIMO])
    });
  }

  /**
   * Crea una copia independiente de una entidad almacenada en caché.
   *
   * @param {!Object} item Entidad normalizada.
   * @return {!Object} Copia segura para el consumidor.
   * @private
   */
  function _copyItem_(item) {
    return {
      codigo: item.codigo,
      minimo: item.minimo,
      maximo: item.maximo
    };
  }

  /**
   * Obtiene y normaliza el origen una sola vez durante la ejecución actual.
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
   * Proyecta una propiedad permitida de los registros normalizados.
   *
   * @param {string} field Propiedad que se desea proyectar.
   * @return {!Array<*>} Valores en el orden físico de la fuente.
   * @throws {Error} Si la propiedad solicitada no pertenece al contrato.
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
   * Filtra registros utilizando un predicado y devuelve copias defensivas.
   *
   * @param {function(!Object): boolean} predicate Criterio de selección.
   * @return {!Array<!Object>} Copias de los registros coincidentes.
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
   * Compara dos registros por código con orden numérico y reglas de español.
   *
   * @param {!Object} left Primer registro.
   * @param {!Object} right Segundo registro.
   * @return {number} Resultado compatible con Array.prototype.sort().
   * @private
   */
  function _compareByCode_(left, right) {
    return left.codigo.localeCompare(right.codigo, "es-MX", {
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
   * Busca registros mediante una coincidencia exacta de código normalizado.
   *
   * @param {*} codigo Código que se desea localizar.
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

  /**
   * Devuelve los registros cuyo nivel mínimo es mayor que cero.
   *
   * @return {!Array<!Object>} Registros con mínimo configurado.
   */
  function getConMinimo() {
    return _filterAndCopy_(function (item) {
      return item.minimo > 0;
    });
  }

  /**
   * Devuelve los registros cuyo nivel máximo es mayor que cero.
   *
   * @return {!Array<!Object>} Registros con máximo configurado.
   */
  function getConMaximo() {
    return _filterAndCopy_(function (item) {
      return item.maximo > 0;
    });
  }

  /**
   * Devuelve registros con al menos un parámetro positivo.
   *
   * A pesar del nombre histórico, no exige que ambos valores sean positivos;
   * conserva la regla existente: MINIMO > 0 o MAXIMO > 0.
   *
   * @return {!Array<!Object>} Registros total o parcialmente parametrizados.
   */
  function getConParametros() {
    return _filterAndCopy_(function (item) {
      return item.minimo > 0 || item.maximo > 0;
    });
  }

  /**
   * Devuelve registros sin niveles positivos configurados.
   *
   * @return {!Array<!Object>} Registros con mínimo y máximo menores o iguales a
   *   cero.
   */
  function getSinParametros() {
    return _filterAndCopy_(function (item) {
      return item.minimo <= 0 && item.maximo <= 0;
    });
  }

  /** @return {!Array<string>} Códigos en el orden físico de la fuente. */
  function getCodigos() {
    return _getField_("codigo");
  }

  /** @return {!Array<number>} Niveles mínimos en el orden físico de la fuente. */
  function getMinimos() {
    return _getField_("minimo");
  }

  /** @return {!Array<number>} Niveles máximos en el orden físico de la fuente. */
  function getMaximos() {
    return _getField_("maximo");
  }

  /**
   * Invalida la caché local para forzar una nueva lectura en la próxima consulta.
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
    getConMinimo,
    getConMaximo,
    getConParametros,
    getSinParametros,
    getCodigos,
    getMinimos,
    getMaximos,
    clearCache
  });
})();
