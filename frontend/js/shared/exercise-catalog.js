(function () {
    "use strict";

    const CACHE_KEY = "mustmake_exercises_v4";
    let catalogRequest;

    function readCachedCatalog() {
        const catalog = window.MUSTMAKE.sessionCache.read(CACHE_KEY, "exercise catalog");
        return Array.isArray(catalog) ? catalog : null;
    }

    async function loadExerciseCatalog() {
        const cachedCatalog = readCachedCatalog();
        if (cachedCatalog) return cachedCatalog;
        if (catalogRequest) return catalogRequest;

        catalogRequest = (async () => {
            const response = await fetch(
                `${window.backend_url}/api/exercises?v=4`,
                { cache: "no-cache" }
            );
            if (!response.ok) {
                throw new Error(`Exercise catalog returned ${response.status}.`);
            }

            const catalog = await response.json();
            if (!Array.isArray(catalog)) {
                throw new Error("Exercise catalog returned invalid data.");
            }

            window.MUSTMAKE.sessionCache.write(CACHE_KEY, catalog, "exercise catalog");
            return catalog;
        })().finally(() => {
            catalogRequest = null;
        });

        return catalogRequest;
    }

    window.MUSTMAKE = window.MUSTMAKE || {};
    window.MUSTMAKE.loadExerciseCatalog = loadExerciseCatalog;
})();
