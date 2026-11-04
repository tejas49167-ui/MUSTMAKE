const isLocalFrontend = ["localhost", "127.0.0.1"].includes(window.location.hostname);
window.backend_url = isLocalFrontend
    ? `http://${window.location.hostname}:4000`
    : "";
window.frontend_url = window.location.origin;

try {
    localStorage.removeItem("token");
} catch (error) {
    console.warn("Could not clear the legacy authentication token.", error);
}

const originalFetch = window.fetch.bind(window);
const apiOrigin = new URL(window.backend_url || "/", window.location.href).origin;
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
