const LOGIN_EMAIL_KEY = "pendingLoginOtpEmail";
const LOGIN_SENT_AT_KEY = "pendingLoginOtpSentAt";
const OTP_COOLDOWN_MS = 60 * 1000;

const loginForm = document.getElementById("loginForm");
const otpLoginVerifyForm = document.getElementById("otpLoginVerifyForm");
const loginIdentifier = document.getElementById("login");
const loginLabel = document.getElementById("loginLabel");
const loginPassword = document.getElementById("password");
const loginPasswordGroup = document.getElementById("loginPasswordGroup");
const passwordLabel = document.getElementById("passwordLabel");
const loginSubmitButton = document.getElementById("loginSubmitButton");
const loginModeButtons = document.querySelectorAll("[data-login-mode]");
let loginMode = "password";
let loginRequestToast = null;
let otpRequestToast = null;
let loginRequestInFlight = false;
let otpVerificationInFlight = false;
let loginRestrictionUntil = 0;
let loginRestrictionNeedsRecheck = false;
let loginRestrictionTimer = null;
let loginRestrictionRetryTimer = null;
let loginRestrictionCheckPromise = null;
const loginRestrictionStatus = document.getElementById("loginRestrictionStatus");

function setLoginToast(message, type = "info") {
    if (
        loginRequestToast?.element.isConnected &&
        !loginRequestToast.element.classList.contains("is-leaving")
    ) {
        loginRequestToast.update(message, { type });
    } else {
        loginRequestToast = window.showToast(message, { type });
    }
}

function showInvalidCredentialsMessage() {
    setLoginToast("Invalid username/email or password.", "error");
}

window.addEventListener("storage", (event) => {
    if (event.key !== "googleLoginComplete" || !event.newValue) {
        return;
    }

    localStorage.removeItem("googleLoginComplete");

    if (localStorage.getItem("user")) {
        try {
            window.redirectAfterAuthentication(JSON.parse(localStorage.getItem("user")));
        } catch (error) {
            console.error("Could not read the signed-in user.", error);
            window.location.replace("/today");
        }
    }
});

const googleLoginLink = document.getElementById("googleLoginLink");
const signupLink = document.getElementById("signupLink");

if (googleLoginLink) {
    googleLoginLink.href = `${window.API_URL}/api/auth/google`;
}

if (signupLink) {
    signupLink.addEventListener("click", (event) => {
        if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }

        event.preventDefault();
        window.location.replace(signupLink.href);
    });
}

if (googleLoginLink) {
    googleLoginLink.addEventListener("click", (event) => {
        if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }

        event.preventDefault();
        const oauthWindow = window.open(googleLoginLink.href, "_blank");

        if (oauthWindow) {
            oauthWindow.opener = null;
        } else {
            window.location.replace(googleLoginLink.href);
        }
    });
}

