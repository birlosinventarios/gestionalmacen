/**
 * VerificacionEntradaController.gs
 *
 * Puerta de entrada pública entre google.script.run y
 * VerificacionEntradaService.
 *
 * Responsabilidades:
 * - Exponer funciones globales invocables desde el navegador.
 * - Crear y finalizar trackers de rendimiento.
 * - Resolver el contexto básico del usuario en el servidor.
 * - Sanitizar el contrato de respuesta para google.script.run.
 * - Delegar reglas de negocio al Service.
 * - Correlacionar una lectura del cliente con su ejecución en servidor.
 *
 * No es responsabilidad de este archivo:
 * - Leer o escribir hojas directamente.
 * - Parsear XML.
 * - Interpretar códigos de barras.
 * - Autorizar operaciones con datos enviados por el cliente.
 * - Calcular faltantes, sobrantes o métricas operativas.
 */

/**
 * Resuelve el contexto básico del usuario del lado servidor.
 *
 * El rol no se toma del payload del navegador. Mientras no exista una
 * integración explícita con UsuariosRepository/AuthService, se usa
 * OPERADOR como valor conservador.
 *
 * @return {{usuario:string, email:string, rol:string}}
 */
function VerificacionEntradaController_getUserContext_() {
  let email = "";

  try {
    email = toStr_(Session.getActiveUser().getEmail());
  } catch (error) {
    email = "";
  }

  if (!email) {
    try {
      email = toStr_(Session.getEffectiveUser().getEmail());
    } catch (error) {
      email = "";
    }
  }

  return {
    usuario: email || "USUARIO_NO_IDENTIFICADO",
    email: email,
    rol: "OPERADOR"
  };
}

/**
 * Convierte el resultado del Service a un objeto plano serializable.
 *
 * Además devuelve el tamaño del JSON ya generado para evitar que el
 * Controller vuelva a ejecutar JSON.stringify únicamente para medirlo.
 *
 * @param {*} value Resultado del Service.
 * @param {Object} trace Tracker activo.
 * @return {{value:*, jsonChars:number}}
 */
function VerificacionEntradaController_toPlain_(value, trace) {
  if (value === undefined) {
    return {
      value: null,
      jsonChars: 4
    };
  }

  const stringifyStartedAt = Date.now();
  let json = "";

  try {
    json = JSON.stringify(value);

    perfMark_(trace, "CONTROLLER_JSON_STRINGIFIED", {
      elapsedMs: Date.now() - stringifyStartedAt,
      responseChars: json.length
    });

    const parseStartedAt = Date.now();
    const plainValue = JSON.parse(json);

    perfMark_(trace, "CONTROLLER_JSON_PARSED", {
      elapsedMs: Date.now() - parseStartedAt,
      responseChars: json.length
    });

    return {
      value: plainValue,
      jsonChars: json.length
    };
  } catch (error) {
    const safeError = new Error(
      "No fue posible serializar la respuesta de Verificación de entrada."
    );

    safeError.code = "VE_RESPONSE_SERIALIZATION_ERROR";
    throw safeError;
  }
}

/**
 * Genera una respuesta uniforme para el navegador.
 *
 * @param {*} data Resultado del Service.
 * @param {Object} trace Tracker activo.
 * @return {{response:{ok:boolean,requestId:string,data:*},dataChars:number}}
 */
function VerificacionEntradaController_success_(data, trace) {
  const startedAt = Date.now();
  const plain = VerificacionEntradaController_toPlain_(data, trace);

  const response = {
    ok: true,
    requestId: trace && trace.requestId ? trace.requestId : "",
    data: plain.value
  };

  perfMark_(trace, "CONTROLLER_SUCCESS_WRAPPED", {
    elapsedMs: Date.now() - startedAt,
    dataChars: plain.jsonChars
  });

  return {
    response: response,
    dataChars: plain.jsonChars
  };
}

