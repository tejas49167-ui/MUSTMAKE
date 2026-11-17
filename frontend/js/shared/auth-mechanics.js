(function () {
    let googleAuthInFlight = false;
    const GOOGLE_AUTH_PENDING_KEY = "mustmake_google_auth_pending";

    async function postAuth(path, payload, fallbackMessage = "Could not complete authentication.") {
        const response = await fetch(`${window.backend_url}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.message || fallbackMessage);
            error.status = response.status;
            error.data = data;
            throw error;
        }

        return data;
    }

    function openGoogleAuth(url) {
        if (googleAuthInFlight) return;

        const oauthWindow = window.open(url, "_blank");
        if (!oauthWindow) {
            window.location.replace(url);
            return;
        }

        googleAuthInFlight = true;
        const loadingToast = window.showToast("Connecting to Google...", {
            type: "loading"
        });
        oauthWindow.opener = null;

        const closeWatcher = window.setInterval(() => {
            if (!oauthWindow.closed) return;

            window.clearInterval(closeWatcher);
            googleAuthInFlight = false;
            loadingToast?.dismiss();
        }, 500);
    }

    function navigateToGoogleAuth(url) {
        try {
            window.sessionStorage.setItem(GOOGLE_AUTH_PENDING_KEY, "true");
        } catch (error) {
            console.warn("Could not save the pending Google sign-in state.", error);
        }

        window.location.replace(url);
    }

    function isUnmodifiedPrimaryClick(event) {
        return event.button === 0 &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !event.altKey;
    }

    function createOtpCooldown({
        storageKey,
        button,
        status,
        waitingLabel,
        readyLabel,
        statusText,
        cooldownMs = 60 * 1000
    }) {
        let timer = null;

        function stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }

        function refresh() {
            stop();
            const sentAt = Number(sessionStorage.getItem(storageKey)) || 0;

            const update = () => {
                const remaining = Math.max(0, sentAt + cooldownMs - Date.now());
                if (button) {
                    button.disabled = remaining > 0;
                    button.textContent = remaining > 0
                        ? waitingLabel(Math.ceil(remaining / 1000))
                        : readyLabel;
                }
                if (status) {
                    status.hidden = false;
                    status.textContent = statusText;
                }

                if (remaining === 0) {
                    stop();
                }
            };

            update();
            if (sentAt && Date.now() < sentAt + cooldownMs) {
                timer = setInterval(update, 1000);
            }
        }

        return { refresh, stop };
    }

    function installStorageListener() {
        window.addEventListener("storage", event => {
            if (event.key !== "googleSignupPending" || !event.newValue) return;

            localStorage.removeItem("googleSignupPending");
            sessionStorage.setItem("pendingSignup", "true");
            window.location.replace("/first-details");
        });
    }

    window.authMechanics = {
        postAuth,
        openGoogleAuth,
        navigateToGoogleAuth,
        isUnmodifiedPrimaryClick,
        createOtpCooldown,
        installStorageListener
    };
})();
