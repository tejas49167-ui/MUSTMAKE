try {
    const callbackData = window.location.hash.slice(1) || window.location.search.slice(1);
    const params = new URLSearchParams(callbackData);
    const token = params.get("token");
    const userData = params.get("user");

    // Remove credentials from the address bar and browser history immediately.
    window.history.replaceState(null, "", window.location.pathname);

    if (!token || !userData) {
        throw new Error("Google login information is missing.");
    }

    const user = JSON.parse(userData);

    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));

    // Let the original login tab replace itself so OAuth pages stay out of its history.
    localStorage.setItem("googleLoginComplete", `${Date.now()}-${Math.random()}`);

    // target=_blank opens a separate OAuth tab. If the browser refuses to close it,
    // continue to the app in that tab as a fallback.
    window.close();

    if (!window.closed) {
        localStorage.removeItem("googleLoginComplete");
        window.redirectAfterAuthentication(user);
    }
} catch (error) {
    window.history.replaceState(null, "", window.location.pathname);
    console.error(error);

    document.getElementById("callbackMessage").textContent =
        "Google login failed. Please try again.";
}
