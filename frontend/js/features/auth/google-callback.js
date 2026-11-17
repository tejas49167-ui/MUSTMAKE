const GOOGLE_AUTH_PENDING_KEY = "mustmake_google_auth_pending";
const callbackToast = window.showToast("Completing Google sign-in…", {
    type: "loading"
});

window.MUSTMAKE = window.MUSTMAKE || {};
window.MUSTMAKE.authState = "pending";
document.documentElement.dataset.authState = "pending";

try {
    sessionStorage.setItem(GOOGLE_AUTH_PENDING_KEY, "true");
} catch (error) {
    console.warn("Could not save the pending Google sign-in state.", error);
}

(async () => {
    if (new URLSearchParams(window.location.search).get("pendingSignup") === "1") {
        sessionStorage.setItem("pendingSignup", "true");
        sessionStorage.removeItem(GOOGLE_AUTH_PENDING_KEY);
        localStorage.setItem("googleSignupPending", String(Date.now()));
        window.close();
        if (!window.closed) {
            window.location.replace("/first-details");
        }
        return;
    }

    try {
        const response = await window.fetch(
            `${window.backend_url}/api/auth/session`,
            { credentials: "include", cache: "no-store" }
        );
        const session = await response.json().catch(() => ({}));

        if (response.status === 401) {
            const error = new Error(session.message || "Google sign-in could not be verified.");
            error.unauthenticated = true;
            throw error;
        }
        if (!response.ok) {
            throw new Error(session.message || "Could not verify Google sign-in.");
        }
        if (!session.user) {
            throw new Error("The server did not return the signed-in account.");
        }

        sessionStorage.removeItem("pendingSignup");
        sessionStorage.removeItem(GOOGLE_AUTH_PENDING_KEY);
        window.saveAuthenticatedSession(session.user);
        window.MUSTMAKE.authState = "authenticated";
        document.documentElement.dataset.authState = "authenticated";
        window.location.replace("/today");
    } catch (error) {
        console.error(error);

        if (error.unauthenticated) {
            sessionStorage.removeItem(GOOGLE_AUTH_PENDING_KEY);
            window.MUSTMAKE.authState = "unauthenticated";
            document.documentElement.dataset.authState = "unauthenticated";
            window.location.replace("/login?googleAuth=failed");
            return;
        }

        callbackToast?.update("Could not verify Google sign-in. Please try again.", {
            type: "error"
        });
    }
})();
