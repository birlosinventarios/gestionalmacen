/**
 * TEST-Reabastecimiento.gs
 *
 * @fileoverview Suite de pruebas manuales para el módulo de Reabastecimiento.
 * Incluye pruebas no destructivas, pruebas puras del dominio y un flujo de
 * integración destructivo protegido por una confirmación explícita.
 *
 * ALCANCE
 * - Validar contratos físicos de las tres hojas en GESTION5.
 * - Validar que los repositorios puedan leer hojas vacías o con información.
 * - Verificar la derivación de estados de solicitud.
 * - Medir candidatos por bodega sin modificar datos.
 * - Verificar errores públicos del Controller.
 * - Ejecutar opcionalmente un flujo real de creación, atención, escaneo y cierre.
 *
 * SEGURIDAD
 * - Ninguna función cuyo nombre empiece con TEST_REAB_SAFE_ escribe información.
 * - Las pruebas destructivas exigen options.confirmar === "EJECUTAR".
 * - El flujo destructivo requiere datos reales proporcionados por el operador.
 * - No se registran folios, códigos, ubicaciones, IDUNICO ni usuarios.
 * - Los resultados de prueba contienen únicamente conteos, booleanos y tiempos.
 *
 * REQUISITOS
 * - z1-Constants.gs con REABASTECIMIENTO_CONFIG.
 * - z0-UtilidadesDatos.gs con testReabastecimientoUtilities_().
 * - Los tres repositorios de Reabastecimiento.
 * - ReabastecimientoService y ReabastecimientoController.
 *
 * EJECUCIÓN RECOMENDADA
 * 1. TEST_REAB_SAFE_ejecutarTodo();
 * 2. Revisar resultados y registros.
 * 3. Ejecutar pruebas destructivas solamente con un caso controlado.
 *
 * @author Sigifredo de la Cruz Ramos
 * @version TEST-REABASTECIMIENTO-2026-11-10-02
 */

const TEST_REAB_CONFIG = Object.freeze({
  MODULE: "REABASTECIMIENTO_TEST",
  DESTRUCTIVE_CONFIRMATION: "EJECUTAR",
  DEFAULT_WAREHOUSE: "TODAS",
  MAX_RESPONSE_SAMPLE_CHARS: 250000,
  EXPECTED_WIDTHS: Object.freeze({
    SOLICITUDES: 12,
    PARTIDAS: 9,
    DETALLES: 9
  })
});

/**
 * Ejecuta una prueba y devuelve un resultado uniforme sin interrumpir la suite.
 *
 * @param {string} name Identificador legible de la prueba.
 * @param {function(): *} executor Función de prueba.
 * @return {!Object} Resultado normalizado.
 * @private
 */
function TEST_REAB_run_(name, executor) {
  const startedAt = Date.now();
  try {
    const data = executor();
    const result = {
      prueba: String(name || "SIN_NOMBRE"),
      ok: true,
      elapsedMs: Date.now() - startedAt,
      data: data === undefined ? null : data
    };
    console.log(
      "[TEST][REAB][OK] " +
      JSON.stringify(TEST_REAB_sanitizeResult_(result))
    );
    return result;
  } catch (error) {
    const result = {
      prueba: String(name || "SIN_NOMBRE"),
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: {
        name: String(error && error.name || "Error"),
        code: String(error && error.code || ""),
        message: String(error && error.message || error || "")
      }
    };
    console.error(
      "[TEST][REAB][ERROR] " +
      JSON.stringify(TEST_REAB_sanitizeResult_(result))
    );
    return result;
  }
}

/**
 * Reduce resultados antes de registrarlos para evitar datos operativos.
 *
 * @param {!Object} result Resultado completo.
 * @return {!Object} Resumen seguro para Cloud Logging.
 * @private
 */