async function postAuth(path, payload) {
    const response = await fetch(`${window.API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.message || "Could not complete login.");
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

function updateLoginRestrictionUI() {
    if (!loginRestrictionStatus || !loginSubmitButton) return;

    const remainingSeconds = Math.max(
        0,
        Math.ceil((loginRestrictionUntil - Date.now()) / 1000)
    );
    const isRestricted = loginMode === "password" &&
        (remainingSeconds > 0 || loginRestrictionNeedsRecheck);

    loginRestrictionStatus.hidden = !isRestricted;
    if (isRestricted) {
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        loginRestrictionStatus.textContent =
            `Too many unsuccessful attempts, try after ${String(minutes).padStart(2, "0")}:` +
            String(seconds).padStart(2, "0");
    }

    loginSubmitButton.disabled = loginRequestInFlight || isRestricted;
}

function clearLoginRestriction() {
    loginRestrictionUntil = 0;
    loginRestrictionNeedsRecheck = false;
    if (loginRestrictionTimer) {
        clearInterval(loginRestrictionTimer);
        loginRestrictionTimer = null;
    }
    if (loginRestrictionRetryTimer) {
        clearTimeout(loginRestrictionRetryTimer);
        loginRestrictionRetryTimer = null;
    }
    updateLoginRestrictionUI();
}

function applyLoginRestriction(retryAfterMs) {
    loginRestrictionUntil = Date.now() + Math.max(0, retryAfterMs);
    loginRestrictionNeedsRecheck = false;

    if (loginRestrictionTimer) {
        clearInterval(loginRestrictionTimer);
    }

    loginRestrictionTimer = setInterval(() => {
        if (Date.now() >= loginRestrictionUntil) {
            loginRestrictionNeedsRecheck = true;
            updateLoginRestrictionUI();
            void refreshLoginRestriction();
            return;
        }

        updateLoginRestrictionUI();
    }, 1000);

    updateLoginRestrictionUI();
}

function refreshLoginRestriction() {
    if (loginRestrictionCheckPromise) return loginRestrictionCheckPromise;

    loginRestrictionCheckPromise = (async () => {
        try {
            const response = await fetch(
                `${window.API_URL}/api/auth/login-rate-limit`,
                { credentials: "include" }
            );
            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.message || "Could not check login availability.");
            }

            if (data.restricted && Number.isFinite(data.retryAfterMs)) {
                applyLoginRestriction(data.retryAfterMs);
            } else {
                clearLoginRestriction();
            }
        } catch (error) {
            console.warn("Could not refresh password login restriction.", error);
            if (loginRestrictionNeedsRecheck && !loginRestrictionRetryTimer) {
                loginRestrictionRetryTimer = setTimeout(() => {
                    loginRestrictionRetryTimer = null;
                    void refreshLoginRestriction();
                }, 3000);
            }
        } finally {
            loginRestrictionCheckPromise = null;
            updateLoginRestrictionUI();
        }
    })();

    return loginRestrictionCheckPromise;
}

function handleLoginRestriction(error) {
    const retryAfterMs = error?.data?.retryAfterMs;
    if (error?.data?.restricted && Number.isFinite(retryAfterMs)) {
        applyLoginRestriction(retryAfterMs);
        loginRequestToast?.dismiss();
        return true;
    }

    return false;
}

function setLoginMode(mode) {
    loginMode = mode;
    const usingOtp = mode === "otp";

    otpRequestToast?.dismiss();
    otpRequestToast = null;

    loginIdentifier.type = usingOtp ? "email" : "text";
    loginIdentifier.autocomplete = usingOtp ? "email" : "username";
    loginIdentifier.placeholder = usingOtp
        ? "Enter your email"
        : "Enter username or email";
    loginLabel.textContent = usingOtp ? "Email" : "Username or Email";

    passwordLabel.hidden = usingOtp;
    loginPasswordGroup.hidden = usingOtp;
    loginPassword.required = !usingOtp;
    loginSubmitButton.textContent = usingOtp ? "Send sign-in code" : "Login";

    loginModeButtons.forEach((button) => {
        const selected = button.dataset.loginMode === mode;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
    });

    updateLoginRestrictionUI();
    if (!usingOtp) {
        void refreshLoginRestriction();
    }
}

function setOtpStatus(message, isError = false) {
    if (!message) {
        otpRequestToast?.dismiss();
        otpRequestToast = null;
        return;
    }

    const type = isError
        ? "error"
        : /^(verifying|sending)/i.test(message)
            ? "loading"
            : /sent|verified/i.test(message)
                ? "success"
                : "info";

    if (
        otpRequestToast?.element.isConnected &&
        !otpRequestToast.element.classList.contains("is-leaving")
    ) {
        otpRequestToast.update(message, { type });
    } else {
        otpRequestToast = window.showToast(message, { type });
    }
}

function finishLogin(data) {
    loginRequestToast?.dismiss();
    otpRequestToast?.dismiss();
    window.saveAuthenticatedSession(data.user);
    sessionStorage.removeItem(LOGIN_EMAIL_KEY);
    sessionStorage.removeItem(LOGIN_SENT_AT_KEY);
    window.redirectAfterAuthentication(data.user);
}

let resendTimer = null;

function showOtpVerify(email, sentAt = Date.now()) {
    loginForm.hidden = true;
    otpLoginVerifyForm.hidden = false;
    document.body.classList.add("otp-login-page");
    document.getElementById("otpLoginEmailLabel").textContent = email;
    sessionStorage.setItem(LOGIN_EMAIL_KEY, email);
    sessionStorage.setItem(LOGIN_SENT_AT_KEY, String(sentAt));
    document.getElementById("loginOtp").focus();
    updateResendCooldown();
}

function updateResendCooldown() {
    const resendButton = document.getElementById("loginOtpResend");
    const resendStatus = document.getElementById("loginOtpResendStatus");
    if (resendTimer) {
        clearInterval(resendTimer);
    }

    const sentAt = Number(sessionStorage.getItem(LOGIN_SENT_AT_KEY)) || 0;
    const refresh = () => {
        const remaining = Math.max(0, sentAt + OTP_COOLDOWN_MS - Date.now());
        resendButton.disabled = remaining > 0;
        resendButton.textContent = remaining > 0
            ? `Resend in ${Math.ceil(remaining / 1000)}s`
            : "Resend code";
        resendStatus.hidden = false;
        resendStatus.textContent = "Didn’t receive the code?";

        if (remaining === 0 && resendTimer) {
            clearInterval(resendTimer);
            resendTimer = null;
        }
    };

    refresh();
    if (sentAt && Date.now() < sentAt + OTP_COOLDOWN_MS) {
        resendTimer = setInterval(refresh, 1000);
    }
}

function resetOtpLogin(message, email = "", isError = false) {
    if (resendTimer) {
        clearInterval(resendTimer);
        resendTimer = null;
    }

    sessionStorage.removeItem(LOGIN_EMAIL_KEY);
    sessionStorage.removeItem(LOGIN_SENT_AT_KEY);
    document.getElementById("loginOtp").value = "";
    otpLoginVerifyForm.hidden = true;
    document.getElementById("loginOtpResendStatus").hidden = true;
    loginForm.hidden = false;
    document.body.classList.remove("otp-login-page");
    setLoginMode("otp");
    loginIdentifier.value = email;
    loginIdentifier.focus();
    setOtpStatus(message, isError);
}

if (loginForm) {
    loginModeButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const nextMode = button.dataset.loginMode;
            if (nextMode !== loginMode) {
                loginIdentifier.value = "";
                setLoginMode(nextMode);
                loginIdentifier.focus();
            }
        });
    });

    setLoginMode("password");

    const storedOtpEmail = sessionStorage.getItem(LOGIN_EMAIL_KEY);
    if (storedOtpEmail) {
        setLoginMode("otp");
        showOtpVerify(
            storedOtpEmail,
            Number(sessionStorage.getItem(LOGIN_SENT_AT_KEY)) || 0
        );
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (loginRequestInFlight) return;
        loginRequestInFlight = true;

        const login = loginIdentifier.value.trim();
        const submitButton = loginForm.querySelector('button[type="submit"]');

        if (loginMode === "otp") {
            const email = login.toLowerCase();
            setLoginToast("Sending sign-in code...", "loading");
            submitButton.disabled = true;

            try {
                await postAuth("/api/auth/send-otp", { email, purpose: "login" });
                loginIdentifier.value = email;
                showOtpVerify(email);
                setLoginToast("Sign-in code sent.", "success");
                setOtpStatus("");
            } catch (error) {
                console.error(error);
                const errorMessage = error instanceof TypeError
                    ? "Cannot reach the backend. Please try again shortly."
                    : error.message || "Could not send a sign-in code.";

                if (/no account exists with this email/i.test(errorMessage)) {
                    setLoginToast(errorMessage, "warning");
                } else {
                    setLoginToast(errorMessage, "error");
                }
            } finally {
                loginRequestInFlight = false;
                updateLoginRestrictionUI();
            }

            return;
        }

        const password = loginPassword.value;
        setLoginToast("Logging in...", "loading");
        submitButton.disabled = true;

        try {
            const data = await postAuth("/api/auth/login", { login, password });
            finishLogin(data);
        } catch (error) {
            console.error(error);
            if (handleLoginRestriction(error)) {
                return;
            }
            const errorMessage = error instanceof TypeError
                ? "Cannot reach the backend. Please try again shortly."
                : error.message || "Could not login.";

            if (/invalid username\/email or password/i.test(errorMessage)) {
                showInvalidCredentialsMessage();
            } else {
                setLoginToast(errorMessage, "error");
            }
        } finally {
                loginRequestInFlight = false;
                updateLoginRestrictionUI();
        }
    });
}

if (otpLoginVerifyForm) {
    otpLoginVerifyForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = sessionStorage.getItem(LOGIN_EMAIL_KEY);
        const otp = document.getElementById("loginOtp").value.trim();
        const submitButton = otpLoginVerifyForm.querySelector('button[type="submit"]');

        if (!email) {
            return resetOtpLogin("Sign-in session expired. Request a new code.", "", true);
        }
        if (otpVerificationInFlight) return;
        otpVerificationInFlight = true;

        setOtpStatus("Verifying code...");
        submitButton.disabled = true;

        try {
            const data = await postAuth("/api/auth/verify-otp", {
                email,
                otp,
                purpose: "login"
            });
            finishLogin(data);
        } catch (error) {
            console.error(error);
            const message = error instanceof TypeError
                ? "Cannot reach the backend. Please try again shortly."
                : error.message || "Could not verify your code.";

            if (/expired|not found|already used|too many incorrect attempts/i.test(message)) {
                resetOtpLogin(`${message} Request a new code.`, email, true);
            } else {
                setOtpStatus(message, true);
            }
        } finally {
            otpVerificationInFlight = false;
            submitButton.disabled = false;
        }
    });
}

document.getElementById("loginOtpResend")?.addEventListener("click", async () => {
    const email = sessionStorage.getItem(LOGIN_EMAIL_KEY);
    if (!email) {
        return resetOtpLogin("Sign-in session expired. Request a new code.", "", true);
    }

    const resendButton = document.getElementById("loginOtpResend");
    resendButton.disabled = true;
    setOtpStatus("Sending another sign-in code...");

    try {
        await postAuth("/api/auth/send-otp", { email, purpose: "login" });
        sessionStorage.setItem(LOGIN_SENT_AT_KEY, String(Date.now()));
        updateResendCooldown();
        setOtpStatus("A new sign-in code was sent.");
    } catch (error) {
        console.error(error);
        setOtpStatus(error instanceof TypeError
            ? "Cannot reach the backend. Please try again shortly."
            : error.message || "Could not resend the sign-in code.", true);
        updateResendCooldown();
    }
});

document.getElementById("changeOtpLoginEmail")?.addEventListener("click", () => {
    resetOtpLogin(
        "Update the email address for your account.",
        sessionStorage.getItem(LOGIN_EMAIL_KEY) || ""
    );
});

window.addEventListener("pageshow", () => {
    void refreshLoginRestriction();
});

window.addEventListener("focus", () => {
    void refreshLoginRestriction();
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        void refreshLoginRestriction();
    }
});
