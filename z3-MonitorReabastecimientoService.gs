/**
 * z3-MonitorReabastecimientoService
 *
 * @fileoverview Servicio de dominio para consolidar el estado operativo de
 * reabastecimiento por SKU y generar el semáforo de atención del almacén.
 *
 * Integra existencias, catálogo, parametrización mínima y máxima, ubicación de
 * surtido, excedentes históricos y saldos vigentes por IdUnico. Con esta
 * información determina prioridad, acción operativa, capacidad de relleno,
 * segmentación por bodega y métricas ejecutivas para el frontend.
 *
 * Responsabilidades:
 * - Leer y validar las fuentes operativas requeridas por el monitor.
 * - Conservar una ubicación de surtido válida por SKU para compatibilidad V1.
 * - Consolidar catálogo, existencias, MAX/MIN y ubicación por código.
 * - Calcular el balance vigente de excedentes por IdUnico y bodega.
 * - Clasificar el semáforo VERDE, AMBAR, ROJO o SIN_PARAMETRIZACION.
 * - Determinar acciones de relleno preventivo, urgente o escalamiento a compras.
 * - Asignar prioridad operativa y banderas de excepción.
 * - Construir registros consolidados y métricas para encabezados.
 * - Exponer endpoints tolerantes para la vista del monitor.
 *
 * Dependencias globales:
 * - ExistenciasRepository, CatalogoRepository y ExcedentesRepository.
 * - UbicacionesSurtidoRepository.
 * - MaxMinRepository como fuente opcional.
 * - EstadoActualExcedentesService como fuente opcional del balance por IdUnico.
 * - toStr_(value), toStrUpper_(value) y toNum_(value).
 *
 * Reglas de negocio:
 * - Una ubicación de surtido se conserva por SKU.
 * - VERDE: existencia mayor o igual que el máximo.
 * - ROJO: existencia menor o igual que el mínimo.
 * - AMBAR: existencia entre mínimo y máximo.
 * - AMBAR_BAJO: existencia menor o igual que mínimo multiplicado por 1.5.
 * - Los excedentes históricos y el balance por IdUnico se conservan por separado.
 * - Menor prioridadorden significa mayor urgencia.
 * - Los registros sin MAX/MIN se clasifican como excepción.
 * - El servicio no escribe en hojas ni modifica inventario.
 *
 * Política de errores:
 * - Las lecturas auxiliares son tolerantes y registran el error de origen.
 * - Los endpoints públicos devuelven estructuras vacías compatibles ante fallas.
 * - La falta de MAX/MIN o del estado por IdUnico no interrumpe la vista completa.
 *
 * @author Sigifredo de la Cruz Ramos
 */

