const SIGNUP_EMAIL_KEY = "pendingSignupEmail";
const SIGNUP_SENT_AT_KEY = "pendingSignupOtpSentAt";
const SIGNUP_CHALLENGE_KEY = "pendingSignupOtpChallenge";

const loginLink = document.getElementById("loginLink");
const signupForm = document.getElementById("signupForm");
const signupOtpForm = document.getElementById("signupOtpForm");
const signupResend = document.getElementById("signupResend");
const resendStatus = document.getElementById("signupResendStatus");
const googleSignupLink = document.getElementById("googleSignupLink");
let signupToast = null;

window.authMechanics.installStorageListener();

if (googleSignupLink) {
    googleSignupLink.href = `${window.backend_url}/api/auth/google`;
    googleSignupLink.addEventListener("click", event => {
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
        window.authMechanics.openGoogleAuth(googleSignupLink.href);
    });
}

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

function postAuth(path, payload) {
    return window.authMechanics.postAuth(path, payload, "Could not complete signup.");
}

function saveSession(data) {
    signupToast?.dismiss();
    window.saveAuthenticatedSession(data.user);
    sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
    sessionStorage.removeItem(SIGNUP_SENT_AT_KEY);
    sessionStorage.removeItem(SIGNUP_CHALLENGE_KEY);
    window.redirectAfterAuthentication(data.user);
}

function savePendingSignup() {
    signupToast?.dismiss();
    sessionStorage.setItem("pendingSignup", "true");
    sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
    sessionStorage.removeItem(SIGNUP_SENT_AT_KEY);
    sessionStorage.removeItem(SIGNUP_CHALLENGE_KEY);
    window.location.replace("/first-details");
}

function setSignupStep(email, sentAt = Date.now(), challengeToken = "") {
    signupForm.hidden = true;
    signupOtpForm.hidden = false;
    document.body.classList.add("otp-login-page");
    document.getElementById("signupOtpEmail").textContent = email;
    sessionStorage.setItem(SIGNUP_EMAIL_KEY, email);
    sessionStorage.setItem(SIGNUP_SENT_AT_KEY, String(sentAt));
    if (challengeToken) {
        sessionStorage.setItem(SIGNUP_CHALLENGE_KEY, challengeToken);
    }
    document.getElementById("signupOtp").focus();
    updateResendCooldown();
}

const resendCooldown = window.authMechanics.createOtpCooldown({
    storageKey: SIGNUP_SENT_AT_KEY,
    button: signupResend,
    status: resendStatus,
    waitingLabel: seconds => `Resend code in ${seconds}s`,
    readyLabel: "Resend code",
    statusText: "Didn't receive the code? You can resend it."
});

function updateResendCooldown() {
    resendCooldown.refresh();
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
    resendCooldown.stop();

    sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
    sessionStorage.removeItem(SIGNUP_SENT_AT_KEY);
    sessionStorage.removeItem(SIGNUP_CHALLENGE_KEY);
    signupOtpForm.hidden = true;
    signupForm.hidden = false;
    document.body.classList.remove("otp-login-page");
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
            if (/already exists/i.test(error.message || "")) {
                returnToSignup("User already exists. Please log in.", true);
                return;
            }

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

            if (data.pendingSignup) {
                savePendingSignup();
            } else {
                saveSession(data);
            }
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
        returnToSignup("", false);
    });
}
