
/**
 * BootstrapServices.gs
 * Carga inicial compartida para la SPA
 */
const BootstrapServices = (() => {

  function mapaCatalogo_(catalogo) {
    return catalogo.reduce((acc, item) => {
      const codigo = String(item.codigo || "").trim().toUpperCase();
      if (!codigo) return acc;

      acc[codigo] = {
        idproducto: item.idproducto || "",
        descripcion: String(item.descripcion || "").trim().toUpperCase()
      };

      return acc;
    }, {});
  }

  function mapaMedidas_(etiquetas) {
    return etiquetas.reduce((acc, item) => {
      const nombre = String(item.nombre || "").trim();
      if (!nombre) return acc;

      acc[nombre] = {
        alto: Number(item.alto || 0),
        ancho: Number(item.ancho || 0)
      };

      return acc;
    }, {});
  }

  function mapaUbicacionesExcedentes_(ubicaciones) {
    return ubicaciones
      .map(x => ({
        bodega: String(x.bodega || "").trim().toUpperCase(),
        ubi: String(x.ubicacion || "").trim().toUpperCase()
      }))
      .filter(x => x.bodega && x.ubi);
  }

  function mapaBodegas_(ubicaciones) {
    return [...new Set(
      ubicaciones
        .map(x => String(x.bodega || "").trim().toUpperCase())
        .filter(Boolean)
    )].sort();
  }

  function codigos_(catalogo) {
    return [...new Set(
      catalogo
        .map(x => String(x.codigo || "").trim().toUpperCase())
        .filter(Boolean)
    )].sort();
  }

  function usuariosOrdenados_(usuarios) {
    return [...usuarios].sort((a, b) =>
      String(a.nombre || "").localeCompare(String(b.nombre || ""))
    );
  }

  return {
    getInfoInicial: function() {
      try {
        console.time("BOOTSTRAP:getInfoInicial");

        /** ===============================
         * REPOSITORIES
         * =============================== */
        const usuarios = UsuariosRepository.getAll();
        const ubicacionesExcedentes = UbicacionesExcedentesRepository.getAll();
        const catalogo = CatalogoRepository.getAll();
        const etiquetas = EtiquetasRepository.getAll();

        /** ===============================
         * TRANSFORMACIONES
         * =============================== */
        const usuariosOrdenados = usuariosOrdenados_(usuarios);
        const bodegas = mapaBodegas_(ubicacionesExcedentes);
        const mapaUbicacionesExcedentes = mapaUbicacionesExcedentes_(ubicacionesExcedentes);
        const mapaCatalogo = mapaCatalogo_(catalogo);
        const mapaMedidas = mapaMedidas_(etiquetas);
        const nombresEtiquetas = Object.keys(mapaMedidas).sort();
        const codigos = codigos_(catalogo);

        const resultado = {
          usuarios: usuariosOrdenados,
          bodegas,
          mapaUbicacionesExcedentes,
          codigos,
          mapaCatalogo,
          mapaMedidas,
          nombresEtiquetas,
        };

        console.timeEnd("BOOTSTRAP:getInfoInicial");
        return resultado;

      } catch (error) {
        console.error("❌ ERROR BootstrapServices.getInfoInicial:", error);

        return {
          usuarios: [],
          bodegas: [],
          mapaUbicacionesExcedentes: [],
          codigos: [],
          mapaCatalogo: {},
          mapaMedidas: {},
          nombresEtiquetas: [],
        };
      }
    }
  };

})();




/**
 * Debug de BootstrapServices.getInfoInicial()
 * Muestra conteos y primeras 5 muestras en el registro de ejecución  
 */
function debugGetInfoInicial() {
  const resultado = BootstrapServices.getInfoInicial();

  Logger.log("========================================");
  Logger.log("📦 DEBUG BootstrapServices.getInfoInicial()");
  Logger.log("========================================");

  // Usuarios
  Logger.log("👤 usuarios total: %s", resultado.usuarios.length);
  Logger.log("👤 usuarios muestra (5): %s", JSON.stringify(resultado.usuarios.slice(0, 5), null, 2));

  // Bodegas
  Logger.log("🏬 bodegas total: %s", resultado.bodegas.length);
  Logger.log("🏬 bodegas muestra (5): %s", JSON.stringify(resultado.bodegas.slice(0, 5), null, 2));

  // Mapa ubicaciones excedentes
  Logger.log("📍 mapaUbicacionesExcedentes total: %s", resultado.mapaUbicacionesExcedentes.length);
  Logger.log(
    "📍 mapaUbicacionesExcedentes muestra (5): %s",
    JSON.stringify(resultado.mapaUbicacionesExcedentes.slice(0, 5), null, 2)
  );

  // Codigos
  Logger.log("🔢 codigos total: %s", resultado.codigos.length);
  Logger.log("🔢 codigos muestra (5): %s", JSON.stringify(resultado.codigos.slice(0, 5), null, 2));

  // Mapa catalogo
  const clavesMapa = Object.keys(resultado.mapaCatalogo || {});
  Logger.log("🧩 mapaCatalogo total claves: %s", clavesMapa.length);
  Logger.log("🧩 mapaCatalogo claves muestra (5): %s", JSON.stringify(clavesMapa.slice(0, 5), null, 2));

  const muestraMapa = clavesMapa.slice(0, 5).reduce((acc, key) => {
    acc[key] = resultado.mapaCatalogo[key];
    return acc;
  }, {});
  Logger.log("🧩 mapaCatalogo muestra (5): %s", JSON.stringify(muestraMapa, null, 2));

  // Etiquetas
  Logger.log("🏷️ mapaMedidas total claves: %s", Object.keys(resultado.mapaMedidas || {}).length);
  Logger.log("🏷️ mapaMedidas: %s", JSON.stringify(resultado.mapaMedidas, null, 2));
  Logger.log("🏷️ nombresEtiquetas total: %s", resultado.nombresEtiquetas.length);
  Logger.log("🏷️ nombresEtiquetas muestra (5): %s", JSON.stringify(resultado.nombresEtiquetas.slice(0, 5), null, 2));

  Logger.log("========================================");
  return resultado;
}
