/**
 * z0-BootstrapServices.gs
 *
 * Servicio de composición del bootstrap inicial utilizado por las vistas de
 * APPALMACEN.
 *
 * Responsabilidades:
 * - Consultar usuarios, ubicaciones de excedentes, catálogo y etiquetas.
 * - Normalizar códigos, descripciones, bodegas y ubicaciones.
 * - Construir mapas de acceso rápido para el cliente.
 * - Eliminar códigos duplicados mediante conjuntos.
 * - Ordenar catálogos visibles de forma determinista.
 * - Medir la duración de cada etapa del proceso.
 * - Reutilizar APPALMACENCache cuando el módulo está disponible.
 * - Devolver un contrato vacío y estable si ocurre un error de composición.
 *
 * Dependencias globales:
 * - UsuariosRepository.
 * - UbicacionesExcedentesRepository.
 * - CatalogoRepository.
 * - EtiquetasRepository.
 * - APPALMACENCache, opcional.
 *
 * Contrato público:
 * - BootstrapServices.getInfoInicial(forceRefresh).
 *
 * Contrato de salida:
 * - usuarios: usuarios ordenados por nombre.
 * - bodegas: nombres únicos de bodegas ordenados.
 * - mapaUbicacionesExcedentes: pares normalizados de bodega y ubicación.
 * - codigos: códigos únicos del catálogo ordenados.
 * - mapaCatalogo: producto indexado por código.
 * - mapaMedidas: dimensiones de etiqueta indexadas por nombre.
 * - nombresEtiquetas: nombres de etiqueta ordenados.
 *
 * Invariantes:
 * - Los códigos, descripciones, bodegas y ubicaciones se normalizan según el
 *   comportamiento original del servicio.
 * - Los mapas utilizan claves normalizadas y conservan el último registro si
 *   existen duplicados en la fuente.
 * - El fallback de error mantiene siempre todas las propiedades del contrato.
 * - forceRefresh solo se considera verdadero cuando su valor es true.
 */

const BootstrapServices = (() => {
  // =========================================================
  // TELEMETRÍA Y NORMALIZADORES PRIVADOS
  // =========================================================

  /**
   * Registra la duración de una etapa del bootstrap.
   *
   * @param {string} etapa Nombre estable de la etapa.
   * @param {number} inicio Marca temporal obtenida mediante Date.now().
   * @param {*=} extra Metadatos opcionales para diagnóstico.
   * @return {void}
   * @private
   */
  function logDuracion_(etapa, inicio, extra) {
    const ms = Date.now() - inicio;
    if (extra !== undefined) {
      console.log(`[BOOT][SERVER] ${etapa}: ${ms} ms`, extra);
    } else {
      console.log(`[BOOT][SERVER] ${etapa}: ${ms} ms`);
    }
  }

  /**
   * Normaliza el catálogo y construye sus índices para el navegador.
   *
   * @param {Array<Object>} catalogo Registros obtenidos del repositorio.
   * @return {{mapaCatalogo:Object,codigos:Array<string>}}
   * @private
   */
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

  /**
   * Construye el mapa de dimensiones y la lista ordenada de etiquetas.
   *
   * @param {Array<Object>} etiquetas Etiquetas configuradas.
   * @return {{mapaMedidas:Object,nombresEtiquetas:Array<string>}}
   * @private
   */
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

  /**
   * Normaliza ubicaciones de excedentes y extrae bodegas únicas.
   *
   * @param {Array<Object>} ubicaciones Registros de ubicación.
   * @return {{mapaUbicacionesExcedentes:Array<Object>,bodegas:Array<string>}}
   * @private
   */
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

  /**
   * Devuelve una copia de los usuarios ordenada por nombre visible.
   *
   * @param {Array<Object>} usuarios Usuarios obtenidos del repositorio.
   * @return {Array<Object>} Copia ordenada sin mutar el arreglo original.
   * @private
   */
  function usuariosOrdenados_(usuarios) {
    return [...usuarios].sort((a, b) =>
      String(a.nombre || "").localeCompare(String(b.nombre || ""))
    );
  }

  /**
   * Construye el bootstrap directamente desde los repositorios.
   *
   * Cada etapa se mide de forma independiente. Ante cualquier error se devuelve
   * un contrato vacío estable para evitar fallos de desestructuración en vistas.
   *
   * @return {Object} Bootstrap normalizado.
   * @private
   */
  // =========================================================
  // COMPOSICIÓN DEL BOOTSTRAP DESDE REPOSITORIOS
  // =========================================================
  function getInfoInicialFresh_() {
    const tTotal = Date.now();

    try {
      console.log("[BOOT][SERVER] BootstrapServices.getInfoInicialFresh_ :: INICIO");

      let t = Date.now();
      const usuarios = UsuariosRepository.getAll();
      logDuracion_("UsuariosRepository.getAll", t, { total: usuarios.length });

      t = Date.now();
      const ubicacionesExcedentes = UbicacionesExcedentesRepository.getAll();
      logDuracion_("UbicacionesExcedentesRepository.getAll", t, { total: ubicacionesExcedentes.length });

      t = Date.now();
      const catalogo =
        typeof CatalogoRepository
          .getAllRaw === "function"
          ? CatalogoRepository
              .getAllRaw()
          : CatalogoRepository
              .getAll();
      logDuracion_("CatalogoRepository.getAll", t, { total: catalogo.length });

      t = Date.now();
      const etiquetas = EtiquetasRepository.getAll();
      logDuracion_("EtiquetasRepository.getAll", t, { total: etiquetas.length });

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
      logDuracion_("BootstrapServices.getInfoInicialFresh_ :: TOTAL", tTotal);

      return resultado;

    } catch (error) {
      console.error("❌ ERROR BootstrapServices.getInfoInicialFresh_:", error);
      logDuracion_("BootstrapServices.getInfoInicialFresh_ :: ERROR TOTAL", tTotal);

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

  // =========================================================
  // API PÚBLICA
  // =========================================================
  return {
    /**
     * Obtiene el bootstrap inicial, preferentemente desde la caché compartida.
     *
     * @param {boolean=} forceRefresh true para omitir el valor cacheado.
     * @return {Object} Bootstrap normalizado.
     */
    getInfoInicial: function(forceRefresh) {
      const forzar = forceRefresh === true;

      if (
        typeof APPALMACENCache !== "undefined" &&
        typeof APPALMACENCache.rememberBootstrap === "function"
      ) {
        return APPALMACENCache.rememberBootstrap(
          function() {
            return getInfoInicialFresh_();
          },
          {
            forceRefresh: forzar
          }
        );
      }

      return getInfoInicialFresh_();
    }
  };

})();
