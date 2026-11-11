/**
 * z4-ReabastecimientoController.gs
 *
 * @fileoverview Controlador público del módulo transaccional de
 * Reabastecimiento para Google Apps Script HTML Service.
 *
 * Responsabilidades:
 * - Exponer funciones globales compatibles con google.script.run.
 * - Validar la forma básica de argumentos antes de invocar el Service.
 * - Delegar todas las reglas de negocio a ReabastecimientoService.
 * - Normalizar respuestas exitosas bajo un contrato estable.
 * - Transformar errores internos en errores públicos accionables.
 * - Registrar telemetría sin incluir folios, códigos, ubicaciones, IDUNICO ni
 *   nombres de usuarios.
 *
 * Responsabilidades excluidas:
 * - No consulta Google Sheets directamente.
 * - No genera folios, fechas, horas ni consecutivos.
 * - No valida catálogo, saldos, ubicaciones o usuarios.
 * - No adquiere ScriptLock. La concurrencia pertenece al Service.
 * - No implementa reglas de estado ni transiciones de partidas.
 *
 * Contrato de respuesta:
 * {
 *   ok: true,
 *   operation: string,
 *   data: *,
 *   metadata: {
 *     elapsedMs: number,
 *     responseChars: number
 *   }
 * }
 *
 * Política de errores:
 * - Los errores de dominio conservan su código estable y mensaje accionable.
 * - Los errores inesperados se exponen como REAB_INTERNAL_ERROR.
 * - Los detalles internos, stacks y valores operativos no se envían al cliente.
 * - El Controller lanza Error para activar withFailureHandler().
 *
 * Dependencias globales:
 * - ReabastecimientoService.
 * - REABASTECIMIENTO_CONFIG.
 * - perfStart_(), perfMark_(), perfEnd_(), perfFail_().
 * - toStr_() y toStrUpper_().
 *
 * @author Sigifredo de la Cruz Ramos
 * @version REABASTECIMIENTO-CONTROLLER-2026-11-10-02
 */
const REABASTECIMIENTO_CONTROLLER_CONFIG = Object.freeze({
  MODULE: "REABASTECIMIENTO",
  LAYER: "CONTROLLER",
  LOG_PREFIX: "[ReabastecimientoController]",
  INTERNAL_ERROR_CODE: "REAB_INTERNAL_ERROR",
  OPERATIONS: Object.freeze({
    GET_CANDIDATOS: "GET_CANDIDATOS_POR_BODEGA",
    CREAR_SOLICITUD: "CREAR_SOLICITUD",
    GET_SOLICITUDES: "GET_SOLICITUDES",
    GET_DETALLE: "GET_DETALLE_SOLICITUD",
    ATENDER_PARTIDA: "ATENDER_PARTIDA",
    VALIDAR_IDUNICO: "VALIDAR_IDUNICO",
    REGISTRAR_IDUNICO: "REGISTRAR_IDUNICO",
    CERRAR_SOLICITUD: "CERRAR_SOLICITUD"
  })
});

/**
 * Comprueba las dependencias globales del Controller.
 *
 * @return {void}
 * @throws {Error} Si falta el Service o una utilidad obligatoria.
 * @private
 */
function ReabastecimientoController_assertDependencies_() {
  if (
    typeof ReabastecimientoService === "undefined" ||
    !ReabastecimientoService
  ) {
    throw new Error(
      REABASTECIMIENTO_CONTROLLER_CONFIG.LOG_PREFIX +
      " ReabastecimientoService no está disponible."
    );
  }

  const dependencies = [
    ["perfStart_", typeof perfStart_],
    ["perfMark_", typeof perfMark_],
    ["perfEnd_", typeof perfEnd_],
    ["perfFail_", typeof perfFail_],
    ["toStr_", typeof toStr_],
    ["toStrUpper_", typeof toStrUpper_]
  ];
  const missing = dependencies
    .filter(function(dependency) {
      return dependency[1] !== "function";
    })
    .map(function(dependency) {
      return dependency[0];
    });

  if (missing.length > 0) {
    throw new Error(
      REABASTECIMIENTO_CONTROLLER_CONFIG.LOG_PREFIX +
      " Faltan utilidades globales: " + missing.join(", ") + "."
    );
  }
}

/**
 * Crea una traza del Controller sin incorporar información operativa sensible.
 *
 * @param {string} operation Operación pública.
 * @return {!Object} Tracker de rendimiento.
 * @private
 */
