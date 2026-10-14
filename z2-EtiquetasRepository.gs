/**
 * z2-EtiquetasRepository
 *
 * @fileoverview Repositorio de solo lectura para el catálogo de etiquetas.
 *
 * Obtiene los registros de la fuente lógica ETIQUETAS, valida las dependencias
 * estructurales, normaliza cada fila y mantiene una caché local durante la
 * ejecución actual de Google Apps Script. La API pública devuelve copias de las
 * entidades para impedir que código consumidor modifique accidentalmente la
 * caché interna.
 *
 * Dependencias globales:
 * - COL.ETIQUETAS.NOMBRE, COL.ETIQUETAS.ANCHO y COL.ETIQUETAS.ALTO.
 * - getRowsByKey_(sourceKey).
 * - toStrUpper_(value) y toNum_(value).
 * - Consola de Google Apps Script para mensajes de diagnóstico.
 *
 * Reglas de mantenimiento:
 * - La clave lógica de la fuente es ETIQUETAS.
 * - NOMBRE identifica un registro válido y no debe estar vacío.
 * - ANCHO y ALTO se normalizan como valores numéricos.
 * - La caché es local a la ejecución; no sustituye CacheService.
 * - Los métodos públicos no exponen referencias mutables de la caché interna.
 * - clearCache() debe ejecutarse cuando la fuente cambie dentro de la misma
 *   ejecución y sea necesario volver a leerla.
 *
 * @author Sigifredo de la Cruz Ramos
 */
const EtiquetasRepository = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    SOURCE_KEY: "ETIQUETAS",
    LOG_PREFIX: "[EtiquetasRepository]"
  });

  /**
   * Caché normalizada de la ejecución actual.
   *
   * @private
   * @type {?Array<!Object>}
   */
  let cache_ = null;

  /**
   * Verifica que las dependencias y los índices de columna requeridos existan.
   *
   * @return {void}
   * @throws {Error} Si falta una función global o la configuración de columnas.
   * @private
   */
  function _validateDependencies_() {
    if (typeof getRowsByKey_ !== "function") {
      throw new Error(
        `${CFG.LOG_PREFIX} No existe la dependencia getRowsByKey_().`
      );
    }

    if (typeof toStrUpper_ !== "function" || typeof toNum_ !== "function") {
      throw new Error(
        `${CFG.LOG_PREFIX} No existen las utilidades de normalización requeridas.`
      );
    }

    if (
      typeof COL === "undefined" ||
      !COL ||
      !COL.ETIQUETAS ||
      !Number.isInteger(COL.ETIQUETAS.NOMBRE) ||
      !Number.isInteger(COL.ETIQUETAS.ANCHO) ||
      !Number.isInteger(COL.ETIQUETAS.ALTO)
    ) {
      throw new Error(
        `${CFG.LOG_PREFIX} La configuración COL.ETIQUETAS es inválida o incompleta.`
      );
    }
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

    const rows = getRowsByKey_(CFG.SOURCE_KEY);
    if (!Array.isArray(rows)) {
      throw new Error(
        `${CFG.LOG_PREFIX} La fuente ${CFG.SOURCE_KEY} no devolvió un arreglo.`
      );
    }

    return rows;
  }

  /**
   * Convierte una fila física al contrato normalizado de una etiqueta.
   *
   * @param {!Array<*>} row Fila física del origen de datos.
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

    return Object.freeze({
      nombre: toStrUpper_(row[COL.ETIQUETAS.NOMBRE]),
      ancho: toNum_(row[COL.ETIQUETAS.ANCHO]),
      alto: toNum_(row[COL.ETIQUETAS.ALTO])
    });
  }

  /**
   * Obtiene la colección normalizada y la conserva en memoria durante la
   * ejecución actual.
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
        return Boolean(item.nombre);
      });

    console.log(
      `${CFG.LOG_PREFIX} Caché cargada: ${cache_.length} registro(s).`
    );

    return cache_;
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
      nombre: item.nombre,
      ancho: item.ancho,
      alto: item.alto
    };
  }

  /**
   * Compara dos etiquetas por nombre utilizando orden lexicográfico en español.
   *
   * @param {!Object} left Primera etiqueta.
   * @param {!Object} right Segunda etiqueta.
   * @return {number} Resultado compatible con Array.prototype.sort().
   * @private
   */
  function _compareByName_(left, right) {
    return left.nombre.localeCompare(right.nombre, "es", {
      sensitivity: "base"
    });
  }

  /**
   * Devuelve todas las etiquetas válidas ordenadas alfabéticamente por nombre.
   *
   * El arreglo y sus objetos son copias independientes de la caché interna.
   *
   * @return {!Array<!Object>} Etiquetas normalizadas y ordenadas.
   */
  function getAll() {
    return _getCachedData_()
      .map(_copyItem_)
      .sort(_compareByName_);
  }

  /**
   * Busca etiquetas cuyo nombre contiene total o parcialmente el texto recibido.
   * La búsqueda no distingue entre mayúsculas y minúsculas debido a la
   * normalización previa con toStrUpper_().
   *
   * @param {*} nombre Texto completo o parcial que se desea localizar.
   * @return {!Array<!Object>} Coincidencias ordenadas por nombre; arreglo vacío
   *   cuando el criterio está vacío o no existen resultados.
   */
  function getPorNombre(nombre) {
    const searchText = toStrUpper_(nombre);
    if (!searchText) {
      return [];
    }

    return _getCachedData_()
      .filter(function (item) {
        return item.nombre.includes(searchText);
      })
      .map(_copyItem_)
      .sort(_compareByName_);
  }

  /**
   * Invalida la caché local para que la siguiente consulta vuelva a leer la
   * fuente de datos.
   *
   * @return {void}
   */
  function clearCache() {
    cache_ = null;
    console.log(`${CFG.LOG_PREFIX} Caché invalidada.`);
  }

  return Object.freeze({
    getAll,
    getPorNombre,
    clearCache
  });
})();
