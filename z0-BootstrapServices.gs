/**
 * z0-BootstrapServices.gs
 *
 * Servicio de composición del bootstrap inicial utilizado por las vistas de
 * APPALMACEN.
 *
 * Responsabilidades:
 * - Consultar usuarios, ubicaciones de excedentes, catálogo y etiquetas.
 * - Mantener fuera del arranque general los datasets propios de vistas.
 * - Normalizar códigos, descripciones, bodegas y ubicaciones.
 * - Construir mapas de acceso rápido para el cliente.
 * - Eliminar códigos duplicados mediante conjuntos.
 * - Ordenar catálogos visibles de forma determinista.
 * - Medir la duración de cada etapa del proceso.
 * - Reutilizar APPALMACENCache cuando el módulo está disponible.
 * - Mantener contratos parciales disponibles cuando falla una fuente opcional.
 * - Devolver siempre un contrato estable para evitar fallos en las vistas.
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
 *
 * @author Sigifredo de la Cruz Ramos
 * @version BOOTSTRAP-SERVICES-2026-11-07-06
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
   * Ejecuta una lectura de repositorio sin derribar el bootstrap completo.
   *
   * Las fuentes de APPALMACEN son funcionalmente independientes. Una falla en
   * etiquetas o excedentes no debe impedir que el shell entregue los catálogos
   * globales restantes. MaxMin se carga exclusivamente desde su propio módulo.
   *
   * @param {string} label Nombre estable de la lectura.
   * @param {function(): *} executor Operación de consulta.
   * @param {*} fallback Contrato de respaldo.
   * @return {*} Resultado de la consulta o fallback.
   * @private
   */
  function ejecutarLecturaSegura_(label, executor, fallback, diagnostics) {
    const inicio = Date.now();
    try {
      if (typeof executor !== "function") {
        throw new TypeError("executor debe ser una función.");
      }
      const result = executor();
      const elapsedMs = Date.now() - inicio;
      if (diagnostics && diagnostics.sources) {
        diagnostics.sources[label] = {
          ok: true,
          elapsedMs,
          total: Array.isArray(result) ? result.length : undefined
        };
      }
      logDuracion_(label, inicio, {
        ok: true,
        total: Array.isArray(result) ? result.length : undefined
      });
      return result;
    } catch (error) {
      console.warn(`[BOOT][SERVER] ${label} :: ERROR`, {
        message: error && error.message ? error.message : String(error || "")
      });
      if (diagnostics && diagnostics.sources) {
        diagnostics.sources[label] = {
          ok: false,
          elapsedMs: Date.now() - inicio,
          message: error && error.message ? error.message : String(error || "")
        };
        diagnostics.degraded = true;
      }
      logDuracion_(label, inicio, { ok: false });
      return fallback;
    }
  }

  /**
   * Crea el contrato vacío y estable del bootstrap.
   *
   * @return {!Object} Contrato sin datos.
   * @private
   */
  function crearBootstrapVacio_() {
    return {
      usuarios: [],
      bodegas: [],
      mapaUbicacionesExcedentes: [],
      codigos: [],
      mapaCatalogo: {},
      mapaMedidas: {},
      nombresEtiquetas: [],
      diagnostics: {
        ok: false,
        degraded: true,
        generatedAt: new Date().toISOString(),
        sources: {}
      }
    };
  }

  /**
 * Normaliza el catálogo y construye sus índices para el navegador.
 *
 * Los códigos se convierten a mayúsculas, se eliminan espacios exteriores y se
 * deduplican mediante Set. Cuando el catálogo contiene códigos repetidos, el mapa
 * conserva el último registro leído, de acuerdo con el contrato histórico.
 *
 * Se utiliza un objeto sin prototipo para impedir colisiones accidentales con
 * propiedades heredadas como constructor, prototype o __proto__.
 *
 * @param {!Array<!Object>} catalogo Registros obtenidos del Repository.
 * @return {{
 *   mapaCatalogo: !Object<string, !Object>,
 *   codigos: !Array<string>
 * }} Índices normalizados del catálogo.
 * @private
 */
