const googleAuthPending = (() => {
    try {
        return sessionStorage.getItem("mustmake_google_auth_pending") === "true";
    } catch {
        return false;
    }
})();

try {
    const isAuthenticated = Boolean(
        JSON.parse(localStorage.getItem("user") || "null")
    );
    if (!isAuthenticated) {
        window.location.replace(googleAuthPending ? "/google-callback" : "/");
    }
} catch {
    window.location.replace(googleAuthPending ? "/google-callback" : "/");
}