/**
 * Estima el tamaño total de la respuesta sin volver a serializar data.
 *
 * Se suman los caracteres del JSON de data y una sobrecarga pequeña del
 * contrato {ok, requestId, data}. Es una métrica operativa aproximada,
 * suficiente para detectar respuestas anormalmente grandes.
 *
 * @param {number} dataChars Tamaño serializado de data.
 * @param {string} requestId Identificador de solicitud.
 * @return {number}
 */
function VerificacionEntradaController_estimateResponseChars_(
  dataChars,
  requestId
) {
  return Number(dataChars || 0) +
    String(requestId || "").length +
    40;
}

/**
 * Ejecuta una operación pública con tracker y contrato uniforme.
 *
 * @param {string} label Nombre de la operación.
 * @param {Object=} metadata Metadatos no sensibles.
 * @param {Function} executor Operación que recibe trace y contexto.
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function VerificacionEntradaController_execute_(
  label,
  metadata,
  executor
) {
  if (typeof executor !== "function") {
    throw new Error(
      "VerificacionEntradaController_execute_: executor inválido."
    );
  }

  const operation = "VE_CONTROLLER_" + toStrUpper_(label);
  const trace = perfStart_(operation, metadata || {});
  const controllerStartedAt = Date.now();

  try {
    const userStartedAt = Date.now();
    const context = VerificacionEntradaController_getUserContext_();

    perfMark_(trace, "CONTROLLER_USER_CONTEXT_READY", {
      elapsedMs: Date.now() - userStartedAt,
      hasEmail: Boolean(context.email),
      role: context.rol
    });

    const wrapperStartedAt = Date.now();

    const result = execController_(
      "VerificacionEntradaController",
      label,
      function() {
        perfMark_(trace, "CONTROLLER_EXECUTOR_STARTED", {
          elapsedMs: Date.now() - wrapperStartedAt
        });

        const serviceStartedAt = Date.now();
        const serviceResult = executor(trace, context);

        perfMark_(trace, "CONTROLLER_SERVICE_COMPLETED", {
          elapsedMs: Date.now() - serviceStartedAt
        });

        return serviceResult;
      }
    );

    perfMark_(trace, "CONTROLLER_EXEC_WRAPPER_COMPLETED", {
      elapsedMs: Date.now() - wrapperStartedAt
    });

    const responseStartedAt = Date.now();
    const wrapped = VerificacionEntradaController_success_(
      result,
      trace
    );

    const response = wrapped.response;
    const responseChars =
      VerificacionEntradaController_estimateResponseChars_(
        wrapped.dataChars,
        response.requestId
      );

    perfMark_(trace, "CONTROLLER_RESPONSE_READY", {
      elapsedMs: Date.now() - responseStartedAt,
      dataChars: wrapped.dataChars,
      responseCharsEstimated: responseChars,
      totalControllerMs: Date.now() - controllerStartedAt
    });

    perfEnd_(trace, "ok", {
      dataChars: wrapped.dataChars,
      responseCharsEstimated: responseChars,
      totalControllerMs: Date.now() - controllerStartedAt
    });

    return response;
  } catch (error) {
    perfFail_(trace, error, {
      code: error && error.code
        ? error.code
        : "VE_CONTROLLER_ERROR",
      totalControllerMs: Date.now() - controllerStartedAt
    });

    /*
     * Apps Script propagará únicamente el mensaje al failureHandler.
     * No se devuelve stack ni objeto raw al navegador.
     */
    throw new Error(
      error && error.message
        ? error.message
        : "Ocurrió un error en Verificación de entrada."
    );
  }
}