function TEST_REAB_sanitizeResult_(result) {
  const data = result && result.data;
  const safe = {
    prueba: result.prueba,
    ok: result.ok,
    elapsedMs: result.elapsedMs
  };
  if (result.error) {
    safe.error = {
      name: result.error.name,
      code: result.error.code,
      hasMessage: Boolean(result.error.message)
    };
  }
  if (Array.isArray(data)) safe.resultCount = data.length;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    ["total", "totalPartidas", "totalDetalles", "cajasUnicas", "responseChars"]
      .forEach(function(key) {
        if (Object.prototype.hasOwnProperty.call(data, key)) safe[key] = data[key];
      });
  }
  return safe;
}

/**
 * Exige una condición y genera un error descriptivo cuando no se cumple.
 *
 * @param {*} condition Condición esperada.
 * @param {string} message Mensaje de diagnóstico.
 * @return {void}
 * @private
 */
function TEST_REAB_assert_(condition, message) {
  if (!condition) throw new Error(String(message || "Aserción incumplida."));
}

/**
 * Exige igualdad estricta.
 *
 * @param {*} actual Valor obtenido.
 * @param {*} expected Valor esperado.
 * @param {string} message Contexto del error.
 * @return {void}
 * @private
 */
function TEST_REAB_assertEqual_(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      String(message || "Valores distintos.") +
      " Esperado=" + String(expected) +
      ", actual=" + String(actual) + "."
    );
  }
}

/**
 * Calcula de forma tolerante el tamaño JSON de un valor.
 *
 * @param {*} value Valor serializable.
 * @return {number} Cantidad de caracteres.
 * @private
 */
function TEST_REAB_jsonChars_(value) {
  try {
    return JSON.stringify(value).length;
  } catch (error) {
    return 0;
  }
}

/**
 * Verifica la confirmación obligatoria de una prueba destructiva.
 *
 * @param {*} options Opciones del operador.
 * @return {!Object} Objeto validado.
 * @throws {Error} Si no existe confirmación explícita.
 * @private
 */
function TEST_REAB_requireDestructiveConfirmation_(options) {
  const input = options && typeof options === "object" ? options : {};
  if (input.confirmar !== TEST_REAB_CONFIG.DESTRUCTIVE_CONFIRMATION) {
    throw new Error(
      "Prueba destructiva bloqueada. Use confirmar: \"" +
      TEST_REAB_CONFIG.DESTRUCTIVE_CONFIRMATION + "\"."
    );
  }
  return input;
}

// =============================================================================
// SUITE NO DESTRUCTIVA
// =============================================================================

/**
 * Ejecuta todas las pruebas seguras y devuelve un resumen consolidado.
 *
 * @param {string=} bodega Bodega para medir candidatos; por defecto TODAS.
 * @return {!Object} Resumen de la suite.
 */
function TEST_REAB_SAFE_ejecutarTodo(bodega) {
  const results = [
    TEST_REAB_SAFE_validarConfiguracion(),
    TEST_REAB_SAFE_validarContratos(),
    TEST_REAB_SAFE_leerRepositorios(),
    TEST_REAB_SAFE_validarIntegridadRelacional(),
    TEST_REAB_SAFE_derivarEstados(),
    TEST_REAB_SAFE_listarSolicitudes(),
    TEST_REAB_SAFE_validarErroresController(),
    TEST_REAB_SAFE_medirCandidatos(bodega || TEST_REAB_CONFIG.DEFAULT_WAREHOUSE)
  ];
  const summary = {
    ok: results.every(function(result) { return result.ok; }),
    total: results.length,
    correctas: results.filter(function(result) { return result.ok; }).length,
    fallidas: results.filter(function(result) { return !result.ok; }).length,
    elapsedMs: results.reduce(function(total, result) {
      return total + Number(result.elapsedMs || 0);
    }, 0),
    resultados: results
  };
  console.log(
    "[TEST][REAB][SUITE] " +
    JSON.stringify({
      ok: summary.ok,
      total: summary.total,
      correctas: summary.correctas,
      fallidas: summary.fallidas,
      elapsedMs: summary.elapsedMs
    })
  );
  return summary;
}

