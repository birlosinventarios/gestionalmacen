/**
 * UsuariosRepository.gs
 * Lectura de hoja USUARIOS
 */

const UsuariosRepository = (() => {

  function readSource_() {
    return getRows_(SHEETS.USUARIOS);
  }

  function normalize_(fila) {
    return {
      idusuario: toNum_(fila[COL.USUARIOS.IDUSUARIOS] || ""),
      nombre: toStrUpper_(fila[COL.USUARIOS.NOMBRE] || ""),
      rol: toStrUpper_(fila[COL.USUARIOS.ROL] || "")
    };
  }

  function getField_(field) {
    return getData_().map(x => x[field]);
  }

  // Lectura de todo el origen de datos una sola vez
  let cache_ = null;

  function getData_() {
    if (cache_ === null) {
      cache_ = readSource_()
        .map(normalize_)
        .filter(x => x.nombre);
      console.log("[CACHE] Usuarios cargados");
    }

    return cache_;
  }

  return {

    // Devuelve todas las usuarios  
    getAll: function() {
      return [...getData_()]
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    },

    // Devuelve todos los datos del usuario por id
    getPorId: function(idusuario) {
      const filtro = toNum_(idusuario || "");
      return getData_().filter(t => t.idusuario === filtro);
    },

    // Devuelve todos los datos del usuario por nombre
    getPorNombre: function(nombre) {
      const filtro = toStrUpper_(nombre || "");
      return getData_().filter(t => t.nombre === filtro);
    },

    // Devuelve todos los datos del usuario por rol
    getPorRol: function(rol) {
      const filtro = toStrUpper_(rol || "");
      return getData_().filter(t => t.rol === filtro);
    },

    //  Devuelve todos las ids involucradas
    getIds: function() {
      return getField_("idusuario");
    },

    //  Devuelve todos los nombres involucrados
    getNombres: function() {
      return getField_("nombre");
    },

    //  Devuelve todos las roles involucrados
    getRoles: function() {
      return getField_("rol");
    },

    clearCache: function() {
      cache_ = null;
      console.log("[CACHE] Usuarios limpios");
    }

  };

})();



function debugUsuariosRepository() {

  // ===============================
  //  VARIABLES DE PRUEBA
  // ===============================

  const ID_PRUEBA = "16";
  const NOMBRE_PRUEBA = "Sigifredo De la cruz";
  const ROL_PRUEBA = "Solicitante";  
 
  // ===============================
  //  getAll
  // ===============================

  const all = UsuariosRepository.getAll();
  console.log("[getAll] total:", all.length);
  console.log("[getAll] muestra:", JSON.stringify(all.slice(0, 5), null, 3));

  // ===============================
  //  getPorId
  // ===============================

  const porid = UsuariosRepository.getPorId(ID_PRUEBA);
  console.log(`[getPorId(${ID_PRUEBA})] total:`, porid.length);
  console.log("[getPorId] muestra:", JSON.stringify(porid.slice(0, 5), null, 3));

  // ===============================
  //  getPorNombre
  // ===============================

  const pornombre = UsuariosRepository.getPorNombre(NOMBRE_PRUEBA);
  console.log(`[getPorNombre(${NOMBRE_PRUEBA})] total:`, pornombre.length);
  console.log("[getPorNombre] muestra:", JSON.stringify(pornombre.slice(0, 5), null, 3));

  // ===============================
  //  getPorRol
  // ===============================

  const porrol = UsuariosRepository.getPorRol(ROL_PRUEBA);
  console.log(`[getPorRol(${ROL_PRUEBA})] total:`, porrol.length);
  console.log("[getPorRol] muestra:", JSON.stringify(porrol.slice(0, 5), null, 3));

  // ===============================
  //  getIds
  // ===============================

  const ids = UsuariosRepository.getIds();
  console.log("[getIds] total:", ids.length);
  console.log("[getIds] muestra:", JSON.stringify(ids.slice(0, 5), null, 3));

  // ===============================
  //  getNombres
  // ===============================

  const nombres = UsuariosRepository.getNombres();
  console.log("[getNombres] total:", nombres.length);
  console.log("[getNombres] muestra:", JSON.stringify(nombres.slice(0, 5), null, 3));

    // ===============================
  //  getRoles
  // ===============================

  const roles = UsuariosRepository.getRoles();
  console.log("[getRoles] total:", roles.length);
  console.log("[getRoles] muestra:", JSON.stringify(roles.slice(0, 5), null, 3));

}