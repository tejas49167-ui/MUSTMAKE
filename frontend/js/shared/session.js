(function () {
    "use strict";

    window.MUSTMAKE = window.MUSTMAKE || {};
    window.MUSTMAKE.readCachedUser = function () {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    };
    window.MUSTMAKE.clearSession = function () {
        window.clearPrivateCaches();
        localStorage.removeItem("user");
    };
})();
