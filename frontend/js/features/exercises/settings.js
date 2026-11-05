import {
    getCameraMirrorPreference,
    setCameraMirrorPreference,
    getSmartCameraModePreference,
    setSmartCameraModePreference,
    getExerciseSoundPreference,
    setExerciseSoundPreference,
    getStrictAiPreference,
    setStrictAiPreference,
    getFrontViewPreference,
    setFrontViewPreference
} from "./camera-preference.js";

const toggle = document.getElementById("cameraMirrorToggle");
const smartCameraToggle = document.getElementById("smartCameraToggle");
const exerciseSoundToggle = document.getElementById("exerciseSoundToggle");
const strictAiToggle = document.getElementById("strictAiToggle");
const frontViewToggle = document.getElementById("frontViewToggle");
const dangerZone = document.getElementById("dangerZone");
const deleteAccountButton = document.getElementById("deleteAccountButton");
const emailMasterToggle = document.getElementById("emailMasterToggle");
const dailyReminderToggle = document.getElementById("dailyReminderToggle");
const productUpdatesToggle = document.getElementById("productUpdatesToggle");
const reminderTimeInput = document.getElementById("reminderTime");
const reminderTimeZoneInput = document.getElementById("reminderTimeZone");
const emailNotificationStatus = document.getElementById("emailNotificationStatus");
const emailVerification = document.getElementById("emailVerification");
const emailVerificationMessage = document.getElementById("emailVerificationMessage");
const emailVerificationForm = document.getElementById("emailVerificationForm");
const emailVerificationCode = document.getElementById("emailVerificationCode");
const sendEmailVerificationCode = document.getElementById("sendEmailVerificationCode");
const confirmEmailVerification = document.getElementById("confirmEmailVerification");

let emailPreferences = null;
let emailPreferencesSaving = false;
let verificationEmail = null;
let verificationChallenge = null;

function hasSignedInUser() {
    try {
        return Boolean(
            JSON.parse(localStorage.getItem("user") || "null")
        );
    } catch {
        return false;
    }
}

dangerZone.hidden = !hasSignedInUser();

toggle.checked = getCameraMirrorPreference();

toggle.addEventListener("change", () => {
    const saved = setCameraMirrorPreference(toggle.checked);

    if (!saved) {
        toggle.checked = getCameraMirrorPreference();
    }

    if (!saved) {
        window.showToast("Could not save camera preference.", { type: "error" });
    }
});

smartCameraToggle.checked = getSmartCameraModePreference();

smartCameraToggle.addEventListener("change", () => {
    const saved = setSmartCameraModePreference(smartCameraToggle.checked);

    if (!saved) {
        smartCameraToggle.checked = getSmartCameraModePreference();
    }

    if (!saved) {
        window.showToast("Could not save smart camera preference.", { type: "error" });
    }
});

exerciseSoundToggle.checked = getExerciseSoundPreference();

exerciseSoundToggle.addEventListener("change", () => {
    const saved = setExerciseSoundPreference(exerciseSoundToggle.checked);

    if (!saved) {
        exerciseSoundToggle.checked = getExerciseSoundPreference();
        window.showToast("Could not save exercise sound preference.", { type: "error" });
    }
});

strictAiToggle.checked = getStrictAiPreference();

strictAiToggle.addEventListener("change", () => {
    const saved = setStrictAiPreference(strictAiToggle.checked);

    if (!saved) {
        strictAiToggle.checked = getStrictAiPreference();
        window.showToast("Could not save Strict AI preference.", { type: "error" });
    }
});

frontViewToggle.checked = getFrontViewPreference();

frontViewToggle.addEventListener("change", () => {
    const saved = setFrontViewPreference(frontViewToggle.checked);

    if (!saved) {
        frontViewToggle.checked = getFrontViewPreference();
        window.showToast("Could not save Front View preference.", { type: "error" });
    }
});

function updateEmailPreferencesUI() {
    const loading = !emailPreferences;
    const masterEnabled = emailPreferences?.enabled === true;
    const reminderEnabled = emailPreferences?.dailyExerciseReminder === true;
    const locked = loading || emailPreferencesSaving;

    emailMasterToggle.checked = masterEnabled;
    dailyReminderToggle.checked = reminderEnabled;
    productUpdatesToggle.checked = emailPreferences?.productUpdates === true;
    reminderTimeInput.value = emailPreferences?.reminderTime || "09:00";
    reminderTimeZoneInput.value = emailPreferences?.timeZone || "Asia/Kolkata";

    emailMasterToggle.disabled = locked;
    dailyReminderToggle.disabled = locked || !masterEnabled;
    productUpdatesToggle.disabled = locked || !masterEnabled;
    reminderTimeInput.disabled = locked || !masterEnabled || !reminderEnabled;
    reminderTimeZoneInput.disabled = locked || !masterEnabled || !reminderEnabled;

    const emailVerified = emailPreferences?.emailVerified === true;
    emailVerification.hidden = loading || emailVerified;
    if (!loading && !emailVerified) {
        emailVerificationMessage.textContent =
            "Verify your email address with a one-time code before MUSTMAKE can send notifications.";
    }
}

