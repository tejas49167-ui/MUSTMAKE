window.MUSTMAKE = window.MUSTMAKE || {};

window.MUSTMAKE.sessionCache = {
    read(key, label = key) {
        if (!key) return null;
        try {
            return JSON.parse(sessionStorage.getItem(key) || "null");
        } catch (error) {
            console.warn(`Could not read cached ${label}.`, error);
            return null;
        }
    },
    write(key, value, label = key) {
        if (!key) return;
        try {
            sessionStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn(`Could not cache ${label}.`, error);
        }
    }
};
