const SIGNUP_EMAIL_KEY = "pendingSignupEmail";
const SIGNUP_SENT_AT_KEY = "pendingSignupOtpSentAt";
const SIGNUP_CHALLENGE_KEY = "pendingSignupOtpChallenge";
const OTP_COOLDOWN_MS = 60 * 1000;

const loginLink = document.getElementById("loginLink");
const signupForm = document.getElementById("signupForm");
const signupOtpForm = document.getElementById("signupOtpForm");
const signupResend = document.getElementById("signupResend");
const resendStatus = document.getElementById("signupResendStatus");
let signupToast = null;

if (loginLink) {
    loginLink.addEventListener("click", (event) => {
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
        window.location.replace(loginLink.href);
    });
}

async function postAuth(path, payload) {
    const response = await fetch(`${window.backend_url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.message || "Could not complete signup.");
    }

    return data;
}

function saveSession(data) {
    signupToast?.dismiss();
    window.saveAuthenticatedSession(data.user);
    sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
    sessionStorage.removeItem(SIGNUP_SENT_AT_KEY);
    sessionStorage.removeItem(SIGNUP_CHALLENGE_KEY);
    window.redirectAfterAuthentication(data.user);
}

function setSignupStep(email, sentAt = Date.now(), challengeToken = "") {
    signupForm.hidden = true;
    signupOtpForm.hidden = false;
    document.getElementById("signupOtpEmail").textContent = email;
    sessionStorage.setItem(SIGNUP_EMAIL_KEY, email);
    sessionStorage.setItem(SIGNUP_SENT_AT_KEY, String(sentAt));
    if (challengeToken) {
        sessionStorage.setItem(SIGNUP_CHALLENGE_KEY, challengeToken);
    }
    document.getElementById("signupOtp").focus();
    updateResendCooldown();
}

let resendTimer = null;

function updateResendCooldown() {
    if (resendTimer) {
        clearInterval(resendTimer);
    }

    const sentAt = Number(sessionStorage.getItem(SIGNUP_SENT_AT_KEY)) || 0;
    const refresh = () => {
        const remaining = Math.max(0, sentAt + OTP_COOLDOWN_MS - Date.now());
        signupResend.disabled = remaining > 0;
        signupResend.textContent = remaining > 0
            ? `Resend code in ${Math.ceil(remaining / 1000)}s`
            : "Resend code";
        resendStatus.hidden = false;
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

function setSignupMessage(message, isError = false) {
    if (!message) {
        signupToast?.dismiss();
        signupToast = null;
        return;
    }

    const type = isError
        ? "error"
        : /^(sending|verifying)/i.test(message)
            ? "loading"
            : /sent|verified|success/i.test(message)
                ? "success"
                : "info";

    if (
        signupToast?.element.isConnected &&
        !signupToast.element.classList.contains("is-leaving")
    ) {
        signupToast.update(message, { type });
    } else {
        signupToast = window.showToast(message, { type });
    }
}

function returnToSignup(message, isError = true) {
    if (resendTimer) {
        clearInterval(resendTimer);
        resendTimer = null;
    }

    sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
    sessionStorage.removeItem(SIGNUP_SENT_AT_KEY);
    sessionStorage.removeItem(SIGNUP_CHALLENGE_KEY);
    signupOtpForm.hidden = true;
    signupForm.hidden = false;
    document.getElementById("signupOtp").value = "";
    resendStatus.textContent = "";
    resendStatus.hidden = true;
    setSignupMessage(message, isError);
}

if (signupForm && signupOtpForm) {
    const savedEmail = sessionStorage.getItem(SIGNUP_EMAIL_KEY);
    if (savedEmail) {
        setSignupStep(
            savedEmail,
            Number(sessionStorage.getItem(SIGNUP_SENT_AT_KEY)) || 0
        );
        setSignupMessage("Enter the code from your email to finish creating your account.");
    }

    signupForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const username = document.getElementById("username").value.trim();
        const email = document.getElementById("email").value.trim().toLowerCase();
        const password = document.getElementById("password").value;
        const submitButton = signupForm.querySelector('button[type="submit"]');

        setSignupMessage("Sending verification code...");
        submitButton.disabled = true;

        try {
            const result = await postAuth("/api/auth/send-otp", {
                username,
                email,
                password,
                purpose: "signup"
            });

            setSignupStep(email, result.sentAt || Date.now(), result.challengeToken);
            setSignupMessage(result.message || "Verification code sent. Check your inbox and spam folder.");
        } catch (error) {
            const savedEmail = sessionStorage.getItem(SIGNUP_EMAIL_KEY);
            if (
                error.message.includes("wait 60 seconds") &&
                savedEmail === email
            ) {
                setSignupStep(email, Number(sessionStorage.getItem(SIGNUP_SENT_AT_KEY)) || Date.now());
            }

            console.error(error);
            setSignupMessage(error instanceof TypeError
                ? "Cannot reach the backend. Please try again shortly."
                : error.message || "Could not send a verification code.", true);
        } finally {
            submitButton.disabled = false;
        }
    });

    signupOtpForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = sessionStorage.getItem(SIGNUP_EMAIL_KEY);
        const otp = document.getElementById("signupOtp").value.trim();
        const submitButton = signupOtpForm.querySelector('button[type="submit"]');

        if (!email) {
            return returnToSignup("Signup session expired. Please enter your details again.");
        }

        setSignupMessage("Verifying code...");
        submitButton.disabled = true;

        try {
            const data = await postAuth("/api/auth/verify-otp", {
                email,
                otp,
                challengeToken: sessionStorage.getItem(SIGNUP_CHALLENGE_KEY),
                purpose: "signup"
            });

            saveSession(data);
        } catch (error) {
            console.error(error);
            const message = error instanceof TypeError
                ? "Cannot reach the backend. Please try again shortly."
                : error.message || "Could not verify your code.";

            if (/expired|restart signup|start signup again|signup details|too many incorrect attempts/i.test(message)) {
                returnToSignup(`${message} Please enter your details again.`, true);
            } else {
                setSignupMessage(message, true);
            }
        } finally {
            submitButton.disabled = false;
        }
    });

    signupResend.addEventListener("click", async () => {
        const email = sessionStorage.getItem(SIGNUP_EMAIL_KEY);
        if (!email) {
            return returnToSignup("Signup session expired. Please enter your details again.");
        }

        signupResend.disabled = true;
        setSignupMessage("Sending another verification code...");

        try {
            const result = await postAuth("/api/auth/send-otp", { email, purpose: "signup" });
            if (result.challengeToken) {
                sessionStorage.setItem(SIGNUP_CHALLENGE_KEY, result.challengeToken);
            }
            sessionStorage.setItem(SIGNUP_SENT_AT_KEY, String(Date.now()));
            updateResendCooldown();
            setSignupMessage("A new verification code was sent.");
        } catch (error) {
            console.error(error);
            setSignupMessage(error instanceof TypeError
                ? "Cannot reach the backend. Please try again shortly."
                : error.message || "Could not resend the verification code.", true);

            if (/signup details expired/i.test(error.message)) {
                returnToSignup("Signup details expired. Please enter them again.", true);
            } else {
                updateResendCooldown();
            }
        }
    });

    document.getElementById("editSignupDetails").addEventListener("click", () => {
        returnToSignup("Update your details, then request a new verification code.", false);
    });
}