async function requestJson(path, options = {}) {
    const response = await fetch(`${window.backend_url}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.message || "Request failed.");
        error.status = response.status;
        throw error;
    }
    return data;
}

async function loadEmailPreferences() {
    try {
        const data = await requestJson("/api/settings/email-notifications");
        emailPreferences = data.preferences;
        updateEmailPreferencesUI();
        emailNotificationStatus.textContent = "Preferences loaded.";
    } catch (error) {
        emailPreferences = null;
        updateEmailPreferencesUI();
        emailMasterToggle.disabled = true;
        emailNotificationStatus.textContent = error.status === 401
            ? "Sign in to manage email notifications."
            : error.message;
    }
}

async function saveEmailPreference(key, value) {
    if (!emailPreferences || emailPreferencesSaving) return;

    const previous = { ...emailPreferences };
    emailPreferences = { ...emailPreferences, [key]: value };
    emailPreferencesSaving = true;
    emailNotificationStatus.textContent = "Saving…";
    updateEmailPreferencesUI();

    try {
        const data = await requestJson("/api/settings/email-notifications", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [key]: value })
        });
        emailPreferences = data.preferences;
        emailNotificationStatus.textContent = "Preferences saved.";
    } catch (error) {
        emailPreferences = previous;
        emailNotificationStatus.textContent = error.message || "Could not save preferences.";
        window.showToast(emailNotificationStatus.textContent, { type: "error" });
    } finally {
        emailPreferencesSaving = false;
        updateEmailPreferencesUI();
    }
}

emailMasterToggle.addEventListener("change", () =>
    saveEmailPreference("enabled", emailMasterToggle.checked));
dailyReminderToggle.addEventListener("change", () =>
    saveEmailPreference("dailyExerciseReminder", dailyReminderToggle.checked));
productUpdatesToggle.addEventListener("change", () =>
    saveEmailPreference("productUpdates", productUpdatesToggle.checked));
reminderTimeInput.addEventListener("change", () =>
    saveEmailPreference("reminderTime", reminderTimeInput.value));
reminderTimeZoneInput.addEventListener("change", () =>
    saveEmailPreference("timeZone", reminderTimeZoneInput.value.trim()));

sendEmailVerificationCode.addEventListener("click", async () => {
    sendEmailVerificationCode.disabled = true;
    try {
        const currentUser = await requestJson("/api/auth/me");
        verificationEmail = currentUser.user.email;
        const result = await requestJson("/api/auth/send-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: verificationEmail, purpose: "login" })
        });
        verificationChallenge = result.challengeToken;
        emailVerificationForm.hidden = false;
        emailVerificationCode.focus();
        emailVerificationMessage.textContent = "Enter the one-time code sent to your email.";
    } catch (error) {
        emailVerificationMessage.textContent = error.message;
        window.showToast(error.message, { type: "error" });
    } finally {
        sendEmailVerificationCode.disabled = false;
    }
});

confirmEmailVerification.addEventListener("click", async () => {
    const code = emailVerificationCode.value.trim();
    if (!verificationEmail || !verificationChallenge || !/^\d{6}$/.test(code)) {
        emailVerificationMessage.textContent = "Enter the six-digit verification code.";
        return;
    }

    confirmEmailVerification.disabled = true;
    try {
        await requestJson("/api/auth/verify-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: verificationEmail,
                otp: code,
                purpose: "login",
                challengeToken: verificationChallenge
            })
        });
        verificationChallenge = null;
        verificationEmail = null;
        emailVerificationCode.value = "";
        emailVerificationForm.hidden = true;
        await loadEmailPreferences();
        emailNotificationStatus.textContent = "Email address verified.";
    } catch (error) {
        emailVerificationMessage.textContent = error.message;
        window.showToast(error.message, { type: "error" });
    } finally {
        confirmEmailVerification.disabled = false;
    }
});

updateEmailPreferencesUI();
loadEmailPreferences();

deleteAccountButton.addEventListener("click", async () => {
    const confirmed = window.confirm(
        "Delete your account permanently? This will also delete your profile, workouts, and competition links. This action cannot be undone."
    );
    if (!confirmed) return;

    deleteAccountButton.disabled = true;
    const deleteToast = window.showToast("Deleting account…", { type: "loading" });

    try {
        const response = await fetch(`${window.backend_url}/api/account`, {
            method: "DELETE"
        });
        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            deleteToast?.dismiss();
            window.clearPrivateCaches();
            localStorage.removeItem("user");
            window.location.replace("/");
            return;
        }
        if (!response.ok) {
            throw new Error(data.message || "Could not delete your account.");
        }

        window.clearPrivateCaches();
        try {
            await fetch(`${window.backend_url}/api/auth/logout`, { method: "POST" });
        } catch (error) {
            console.warn("Could not clear the session cookie after account deletion.", error);
        }
        localStorage.removeItem("user");
        deleteToast?.dismiss();
        window.queueToast("Account deleted successfully.", "success");
        window.setTimeout(() => window.location.replace("/"), 600);
    } catch (error) {
        console.error("Account deletion error:", error);
        deleteToast?.update(error instanceof TypeError
            ? "Could not reach the server. Please try again."
            : error.message || "Could not delete your account.", { type: "error" });
        deleteAccountButton.disabled = false;
    }
});