/**
 * Devuelve configuración inicial del módulo.
 * Puede llamarse sin RFC antes de cargar el XML.
 *
 * @param {string=} rfcEmisor RFC emisor opcional.
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function VerificacionEntradaController_obtenerBootstrap(rfcEmisor) {
  return VerificacionEntradaController_execute_(
    "OBTENER_BOOTSTRAP",
    {
      hasRfc: Boolean(toStr_(rfcEmisor))
    },
    function(trace, context) {
      return VerificacionEntradaService.getBootstrap(
        rfcEmisor || "",
        context,
        trace
      );
    }
  );
}

/**
 * Crea una sesión de Verificación de entrada.
 *
 * @param {Object} payload Resumen CFDI y conceptos normalizados.
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function VerificacionEntradaController_crearSesion(payload) {
  const concepts = Array.isArray(payload && payload.conceptos)
    ? payload.conceptos.length
    : 0;

  return VerificacionEntradaController_execute_(
    "CREAR_SESION",
    {
      concepts: concepts,
      hasDocument: Boolean(payload && (payload.documento || payload))
    },
    function(trace, context) {
      return VerificacionEntradaService.crearSesion(
        payload || {},
        context,
        trace
      );
    }
  );
}

/**
 * Obtiene encabezado, detalle, cajas, eventos y resumen de una sesión.
 *
 * @param {string} idSesion Identificador interno.
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function VerificacionEntradaController_obtenerSesion(idSesion) {
  return VerificacionEntradaController_execute_(
    "OBTENER_SESION",
    {
      hasSessionId: Boolean(toStr_(idSesion))
    },
    function(trace) {
      return VerificacionEntradaService.obtenerSesion(
        idSesion,
        trace
      );
    }
  );
}

/**
 * Obtiene una vista ligera de la sesión.
 *
 * Devuelve encabezado, detalle conciliado y resumen, pero no transporta
 * el historial completo de cajas ni eventos. Está destinado al botón
 * Actualizar de la interfaz durante la captura.
 *
 * @param {string} idSesion Identificador interno.
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function VerificacionEntradaController_obtenerSesionLigera(idSesion) {
  return VerificacionEntradaController_execute_(
    "OBTENER_SESION_LIGERA",
    {
      hasSessionId: Boolean(toStr_(idSesion)),
      responseMode: "LIGHT"
    },
    function(trace) {
      if (
        !VerificacionEntradaService ||
        typeof VerificacionEntradaService.obtenerSesionLigera !== "function"
      ) {
        const error = new Error(
          "VerificacionEntradaService.obtenerSesionLigera no está disponible."
        );
        error.code = "VE_LIGHT_SESSION_NOT_AVAILABLE";
        throw error;
      }

      return VerificacionEntradaService.obtenerSesionLigera(
        idSesion,
        trace
      );
    }
  );
}

/**
 * Registra un lote de cajas previamente interpretadas en el navegador.
 * El Service vuelve a validar sesión, SKU, cantidades y duplicados.
 *
 * clientMetadata solo se usa para correlación y rendimiento. Nunca se usa
 * para reglas de negocio, autorización, cantidades o identificación.
 *
 * @param {Object} payload Identificador de sesión y cajas.
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function VerificacionEntradaController_registrarCajas(payload) {
  const boxes = Array.isArray(payload && payload.cajas)
    ? payload.cajas.length
    : 0;

  const clientMetadata = payload && payload.clientMetadata
    ? payload.clientMetadata
    : {};

  return VerificacionEntradaController_execute_(
    "REGISTRAR_CAJAS",
    {
      boxes: boxes,
      hasSessionId: Boolean(
        toStr_(payload && payload.idSesion)
      ),
      clientScanId: toStr_(clientMetadata.scanId),
      clientQueueMs: Math.max(
        0,
        Number(clientMetadata.queueMs || 0)
      ),
      clientSentAtMs: Math.max(
        0,
        Number(clientMetadata.sentAtMs || 0)
      ),
      clientBatchSize: Math.max(
        0,
        Number(clientMetadata.batchSize || boxes)
      )
    },
    function(trace, context) {
      perfMark_(trace, "CONTROLLER_REGISTER_BOXES_RECEIVED", {
        boxes: boxes,
        hasClientScanId: Boolean(toStr_(clientMetadata.scanId))
      });

      return VerificacionEntradaService.registrarCajas(
        payload || {},
        context,
        trace
      );
    }
  );
}

/**
 * Cancela lógicamente una caja y reconstruye los acumulados.
 *
 * @param {Object} payload Sesión, caja y motivo.
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function VerificacionEntradaController_cancelarCaja(payload) {
  return VerificacionEntradaController_execute_(
    "CANCELAR_CAJA",
    {
      hasSessionId: Boolean(toStr_(payload && payload.idSesion)),
      hasBoxId: Boolean(toStr_(payload && payload.idUnicoCaja)),
      hasReason: Boolean(toStr_(payload && payload.motivoCancelacion))
    },
    function(trace, context) {
      return VerificacionEntradaService.cancelarCaja(
        payload || {},
        context,
        trace
      );
    }
  );
}

/**
 * Pausa una sesión.
 *
 * @param {string} idSesion Identificador interno.
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function VerificacionEntradaController_pausarSesion(idSesion) {
  return VerificacionEntradaController_execute_(
    "PAUSAR_SESION",
    {
      hasSessionId: Boolean(toStr_(idSesion))
    },
    function(trace, context) {
      return VerificacionEntradaService.pausarSesion(
        idSesion,
        context,
        trace
      );
    }
  );
}

/**
 * Reanuda una sesión pausada.
 *
 * @param {string} idSesion Identificador interno.
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function VerificacionEntradaController_reanudarSesion(idSesion) {
  return VerificacionEntradaController_execute_(
    "REANUDAR_SESION",
    {
      hasSessionId: Boolean(toStr_(idSesion))
    },
    function(trace, context) {
      return VerificacionEntradaService.reanudarSesion(
        idSesion,
        context,
        trace
      );
    }
  );
}

/**
 * Cierra una sesión, reconstruyendo todos los saldos bajo lock.
 *
 * @param {Object} payload Sesión y observación de cierre.
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function VerificacionEntradaController_cerrarSesion(payload) {
  return VerificacionEntradaController_execute_(
    "CERRAR_SESION",
    {
      hasSessionId: Boolean(toStr_(payload && payload.idSesion)),
      hasObservation: Boolean(
        toStr_(payload && payload.observacionCierre)
      )
    },
    function(trace, context) {
      return VerificacionEntradaService.cerrarSesion(
        payload || {},
        context,
        trace
      );
    }
  );
}

/**
 * Diagnóstico de solo lectura del Controller.
 * No escribe información.
 *
 * @return {{ok:boolean, requestId:string, data:*}}
 */