function procesarCatalogo_(catalogo) {
  const source =
    Array.isArray(catalogo)
      ? catalogo
      : [];

  const mapaCatalogo =
    Object.create(null);

  const codigosUnicos =
    new Set();

  for (
    let index = 0;
    index < source.length;
    index++
  ) {
    const item =
      source[index] || {};

    const codigo = String(
      item.codigo || ""
    )
      .trim()
      .toUpperCase();

    if (!codigo) {
      continue;
    }

    codigosUnicos.add(codigo);

    mapaCatalogo[codigo] = {
      idproducto:
        item.idproducto ||
        item.idProducto ||
        "",

      descripcion: String(
        item.descripcion || ""
      )
        .trim()
        .toUpperCase()
    };
  }

  return {
    mapaCatalogo,

    codigos: Array
      .from(codigosUnicos)
      .sort(function (a, b) {
        return a.localeCompare(
          b,
          "es-MX",
          {
            numeric: true,
            sensitivity: "base"
          }
        );
      })
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

  function usuariosOrdenados_(usuarios) {
    return (Array.isArray(usuarios) ? usuarios : [])
      .map(function(usuario) {
        return {
          idusuario: Number(usuario.idusuario || 0),
          nombre: String(usuario.nombre || "").trim(),
          rol: String(usuario.rol || "").trim()
        };
      })
      .filter(function(usuario) {
        return Boolean(usuario.nombre);
      })
      .sort(function(a, b) {
        return a.nombre.localeCompare(b.nombre, "es-MX", {
          sensitivity: "base",
          numeric: true
        });
      });
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
    console.log("[BOOT][SERVER] BootstrapServices.getInfoInicialFresh_ :: INICIO");

    try {
      const diagnostics = {
        ok: true,
        degraded: false,
        generatedAt: new Date().toISOString(),
        sources: {}
      };
      const usuarios = ejecutarLecturaSegura_(
        "UsuariosRepository.getAll",
        function() {
          return UsuariosRepository.getAll();
        },
        [],
        diagnostics
      );

      const ubicacionesExcedentes = ejecutarLecturaSegura_(
        "UbicacionesExcedentesRepository.getAll",
        function() {
          return UbicacionesExcedentesRepository.getAll();
        },
        [],
        diagnostics
      );

      const catalogo = ejecutarLecturaSegura_(
        "CatalogoRepository.getAll",
        function() {
          return typeof CatalogoRepository.getAllRaw === "function"
            ? CatalogoRepository.getAllRaw()
            : CatalogoRepository.getAll();
        },
        [],
        diagnostics
      );

      const etiquetas = ejecutarLecturaSegura_(
        "EtiquetasRepository.getAll",
        function() {
          return EtiquetasRepository.getAll();
        },
        [],
        diagnostics
      );


      let t = Date.now();
      const usuariosNormalizados = usuariosOrdenados_(usuarios);
      logDuracion_("usuariosOrdenados_", t, {
        total: usuariosNormalizados.length
      });

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
      const { mapaCatalogo, codigos } = procesarCatalogo_(catalogo);
      logDuracion_("procesarCatalogo_", t, {
        codigos: codigos.length,
        clavesMapaCatalogo: Object.keys(mapaCatalogo).length
      });

      t = Date.now();
      const { mapaMedidas, nombresEtiquetas } = procesarEtiquetas_(etiquetas);
      logDuracion_("procesarEtiquetas_", t, {
        clavesMapaMedidas: Object.keys(mapaMedidas).length,
        nombresEtiquetas: nombresEtiquetas.length
      });


      const resultado = {
        usuarios: usuariosNormalizados,
        bodegas,
        mapaUbicacionesExcedentes,
        codigos,
        mapaCatalogo,
        mapaMedidas,
        nombresEtiquetas,
        diagnostics: Object.assign({}, diagnostics, {
          ok: diagnostics.degraded !== true,
          totalMs: Date.now() - tTotal
        })
      };

      logDuracion_("BootstrapServices.getInfoInicialFresh_ :: TOTAL", tTotal, {
        usuarios: resultado.usuarios.length,
        codigos: resultado.codigos.length,
        incluyeMaxMin: false
      });
      return resultado;
    } catch (error) {
      console.error("[BOOT][SERVER] BootstrapServices.getInfoInicialFresh_ :: ERROR", {
        message: error && error.message ? error.message : String(error || ""),
        stack: error && error.stack ? error.stack : ""
      });
      logDuracion_(
        "BootstrapServices.getInfoInicialFresh_ :: ERROR TOTAL",
        tTotal
      );
      const fallback = crearBootstrapVacio_();
      fallback.diagnostics = {
        ok: false,
        degraded: true,
        generatedAt: new Date().toISOString(),
        totalMs: Date.now() - tTotal,
        error: error && error.message ? error.message : String(error || ""),
        sources: {}
      };
      return fallback;
    }
  }
  // =========================================================
  // API PÚBLICA
  // =========================================================
  return Object.freeze({
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
  });
})();
