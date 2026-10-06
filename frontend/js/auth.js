const API_URL = "https://mustmakebackend.vercel.app";
const LOGIN_EMAIL_KEY = "pendingLoginOtpEmail";
const LOGIN_SENT_AT_KEY = "pendingLoginOtpSentAt";
const OTP_COOLDOWN_MS = 60 * 1000;

const loginForm = document.getElementById("loginForm");
const otpLoginRequestForm = document.getElementById("otpLoginRequestForm");
const otpLoginVerifyForm = document.getElementById("otpLoginVerifyForm");
const loginMessage = document.getElementById("loginMessage");

window.addEventListener("storage", (event) => {
    if (event.key !== "googleLoginComplete" || !event.newValue) {
        return;
    }

    localStorage.removeItem("googleLoginComplete");

    if (localStorage.getItem("token") && localStorage.getItem("user")) {
        window.location.replace("../index.html");
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
    const response = await fetch(`${API_URL}${path}`, {
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

function finishLogin(data) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    sessionStorage.removeItem(LOGIN_EMAIL_KEY);
    sessionStorage.removeItem(LOGIN_SENT_AT_KEY);
    window.location.replace("../index.html");
}

function showOtpRequest(email = "") {
    loginForm.hidden = true;
    otpLoginVerifyForm.hidden = true;
    otpLoginRequestForm.hidden = false;
    document.getElementById("otpLoginEmail").value = email;
    document.getElementById("otpLoginEmail").focus();
}

let resendTimer = null;

function showOtpVerify(email, sentAt = Date.now()) {
    loginForm.hidden = true;
    otpLoginRequestForm.hidden = true;
    otpLoginVerifyForm.hidden = false;
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
            ? `Resend code in ${Math.ceil(remaining / 1000)}s`
            : "Resend code";
        resendStatus.textContent = remaining > 0
            ? "You can request another code when the timer ends."
            : "Didn't receive the code? You can resend it.";

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
    showOtpRequest(email);
    loginMessage.textContent = message;
}

if (loginForm) {
    const storedOtpEmail = sessionStorage.getItem(LOGIN_EMAIL_KEY);
    if (storedOtpEmail) {
        showOtpVerify(
            storedOtpEmail,
            Number(sessionStorage.getItem(LOGIN_SENT_AT_KEY)) || 0
        );
        loginMessage.textContent = "Enter the code from your email to sign in.";
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const login = document.getElementById("login").value.trim();
        const password = document.getElementById("password").value;
        const submitButton = loginForm.querySelector('button[type="submit"]');

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

document.getElementById("showOtpLogin")?.addEventListener("click", () => {
    showOtpRequest();
    loginMessage.textContent = "Enter your account email and we’ll send a sign-in code.";
});

document.getElementById("backToPasswordLogin")?.addEventListener("click", () => {
    otpLoginRequestForm.hidden = true;
    loginForm.hidden = false;
    loginMessage.textContent = "";
});

if (otpLoginRequestForm) {
    otpLoginRequestForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = document.getElementById("otpLoginEmail").value.trim().toLowerCase();
        const submitButton = otpLoginRequestForm.querySelector('button[type="submit"]');
        loginMessage.textContent = "Sending sign-in code...";
        submitButton.disabled = true;

        try {
            await postAuth("/api/auth/send-otp", { email, purpose: "login" });
            showOtpVerify(email);
            loginMessage.textContent = "Sign-in code sent. Check your inbox and spam folder.";
        } catch (error) {
            console.error(error);
            loginMessage.textContent = error instanceof TypeError
                ? "Cannot reach the backend. Please try again shortly."
                : error.message || "Could not send a sign-in code.";
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

        loginMessage.textContent = "Verifying code...";
        submitButton.disabled = true;

        try {
            const data = await postAuth("/api/auth/verify-otp", {
                email,
                otp,
                purpose: "login"
            });
            loginMessage.textContent = "Code verified. Signing you in...";
            finishLogin(data);
        } catch (error) {
            console.error(error);
            const message = error instanceof TypeError
                ? "Cannot reach the backend. Please try again shortly."
                : error.message || "Could not verify your code.";

            if (/expired|not found|already used|too many incorrect attempts/i.test(message)) {
                resetOtpLogin(`${message} Request a new code.`, email);
            } else {
                loginMessage.textContent = message;
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
    loginMessage.textContent = "Sending another sign-in code...";

    try {
        await postAuth("/api/auth/send-otp", { email, purpose: "login" });
        sessionStorage.setItem(LOGIN_SENT_AT_KEY, String(Date.now()));
        updateResendCooldown();
        loginMessage.textContent = "A new sign-in code was sent.";
    } catch (error) {
        console.error(error);
        loginMessage.textContent = error instanceof TypeError
            ? "Cannot reach the backend. Please try again shortly."
            : error.message || "Could not resend the sign-in code.";
        updateResendCooldown();
    }
});

document.getElementById("changeOtpLoginEmail")?.addEventListener("click", () => {
    resetOtpLogin("Enter the email address for your account.");
});
