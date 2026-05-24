
/**
 * Lógica sobre usuarios
 */

const UsuariosService = (() => {

  return {

    /**
     * Registros con rol RESPONSABLE
     */
    getResponsables: function() {
      return UsuariosRepository.getPorRol("RESPONSABLE");
    },

    /**
     * Registros con rol SOLICITANTE
     */
    getSolicitantes: function() {
      return UsuariosRepository.getPorRol("SOLICITANTE");
    },

    /**
     * Registros por nombre dinámico
     */
    getRegistrosPorNombre: function(nombre) {
      const texto = toStrUpper_(nombre);

      return UsuariosRepository.getAll()
        .filter(x =>
          (x.nombre).includes(texto)
        );
    },

    /**
     * Valida si el usuario encontrado por nombre es RESPONSABLE
     */
    esResponsable: function(nombre) {
      return this.getRegistrosPorNombre(nombre)
        .some(x => x.rol === "RESPONSABLE");
    },

    /**
     * Valida si el usuario encontrado por nombre es SOLICITANTE
     */
    esSolicitante: function(nombre) {
      return this.getRegistrosPorNombre(nombre)
        .some(x => x.rol === "SOLICITANTE");
    }

  };

})();



function debugUsuariosService() {

const nombre = "Sigi";
const nombrecompleto = "sigifredo de la cruz";

    debugServiceCall_(
      "getResponsables",
      null,
      () => UsuariosService.getResponsables(),
      { limit: 3 }
    );

    debugServiceCall_(
      "getSolicitantes",
      null,
      () => UsuariosService.getSolicitantes(),
      { limit: 3 }
    );

    debugServiceCall_(
      "getRegistrosPorNombre",
      { nombre: nombre },
      () => UsuariosService.getRegistrosPorNombre(nombre),
      { limit: 3 }
    );

    debugServiceCall_(
      "esResponsable",
      { nombrecompleto: nombrecompleto },
      () => UsuariosService.esResponsable(nombrecompleto),
      { limit: 3 }
    );

    debugServiceCall_(
      "esSolicitante",
      { nombrecompleto: nombrecompleto },
      () => UsuariosService.esSolicitante(nombrecompleto),
      { limit: 3 }
    );

}