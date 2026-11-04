const callbackToast = window.showToast("Completing Google sign-in…", {
    type: "loading"
});

(async () => {
    try {
        const response = await window.fetch(`${window.backend_url}/api/auth/session`);
        const session = await response.json().catch(() => ({}));
        if (!response.ok || !session.user) {
            throw new Error(session.message || "Google login information is missing.");
        }

        const user = session.user;
        window.saveAuthenticatedSession(user);

        localStorage.setItem("googleLoginComplete", `${Date.now()}-${Math.random()}`);
        window.close();

        if (!window.closed) {
            localStorage.removeItem("googleLoginComplete");
            window.redirectAfterAuthentication(user);
        }
    } catch (error) {
        console.error(error);
        callbackToast?.update("Google login failed. Please try again.", {
            type: "error"
        });
    }
})();