const MonitorReabastecimientoService = (() => {
  "use strict";

  /** @private @const {!Object} */
  const CFG = Object.freeze({
    LOCALE: "es-MX",
    GLOBAL_AUDIT_TYPE: "GLOBAL",
    ALL_WAREHOUSES: "TODAS",
    PREVENTIVE_FACTOR: 1.5,
    LOG_PREFIX: "[MonitorReabastecimientoService]"
  });


  // ==========================================================================
  // VALIDACIÓN Y FUENTES DE DATOS
  // ==========================================================================

  /**
   * Verifica las dependencias obligatorias del monitor.
   *
   * MaxMinRepository y EstadoActualExcedentesService son opcionales y se validan
   * en el punto donde se utilizan.
   *
   * @return {void}
   * @throws {Error} Si falta una fuente o utilidad indispensable.
   * @private
   */
  /**
   * Verifica las dependencias obligatorias del monitor.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function assertDependencies_() {
    const functions = [
      ["toStr_", typeof toStr_],
      ["toStrUpper_", typeof toStrUpper_],
      ["toNum_", typeof toNum_]
    ];
    const missingFunctions = functions
      .filter(function (dependency) {
        return dependency[1] !== "function";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingFunctions.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan utilidades globales: ` +
          `${missingFunctions.join(", ")}.`
      );
    }

    const repositories = [
      ["ExistenciasRepository", typeof ExistenciasRepository],
      ["CatalogoRepository", typeof CatalogoRepository],
      ["ExcedentesRepository", typeof ExcedentesRepository],
      [
        "UbicacionesSurtidoRepository",
        typeof UbicacionesSurtidoRepository
      ]
    ];
    const missingRepositories = repositories
      .filter(function (dependency) {
        return dependency[1] === "undefined";
      })
      .map(function (dependency) {
        return dependency[0];
      });

    if (missingRepositories.length > 0) {
      throw new Error(
        `${CFG.LOG_PREFIX} Faltan repositorios obligatorios: ` +
          `${missingRepositories.join(", ")}.`
      );
    }
  }

  /**
   * ------------------------------------------------------------
   * HELPERS BASE
   * ------------------------------------------------------------
   */

  /**
   * Devuelve el valor si es arreglo o una colección vacía.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function safeArray_(value) {
    return Array.isArray(value) ? value : [];
  }

  /**
   * Lee existencias con una política tolerante.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function getExistencias_() {
    try {
      return safeArray_(ExistenciasRepository.getAll());
    } catch (error) {
      console.error(CFG.LOG_PREFIX + " Error al leer ExistenciasRepository:", error);
      return [];
    }
  }

  /**
   * Lee el catálogo con una política tolerante.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function getCatalogo_() {
    try {
      return safeArray_(CatalogoRepository.getAll());
    } catch (error) {
      console.error(CFG.LOG_PREFIX + " Error al leer CatalogoRepository:", error);
      return [];
    }
  }

  /**
   * Lee excedentes históricos con una política tolerante.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function getExcedentes_() {
    try {
      return safeArray_(ExcedentesRepository.getAll());
    } catch (error) {
      console.error(CFG.LOG_PREFIX + " Error al leer ExcedentesRepository:", error);
      return [];
    }
  }

  /**
   * Lee la parametrización MAX/MIN cuando está disponible.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function getMaxMin_() {
    try {
      if (
        typeof MaxMinRepository !== "undefined" &&
        MaxMinRepository &&
        typeof MaxMinRepository.getAll === "function"
      ) {
        return safeArray_(MaxMinRepository.getAll());
      }

      console.warn(CFG.LOG_PREFIX + " MaxMinRepository no disponible; se continuará sin MAX/MIN.");
      return [];
    } catch (error) {
      console.error(CFG.LOG_PREFIX + " Error al leer MaxMinRepository:", error);
      return [];
    }
  }

  /**
   * Conserva una sola ubicación válida por SKU.
   * Esto mantiene compatibilidad con la lógica V1, donde el saldo está a nivel SKU
   * y no a nivel ubicación física detallada.
   */
  /**
   * Conserva una ubicación de surtido por SKU.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function getUbicacionesSurtidoSanitizadas_() {
    const mapa = Object.create(null);

    try {
      safeArray_(UbicacionesSurtidoRepository.getAll()).forEach(item => {
        const codigo = toStrUpper_(item.codigo);
        const ubicacion = toStrUpper_(item.ubicacion);

        if (!codigo) return;
        if (!ubicacion) return;

        if (!mapa[codigo]) {
          mapa[codigo] = {
            codigo: codigo,
            ubicacion: ubicacion,
            idproducto: toNum_(item.idproducto || 0),
            idubicacion: toNum_(item.idubicacion || 0),
            bodega: toNum_(item.bodega || 0),
            pasillo: toNum_(item.pasillo || 0),
            anaquel: toNum_(item.anaquel || 0),
            repisa: toNum_(item.repisa || 0)
          };
        }
      });
    } catch (error) {
      console.error(CFG.LOG_PREFIX + " Error al sanear ubicaciones de surtido:", error);
    }

    return Object.values(mapa).sort((a, b) => a.codigo.localeCompare(b.codigo, CFG.LOCALE, { numeric: true, sensitivity: "base" }));
  }

  /**
   * Construye un índice seguro por código.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function buildMapByCodigo_(rows) {
    return safeArray_(rows).reduce((acc, item) => {
      const codigo = toStrUpper_(item.codigo);
      if (!codigo) return acc;
      acc[codigo] = item;
      return acc;
    }, {});
  }

  /**
   * Construye el índice del catálogo.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function buildCatalogoMap_() {
    return buildMapByCodigo_(getCatalogo_());
  }

  /**
   * Construye el índice MAX/MIN.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function buildMaxMinMap_() {
    return buildMapByCodigo_(getMaxMin_());
  }

  /**
   * Construye el índice de ubicaciones de surtido.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function buildUbicacionesMap_() {
    return buildMapByCodigo_(getUbicacionesSurtidoSanitizadas_());
  }

  // ==========================================================================
  // SEGMENTACIÓN POR BODEGA Y ZONA
  // ==========================================================================

  /**
   * Clasifica una ubicación en su segmento operativo.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function getBodegaSegmento_(ubicacionSurtido) {
    const raw = toStrUpper_(ubicacionSurtido || "");

    if (!raw) {
      return {
        key: "SIN_UBICACION",
        label: "Sin ubicación"
      };
    }

    if (raw.startsWith("B1")) {
      return {
        key: "B1",
        label: "Bodega 1"
      };
    }

    if (raw.startsWith("B2")) {
      return {
        key: "B2",
        label: "Bodega 2"
      };
    }

    if (raw.startsWith("B3")) {
      return {
        key: "B3",
        label: "Bodega 3"
      };
    }

    if (raw.startsWith("CU")) {
      return {
        key: "CU",
        label: "Cuarto Alto Riesgo"
      };
    }

    if (raw.startsWith("MO")) {
      return {
        key: "MO",
        label: "Mostrador"
      };
    }

    return {
      key: "OTRO",
      label: "Otro"
    };
  }

  // ==========================================================================
  // MÉTRICAS DE EXCEDENTES
  // ==========================================================================

  /**
   * Clasifica el estatus histórico de un excedente.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function clasificarStatusExcedente_(status) {
    const txt = toStrUpper_(status);

    if (!txt) return "DESCONOCIDO";

    if (
      txt.includes("PENDIENTE") ||
      txt.includes("ACOMODAR") ||
      txt.includes("POR ACOMODAR")
    ) {
      return "PENDIENTE";
    }

    if (
      txt.includes("VIGENTE") ||
      txt.includes("DISPONIBLE") ||
      txt.includes("ACTIVO")
    ) {
      return "VIGENTE";
    }

    if (
      txt.includes("ACOMODADO") ||
      txt.includes("SURTIDO") ||
      txt.includes("CERRADO") ||
      txt.includes("CANCELADO")
    ) {
      return "ATENDIDO";
    }

    return "OTRO";
  }

  /**
   * Calcula métricas de BD-EXCEDENTES.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function getMetricosExcedentes_() {
    const excedentes = getExcedentes_();

    const salida = {
      totalIdsExcedente: 0,
      idsPendientesAcomodar: 0,
      idsVigentes: 0,
      idsAtendidos: 0,
      idsOtros: 0
    };

    excedentes.forEach(item => {
      if (!toStrUpper_(item.idunico)) return;

      salida.totalIdsExcedente++;

      const categoria = clasificarStatusExcedente_(item.status);

      if (categoria === "PENDIENTE") salida.idsPendientesAcomodar++;
      else if (categoria === "VIGENTE") salida.idsVigentes++;
      else if (categoria === "ATENDIDO") salida.idsAtendidos++;
      else salida.idsOtros++;
    });

    return salida;
  }

  // ==========================================================================
  // REGLAS DEL SEMÁFORO Y PRIORIZACIÓN
  // ==========================================================================

  /**
   * Calcula el color del semáforo.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function calcularStatus_(existenciaActual, minimo, maximo, tieneMaxMin) {
    if (!tieneMaxMin) return "SIN_PARAMETRIZACION";

    if (existenciaActual >= maximo) return "VERDE";
    if (existenciaActual <= minimo) return "ROJO";
    return "AMBAR";
  }

  /**
   * Clasifica la cercanía preventiva del estado AMBAR.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function calcularSubStatusAmbar_(existenciaActual, minimo, maximo, status) {
    if (status !== "AMBAR") return "";

    const umbralPreventivo = minimo * CFG.PREVENTIVE_FACTOR;

    if (existenciaActual <= umbralPreventivo) {
      return "AMBAR_BAJO";
    }

    if (existenciaActual > umbralPreventivo && existenciaActual < maximo) {
      return "AMBAR_ALTO";
    }

    return "AMBAR";
  }

  /**
   * Determina la acción operativa recomendada.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function calcularAccionOperativa_(status, excedenteTotal, tieneMaxMin) {
    if (!tieneMaxMin) return "REVISAR PARAMETRIZACION";

    if (status === "VERDE") return "SIN ACCION";

    if (status === "AMBAR") {
      if (excedenteTotal > 0) return "RELLENO PREVENTIVO";
      return "MONITOREAR / SIN RESPALDO";
    }

    if (status === "ROJO") {
      if (excedenteTotal > 0) return "RELLENO URGENTE";
      return "REPORTAR A COMPRAS";
    }

    return "SIN DEFINIR";
  }

  /**
   * Asigna orden y etiqueta de prioridad.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function calcularPrioridad_(status, accionOperativa, substatusAmbar) {
    /**
     * Menor número = mayor prioridad
     */
    if (accionOperativa === "REPORTAR A COMPRAS") {
      return { orden: 1, etiqueta: "CRITICO SIN RESPALDO" };
    }

    if (accionOperativa === "RELLENO URGENTE") {
      return { orden: 2, etiqueta: "URGENTE" };
    }

    if (status === "AMBAR" && substatusAmbar === "AMBAR_BAJO") {
      return { orden: 3, etiqueta: "PREVENTIVO ALTO" };
    }

    if (status === "AMBAR" && substatusAmbar === "AMBAR_ALTO") {
      return { orden: 4, etiqueta: "PREVENTIVO" };
    }

    if (status === "VERDE") {
      return { orden: 5, etiqueta: "SIN ACCION" };
    }

    if (status === "SIN_PARAMETRIZACION") {
      return { orden: 6, etiqueta: "EXCEPCION" };
    }

    return { orden: 99, etiqueta: "SIN CLASIFICAR" };
  }

  /**
   * Construye banderas de excepción operativa.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function calcularBanderas_(
    existenciaActual,
    minimo,
    maximo,
    excedenteTotal,
    tieneMaxMin,
    ubicacionSurtido
  ) {
    return {
      sobreObjetivo: tieneMaxMin ? existenciaActual > maximo : false,
      sinExcedente: excedenteTotal <= 0,
      sinUbicacion: !toStrUpper_(ubicacionSurtido),
      sinMaxMin: !tieneMaxMin,
      bajoMinimo: tieneMaxMin ? existenciaActual <= minimo : false
    };
  }
  
  // ==========================================================================
  // BALANCE POR ID ÚNICO Y ESTADO ACTUAL
  // ==========================================================================

  /**
   * Determina si una bodega pertenece a Casa Blanca.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function esCasaBlanca_(bodega) {
  const b = toStrUpper_(bodega || "");

  return (
    b === "CASA BLANCA 1" ||
    b === "CASA BLANCA 2" ||
    b.startsWith("CB1") ||
    b.startsWith("CB2")
  );
}

  /**
   * Determina si una bodega pertenece a excedentes.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function esBodegaExcedente_(bodega) {
  const b = toStrUpper_(bodega || "");

  return (
    b === "BODEGA 1" ||
    b === "BODEGA 2" ||
    b === "BODEGA 3" ||
    b === "BODEGA MOSTRADOR" ||
    b === "CUARTO ALTO RIESGO" ||
    b === "MOSTRADOR" ||
    b.startsWith("B1") ||
    b.startsWith("B2") ||
    b.startsWith("B3") ||
    b.startsWith("BM") ||
    b.startsWith("CU") ||
    b.startsWith("MO")
  );
}

  /**
   * Consolida saldos auditables por código e IdUnico.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function construirBalanceIdUnicoPorCodigo_() {
  const mapa = {};

  if (
    typeof EstadoActualExcedentesService === "undefined" ||
    !EstadoActualExcedentesService ||
    typeof EstadoActualExcedentesService.getAuditables !== "function"
  ) {
    console.warn(CFG.LOG_PREFIX + " EstadoActualExcedentesService no disponible.");
    return mapa;
  }

  let auditables = [];

  try {
    auditables = EstadoActualExcedentesService.getAuditables({
      tipoAuditoria: CFG.GLOBAL_AUDIT_TYPE,
      bodegaObjetivo: CFG.ALL_WAREHOUSES
    }) || [];
  } catch (error) {
    console.error(CFG.LOG_PREFIX + " Error al construir balance por IdUnico:", error);
    return mapa;
  }

  auditables.forEach(item => {
    const codigo = toStrUpper_(item.codigo || "");
    const idUnico = toStr_(item.idUnico || item.idunico || "");
    const bodegaActual = toStrUpper_(item.bodegaActual || item.bodega || "");
    const ubicacionActual = toStrUpper_(item.ubicacionActual || item.ubicacion || "");
    const saldoActual = toNum_(item.saldoActual || 0);

    if (!codigo) return;
    if (!idUnico) return;
    if (saldoActual <= 0) return;

    if (!mapa[codigo]) {
      mapa[codigo] = {
        codigo: codigo,

        excedentebodegaIdUnico: 0,
        excedentecasablancaIdUnico: 0,
        excedenteTotalIdUnico: 0,

        idsUnicosExcedenteBodega: [],
        idsUnicosExcedenteCasaBlanca: [],

        detalleIdUnicoExcedentes: [],
        detalleIdUnicoBodega: [],
        detalleIdUnicoCasaBlanca: []
      };
    }

    const detalleIdUnico = {
      idUnico: idUnico,
      bodega: bodegaActual,
      ubicacion: ubicacionActual,
      sku: codigo,
      cantidadIdUnico: saldoActual
    };

    if (esCasaBlanca_(bodegaActual)) {
      mapa[codigo].excedentecasablancaIdUnico += saldoActual;
      mapa[codigo].idsUnicosExcedenteCasaBlanca.push(idUnico);
      mapa[codigo].detalleIdUnicoCasaBlanca.push(detalleIdUnico);
      mapa[codigo].detalleIdUnicoExcedentes.push(detalleIdUnico);

    } else if (esBodegaExcedente_(bodegaActual)) {
      mapa[codigo].excedentebodegaIdUnico += saldoActual;
      mapa[codigo].idsUnicosExcedenteBodega.push(idUnico);
      mapa[codigo].detalleIdUnicoBodega.push(detalleIdUnico);
      mapa[codigo].detalleIdUnicoExcedentes.push(detalleIdUnico);
    }

    mapa[codigo].excedenteTotalIdUnico =
      mapa[codigo].excedentebodegaIdUnico +
      mapa[codigo].excedentecasablancaIdUnico;
  });

  return mapa;
}

  // ==========================================================================
  // CONSOLIDADO PRINCIPAL
  // ==========================================================================

  
  /**
   * Construye los registros consolidados del monitor.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function construirRegistros_() {
    assertDependencies_();
    const existencias = getExistencias_();
    const mapaCatalogo = buildCatalogoMap_();
    const mapaMaxMin = buildMaxMinMap_();
    const mapaUbicaciones = buildUbicacionesMap_();
    const balanceIdUnicoPorCodigo = construirBalanceIdUnicoPorCodigo_();

    const salida = existencias.map(item => {

      const codigo = toStrUpper_(item.codigo);
      const catalogo = mapaCatalogo[codigo] || {};
      const maxmin = mapaMaxMin[codigo] || {};
      const ubicacion = mapaUbicaciones[codigo] || {};

      const idproducto =
        toNum_(item.idproducto || 0) ||
        toNum_(catalogo.idproducto || 0) ||
        toNum_(ubicacion.idproducto || 0);

      const descripcion =
        toStrUpper_(item.descripcion) ||
        toStrUpper_(catalogo.descripcion) ||
        "";

      const statusCatalogo = toStrUpper_(catalogo.status || "");

      const ubicacionSurtido = toStrUpper_(ubicacion.ubicacion || "");
      const segmentoBodega = getBodegaSegmento_(ubicacionSurtido);

      const existenciaActual = toNum_(item.almacenbirlos || 0);
      const excedenteBodega = toNum_(item.excedentebodega || 0);
      const excedenteCasaBlanca = toNum_(item.excedentecasablanca || 0);
      const excedenteTotal = excedenteBodega + excedenteCasaBlanca;

      const balanceIdUnico = balanceIdUnicoPorCodigo[codigo] || null;

      const excedenteBodegaIdUnico = balanceIdUnico
        ? toNum_(balanceIdUnico.excedentebodegaIdUnico)
        : 0;

      const excedenteCasaBlancaIdUnico = balanceIdUnico
        ? toNum_(balanceIdUnico.excedentecasablancaIdUnico)
        : 0;

      const excedenteTotalIdUnico =
        excedenteBodegaIdUnico + excedenteCasaBlancaIdUnico;


      const minimo = toNum_(maxmin.minimo || 0);
      const maximo = toNum_(maxmin.maximo || 0);

      const tieneMaxMin = minimo > 0 || maximo > 0;

      const statusSemaforo = calcularStatus_(
        existenciaActual,
        minimo,
        maximo,
        tieneMaxMin
      );
      const substatusAmbar = calcularSubStatusAmbar_(
        existenciaActual,
        minimo,
        maximo,
        statusSemaforo
      );
      const accionOperativa = calcularAccionOperativa_(
        statusSemaforo,
        excedenteTotal,
        tieneMaxMin
      );
      const prioridad = calcularPrioridad_(
        statusSemaforo,
        accionOperativa,
        substatusAmbar
      );

      const cantidadObjetivoRelleno = tieneMaxMin
        ? Math.max(maximo - existenciaActual, 0)
        : 0;

      const rellenoPosibleConExcedente = Math.min(cantidadObjetivoRelleno, excedenteTotal);
      const rellenoCompleto = cantidadObjetivoRelleno > 0 && excedenteTotal >= cantidadObjetivoRelleno;

      const banderas = calcularBanderas_(
        existenciaActual,
        minimo,
        maximo,
        excedenteTotal,
        tieneMaxMin,
        ubicacionSurtido
      );

      let observacion = "";

      if (!tieneMaxMin) {
        observacion = "SKU sin mínimo/máximo declarado";
      } else if (!ubicacionSurtido) {
        observacion = "SKU sin ubicación de surtido asignada";
      } else if (statusSemaforo === "VERDE" && banderas.sobreObjetivo) {
        observacion = "Existencia arriba del máximo operativo";
      } else if (statusSemaforo === "AMBAR" && excedenteTotal > 0) {
        observacion = "Conviene hacer relleno preventivo";
      } else if (statusSemaforo === "AMBAR" && excedenteTotal <= 0) {
        observacion = "Nivel intermedio sin respaldo en excedentes";
      } else if (statusSemaforo === "ROJO" && excedenteTotal > 0) {
        observacion = "Atender con relleno urgente desde excedente";
      } else if (statusSemaforo === "ROJO" && excedenteTotal <= 0) {
        observacion = "Escalar a compras, sin respaldo interno";
      }

      return {
        // Identificación
        idproducto: idproducto,
        codigo: codigo,
        descripcion: descripcion,
        statuscatalogo: statusCatalogo,

        // Ubicación surtido
        idubicacion: toNum_(ubicacion.idubicacion || 0),
        ubicacionsurtido: ubicacionSurtido,
        bodega: toNum_(ubicacion.bodega || 0),
        pasillo: toNum_(ubicacion.pasillo || 0),
        anaquel: toNum_(ubicacion.anaquel || 0),
        repisa: toNum_(ubicacion.repisa || 0),

        // Segmentación por bodega / zona
        bodegakey: segmentoBodega.key,
        bodegalabel: segmentoBodega.label,

        // Operación
        existenciaactual: existenciaActual,
        minimo: minimo,
        maximo: maximo,
        umbralpreventivo: minimo * CFG.PREVENTIVE_FACTOR,

        // Excedentes disponibles desde EXISTENCIAS
        excedentebodega: excedenteBodega,
        excedentecasablanca: excedenteCasaBlanca,
        excedentetotal: excedenteTotal,

        // Excedentes disponibles desde ID ÚNICO / EstadoActualExcedentesService
        excedentebodegaIdUnico: excedenteBodegaIdUnico,
        excedentecasablancaIdUnico: excedenteCasaBlancaIdUnico,
        excedenteTotalIdUnico: excedenteTotalIdUnico,

        idsUnicosExcedenteBodega: balanceIdUnico
          ? [...(balanceIdUnico.idsUnicosExcedenteBodega || [])]
          : [],

        idsUnicosExcedenteCasaBlanca: balanceIdUnico
          ? [...(balanceIdUnico.idsUnicosExcedenteCasaBlanca || [])]
          : [],

        detalleIdUnicoExcedentes: balanceIdUnico
          ? [...(balanceIdUnico.detalleIdUnicoExcedentes || [])]
          : [],

        detalleIdUnicoBodega: balanceIdUnico
          ? [...(balanceIdUnico.detalleIdUnicoBodega || [])]
          : [],

        detalleIdUnicoCasaBlanca: balanceIdUnico
          ? [...(balanceIdUnico.detalleIdUnicoCasaBlanca || [])]
          : [],

        modoBalanceDisponibleIdUnico: !!balanceIdUnico,

        // Semáforo / acción
        statussemaforo: statusSemaforo,
        substatusambar: substatusAmbar,
        accionoperativa: accionOperativa,

        // Prioridad operativa
        prioridadorden: prioridad.orden,
        prioridadetiqueta: prioridad.etiqueta,

        // Capacidad de respuesta
        cantidadobjetivorelleno: cantidadObjetivoRelleno,
        rellenoposibleconexcedente: rellenoPosibleConExcedente,
        rellenocompleto: rellenoCompleto,

        // Banderas
        sobreobjetivo: banderas.sobreObjetivo,
        sinexcedente: banderas.sinExcedente,
        sinubicacion: banderas.sinUbicacion,
        sinmaxmin: banderas.sinMaxMin,
        bajominimo: banderas.bajoMinimo,

        // Texto operativo
        observacion: observacion
      };
    });

    /**
     * Orden final:
     * 1) prioridad
     * 2) código
     */
    return salida.sort((a, b) => {
      if (a.prioridadorden !== b.prioridadorden) {
        return a.prioridadorden - b.prioridadorden;
      }
      return String(a.codigo || "").localeCompare(String(b.codigo || ""), CFG.LOCALE, { numeric: true, sensitivity: "base" });
    });
  }

  // ==========================================================================
  // MÉTRICAS Y API PÚBLICA
  // ==========================================================================

  /**
   * Construye el resumen vacío compatible con la vista.
   *
   * @return {!Object} Métricas inicializadas en cero.
   * @private
   */
  /**
   * Construye métricas vacías compatibles.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function buildEmptySummary_() {
    return {
      totalRegistros: 0,
      verdes: 0,
      ambar: 0,
      rojos: 0,
      ambarConExcedente: 0,
      ambarSinExcedente: 0,
      rojosConExcedente: 0,
      rojosSinExcedente: 0,
      rellenosPreventivos: 0,
      rellenosUrgentes: 0,
      casosCompras: 0,
      sinUbicacion: 0,
      sinMaxMin: 0,
      sobreObjetivo: 0,
      porcentajeVerde: 0,
      porcentajeAmbar: 0,
      porcentajeRojo: 0,
      bodega1: 0,
      bodega2: 0,
      bodega3: 0,
      cuartoAltoRiesgo: 0,
      mostrador: 0,
      sinUbicacionSegmento: 0,
      otroSegmento: 0,
      totalIdsExcedente: 0,
      idsPendientesAcomodar: 0,
      idsVigentes: 0,
      idsAtendidos: 0,
      idsOtros: 0
    };
  }

  /**
   * Calcula métricas ejecutivas de los registros.
   *
   * @return {*} Resultado de la operación.
   * @private
   */
  function construirResumen_(registros) {
    const rows = safeArray_(registros);
    const metExcedentes = getMetricosExcedentes_();

    const resumen = {
      totalRegistros: rows.length,

      verdes: rows.filter(x => x.statussemaforo === "VERDE").length,
      ambar: rows.filter(x => x.statussemaforo === "AMBAR").length,
      rojos: rows.filter(x => x.statussemaforo === "ROJO").length,

      ambarConExcedente: rows.filter(x =>
        x.statussemaforo === "AMBAR" && x.excedentetotal > 0
      ).length,

      ambarSinExcedente: rows.filter(x =>
        x.statussemaforo === "AMBAR" && x.excedentetotal <= 0
      ).length,

      rojosConExcedente: rows.filter(x =>
        x.statussemaforo === "ROJO" && x.excedentetotal > 0
      ).length,

      rojosSinExcedente: rows.filter(x =>
        x.statussemaforo === "ROJO" && x.excedentetotal <= 0
      ).length,

      rellenosPreventivos: rows.filter(x =>
        x.accionoperativa === "RELLENO PREVENTIVO"
      ).length,

      rellenosUrgentes: rows.filter(x =>
        x.accionoperativa === "RELLENO URGENTE"
      ).length,

      casosCompras: rows.filter(x =>
        x.accionoperativa === "REPORTAR A COMPRAS"
      ).length,

      sinUbicacion: rows.filter(x => x.sinubicacion).length,
      sinMaxMin: rows.filter(x => x.sinmaxmin).length,
      sobreObjetivo: rows.filter(x => x.sobreobjetivo).length,

      porcentajeVerde: rows.length
        ? Number(((rows.filter(x => x.statussemaforo === "VERDE").length / rows.length) * 100).toFixed(2))
        : 0,

      porcentajeAmbar: rows.length
        ? Number(((rows.filter(x => x.statussemaforo === "AMBAR").length / rows.length) * 100).toFixed(2))
        : 0,

      porcentajeRojo: rows.length
        ? Number(((rows.filter(x => x.statussemaforo === "ROJO").length / rows.length) * 100).toFixed(2))
        : 0,

      // Segmentación por bodega / zona
      bodega1: rows.filter(x => x.bodegakey === "B1").length,
      bodega2: rows.filter(x => x.bodegakey === "B2").length,
      bodega3: rows.filter(x => x.bodegakey === "B3").length,
      cuartoAltoRiesgo: rows.filter(x => x.bodegakey === "CU").length,
      mostrador: rows.filter(x => x.bodegakey === "MO").length,
      sinUbicacionSegmento: rows.filter(x => x.bodegakey === "SIN_UBICACION").length,
      otroSegmento: rows.filter(x => x.bodegakey === "OTRO").length,

      // Métricos de BD-EXCEDENTES
      totalIdsExcedente: metExcedentes.totalIdsExcedente,
      idsPendientesAcomodar: metExcedentes.idsPendientesAcomodar,
      idsVigentes: metExcedentes.idsVigentes,
      idsAtendidos: metExcedentes.idsAtendidos,
      idsOtros: metExcedentes.idsOtros
    };

    return resumen;
  }

  /**
   * ------------------------------------------------------------
   * API PÚBLICA DEL SERVICE
   * ------------------------------------------------------------
   */

  /**
   * Construye la vista completa y tolera errores operativos.
   *
   * @return {!Object} Registros consolidados y resumen compatible.
   * @public
   */
  function getVista() {
    try {
      const registros = construirRegistros_();
      const resumen = construirResumen_(registros);

      console.log(
        CFG.LOG_PREFIX + " Vista construida.",
        JSON.stringify({
          totalRegistros: resumen.totalRegistros,
          verdes: resumen.verdes,
          ambar: resumen.ambar,
          rojos: resumen.rojos,
          casosCompras: resumen.casosCompras,
          sinUbicacion: resumen.sinUbicacion,
          sinMaxMin: resumen.sinMaxMin
        })
      );

      return {
        registros: registros || [],
        resumen: resumen || buildEmptySummary_()
      };
    } catch (error) {
      console.error(CFG.LOG_PREFIX + " getVista falló:", error);
      return {
        registros: [],
        resumen: buildEmptySummary_()
      };
    }
  }

  /**
   * Devuelve únicamente los registros consolidados.
   *
   * @return {!Array<!Object>} Registros o un arreglo vacío ante error.
   * @public
   */
  function getRegistros() {
    try {
      return construirRegistros_();
    } catch (error) {
      console.error(CFG.LOG_PREFIX + " getRegistros falló:", error);
      return [];
    }
  }

  /**
   * Devuelve únicamente el resumen ejecutivo del monitor.
   *
   * @return {!Object} Resumen compatible, incluso ante un error operativo.
   * @public
   */
  function getResumen() {
    try {
      return construirResumen_(construirRegistros_());
    } catch (error) {
      console.error(CFG.LOG_PREFIX + " getResumen falló:", error);
      return buildEmptySummary_();
    }
  }

  return Object.freeze({
    getVista,
    getRegistros,
    getResumen
  });
})();
