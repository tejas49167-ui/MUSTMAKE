(function () {
    "use strict";

    let user;
    try {
        user = JSON.parse(localStorage.getItem("user") || "null");
    } catch {
        return;
    }

    if (!user || typeof user !== "object" || Array.isArray(user)) {
        return;
    }

    document.body.classList.add("auth-session-prompt-active");

    const dialog = document.createElement("dialog");
    dialog.className = "auth-session-dialog";
    dialog.setAttribute("aria-labelledby", "authSessionPromptTitle");
    dialog.setAttribute("aria-describedby", "authSessionPromptMessage");
    dialog.innerHTML = `
        <div class="auth-session-dialog-content">
            <h2 id="authSessionPromptTitle">You’re already logged in</h2>
            <p id="authSessionPromptMessage">Would you like to log out?</p>
            <p class="auth-session-prompt-status" role="status" aria-live="polite" hidden></p>
            <div class="auth-session-prompt-actions">
                <button type="button" data-auth-session-stay>No, go to app</button>
                <button type="button" data-auth-session-logout>Yes, log out</button>
            </div>
        </div>
    `;
    document.body.append(dialog);

    const stayButton = dialog.querySelector("[data-auth-session-stay]");
    const logoutButton = dialog.querySelector("[data-auth-session-logout]");
    const status = dialog.querySelector(".auth-session-prompt-status");

    function goToApp() {
        window.location.replace("/today");
    }

    stayButton.addEventListener("click", goToApp);
    dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        goToApp();
    });
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) {
            goToApp();
        }
    });

    logoutButton.addEventListener("click", async () => {
        stayButton.disabled = true;
        logoutButton.disabled = true;
        logoutButton.textContent = "Logging out…";
        status.hidden = true;

        try {
            const response = await window.fetch(
                `${window.backend_url}/api/auth/logout`,
                { method: "POST" }
            );

            if (!response.ok && response.status !== 401) {
                throw new Error("Could not end the server session.");
            }

            window.clearPrivateCaches?.();
            localStorage.removeItem("user");
            document.body.classList.remove("auth-session-prompt-active");
            dialog.close();
            document.querySelector(".auth-container input")?.focus();
        } catch (error) {
            console.warn("Could not log out from the authentication page.", error);
            status.textContent = "Could not log out. Please try again.";
            status.hidden = false;
            stayButton.disabled = false;
            logoutButton.disabled = false;
            logoutButton.textContent = "Yes, log out";
        }
    });

    dialog.showModal();
    stayButton.focus();
})();
