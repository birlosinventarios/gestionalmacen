/**
 * GestorExcedentesController.gs
 * Funciones globales invocables desde google.script.run
 */

function GestorExcedentesController_obtenerExcedentesConsolidados() {
  return GestorExcedentesService.obtenerExcedentesConsolidados();
}

function GestorExcedentesController_getResumen() {
  return GestorExcedentesService.getResumen();
}
