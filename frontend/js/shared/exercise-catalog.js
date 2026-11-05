(function () {
    "use strict";

    const CACHE_KEY = "mustmake_exercises_v4";
    let catalogRequest;

    function readCachedCatalog() {
        try {
            const catalog = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
            return Array.isArray(catalog) ? catalog : null;
        } catch (error) {
            console.warn("Could not read the cached exercise catalog.", error);
            return null;
        }
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

            try {
                sessionStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
            } catch (error) {
                console.warn("Could not cache the exercise catalog.", error);
            }
            return catalog;
        })().finally(() => {
            catalogRequest = null;
        });

        return catalogRequest;
    }

    window.MUSTMAKE = window.MUSTMAKE || {};
    window.MUSTMAKE.loadExerciseCatalog = loadExerciseCatalog;
})();
