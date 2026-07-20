/**
 * DetallesProductoController.gs
 * Funciones globales invocables desde google.script.run
 */

function DetallesProductoController_getBootstrap() {
  return execController_(
    "DetallesProductoController",
    "getBootstrap",
    function () {
      return DetallesProductoService.getBootstrap();
    }
  );
}

function DetallesProductoController_buscarProductoPorCodigo(codigo) {
  return execController_(
    "DetallesProductoController",
    "buscarProductoPorCodigo",
    function () {
      return DetallesProductoService.buscarProductoPorCodigo(codigo);
    }
  );
}

function DetallesProductoController_buscarProductoPorId(id) {
  return execController_(
    "DetallesProductoController",
    "buscarProductoPorId",
    function () {
      return DetallesProductoService.buscarProductoPorId(id);
    }
  );
}

function DetallesProductoController_guardarDetalle(payload) {
  return execController_(
    "DetallesProductoController",
    "guardarDetalle",
    function () {
      return DetallesProductoService.guardarDetalle(payload);
    }
  );
}

function DetallesProductoController_obtenerDetalles() {
  return execController_(
    "DetallesProductoController",
    "obtenerDetalles",
    function () {
      return DetallesProductoService.obtenerDetalles();
    }
  );
}