/**
 * Valida constantes, anchos, rutas y estados declarativos.
 *
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_SAFE_validarConfiguracion() {
  return TEST_REAB_run_("CONFIGURACION", function() {
    TEST_REAB_assert_(
      typeof REABASTECIMIENTO_CONFIG === "object",
      "Falta REABASTECIMIENTO_CONFIG."
    );
    TEST_REAB_assert_(
      typeof REABASTECIMIENTO_HEADERS === "object",
      "Falta REABASTECIMIENTO_HEADERS."
    );
    TEST_REAB_assertEqual_(
      REABASTECIMIENTO_HEADERS.SOLICITUDES.length,
      TEST_REAB_CONFIG.EXPECTED_WIDTHS.SOLICITUDES,
      "Ancho de solicitudes inválido."
    );
    TEST_REAB_assertEqual_(
      REABASTECIMIENTO_HEADERS.PARTIDAS.length,
      TEST_REAB_CONFIG.EXPECTED_WIDTHS.PARTIDAS,
      "Ancho de partidas inválido."
    );
    TEST_REAB_assertEqual_(
      REABASTECIMIENTO_HEADERS.DETALLES.length,
      TEST_REAB_CONFIG.EXPECTED_WIDTHS.DETALLES,
      "Ancho de detalles inválido."
    );
    TEST_REAB_assertEqual_(
      SHEETS.REABASTECIMIENTO_SOLICITUDES.file,
      "GESTION5",
      "Solicitudes debe pertenecer a GESTION5."
    );
    TEST_REAB_assert_(
      APPALMACEN_ROUTING.PAGES_ALLOWED.includes("Reabastecimiento"),
      "La ruta Reabastecimiento no está permitida."
    );
    TEST_REAB_assert_(
      APPALMACEN_ROUTING.PAGES_ALLOWED.includes("ReabastecimientoDetalles"),
      "La ruta ReabastecimientoDetalles no está permitida."
    );
    return {
      version: REABASTECIMIENTO_CONFIG.VERSION,
      solicitudesWidth: REABASTECIMIENTO_HEADERS.SOLICITUDES.length,
      partidasWidth: REABASTECIMIENTO_HEADERS.PARTIDAS.length,
      detallesWidth: REABASTECIMIENTO_HEADERS.DETALLES.length
    };
  });
}

/**
 * Valida los encabezados físicos de GESTION5.
 *
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_SAFE_validarContratos() {
  return TEST_REAB_run_("CONTRATOS_FISICOS", function() {
    const contracts = testReabastecimientoUtilities_();
    TEST_REAB_assert_(Array.isArray(contracts), "La validación debe devolver un arreglo.");
    TEST_REAB_assertEqual_(contracts.length, 3, "Deben validarse tres hojas.");
    return {
      total: contracts.length,
      widths: contracts.map(function(contract) {
        return Number(contract.width || contract.expectedWidth || 0);
      })
    };
  });
}

/**
 * Lee los tres repositorios sin realizar escrituras.
 *
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_SAFE_leerRepositorios() {
  return TEST_REAB_run_("LECTURA_REPOSITORIOS", function() {
    const solicitudes = ReabastecimientoSolicitudesRepository.getAll();
    const partidas = ReabastecimientoPartidasRepository.getAll();
    const detalles = ReabastecimientoDetallesRepository.getAll();
    TEST_REAB_assert_(Array.isArray(solicitudes), "Solicitudes no devolvió un arreglo.");
    TEST_REAB_assert_(Array.isArray(partidas), "Partidas no devolvió un arreglo.");
    TEST_REAB_assert_(Array.isArray(detalles), "Detalles no devolvió un arreglo.");
    return {
      solicitudes: solicitudes.length,
      partidas: partidas.length,
      detalles: detalles.length
    };
  });
}


/**
 * Verifica la relación solicitud + código y la ausencia de códigos duplicados.
 *
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_SAFE_validarIntegridadRelacional() {
  return TEST_REAB_run_("INTEGRIDAD_RELACIONAL", function() {
    const partidas = ReabastecimientoPartidasRepository.getAll();
    const detalles = ReabastecimientoDetallesRepository.getAll();
    const partKeys = Object.create(null);
    let duplicateParts = 0;
    partidas.forEach(function(part) {
      const key = part.idSolicitud + "|" + part.codigoSolicitado;
      if (partKeys[key]) duplicateParts += 1;
      partKeys[key] = true;
    });
    const orphanDetails = detalles.filter(function(detail) {
      return !partKeys[detail.idSolicitud + "|" + detail.codigo];
    }).length;
    TEST_REAB_assertEqual_(duplicateParts, 0,
      "Existen códigos duplicados dentro de una solicitud.");
    TEST_REAB_assertEqual_(orphanDetails, 0,
      "Existen detalles sin una partida coincidente por solicitud + código.");
    return {
      totalPartidas: partidas.length,
      totalDetalles: detalles.length,
      partidasDuplicadas: duplicateParts,
      detallesHuerfanos: orphanDetails
    };
  });
}

/**
 * Comprueba todos los estados derivados y un caso inconsistente.
 *
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_SAFE_derivarEstados() {
  return TEST_REAB_run_("ESTADOS_DERIVADOS", function() {
    const derive = ReabastecimientoService.derivarEstadoSolicitud;
    const states = REABASTECIMIENTO_CONFIG.SOLICITUD_ESTADOS_DERIVADOS;
    TEST_REAB_assertEqual_(
      derive({}),
      states.ABIERTA,
      "Solicitud vacía debe ser ABIERTA."
    );
    TEST_REAB_assertEqual_(
      derive({ fechaInicioAtencion: "10/11/2026", horaInicioAtencion: "14:01" }),
      states.EN_ATENCION,
      "Solicitud con inicio debe estar EN_ATENCION."
    );
    TEST_REAB_assertEqual_(
      derive({
        fechaInicioAtencion: "10/11/2026",
        horaInicioAtencion: "14:01",
        fechaCierreAtencion: "10/11/2026",
        horaCierreAtencion: "15:20"
      }),
      states.CERRADA,
      "Solicitud con inicio y cierre debe estar CERRADA."
    );
    TEST_REAB_assertEqual_(
      derive({ fechaCierreAtencion: "10/11/2026", horaCierreAtencion: "15:20" }),
      states.INCONSISTENTE,
      "Cierre sin inicio debe ser INCONSISTENTE."
    );
    TEST_REAB_assertEqual_(
      derive({ fechaInicioAtencion: "10/11/2026" }),
      states.INCONSISTENTE,
      "Fecha de inicio sin hora debe ser INCONSISTENTE."
    );
    return { total: 5 };
  });
}

/**
 * Valida el contrato de listado a través del Controller.
 *
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_SAFE_listarSolicitudes() {
  return TEST_REAB_run_("CONTROLLER_LISTADO", function() {
    const response = ReabastecimientoController_getSolicitudes({});
    TEST_REAB_assert_(response && response.ok === true, "El Controller debe responder ok=true.");
    TEST_REAB_assert_(response.data && Array.isArray(response.data.solicitudes),
      "data.solicitudes debe ser un arreglo.");
    TEST_REAB_assertEqual_(
      response.data.total,
      response.data.solicitudes.length,
      "El total no coincide con la colección."
    );
    return {
      total: response.data.total,
      responseChars: TEST_REAB_jsonChars_(response),
      elapsedMsController: Number(response.metadata && response.metadata.elapsedMs || 0)
    };
  });
}

/**
 * Comprueba que el Controller rechace payloads incompletos sin escribir.
 *
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_SAFE_validarErroresController() {
  return TEST_REAB_run_("ERRORES_CONTROLLER", function() {
    const cases = [
      function() { ReabastecimientoController_crearSolicitud({}); },
      function() { ReabastecimientoController_getDetalleSolicitud(""); },
      function() { ReabastecimientoController_atenderPartida({}); },
      function() { ReabastecimientoController_validarIdUnico({}); },
      function() { ReabastecimientoController_registrarIdUnico({}); },
      function() { ReabastecimientoController_cerrarSolicitud({}); }
    ];
    const results = cases.map(function(executor) {
      try {
        executor();
        return false;
      } catch (error) {
        return String(error && error.message || "").includes("REAB_PAYLOAD_INVALIDO");
      }
    });
    TEST_REAB_assert_(results.every(Boolean), "No todos los payloads inválidos fueron rechazados.");
    return { total: results.length, rechazados: results.filter(Boolean).length };
  });
}

/**
 * Mide candidatos elegibles sin escribir información.
 *
 * @param {string=} bodega Bodega o TODAS.
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_SAFE_medirCandidatos(bodega) {
  return TEST_REAB_run_("CANDIDATOS", function() {
    const response = ReabastecimientoController_getCandidatosPorBodega(
      bodega || TEST_REAB_CONFIG.DEFAULT_WAREHOUSE
    );
    TEST_REAB_assert_(response && response.ok === true, "Respuesta inválida del Controller.");
    const data = response.data || {};
    const records = Array.isArray(data.registros) ? data.registros : [];
    const invalid = records.some(function(item) {
      return !item ||
        !item.codigo ||
        !item.ubicacionSurtido ||
        Number(item.cantidadObjetivoRelleno || 0) <= 0 ||
        Number(item.excedenteDisponibleIdUnico || 0) <= 0 ||
        !["RELLENO PREVENTIVO", "RELLENO URGENTE"].includes(item.accionOperativa);
    });
    TEST_REAB_assert_(!invalid, "La respuesta contiene candidatos no elegibles.");
    const responseChars = TEST_REAB_jsonChars_(response);
    TEST_REAB_assert_(
      responseChars <= TEST_REAB_CONFIG.MAX_RESPONSE_SAMPLE_CHARS || records.length > 0,
      "La respuesta excede el umbral de muestra sin registros."
    );
    return {
      total: records.length,
      responseChars: responseChars,
      elapsedMsController: Number(response.metadata && response.metadata.elapsedMs || 0)
    };
  });
}

// =============================================================================
// SUITE DESTRUCTIVA CONTROLADA
// =============================================================================

/**
 * Crea una solicitud real con datos proporcionados explícitamente.
 *
 * @param {!Object} options Configuración destructiva:
 * {
 *   confirmar: "EJECUTAR",
 *   solicitante: string,
 *   bodega: string,
 *   partidas: Array<{codigo:string, ubicacion:string}>
 * }
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_DESTRUCTIVO_crearSolicitud(options) {
  return TEST_REAB_run_("DESTRUCTIVO_CREAR_SOLICITUD", function() {
    const input = TEST_REAB_requireDestructiveConfirmation_(options);
    TEST_REAB_assert_(input.solicitante, "Falta solicitante.");
    TEST_REAB_assert_(input.bodega, "Falta bodega.");
    TEST_REAB_assert_(Array.isArray(input.partidas) && input.partidas.length > 0,
      "Faltan partidas.");
    const response = ReabastecimientoController_crearSolicitud({
      solicitante: input.solicitante,
      bodega: input.bodega,
      partidas: input.partidas
    });
    TEST_REAB_assert_(response && response.ok === true, "No se creó la solicitud.");
    return {
      creada: true,
      totalPartidas: Number(response.data && response.data.skusSolicitados || 0),
      responseChars: TEST_REAB_jsonChars_(response)
    };
  });
}

/**
 * Marca una partida real como atendida.
 *
 * @param {!Object} options Debe incluir confirmar, idSolicitud,
 * idPartidaConsecutivo y usuario.
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_DESTRUCTIVO_atenderPartida(options) {
  return TEST_REAB_run_("DESTRUCTIVO_ATENDER_PARTIDA", function() {
    const input = TEST_REAB_requireDestructiveConfirmation_(options);
    const response = ReabastecimientoController_atenderPartida({
      idSolicitud: input.idSolicitud,
      idPartidaConsecutivo: input.idPartidaConsecutivo,
      usuario: input.usuario
    });
    TEST_REAB_assert_(response && response.ok === true, "No se atendió la partida.");
    return {
      atendida: Boolean(response.data && response.data.atendida),
      yaAtendida: Boolean(response.data && response.data.yaAtendida)
    };
  });
}

/**
 * Valida un IDUNICO real sin persistirlo.
 *
 * @param {!Object} options Debe incluir confirmar, solicitud, partida e IDUNICO.
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_DESTRUCTIVO_validarIdUnico(options) {
  return TEST_REAB_run_("DESTRUCTIVO_VALIDAR_IDUNICO", function() {
    const input = TEST_REAB_requireDestructiveConfirmation_(options);
    const response = ReabastecimientoController_validarIdUnico({
      idSolicitud: input.idSolicitud,
      idPartidaConsecutivo: input.idPartidaConsecutivo,
      idUnico: input.idUnico
    });
    TEST_REAB_assert_(response && response.ok === true, "El IDUNICO no fue validado.");
    return {
      valido: Boolean(response.data && response.data.valido),
      cantidadPositiva: Number(response.data && response.data.cantidad || 0) > 0
    };
  });
}

/**
 * Registra un IDUNICO real.
 *
 * @param {!Object} options Debe incluir confirmar, solicitud, partida, IDUNICO y
 * usuario.
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_DESTRUCTIVO_registrarIdUnico(options) {
  return TEST_REAB_run_("DESTRUCTIVO_REGISTRAR_IDUNICO", function() {
    const input = TEST_REAB_requireDestructiveConfirmation_(options);
    const response = ReabastecimientoController_registrarIdUnico({
      idSolicitud: input.idSolicitud,
      idPartidaConsecutivo: input.idPartidaConsecutivo,
      idUnico: input.idUnico,
      usuario: input.usuario
    });
    TEST_REAB_assert_(response && response.ok === true, "El IDUNICO no fue registrado.");
    return {
      creado: true,
      cantidadPositiva: Number(response.data && response.data.cantidad || 0) > 0
    };
  });
}

/**
 * Cierra una solicitud real.
 *
 * @param {!Object} options Debe incluir confirmar, idSolicitud y usuario.
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_DESTRUCTIVO_cerrarSolicitud(options) {
  return TEST_REAB_run_("DESTRUCTIVO_CERRAR_SOLICITUD", function() {
    const input = TEST_REAB_requireDestructiveConfirmation_(options);
    const response = ReabastecimientoController_cerrarSolicitud({
      idSolicitud: input.idSolicitud,
      usuario: input.usuario
    });
    TEST_REAB_assert_(response && response.ok === true, "La solicitud no fue cerrada.");
    return {
      cerrada: Boolean(response.data && response.data.cerrada),
      yaCerrada: Boolean(response.data && response.data.yaCerrada),
      cajasInvolucradas: Number(response.data && response.data.cajasInvolucradas || 0)
    };
  });
}

/**
 * Consulta de verificación posterior a un flujo destructivo.
 *
 * Aunque no escribe, exige confirmación porque normalmente expone el resultado de
 * una prueba que sí modificó datos reales.
 *
 * @param {!Object} options Debe incluir confirmar e idSolicitud.
 * @return {!Object} Resultado de prueba.
 */
function TEST_REAB_DESTRUCTIVO_verificarSolicitud(options) {
  return TEST_REAB_run_("DESTRUCTIVO_VERIFICAR_SOLICITUD", function() {
    const input = TEST_REAB_requireDestructiveConfirmation_(options);
    const response = ReabastecimientoController_getDetalleSolicitud(
      input.idSolicitud
    );
    TEST_REAB_assert_(response && response.ok === true, "No se obtuvo el detalle.");
    const data = response.data || {};
    return {
      estado: data.solicitud && data.solicitud.estado || "",
      totalPartidas: Number(data.totalPartidas || 0),
      totalDetalles: Number(data.totalDetalles || 0),
      cajasUnicas: Number(data.cajasUnicas || 0)
    };
  });
}
