/**
 * BootstrapServices.gs
 * Carga inicial compartida para la SPA
 */
const BootstrapServices = (() => {

  function logDuracion_(etapa, inicio, extra) {
    const ms = Date.now() - inicio;
    if (extra !== undefined) {
      console.log(`[BOOT][SERVER] ${etapa}: ${ms} ms`, extra);
    } else {
      console.log(`[BOOT][SERVER] ${etapa}: ${ms} ms`);
    }
  }

  function procesarCatalogo_(catalogo) {
    const mapaCatalogo = {};
    const codigosUnicos = new Set();

    for (let i = 0; i < catalogo.length; i++) {
      const item = catalogo[i];
      const codigo = String(item.codigo || "").trim().toUpperCase();
      if (!codigo) continue;

      codigosUnicos.add(codigo);

      mapaCatalogo[codigo] = {
        idproducto: item.idproducto || "",
        descripcion: String(item.descripcion || "").trim().toUpperCase()
      };
    }

    return {
      mapaCatalogo,
      codigos: [...codigosUnicos].sort()
    };
  }

  function procesarEtiquetas_(etiquetas) {
    const mapaMedidas = {};

    for (let i = 0; i < etiquetas.length; i++) {
      const item = etiquetas[i];
      const nombre = String(item.nombre || "").trim();
      if (!nombre) continue;

      mapaMedidas[nombre] = {
        alto: Number(item.alto || 0),
        ancho: Number(item.ancho || 0)
      };
    }

    return {
      mapaMedidas,
      nombresEtiquetas: Object.keys(mapaMedidas).sort()
    };
  }

  function procesarUbicaciones_(ubicaciones) {
    const mapaUbicacionesExcedentes = [];
    const bodegasSet = new Set();

    for (let i = 0; i < ubicaciones.length; i++) {
      const item = ubicaciones[i];
      const bodega = String(item.bodega || "").trim().toUpperCase();
      const ubi = String(item.ubicacion || "").trim().toUpperCase();

      if (!bodega || !ubi) continue;

      bodegasSet.add(bodega);
      mapaUbicacionesExcedentes.push({
        bodega,
        ubi
      });
    }

    return {
      mapaUbicacionesExcedentes,
      bodegas: [...bodegasSet].sort()
    };
  }

  function usuariosOrdenados_(usuarios) {
    return [...usuarios].sort((a, b) =>
      String(a.nombre || "").localeCompare(String(b.nombre || ""))
    );
  }

  return {
    getInfoInicial: function() {
      const tTotal = Date.now();

      try {
        console.log("[BOOT][SERVER] BootstrapServices.getInfoInicial :: INICIO");

        /** ===============================
         * REPOSITORIES
         * =============================== */
        let t = Date.now();
        const usuarios = UsuariosRepository.getAll();
        logDuracion_("UsuariosRepository.getAll", t, { total: usuarios.length });

        t = Date.now();
        const ubicacionesExcedentes = UbicacionesExcedentesRepository.getAll();
        logDuracion_("UbicacionesExcedentesRepository.getAll", t, { total: ubicacionesExcedentes.length });

        t = Date.now();
        const catalogo = CatalogoRepository.getAll();
        logDuracion_("CatalogoRepository.getAll", t, { total: catalogo.length });

        t = Date.now();
        const etiquetas = EtiquetasRepository.getAll();
        logDuracion_("EtiquetasRepository.getAll", t, { total: etiquetas.length });

        /** ===============================
         * TRANSFORMACIONES
         * =============================== */
        t = Date.now();
        const usuariosOrdenados = usuariosOrdenados_(usuarios);
        logDuracion_("usuariosOrdenados_", t, { total: usuariosOrdenados.length });

        t = Date.now();
        const {
          mapaUbicacionesExcedentes,
          bodegas
        } = procesarUbicaciones_(ubicacionesExcedentes);
        logDuracion_("procesarUbicaciones_", t, {
          bodegas: bodegas.length,
          ubicaciones: mapaUbicacionesExcedentes.length
        });

        t = Date.now();
        const {
          mapaCatalogo,
          codigos
        } = procesarCatalogo_(catalogo);
        logDuracion_("procesarCatalogo_", t, {
          codigos: codigos.length,
          clavesMapaCatalogo: Object.keys(mapaCatalogo).length
        });

        t = Date.now();
        const {
          mapaMedidas,
          nombresEtiquetas
        } = procesarEtiquetas_(etiquetas);
        logDuracion_("procesarEtiquetas_", t, {
          clavesMapaMedidas: Object.keys(mapaMedidas).length,
          nombresEtiquetas: nombresEtiquetas.length
        });

        /** ===============================
         * PAYLOAD FINAL
         * =============================== */
        t = Date.now();
        const resultado = {
          usuarios: usuariosOrdenados,
          bodegas,
          mapaUbicacionesExcedentes,
          codigos,
          mapaCatalogo,
          mapaMedidas,
          nombresEtiquetas
        };
        logDuracion_("Construcción payload final", t);

        logDuracion_("BootstrapServices.getInfoInicial :: TOTAL", tTotal);

        return resultado;

      } catch (error) {
        console.error("❌ ERROR BootstrapServices.getInfoInicial:", error);
        logDuracion_("BootstrapServices.getInfoInicial :: ERROR TOTAL", tTotal);

        return {
          usuarios: [],
          bodegas: [],
          mapaUbicacionesExcedentes: [],
          codigos: [],
          mapaCatalogo: {},
          mapaMedidas: {},
          nombresEtiquetas: []
        };
      }
    }
  };

})();