function ReabastecimientoController_startTrace_(operation) {
  return perfStart_(
    "REABASTECIMIENTO_CONTROLLER_" + String(operation || "UNKNOWN"),
    {
      module: REABASTECIMIENTO_CONTROLLER_CONFIG.MODULE,
      layer: REABASTECIMIENTO_CONTROLLER_CONFIG.LAYER
    }
  );
}

/**
 * Valida que un argumento sea un objeto simple no nulo.
 *
 * @param {*} value Valor recibido.
 * @param {string} argumentName Nombre funcional del argumento.
 * @return {!Object} El mismo objeto validado.
 * @throws {TypeError} Si el argumento no es un objeto simple.
 * @private
 */
function ReabastecimientoController_requireObject_(value, argumentName) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw ReabastecimientoController_publicError_(
      REABASTECIMIENTO_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO,
      String(argumentName || "payload") + " debe ser un objeto."
    );
  }
  return value;
}

/**
 * Valida un texto obligatorio sin aplicar reglas del dominio.
 *
 * @param {*} value Valor recibido.
 * @param {string} fieldName Nombre funcional.
 * @return {string} Texto sin espacios exteriores.
 * @throws {Error} Si el valor está vacío.
 * @private
 */
function ReabastecimientoController_requireText_(value, fieldName) {
  const text = toStr_(value);
  if (!text) {
    throw ReabastecimientoController_publicError_(
      REABASTECIMIENTO_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO,
      String(fieldName || "El campo") + " es obligatorio."
    );
  }
  return text;
}

/**
 * Construye un error público estable.
 *
 * Google Apps Script transmite principalmente name y message mediante
 * withFailureHandler(). El código se incorpora al mensaje con un delimitador
 * explícito para que el cliente pueda mostrarlo o clasificarlo sin depender del
 * stack interno.
 *
 * @param {string} code Código público.
 * @param {string} message Mensaje accionable.
 * @return {!Error} Error serializable para google.script.run.
 * @private
 */
function ReabastecimientoController_publicError_(code, message) {
  const publicCode = toStrUpper_(code) ||
    REABASTECIMIENTO_CONTROLLER_CONFIG.INTERNAL_ERROR_CODE;
  const publicMessage = toStr_(message) ||
    "No fue posible completar la operación de Reabastecimiento.";
  const error = new Error("[" + publicCode + "] " + publicMessage);
  error.name = "ReabastecimientoPublicError";
  error.code = publicCode;
  return error;
}

/**
 * Convierte un error interno a un error público seguro.
 *
 * @param {*} error Error original.
 * @return {!Error} Error apto para el navegador.
 * @private
 */
function ReabastecimientoController_toPublicError_(error) {
  const configuredCodes =
    REABASTECIMIENTO_CONFIG &&
    REABASTECIMIENTO_CONFIG.ERROR_CODES
      ? Object.values(REABASTECIMIENTO_CONFIG.ERROR_CODES)
      : [];
  const candidateCode = toStrUpper_(error && error.code);
  const isKnownDomainCode = configuredCodes.includes(candidateCode);
  const code = isKnownDomainCode
    ? candidateCode
    : REABASTECIMIENTO_CONTROLLER_CONFIG.INTERNAL_ERROR_CODE;
  const message = isKnownDomainCode
    ? toStr_(error && error.message)
    : "Ocurrió un error interno al procesar la solicitud.";
  return ReabastecimientoController_publicError_(code, message);
}

/**
 * Calcula de forma tolerante el tamaño serializado de una respuesta.
 *
 * @param {*} value Respuesta que se enviará al cliente.
 * @return {number} Cantidad de caracteres JSON o cero si no es serializable.
 * @private
 */
function ReabastecimientoController_measureResponse_(value) {
  try {
    return JSON.stringify(value).length;
  } catch (error) {
    return 0;
  }
}

/**
 * Ejecuta una operación pública con contrato uniforme de éxito y error.
 *
 * @param {string} operation Nombre lógico.
 * @param {function(!Object): *} executor Operación delegada al Service.
 * @return {!Object} Sobre de respuesta exitosa.
 * @throws {Error} Error público para withFailureHandler().
 * @private
 */
