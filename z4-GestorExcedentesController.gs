/**
 * GestorExcedentesController.gs
 */
const CTRL_GESTOR_EXCEDENTES =
  "GestorExcedentesController";

/**
 * Endpoint principal utilizado por GestorExcedentes.html.
 *
 * Usa la construcción ligera estricta:
 * - No devuelve dataCompleta.
 * - Propaga errores al failureHandler del navegador.
 */
function GestorExcedentesController_obtenerVista() {
  return execController_(
    CTRL_GESTOR_EXCEDENTES,
    "obtenerVista",
    function() {
      const result =
        GestorExcedentesService
          .obtenerVistaLigeraRaw();

      result.__controllerDebug = {
        controller:
          CTRL_GESTOR_EXCEDENTES,

        method:
          "obtenerVista",

        build:
          "CTRL-2026-09-18-LIGHT-STRICT-02",

        dataLength:
          Array.isArray(
            result.data
          )
            ? result.data.length
            : -1,

        hasDataCompleta:
          Array.isArray(
            result.dataCompleta
          )
      };

      console.log(
        "[GestorExcedentesController] " +
        "obtenerVista :: salida",
        result.__controllerDebug
      );

      return result;
    }
  );
}

/**
 * Endpoint completo para compatibilidad y diagnóstico.
 *
 * Devuelve:
 * - data
 * - dataCompleta
 * - resumen
 */
function GestorExcedentesController_obtenerVistaRaw() {
  return execController_(
    CTRL_GESTOR_EXCEDENTES,
    "obtenerVistaRaw",
    function() {
      const result =
        GestorExcedentesService
          .obtenerVistaRaw();

      result.__controllerDebug = {
        controller:
          CTRL_GESTOR_EXCEDENTES,

        method:
          "obtenerVistaRaw",

        build:
          "CTRL-2026-09-18-RAW-02",

        dataLength:
          Array.isArray(
            result.data
          )
            ? result.data.length
            : -1,

        dataCompletaLength:
          Array.isArray(
            result.dataCompleta
          )
            ? result.dataCompleta.length
            : -1
      };

      console.log(
        "[GestorExcedentesController] " +
        "obtenerVistaRaw :: salida",
        result.__controllerDebug
      );

      return result;
    }
  );
}

function GestorExcedentesController_obtenerExcedentesConsolidados() {
  return execController_(
    CTRL_GESTOR_EXCEDENTES,
    "obtenerExcedentesConsolidados",
    function() {
      return GestorExcedentesService
        .obtenerExcedentesConsolidados();
    }
  );
}

function GestorExcedentesController_getResumen() {
  return execController_(
    CTRL_GESTOR_EXCEDENTES,
    "getResumen",
    function() {
      return GestorExcedentesService
        .getResumen();
    }
  );
}

function GestorExcedentesController_clearCache() {
  return execController_(
    CTRL_GESTOR_EXCEDENTES,
    "clearCache",
    function() {
      return GestorExcedentesService
        .clearCache();
    }
  );
}

function GestorExcedentesController_pingVersion() {
  return execController_(
    CTRL_GESTOR_EXCEDENTES,
    "pingVersion",
    function() {
      return {
        ok:
          true,

        controller:
          CTRL_GESTOR_EXCEDENTES,

        build:
          "PING-2026-09-18-02"
      };
    }
  );
}