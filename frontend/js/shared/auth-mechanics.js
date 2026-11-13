(function () {
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
        createOtpCooldown,
        installStorageListener
    };
})();
