/**
 * GestorExcedentesController.gs
 * Funciones globales invocables desde google.script.run
 */

/**
 * Nuevo endpoint recomendado:
 * devuelve data + resumen en una sola llamada.
 */
function GestorExcedentesController_obtenerVista() {
  return GestorExcedentesService.obtenerVista();
}

/**
 * Compatibilidad con tu vista actual:
 * devuelve solo el array consolidado vigente.
 */
function GestorExcedentesController_obtenerExcedentesConsolidados() {
  return GestorExcedentesService.obtenerExcedentesConsolidados();
}

/**
 * Resumen aislado por si quieres consumir métricos aparte.
 */
function GestorExcedentesController_getResumen() {
  return GestorExcedentesService.getResumen();
}