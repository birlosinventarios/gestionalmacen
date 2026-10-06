/**
 * UsuariosRepository.gs
 *
 * Repositorio de solo lectura para la hoja lógica USUARIOS.
 *
 * Responsabilidades:
 * - Leer las filas de la fuente configurada con la clave "USUARIOS".
 * - Convertir cada fila física a un objeto de dominio normalizado.
 * - Mantener una caché en memoria durante la ejecución para evitar lecturas
 *   repetidas de la hoja.
 * - Exponer consultas por identificador, nombre y rol.
 * - Exponer proyecciones simples de identificadores, nombres y roles.
 * - Permitir la invalidación explícita de la caché local.
 *
 * Este repositorio no debe:
 * - Aplicar reglas de autorización.
 * - Filtrar usuarios por rol de forma implícita.
 * - Escribir, actualizar o eliminar registros en la hoja USUARIOS.
 * - Exponer directamente las filas físicas de la hoja.
 *
 * Dependencias globales:
 * - getRowsByKey_(sheetKey)
 * - toNum_(value)
 * - toStrUpper_(value)
 * - COL.USUARIOS.IDUSUARIOS
 * - COL.USUARIOS.NOMBRE
 * - COL.USUARIOS.ROL
 *
 * Contrato público:
 * - getAll()
 * - getPorId(idusuario)
 * - getPorNombre(nombre)
 * - getPorRol(rol)
 * - getIds()
 * - getNombres()
 * - getRoles()
 * - clearCache()
 */
const UsuariosRepository = (() => {
  /**
   * Clave lógica utilizada para localizar la fuente de usuarios.
   *
   * @type {string}
   * @const
   */
  const SOURCE_KEY = "USUARIOS";

  /**
   * Caché normalizada del repositorio.
   *
   * null indica que la fuente todavía no se ha leído o que la caché fue
   * invalidada. Un arreglo vacío representa una lectura válida sin usuarios.
   *
   * @type {Array<Object>|null}
   */
  let cache_ = null;

  /**
   * Lee todas las filas de la fuente configurada.
   *
   * La interpretación de encabezados, archivos y hojas corresponde a
   * getRowsByKey_().
   *
   * @return {Array<Array<*>>} Filas físicas de la hoja USUARIOS.
   * @private
   */
  function readSource_() {
    return getRowsByKey_(SOURCE_KEY);
  }

  /**
   * Convierte una fila física en el contrato de usuario del repositorio.
   *
   * Los textos se normalizan en mayúsculas para que las consultas posteriores
   * sean deterministas e independientes del formato capturado en la hoja.
   *
   * @param {Array<*>} fila Fila física obtenida desde la hoja.
   * @return {{idusuario:number,nombre:string,rol:string}} Usuario normalizado.
   * @private
   */
  function normalize_(fila) {
    return {
      idusuario: toNum_(fila[COL.USUARIOS.IDUSUARIOS] || ""),
      nombre: toStrUpper_(fila[COL.USUARIOS.NOMBRE] || ""),
      rol: toStrUpper_(fila[COL.USUARIOS.ROL] || "")
    };
  }

  /**
   * Obtiene la colección normalizada desde memoria o la construye en la
   * primera lectura.
   *
   * Solo se conservan registros con nombre. El repositorio no elimina
   * duplicados ni filtra por rol, ya que esas decisiones pertenecen a la capa
   * de dominio que consume los datos.
   *
   * @return {Array<Object>} Colección interna almacenada en caché.
   * @private
   */
  function getData_() {
    if (cache_ === null) {
      cache_ = readSource_()
        .map(normalize_)
        .filter(usuario => usuario.nombre);

      console.log("[CACHE] Usuarios cargados");
    }

    return cache_;
  }

  /**
   * Proyecta un campo de todos los usuarios almacenados en caché.
   *
   * Array.prototype.map() crea una colección nueva, por lo que el consumidor
   * no recibe una referencia directa al arreglo interno del repositorio.
   *
   * @param {string} field Nombre de la propiedad por proyectar.
   * @return {Array<*>} Valores correspondientes al campo solicitado.
   * @private
   */
  function getField_(field) {
    return getData_().map(usuario => usuario[field]);
  }

  /**
   * Devuelve todos los usuarios ordenados alfabéticamente por nombre.
   *
   * Se crea una copia antes de ordenar para evitar modificar el orden de la
   * colección interna almacenada en caché.
   *
   * @return {Array<Object>} Copia ordenada de los usuarios normalizados.
   */
  function getAll() {
    return [...getData_()].sort((a, b) =>
      a.nombre.localeCompare(b.nombre)
    );
  }

  /**
   * Busca usuarios por identificador numérico.
   *
   * Se conserva el retorno como arreglo para mantener compatibilidad con el
   * contrato original y permitir detectar identificadores duplicados.
   *
   * @param {*} idusuario Identificador recibido por el consumidor.
   * @return {Array<Object>} Usuarios cuyo identificador coincide.
   */
  function getPorId(idusuario) {
    const filtro = toNum_(idusuario || "");
    return getData_().filter(usuario => usuario.idusuario === filtro);
  }

  /**
   * Busca usuarios por nombre normalizado.
   *
   * @param {*} nombre Nombre recibido por el consumidor.
   * @return {Array<Object>} Usuarios cuyo nombre coincide exactamente.
   */
  function getPorNombre(nombre) {
    const filtro = toStrUpper_(nombre || "");
    return getData_().filter(usuario => usuario.nombre === filtro);
  }

  /**
   * Busca usuarios por rol normalizado.
   *
   * @param {*} rol Rol recibido por el consumidor.
   * @return {Array<Object>} Usuarios cuyo rol coincide exactamente.
   */
  function getPorRol(rol) {
    const filtro = toStrUpper_(rol || "");
    return getData_().filter(usuario => usuario.rol === filtro);
  }

  /**
   * Devuelve todos los identificadores presentes en la fuente normalizada.
   *
   * @return {Array<number>}
   */
  function getIds() {
    return getField_("idusuario");
  }

  /**
   * Devuelve todos los nombres presentes en la fuente normalizada.
   *
   * @return {Array<string>}
   */
  function getNombres() {
    return getField_("nombre");
  }

  /**
   * Devuelve todos los roles presentes en la fuente normalizada.
   *
   * @return {Array<string>}
   */
  function getRoles() {
    return getField_("rol");
  }

  /**
   * Invalida la caché local para que la siguiente consulta vuelva a leer la
   * fuente USUARIOS.
   *
   * @return {void}
   */
  function clearCache() {
    cache_ = null;
    console.log("[CACHE] Usuarios limpios");
  }

  return {
    getAll,
    getPorId,
    getPorNombre,
    getPorRol,
    getIds,
    getNombres,
    getRoles,
    clearCache
  };
})();
