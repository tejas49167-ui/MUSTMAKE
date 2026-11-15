(function () {
    "use strict";

    window.MUSTMAKE = window.MUSTMAKE || {};
    window.MUSTMAKE.clearSession = function () {
        window.clearPrivateCaches();
        localStorage.removeItem("user");
    };
})();
