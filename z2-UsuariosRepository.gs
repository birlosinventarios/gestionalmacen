/**
 * UsuariosRepository.gs
 * Lectura de hoja USUARIOS
 */

const UsuariosRepository = (() => {

  function readSource_() {
    return getRowsByKey_("USUARIOS");
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
