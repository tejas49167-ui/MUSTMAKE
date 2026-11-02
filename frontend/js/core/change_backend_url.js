const isLocalFrontend = ["localhost", "127.0.0.1"].includes(window.location.hostname);
window.API_URL = isLocalFrontend
    ? `http://${window.location.hostname}:4000`
    : "";

try {
    localStorage.removeItem("token");
} catch (error) {
    console.warn("Could not clear the legacy authentication token.", error);
}

const originalFetch = window.fetch.bind(window);
const apiOrigin = new URL(window.API_URL || "/", window.location.href).origin;
window.fetch = function (input, init = {}) {
    const requestUrl = input instanceof Request ? input.url : input;
    const url = new URL(requestUrl, window.location.href);
    if (url.origin !== apiOrigin || !url.pathname.startsWith("/api/")) {
        return originalFetch(input, init);
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    headers.delete("Authorization");

    return originalFetch(input, {
        ...init,
        credentials: "include",
        headers
    });
};
