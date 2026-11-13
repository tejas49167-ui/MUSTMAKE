(function () {
    const config = Object.freeze({
        APP_TIME_ZONE: "Asia/Kolkata"
    });

    if (typeof module === "object" && module.exports) {
        module.exports = config;
    }

    if (typeof window !== "undefined") {
        window.MUSTMAKE = window.MUSTMAKE || {};
        window.MUSTMAKE.config = Object.freeze({
            ...(window.MUSTMAKE.config || {}),
            ...config
        });
    }
})();
