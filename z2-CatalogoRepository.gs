/**
 * @fileoverview Repositorio de solo lectura para el catálogo de productos.
 *
 * Centraliza la lectura y normalización de la fuente lógica CATALOGO, mantiene una
 * caché por ejecución y ofrece consultas exactas y proyecciones de sus campos.
 * El repositorio no realiza operaciones de escritura sobre Google Sheets.
 *
 * Responsabilidades:
 * - Leer filas mediante getRowsByKey_("CATALOGO").
 * - Aplicar el contrato de columnas definido en COL.CATALOGO.
 * - Normalizar códigos, descripciones y estados en mayúsculas.
 * - Preservar IDPRODUCTO como texto.
 * - Excluir filas sin código y conservar duplicados explícitamente.
 * - Proteger la caché mediante copias defensivas en toda la API pública.
 *
 * Dependencias globales:
 * - getRowsByKey_(sheetKey)
 * - toStr_(value)
 * - toStrUpper_(value)
 * - COL.CATALOGO
 *
 * Consideraciones de mantenimiento:
 * - Un arreglo vacío es una lectura válida; null representa caché no inicializada.
 * - El orden físico se conserva internamente y getAll() devuelve una copia ordenada.
 * - Las búsquedas son exactas después de normalizar su criterio.
 * - No deben agregarse efectos secundarios ni escrituras a este repositorio.
 *
 * @author Sigifredo de la Cruz Ramos
 */