function testVerificacionEntradaControllerLectura() {
  return VerificacionEntradaController_obtenerBootstrap("");
}

/**
 * Diagnóstico público de rendimiento del Controller.
 *
 * Mide la operación completa de bootstrap sin escribir información.
 * El detalle por etapa queda registrado en las marcas del trace.
 *
 * @return {{ok:boolean,elapsedMs:number,response:Object}}
 */
function testVerificacionEntradaControllerRendimiento() {
  const startedAt = Date.now();
  const response = VerificacionEntradaController_obtenerBootstrap("");

  return {
    ok: Boolean(response && response.ok === true),
    elapsedMs: Date.now() - startedAt,
    response: response
  };
}


/**
 * Diagnóstico de disponibilidad de endpoints optimizados.
 * No escribe información.
 *
 * @return {{ok:boolean,obtenerSesionLigera:boolean,registrarCajas:boolean}}
 */
function testVerificacionEntradaControllerOptimizaciones() {
  const result = {
    obtenerSesionLigera:
      typeof VerificacionEntradaController_obtenerSesionLigera === "function" &&
      typeof VerificacionEntradaService !== "undefined" &&
      Boolean(VerificacionEntradaService) &&
      typeof VerificacionEntradaService.obtenerSesionLigera === "function",

    registrarCajas:
      typeof VerificacionEntradaController_registrarCajas === "function" &&
      typeof VerificacionEntradaService !== "undefined" &&
      Boolean(VerificacionEntradaService) &&
      typeof VerificacionEntradaService.registrarCajas === "function"
  };

  result.ok = result.obtenerSesionLigera && result.registrarCajas;

  console.log(
    "[TEST][VE_CONTROLLER_OPTIMIZACIONES] " +
    JSON.stringify(result)
  );

  return result;
}
