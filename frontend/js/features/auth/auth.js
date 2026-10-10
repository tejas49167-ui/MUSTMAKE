const LOGIN_EMAIL_KEY = "pendingLoginOtpEmail";
const LOGIN_SENT_AT_KEY = "pendingLoginOtpSentAt";
const OTP_COOLDOWN_MS = 60 * 1000;

const loginForm = document.getElementById("loginForm");
const otpLoginVerifyForm = document.getElementById("otpLoginVerifyForm");
const loginMessage = document.getElementById("loginMessage");
const otpLoginStatus = document.getElementById("otpLoginStatus");
const loginIdentifier = document.getElementById("login");
const loginLabel = document.getElementById("loginLabel");
const loginPassword = document.getElementById("password");
const passwordLabel = document.getElementById("passwordLabel");
const loginSubmitButton = document.getElementById("loginSubmitButton");
const loginModeButtons = document.querySelectorAll("[data-login-mode]");
let loginMode = "password";

window.addEventListener("storage", (event) => {
    if (event.key !== "googleLoginComplete" || !event.newValue) {
        return;
    }

    localStorage.removeItem("googleLoginComplete");

    if (localStorage.getItem("token") && localStorage.getItem("user")) {
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
        throw new Error(data.message || "Could not complete login.");
    }

    return data;
}

function setLoginMode(mode) {
    loginMode = mode;
    const usingOtp = mode === "otp";

    otpLoginStatus.textContent = "";
    otpLoginStatus.hidden = true;

    loginIdentifier.type = usingOtp ? "email" : "text";
    loginIdentifier.autocomplete = usingOtp ? "email" : "username";
    loginIdentifier.placeholder = usingOtp
        ? "Enter your email"
        : "Enter username or email";
    loginLabel.textContent = usingOtp ? "Email" : "Username or Email";

    passwordLabel.hidden = usingOtp;
    loginPassword.hidden = usingOtp;
    loginPassword.required = !usingOtp;
    loginSubmitButton.textContent = usingOtp ? "Send sign-in code" : "Login";

    loginModeButtons.forEach((button) => {
        const selected = button.dataset.loginMode === mode;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
    });
}

function setOtpStatus(message) {
    otpLoginStatus.textContent = message;
    otpLoginStatus.hidden = !message;
    loginMessage.textContent = "";
}

function finishLogin(data) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
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

function resetOtpLogin(message, email = "") {
    if (resendTimer) {
        clearInterval(resendTimer);
        resendTimer = null;
    }

    sessionStorage.removeItem(LOGIN_EMAIL_KEY);
    sessionStorage.removeItem(LOGIN_SENT_AT_KEY);
    document.getElementById("loginOtp").value = "";
    otpLoginVerifyForm.hidden = true;
    loginForm.hidden = false;
    document.body.classList.remove("otp-login-page");
    setLoginMode("otp");
    loginIdentifier.value = email;
    loginIdentifier.focus();
    loginMessage.textContent = message;
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
            loginMessage.textContent = "";
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
        loginMessage.textContent = "";
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const login = loginIdentifier.value.trim();
        const submitButton = loginForm.querySelector('button[type="submit"]');

        if (loginMode === "otp") {
            const email = login.toLowerCase();
            loginMessage.textContent = "Sending sign-in code...";
            submitButton.disabled = true;

            try {
                await postAuth("/api/auth/send-otp", { email, purpose: "login" });
                loginIdentifier.value = email;
                showOtpVerify(email);
                loginMessage.textContent = "";
                setOtpStatus("");
            } catch (error) {
                console.error(error);
                loginMessage.textContent = error instanceof TypeError
                    ? "Cannot reach the backend. Please try again shortly."
                    : error.message || "Could not send a sign-in code.";
            } finally {
                submitButton.disabled = false;
            }

            return;
        }

        const password = loginPassword.value;
        loginMessage.textContent = "Logging in...";
        submitButton.disabled = true;

        try {
            const data = await postAuth("/api/auth/login", { login, password });
            loginMessage.textContent = "Login successful!";
            finishLogin(data);
        } catch (error) {
            console.error(error);
            loginMessage.textContent = error instanceof TypeError
                ? "Cannot reach the backend. Please try again shortly."
                : error.message || "Could not login.";
        } finally {
            submitButton.disabled = false;
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
            return resetOtpLogin("Sign-in session expired. Request a new code.");
        }

        setOtpStatus("Verifying code...");
        submitButton.disabled = true;

        try {
            const data = await postAuth("/api/auth/verify-otp", {
                email,
                otp,
                purpose: "login"
            });
            setOtpStatus("Code verified. Signing you in...");
            finishLogin(data);
        } catch (error) {
            console.error(error);
            const message = error instanceof TypeError
                ? "Cannot reach the backend. Please try again shortly."
                : error.message || "Could not verify your code.";

            if (/expired|not found|already used|too many incorrect attempts/i.test(message)) {
                resetOtpLogin(`${message} Request a new code.`, email);
            } else {
                setOtpStatus(message);
            }
        } finally {
            submitButton.disabled = false;
        }
    });
}

document.getElementById("loginOtpResend")?.addEventListener("click", async () => {
    const email = sessionStorage.getItem(LOGIN_EMAIL_KEY);
    if (!email) {
        return resetOtpLogin("Sign-in session expired. Request a new code.");
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
            : error.message || "Could not resend the sign-in code.");
        updateResendCooldown();
    }
});

document.getElementById("changeOtpLoginEmail")?.addEventListener("click", () => {
    resetOtpLogin(
        "Update the email address for your account.",
        sessionStorage.getItem(LOGIN_EMAIL_KEY) || ""
    );
});