const CatalogoRepository = (() => {
  "use strict";

  /** @private @const {string} Clave lógica de la fuente de catálogo. */
  const SOURCE_KEY = "CATALOGO";

  /** @private @const {!Object<string, string>} Campos públicos permitidos. */
  const FIELDS = Object.freeze({
    ID_PRODUCTO: "idproducto",
    CODIGO: "codigo",
    DESCRIPCION: "descripcion",
    STATUS: "status"
  });

  /**
   * Caché normalizada de la ejecución actual.
   *
   * null indica que la fuente todavía no se ha leído o que la caché fue
   * invalidada. Un arreglo vacío representa una lectura válida sin productos.
   *
   * @private
   * @type {?Array<!Object>}
   */
  let cache_ = null;

  /**
   * Lee todas las filas físicas de la fuente CATALOGO.
   *
   * @return {Array<Array<*>>} Filas obtenidas por la utilidad de datos.
   * @private
   */
  function readSource_() {
    const rows = getRowsByKey_(SOURCE_KEY);
    if (!Array.isArray(rows)) {
      throw new TypeError(
        `getRowsByKey_("${SOURCE_KEY}") debe devolver un arreglo de filas`
      );
    }
    return rows;
  }

  /**
   * Convierte una fila física al contrato normalizado del repositorio.
   *
   * @param {Array<*>} fila Fila física de CATALOGO.
   * @return {{
   *   idproducto:string,
   *   codigo:string,
   *   descripcion:string,
   *   status:string
   * }} Producto normalizado.
   * @private
   */
  function normalize_(fila) {
    if (!Array.isArray(fila)) {
      throw new TypeError("CATALOGO contiene una fila con formato inválido");
    }
    return {
      idproducto: toStr_(fila[COL.CATALOGO.IDPRODUCTO]),
      codigo: toStrUpper_(fila[COL.CATALOGO.CODIGO]),
      descripcion: toStrUpper_(fila[COL.CATALOGO.DESCRIPCION]),
      status: toStrUpper_(fila[COL.CATALOGO.STATUS])
    };
  }

  /**
   * Obtiene el catálogo normalizado desde caché o lo construye en la primera
   * lectura de la ejecución actual.
   *
   * Solo se conservan registros con código. La colección interna no se ordena
   * para preservar el orden físico usado por getAllRaw().
   *
   * @return {Array<Object>} Colección interna almacenada en caché.
   * @private
   */
  function getData_() {
    if (cache_ === null) {
      cache_ = readSource_()
        .map(normalize_)
        .filter(producto => producto.codigo);

      console.log("[CACHE] Catalogo cargado", { total: cache_.length });
    }

    return cache_;
  }

  /**
   * Proyecta un campo de todos los productos normalizados.
   *
   * Array.prototype.map() entrega una colección nueva y evita exponer el
   * arreglo interno de la caché.
   *
   * @param {string} field Propiedad por proyectar.
   * @return {Array<*>} Valores del campo solicitado.
   * @private
   */
  /**
   * Genera una copia defensiva de una entidad de catálogo.
   * @param {!Object} producto
   * @return {!Object}
   * @private
   */
  function cloneProduct_(producto) {
    return { ...producto };
  }

  /**
   * Proyecta un campo permitido de todos los productos normalizados.
   *
   * @param {string} field Propiedad pública por proyectar.
   * @return {!Array<*>} Valores del campo solicitado.
   * @throws {RangeError} Si el campo no forma parte del contrato público.
   * @private
   */
  function getField_(field) {
    if (!Object.values(FIELDS).includes(field)) {
      throw new RangeError(`Campo de catálogo no permitido: ${field}`);
    }
    return getData_().map(producto => producto[field]);
  }

  /**
   * Devuelve todos los productos ordenados alfabéticamente por código.
   *
   * Se crea una copia antes de ordenar para no modificar la caché interna.
   *
   * @return {Array<Object>} Copia ordenada del catálogo.
   */
  function getAll() {
    return getData_()
      .map(cloneProduct_)
      .sort((a, b) => a.codigo.localeCompare(b.codigo, "es-MX"));
  }

  /**
   * Devuelve una copia superficial del catálogo en su orden normalizado.
   *
   * @return {Array<Object>}
   */
  function getAllRaw() {
    return getData_().map(cloneProduct_);
  }

  /** @return {Array<string>} Códigos normalizados del catálogo. */
  function getCodigos() {
    return getField_(FIELDS.CODIGO);
  }

  /** @return {Array<string>} Descripciones normalizadas del catálogo. */
  function getDescripciones() {
    return getField_(FIELDS.DESCRIPCION);
  }

  /** @return {Array<string>} Identificadores de producto del catálogo. */
  function getIdProductos() {
    return getField_(FIELDS.ID_PRODUCTO);
  }

  /** @return {Array<string>} Estados normalizados del catálogo. */
  function getStatus() {
    return getField_(FIELDS.STATUS);
  }

  /**
   * Busca productos por código normalizado.
   *
   * El retorno permanece como arreglo para conservar compatibilidad y hacer
   * visibles posibles códigos duplicados.
   *
   * @param {*} codigo Código solicitado.
   * @return {Array<Object>} Coincidencias exactas por código.
   */
  function getPorCodigo(codigo) {
    const filtro = toStrUpper_(codigo);
    return getData_()
      .filter(producto => producto.codigo === filtro)
      .map(cloneProduct_);
  }

  /**
   * Busca productos por IDPRODUCTO textual.
   *
   * @param {*} idproducto Identificador solicitado.
   * @return {Array<Object>} Coincidencias exactas por identificador.
   */
  function getPorIdProducto(idproducto) {
    const filtro = toStr_(idproducto);
    return getData_()
      .filter(producto => producto.idproducto === filtro)
      .map(cloneProduct_);
  }

  /**
   * Busca productos por descripción normalizada.
   *
   * @param {*} descripcion Descripción solicitada.
   * @return {Array<Object>} Coincidencias exactas por descripción.
   */
  function getPorDescripcion(descripcion) {
    const filtro = toStrUpper_(descripcion);
    return getData_()
      .filter(producto => producto.descripcion === filtro)
      .map(cloneProduct_);
  }

  /**
   * Busca productos por estado.
   *
   * El criterio se normaliza en mayúsculas, igual que los estados almacenados,
   * para mantener una comparación consistente con el resto de las consultas.
   *
   * @param {*} status Estado solicitado.
   * @return {Array<Object>} Coincidencias exactas por estado.
   */
  function getPorStatus(status) {
    const filtro = toStrUpper_(status);
    return getData_()
      .filter(producto => producto.status === filtro)
      .map(cloneProduct_);
  }

  /**
   * Invalida la caché local para que la siguiente consulta relea CATALOGO.
   *
   * @return {boolean} true cuando la caché queda invalidada.
   */
  function clearCache() {
    cache_ = null;
    console.log("[CACHE] Catalogo limpio");
    return true;
  }

  return Object.freeze({
    getAll,
    getAllRaw,
    getCodigos,
    getDescripciones,
    getIdProductos,
    getStatus,
    getPorCodigo,
    getPorIdProducto,
    getPorDescripcion,
    getPorStatus,
    clearCache
  });
})();
