(function () {
    let googleAuthInFlight = false;

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

        const showProgress = () => {
            const container = document.querySelector(".auth-container");
            const content = container?.querySelector(".auth-content");
            if (!container || !content) return () => {};

            const wasHidden = content.hidden;
            const progress = document.createElement("div");
            progress.className = "google-auth-progress";
            progress.setAttribute("role", "status");
            progress.setAttribute("aria-live", "polite");

            const spinner = document.createElement("span");
            spinner.className = "google-auth-progress-spinner";
            spinner.setAttribute("aria-hidden", "true");

            const message = document.createElement("p");
            message.textContent = "Continue in the Google sign-in window.";
            progress.append(spinner, message);
            content.hidden = true;
            container.appendChild(progress);

            return () => {
                progress.remove();
                content.hidden = wasHidden;
            };
        };

        const oauthWindow = window.open(url, "_blank");
        if (!oauthWindow) {
            showProgress();
            window.location.replace(url);
            return;
        }

        googleAuthInFlight = true;
        const restoreAuthPage = showProgress();
        oauthWindow.opener = null;

        const closeWatcher = window.setInterval(() => {
            if (!oauthWindow.closed) return;

            window.clearInterval(closeWatcher);
            googleAuthInFlight = false;
            restoreAuthPage();
        }, 500);
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
            if (event.key === "googleSignupPending" && event.newValue) {
                localStorage.removeItem("googleSignupPending");
                sessionStorage.setItem("pendingSignup", "true");
                window.location.replace("/first-details");
                return;
            }

            if (event.key !== "googleLoginComplete" || !event.newValue) {
                return;
            }

            localStorage.removeItem("googleLoginComplete");
            const user = localStorage.getItem("user");
            if (!user) return;

            try {
                window.redirectAfterAuthentication(JSON.parse(user));
            } catch (error) {
                console.error("Could not read the signed-in user.", error);
                window.location.replace("/today");
            }
        });
    }

    window.authMechanics = {
        postAuth,
        openGoogleAuth,
        createOtpCooldown,
        installStorageListener
    };
})();