function ReabastecimientoController_execute_(operation, executor) {
  const trace = ReabastecimientoController_startTrace_(operation);
  const startedAt = Date.now();

  try {
    ReabastecimientoController_assertDependencies_();
    if (typeof executor !== "function") {
      throw new TypeError("El executor del Controller debe ser una función.");
    }

    const data = executor(trace);
    const response = {
      ok: true,
      operation: String(operation || "UNKNOWN"),
      data: data,
      metadata: {
        elapsedMs: Date.now() - startedAt,
        responseChars: 0
      }
    };
    response.metadata.responseChars =
      ReabastecimientoController_measureResponse_(response);

    perfMark_(trace, "CONTROLLER_RESPONSE_READY", {
      responseChars: response.metadata.responseChars
    });
    perfEnd_(trace, "ok", {
      elapsedMs: response.metadata.elapsedMs,
      responseChars: response.metadata.responseChars
    });
    return response;
  } catch (error) {
    perfFail_(trace, error, {
      code: toStr_(error && error.code),
      errorName: toStr_(error && error.name),
      elapsedMs: Date.now() - startedAt
    });
    throw ReabastecimientoController_toPublicError_(error);
  }
}

/**
 * Obtiene los SKU elegibles para crear una solicitud en una bodega.
 *
 * @param {*} bodega Clave o etiqueta de bodega. TODAS obtiene el universo.
 * @return {!Object} Sobre con candidatos compactos.
 */
function ReabastecimientoController_getCandidatosPorBodega(bodega) {
  return ReabastecimientoController_execute_(
    REABASTECIMIENTO_CONTROLLER_CONFIG.OPERATIONS.GET_CANDIDATOS,
    function() {
      const warehouse = toStrUpper_(bodega) || "TODAS";
      return ReabastecimientoService.getCandidatosPorBodega(warehouse);
    }
  );
}

/**
 * Crea una solicitud y sus partidas.
 *
 * Payload esperado:
 * {
 *   solicitante: string,
 *   bodega: string,
 *   partidas: Array<{codigo:string, ubicacion:string}>
 * }
 *
 * El Controller valida únicamente la forma. El Service revalida usuario,
 * candidatos, ubicaciones, necesidad de relleno, folio y concurrencia.
 *
 * @param {*} payload Datos de creación.
 * @return {!Object} Sobre con la solicitud creada.
 */
function ReabastecimientoController_crearSolicitud(payload) {
  return ReabastecimientoController_execute_(
    REABASTECIMIENTO_CONTROLLER_CONFIG.OPERATIONS.CREAR_SOLICITUD,
    function() {
      const input = ReabastecimientoController_requireObject_(payload, "payload");
      ReabastecimientoController_requireText_(input.solicitante, "solicitante");
      ReabastecimientoController_requireText_(input.bodega, "bodega");
      if (!Array.isArray(input.partidas) || input.partidas.length === 0) {
        throw ReabastecimientoController_publicError_(
          REABASTECIMIENTO_CONFIG.ERROR_CODES.PAYLOAD_INVALIDO,
          "partidas debe contener al menos un elemento."
        );
      }
      return ReabastecimientoService.crearSolicitud(input);
    }
  );
}

/**
 * Consulta solicitudes mediante filtros opcionales.
 *
 * Filtros soportados:
 * {
 *   estado?: "ABIERTA"|"EN_ATENCION"|"CERRADA"|"INCONSISTENTE",
 *   bodega?: string,
 *   idSolicitud?: string
 * }
 *
 * @param {*=} filtros Filtros opcionales.
 * @return {!Object} Sobre con la colección de solicitudes.
 */
function ReabastecimientoController_getSolicitudes(filtros) {
  return ReabastecimientoController_execute_(
    REABASTECIMIENTO_CONTROLLER_CONFIG.OPERATIONS.GET_SOLICITUDES,
    function() {
      const input = filtros == null
        ? {}
        : ReabastecimientoController_requireObject_(filtros, "filtros");
      const solicitudes = ReabastecimientoService.getSolicitudes(input);
      return {
        solicitudes: solicitudes,
        total: solicitudes.length
      };
    }
  );
}

/**
 * Devuelve cabecera, partidas y detalles de una solicitud.
 *
 * @param {*} idSolicitud Folio de la solicitud.
 * @return {!Object} Sobre con el detalle completo.
 */
function ReabastecimientoController_getDetalleSolicitud(idSolicitud) {
  return ReabastecimientoController_execute_(
    REABASTECIMIENTO_CONTROLLER_CONFIG.OPERATIONS.GET_DETALLE,
    function() {
      const id = ReabastecimientoController_requireText_(
        idSolicitud,
        "idSolicitud"
      );
      return ReabastecimientoService.getDetalleSolicitud(id);
    }
  );
}

