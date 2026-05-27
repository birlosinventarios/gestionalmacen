
/**
 * BootstrapServices.gs
 * Carga inicial compartida para la SPA
 */
const BootstrapServices = (() => {

      function mapaProductos_(catalogo) {
          return catalogo.reduce((acc,item) => {
              if (!item.codigo) return acc;

              acc[item.codigo] = {
                id: item.idproducto,
                descripcion: item.descripcion
              };

              return acc;
            }, {});
      }

      function mapaMedidas_(etiquetas) {
          return etiquetas.reduce((acc,item) => {
              if (!item.nombre) return acc;

              acc[item.nombre] = {
                alto: item.alto,
                ancho: item.ancho
              };

              return acc;
            }, {});
      }


      function mapaUbicacionesExcedentes_(ubicaciones) {
        return ubicaciones
          .map(x => ({
            bodega: x.bodega,
            ubi: x.ubicacion
          }))
          .filter(x => x.bodega && x.ubi);
      }

      function mapaBodegas_(ubicaciones) {
        return [...new Set(
          ubicaciones
            .map(x => x.bodega)
            .filter(Boolean)
        )].sort();
      }
      
      function codigos_(catalogo) {
        return [...new Set(
          catalogo
            .map(x => x.codigo)
            .filter(Boolean)
        )].sort();
      }


      function usuariosOrdenados_(usuarios) {
        return [...usuarios].sort((a, b) => a.nombre.localeCompare(b.nombre));
      }



      return {

          getInfoInicial: function() {
            try {
                  console.time("BOOTSTRAP:getInfoInicial");


                  /**===============================
                  // REPOSITORIES
                  // =============================== */

                  const usuarios = UsuariosRepository.getAll();
                  const ubicacionesExcedentes = UbicacionesExcedentesRepository.getAll();
                  const catalogo = CatalogoRepository.getAll();
                  const etiquetas = EtiquetasRepository.getAll();
              
                  /**===============================
                  // TRANSFORMACIONES
                  // =============================== */

                  const usuariosOrdenados = usuariosOrdenados_(usuarios);
                  const bodegas = mapaBodegas_(ubicacionesExcedentes);
                  const mapaUbicaciones = mapaUbicacionesExcedentes_(ubicacionesExcedentes);
                  const mapaProductos = mapaProductos_(catalogo);
                  const mapaMedidas = mapaMedidas_(etiquetas);
                  const nombresEtiquetas = Object.keys(mapaMedidas).sort();
                  const codigos = codigos_(catalogo);

                  const resultado = {
                    usuarios: usuariosOrdenados,
                    bodegas,
                    mapaUbicaciones,
                    codigos,
                    mapaProductos,
                    mapaMedidas,
                    nombresEtiquetas
                  };

                  return resultado;

                  } catch (error) {
                    console.error("❌ ERROR BootstrapServices.getInfoInicial:", error);

                      return {
                        usuarios: [],
                        bodegas: [],
                        mapaUbicaciones: [],
                        codigos: [],
                        mapaProductos: {},
                        mapaMedidas: {},
                        nombresEtiquetas: []
                      };
                    }
            }

      };

})();


/**
 * Debug para revisar informacion cargada
 */

function debugGetInfoInicial() {
  const resultado = BootstrapServices.getInfoInicial();

  console.log("usuarios total:", resultado.usuarios.length);
  console.log("usuarios muestra:", JSON.stringify(resultado.usuarios.slice(0, 3), null, 2));

  console.log("bodegas total:", resultado.bodegas.length);
  console.log("bodegas muestra:", JSON.stringify(resultado.bodegas.slice(0, 5), null, 2));

  console.log("mapaUbicaciones total:", resultado.mapaUbicaciones.length);
  console.log("mapaUbicaciones muestra:", JSON.stringify(resultado.mapaUbicaciones.slice(0, 5), null, 2));

  console.log("codigos total:", resultado.codigos.length);
  console.log("codigos muestra:", JSON.stringify(resultado.codigos.slice(0, 5), null, 2));

  console.log("mapaProductos total:", Object.keys(resultado.mapaProductos).length);
  console.log("mapaProductos claves muestra:", JSON.stringify(Object.keys(resultado.mapaProductos).slice(0, 5), null, 2));

  console.log("mapaMedidas:", JSON.stringify(resultado.mapaMedidas, null, 2));
  console.log("nombresEtiquetas:", JSON.stringify(resultado.nombresEtiquetas, null, 2));

  return resultado;
}


/**
 * Debug manual en servidor
 */
function debugGetInfoInicial() {
  const resultado = BootstrapServices.getInfoInicial();

  console.log("usuarios total:", resultado.usuarios.length);
  console.log("usuarios muestra:", JSON.stringify(resultado.usuarios.slice(0, 3), null, 2));

  console.log("bodegas total:", resultado.bodegas.length);
  console.log("bodegas muestra:", JSON.stringify(resultado.bodegas.slice(0, 5), null, 2));

  console.log("mapaUbicaciones total:", resultado.mapaUbicaciones.length);
  console.log("mapaUbicaciones muestra:", JSON.stringify(resultado.mapaUbicaciones.slice(0, 5), null, 2));

  console.log("codigos total:", resultado.codigos.length);
  console.log("codigos muestra:", JSON.stringify(resultado.codigos.slice(0, 5), null, 2));

  console.log("mapaProductos total:", Object.keys(resultado.mapaProductos).length);
  console.log("mapaProductos claves muestra:", JSON.stringify(Object.keys(resultado.mapaProductos).slice(0, 5), null, 2));

  console.log("mapaMedidas:", JSON.stringify(resultado.mapaMedidas, null, 2));
  console.log("nombresEtiquetas:", JSON.stringify(resultado.nombresEtiquetas, null, 2));

  return resultado;
}

