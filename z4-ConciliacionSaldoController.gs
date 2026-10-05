/**
 * ConciliacionSaldoController.gs
 *
 * Controlador público para la futura vista ConciliacionSaldo.html.
 */
const CTRL_CONCILIACION_SALDO =
  "ConciliacionSaldoController";

/**
 * Paquete inicial de la vista.
 * Devuelve grupos de trabajo, responsables y resumen general.
 */
function ConciliacionSaldoController_obtenerBootstrap() {
  return execController_(
    CTRL_CONCILIACION_SALDO,
    "obtenerBootstrap",
    function () {
      return ConciliacionSaldoService.obtenerBootstrap();
    }
  );
}

/**
 * Consulta grupos con filtros opcionales.
 *
 * Ejemplo:
 * {
 *   estado: "TRABAJO",
 *   serie: "A1-20",
 *   tipomovimiento: "SURTIDO",
 *   query: "PLP-12X21/2",
 *   limit: 500
 * }
 */
function ConciliacionSaldoController_listarGrupos(filtros) {
  return execController_(
    CTRL_CONCILIACION_SALDO,
    "listarGrupos",
    function () {
      return ConciliacionSaldoService.listarGrupos(
        filtros || {}
      );
    }
  );
}

/**
 * Obtiene un grupo fresco por FECHA|HORA|SERIE.
 */
function ConciliacionSaldoController_obtenerGrupo(
  claveGrupo
) {
  return execController_(
    CTRL_CONCILIACION_SALDO,
    "obtenerGrupo",
    function () {
      return ConciliacionSaldoService.obtenerGrupo(
        claveGrupo
      );
    }
  );
}

/**
 * Registra folio, responsable y sello de respuesta.
 *
 * Payload:
 * {
 *   clavegrupo: "11/09/2026|15:47:03|A1-20",
 *   filas: [NUMEROS_DE_FILA],
 *   folio: "TR-45872",
 *   responsable: "NOMBRE RESPONSABLE"
 * }
 */
function ConciliacionSaldoController_registrarConciliacion(
  payload
) {
  return execController_(
    CTRL_CONCILIACION_SALDO,
    "registrarConciliacion",
    function () {
      return ConciliacionSaldoService
        .registrarConciliacion(payload || {});
    }
  );
}

/**
 * Diagnóstico básico del controlador y servicio.
 */
function ConciliacionSaldoController_ping() {
  return execController_(
    CTRL_CONCILIACION_SALDO,
    "ping",
    function () {
      const service = ConciliacionSaldoService.ping();

      return {
        ok: true,
        controller: CTRL_CONCILIACION_SALDO,
        modulo: "CONCILIACION_SALDO",
        build: "CONCILIACION-SALDO-CTRL-2026-09-14-01",
        service: service
      };
    }
  );
}

// =========================================================
// PRUEBAS MANUALES CONTROLADAS
// =========================================================

/**
 * Ejecutar desde Apps Script para revisar agrupación y responsables.
 * No escribe datos.
 */
function testConciliacionSaldoBootstrap_() {
  const result =
    ConciliacionSaldoController_obtenerBootstrap();

  console.log(
    JSON.stringify(result, null, 2)
  );

  return result;
}

/**
 * Ejecutar desde Apps Script para verificar el grupo de la muestra.
 * No escribe datos.
 */
function testConciliacionSaldoGrupoA120_() {
  const key = "11/09/2026|15:47:03|A1-20";

  const result =
    ConciliacionSaldoController_obtenerGrupo(key);

  console.log(
    JSON.stringify(result, null, 2)
  );

  return result;
}

/**
 * PRUEBA DE ESCRITURA.
 *
 * No ejecutar sin reemplazar los valores de prueba.
 * El número de fila debe corresponder al movimiento pendiente real.
 */
function testConciliacionSaldoRegistrar_DESACTIVADO_() {
  throw new Error(
    "Prueba desactivada. Configura una fila, folio y responsable válidos antes de habilitarla."
  );

  /*
  return ConciliacionSaldoController_registrarConciliacion({
    clavegrupo: "11/09/2026|15:47:03|A1-20",
    filas: [REEMPLAZAR_NUMERO_FILA],
    folio: "REEMPLAZAR_FOLIO",
    responsable: "REEMPLAZAR_RESPONSABLE"
  });
  */
}