/**
 * Marca una partida como atendida y registra el inicio global cuando corresponde.
 *
 * Payload esperado:
 * {
 *   idSolicitud: string,
 *   idPartidaConsecutivo: string,
 *   usuario: string
 * }
 *
 * @param {*} payload Datos de atención.
 * @return {!Object} Sobre con el resultado idempotente.
 */
function ReabastecimientoController_atenderPartida(payload) {
  return ReabastecimientoController_execute_(
    REABASTECIMIENTO_CONTROLLER_CONFIG.OPERATIONS.ATENDER_PARTIDA,
    function() {
      const input = ReabastecimientoController_requireObject_(payload, "payload");
      ReabastecimientoController_requireText_(input.idSolicitud, "idSolicitud");
      ReabastecimientoController_requireText_(
        input.idPartidaConsecutivo,
        "idPartidaConsecutivo"
      );
      ReabastecimientoController_requireText_(input.usuario, "usuario");
      return ReabastecimientoService.atenderPartida(input);
    }
  );
}

/**
 * Valida un IDUNICO contra una partida sin persistir el escaneo.
 * idPartidaConsecutivo identifica la partida operativa, pero no se almacena en
 * REABASTECIMIENTO_DETALLES.
 *
 * Payload esperado:
 * {
 *   idSolicitud: string,
 *   idPartidaConsecutivo: string,
 *   idUnico: string
 * }
 *
 * @param {*} payload Datos de validación.
 * @return {!Object} Sobre con la fotografía vigente del IDUNICO.
 */
function ReabastecimientoController_validarIdUnico(payload) {
  return ReabastecimientoController_execute_(
    REABASTECIMIENTO_CONTROLLER_CONFIG.OPERATIONS.VALIDAR_IDUNICO,
    function() {
      const input = ReabastecimientoController_requireObject_(payload, "payload");
      ReabastecimientoController_requireText_(input.idSolicitud, "idSolicitud");
      ReabastecimientoController_requireText_(
        input.idPartidaConsecutivo,
        "idPartidaConsecutivo"
      );
      ReabastecimientoController_requireText_(input.idUnico, "idUnico");
      return ReabastecimientoService.validarIdUnico(input);
    }
  );
}

/**
 * Registra un IDUNICO escaneado para el código de una partida.
 * idPartidaConsecutivo se usa para recuperar el código autoritativo y no se
 * persiste en la hoja de detalles.
 *
 * Payload esperado:
 * {
 *   idSolicitud: string,
 *   idPartidaConsecutivo: string,
 *   idUnico: string,
 *   usuario: string
 * }
 *
 * @param {*} payload Datos del escaneo.
 * @return {!Object} Sobre con el detalle persistido.
 */
function ReabastecimientoController_registrarIdUnico(payload) {
  return ReabastecimientoController_execute_(
    REABASTECIMIENTO_CONTROLLER_CONFIG.OPERATIONS.REGISTRAR_IDUNICO,
    function() {
      const input = ReabastecimientoController_requireObject_(payload, "payload");
      ReabastecimientoController_requireText_(input.idSolicitud, "idSolicitud");
      ReabastecimientoController_requireText_(
        input.idPartidaConsecutivo,
        "idPartidaConsecutivo"
      );
      ReabastecimientoController_requireText_(input.idUnico, "idUnico");
      ReabastecimientoController_requireText_(input.usuario, "usuario");
      return ReabastecimientoService.registrarIdUnico(input);
    }
  );
}

/**
 * Cierra una solicitud cuando todas sus partidas están atendidas y existe al
 * menos un IDUNICO registrado.
 *
 * Payload esperado:
 * {
 *   idSolicitud: string,
 *   usuario: string
 * }
 *
 * @param {*} payload Datos de cierre.
 * @return {!Object} Sobre con el resultado idempotente del cierre.
 */
function ReabastecimientoController_cerrarSolicitud(payload) {
  return ReabastecimientoController_execute_(
    REABASTECIMIENTO_CONTROLLER_CONFIG.OPERATIONS.CERRAR_SOLICITUD,
    function() {
      const input = ReabastecimientoController_requireObject_(payload, "payload");
      ReabastecimientoController_requireText_(input.idSolicitud, "idSolicitud");
      ReabastecimientoController_requireText_(input.usuario, "usuario");
      return ReabastecimientoService.cerrarSolicitud(input);
    }
  );
}
