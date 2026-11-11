(function () {
    function safeSocialUrl(value) {
        if (typeof value !== "string") return null;
        const trimmedValue = value.trim();
        if (!trimmedValue || trimmedValue.length > 500) return null;

        try {
            const url = new URL(trimmedValue);
            return ["http:", "https:"].includes(url.protocol) && url.hostname
                ? url.href
                : null;
        } catch {
            return null;
        }
    }

    window.MUSTMAKE = window.MUSTMAKE || {};
    window.MUSTMAKE.safeSocialUrl = safeSocialUrl;
})();
