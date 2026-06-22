/**
 * MonitorReabastecimientoService.gs
 */

const MonitorReabastecimientoService = (() => {

  /**
   * ------------------------------------------------------------
   * HELPERS BASE
   * ------------------------------------------------------------
   */

  function safeArray_(value) {
    return Array.isArray(value) ? value : [];
  }

  function getExistencias_() {
    try {
      return safeArray_(ExistenciasRepository.getAll());
    } catch (error) {
      console.error("❌ Error al leer ExistenciasRepository:", error);
      return [];
    }
  }

  function getCatalogo_() {
    try {
      return safeArray_(CatalogoRepository.getAll());
    } catch (error) {
      console.error("❌ Error al leer CatalogoRepository:", error);
      return [];
    }
  }

  function getExcedentes_() {
    try {
      return safeArray_(ExcedentesRepository.getAll());
    } catch (error) {
      console.error("❌ Error al leer ExcedentesRepository:", error);
      return [];
    }
  }

  function getMaxMin_() {
    try {
      if (
        typeof MaxMinRepository !== "undefined" &&
        MaxMinRepository &&
        typeof MaxMinRepository.getAll === "function"
      ) {
        return safeArray_(MaxMinRepository.getAll());
      }

      console.warn("⚠️ MaxMinRepository no está disponible. Se continuará sin parametrización MAX/MIN.");
      return [];
    } catch (error) {
      console.error("❌ Error al leer MaxMinRepository:", error);
      return [];
    }
  }

  /**
   * Conserva una sola ubicación válida por SKU.
   * Esto mantiene compatibilidad con la lógica V1, donde el saldo está a nivel SKU
   * y no a nivel ubicación física detallada.
   */
  function getUbicacionesSurtidoSanitizadas_() {
    const mapa = {};

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
      console.error("❌ Error al sanear ubicaciones de surtido:", error);
    }

    return Object.values(mapa).sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  function buildMapByCodigo_(rows) {
    return safeArray_(rows).reduce((acc, item) => {
      const codigo = toStrUpper_(item.codigo);
      if (!codigo) return acc;
      acc[codigo] = item;
      return acc;
    }, {});
  }

  function buildCatalogoMap_() {
    return buildMapByCodigo_(getCatalogo_());
  }

  function buildMaxMinMap_() {
    return buildMapByCodigo_(getMaxMin_());
  }

  function buildUbicacionesMap_() {
    return buildMapByCodigo_(getUbicacionesSurtidoSanitizadas_());
  }

  /**
   * ------------------------------------------------------------
   * SEGMENTACIÓN POR BODEGA / ZONA
   * ------------------------------------------------------------
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

  /**
   * ------------------------------------------------------------
   * EXCEDENTES - MÉTRICOS DE APOYO
   * ------------------------------------------------------------
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

  /**
   * ------------------------------------------------------------
   * LÓGICA DE NEGOCIO DEL SEMÁFORO
   * ------------------------------------------------------------
   */

  function calcularStatus_(existenciaActual, minimo, maximo, tieneMaxMin) {
    if (!tieneMaxMin) return "SIN_PARAMETRIZACION";

    if (existenciaActual >= maximo) return "VERDE";
    if (existenciaActual <= minimo) return "ROJO";
    return "AMBAR";
  }

  function calcularSubStatusAmbar_(existenciaActual, minimo, maximo, status) {
    if (status !== "AMBAR") return "";

    const umbralPreventivo = minimo * 1.5;

    if (existenciaActual <= umbralPreventivo) {
      return "AMBAR_BAJO";
    }

    if (existenciaActual > umbralPreventivo && existenciaActual < maximo) {
      return "AMBAR_ALTO";
    }

    return "AMBAR";
  }

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

  function calcularBanderas_(existenciaActual, minimo, maximo, excedenteTotal, tieneMaxMin, ubicacionSurtido) {
    return {
      sobreObjetivo: tieneMaxMin ? existenciaActual > maximo : false,
      sinExcedente: excedenteTotal <= 0,
      sinUbicacion: !toStrUpper_(ubicacionSurtido),
      sinMaxMin: !tieneMaxMin,
      bajoMinimo: tieneMaxMin ? existenciaActual <= minimo : false
    };
  }

  /**
   * ------------------------------------------------------------
   * CONSOLIDADO PRINCIPAL
   * ------------------------------------------------------------
   */

  function construirRegistros_() {
    const existencias = getExistencias_();
    const mapaCatalogo = buildCatalogoMap_();
    const mapaMaxMin = buildMaxMinMap_();
    const mapaUbicaciones = buildUbicacionesMap_();

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

      const minimo = toNum_(maxmin.minimo || 0);
      const maximo = toNum_(maxmin.maximo || 0);

      const tieneMaxMin = minimo > 0 || maximo > 0;

      const statusSemaforo = calcularStatus_(existenciaActual, minimo, maximo, tieneMaxMin);
      const substatusAmbar = calcularSubStatusAmbar_(existenciaActual, minimo, maximo, statusSemaforo);
      const accionOperativa = calcularAccionOperativa_(statusSemaforo, excedenteTotal, tieneMaxMin);
      const prioridad = calcularPrioridad_(statusSemaforo, accionOperativa, substatusAmbar);

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
        umbralpreventivo: minimo * 1.5,

        // Excedentes disponibles
        excedentebodega: excedenteBodega,
        excedentecasablanca: excedenteCasaBlanca,
        excedentetotal: excedenteTotal,

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
      return String(a.codigo || "").localeCompare(String(b.codigo || ""));
    });
  }

  /**
   * ------------------------------------------------------------
   * MÉTRICOS / HEADERS
   * ------------------------------------------------------------
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

  return {

    /**
     * Vista completa para frontend
     */
    getVista: function() {
      try {
        const registros = construirRegistros_();
        const resumen = construirResumen_(registros);

        console.log("======================================================");
        console.log("📦 [MonitorReabastecimientoService] RESUMEN DE CARGA");
        console.log("======================================================");
        console.log("📊 Total registros:", resumen.totalRegistros);
        console.log("🟢 Verdes:", resumen.verdes);
        console.log("🟠 Ámbar:", resumen.ambar);
        console.log("🔴 Rojos:", resumen.rojos);
        console.log("🚨 Casos a compras:", resumen.casosCompras);
        console.log("📍 Sin ubicación:", resumen.sinUbicacion);
        console.log("⚙️ Sin MAX/MIN:", resumen.sinMaxMin);
        console.log("🏢 Bodega 1:", resumen.bodega1);
        console.log("🏢 Bodega 2:", resumen.bodega2);
        console.log("🏢 Bodega 3:", resumen.bodega3);
        console.log("☢️ Cuarto Alto Riesgo:", resumen.cuartoAltoRiesgo);
        console.log("🛒 Mostrador:", resumen.mostrador);
        console.log("======================================================");

        return {
          registros: registros || [],
          resumen: resumen || {}
        };

      } catch (error) {
        console.error("❌ Error MonitorReabastecimientoService.getVista:", error);

        return {
          registros: [],
          resumen: {
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
          }
        };
      }
    },

    /**
     * Solo registros consolidados
     */
    getRegistros: function() {
      try {
        return construirRegistros_();
      } catch (error) {
        console.error("❌ Error MonitorReabastecimientoService.getRegistros:", error);
        return [];
      }
    },

    /**
     * Solo resumen / headers
     */
    getResumen: function() {
      try {
        const registros = construirRegistros_();
        return construirResumen_(registros);
      } catch (error) {
        console.error("❌ Error MonitorReabastecimientoService.getResumen:", error);
        return {};
      }
    }

  };

})();