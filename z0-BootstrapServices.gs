/**
 * z0-BootstrapServices.gs
 *
 * Servicio de composición del bootstrap inicial utilizado por las vistas de
 * APPALMACEN.
 *
 * Responsabilidades:
 * - Consultar usuarios, ubicaciones de excedentes, catálogo, etiquetas y
 *   ubicaciones MaxMin.
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
 * - UbicacionesMaxMinRepository.
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
 * - registrosUbicacionesMaxMin: registros normalizados de GESTION4.
 * - registrosPendientesUbicacionesMaxMin: registros sin captura completa.
 * - codigosPendientesUbicacionesMaxMin: códigos pendientes únicos y ordenados.
 *
 * Invariantes:
 * - Los códigos, descripciones, bodegas y ubicaciones se normalizan según el
 *   comportamiento original del servicio.
 * - Los mapas utilizan claves normalizadas y conservan el último registro si
 *   existen duplicados en la fuente.
 * - El fallback de error mantiene siempre todas las propiedades del contrato.
 * - forceRefresh solo se considera verdadero cuando su valor es true.
 * - Un registro MaxMin se considera concluido cuando FECHA, HORA y USUARIO
 *   contienen valores no vacíos. VALIDACION pertenece a un flujo posterior.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version BOOTSTRAP-SERVICES-2026-11-06-02
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
   * Proyecta un registro de UBICACIONES_MAXMIN a un contrato estable para las
   * vistas sin exponer arreglos físicos ni referencias internas.
   *
   * @param {Object} item Registro normalizado por el repositorio.
   * @return {Object} Copia serializable.
   * @private
   */
  function proyectarUbicacionMaxMin_(item) {
    return {
      numFila: Number(item.numFila || 0),
      codigo: String(item.codigo || "").trim().toUpperCase(),
      descripcion: String(item.descripcion || "").trim().toUpperCase(),
      bodega: String(item.bodega || "").trim().toUpperCase(),
      ubicacion: String(item.ubicacion || "").trim().toUpperCase(),
      existencia: Number(item.existencia || 0),
      porcentaje: Number(item.porcentaje || 0),
      maximo: Number(item.maximo || 0),
      minimo: Number(item.minimo || 0),
      zonaBodega: String(item.zonaBodega || "").trim().toUpperCase(),
      zonaAbastecimiento: String(item.zonaAbastecimiento || "").trim().toUpperCase(),
      zonaNivel: String(item.zonaNivel || "").trim().toUpperCase(),
      fecha: String(item.fecha || "").trim(),
      hora: String(item.hora || "").trim(),
      usuario: String(item.usuario || "").trim(),
      validacion: String(item.validacion || "").trim().toUpperCase()
    };
  }

  /**
   * Indica si la captura inicial de una ubicación MaxMin está completa.
   * VALIDACION no participa en este filtro porque corresponde a otra etapa.
   *
   * @param {Object} item Registro proyectado.
   * @return {boolean}
   * @private
   */
  function estaCapturaMaxMinCompleta_(item) {
    return Boolean(item.fecha && item.hora && item.usuario);
  }

  /**
   * Normaliza, ordena y segmenta UBICACIONES_MAXMIN.
   *
   * @param {Array<Object>} registros Datos del repositorio.
   * @return {{registros:Array<Object>,pendientes:Array<Object>,codigosPendientes:Array<string>}}
   * @private
   */
  function procesarUbicacionesMaxMin_(registros) {
    const normalizados = (Array.isArray(registros) ? registros : [])
      .map(proyectarUbicacionMaxMin_)
      .filter(item => item.codigo)
      .sort((a, b) =>
        a.codigo.localeCompare(b.codigo, "es-MX", { numeric: true }) ||
        a.bodega.localeCompare(b.bodega, "es-MX", { numeric: true }) ||
        a.ubicacion.localeCompare(b.ubicacion, "es-MX", { numeric: true })
      );

    const pendientes = normalizados.filter(
      item => !estaCapturaMaxMinCompleta_(item)
    );

    const codigosPendientes = [...new Set(
      pendientes.map(item => item.codigo).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "es-MX", { numeric: true }));

    return { registros: normalizados, pendientes, codigosPendientes };
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
      const ubicacionesMaxMin =
        typeof UbicacionesMaxMinRepository !== "undefined" &&
        typeof UbicacionesMaxMinRepository.getAll === "function"
          ? UbicacionesMaxMinRepository.getAll()
          : [];
      logDuracion_("UbicacionesMaxMinRepository.getAll", t, {
        total: ubicacionesMaxMin.length
      });

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
      const {
        registros: registrosUbicacionesMaxMin,
        pendientes: registrosPendientesUbicacionesMaxMin,
        codigosPendientes: codigosPendientesUbicacionesMaxMin
      } = procesarUbicacionesMaxMin_(ubicacionesMaxMin);
      logDuracion_("procesarUbicacionesMaxMin_", t, {
        registros: registrosUbicacionesMaxMin.length,
        pendientes: registrosPendientesUbicacionesMaxMin.length,
        codigosPendientes: codigosPendientesUbicacionesMaxMin.length
      });

      t = Date.now();
      const resultado = {
        usuarios: usuariosOrdenados,
        bodegas,
        mapaUbicacionesExcedentes,
        codigos,
        mapaCatalogo,
        mapaMedidas,
        nombresEtiquetas,
        registrosUbicacionesMaxMin,
        registrosPendientesUbicacionesMaxMin,
        codigosPendientesUbicacionesMaxMin
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
        nombresEtiquetas: [],
        registrosUbicacionesMaxMin: [],
        registrosPendientesUbicacionesMaxMin: [],
        codigosPendientesUbicacionesMaxMin: []
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
