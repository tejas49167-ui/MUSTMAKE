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
const dailyReminderRow = document.querySelector(".settings-row-reminder");
const dailyReminderPreference = document.getElementById("dailyReminderPreference");

let emailPreferences = null;
let emailPreferencesSaving = false;

function hasSignedInUser() {
    try {
        return Boolean(
            JSON.parse(localStorage.getItem("user") || "null")
        );
    } catch {
        return false;
    }
}

const signedInUser = hasSignedInUser();
dangerZone.hidden = !signedInUser;
dailyReminderRow.hidden = !signedInUser;

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
    const locked = loading || emailPreferencesSaving;

    if (emailPreferences) {
        const reminderEnabled = emailPreferences.enabled === true &&
            emailPreferences.dailyExerciseReminder === true;
        dailyReminderPreference.value = reminderEnabled ? "remind" : "dont-remind";
    }

    dailyReminderPreference.disabled = locked;
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
    } catch (error) {
        emailPreferences = null;
        updateEmailPreferencesUI();
        dailyReminderPreference.disabled = true;
        window.showToast(error.status === 401
            ? "Sign in to manage email notifications."
            : error.message, { type: "error" });
    }
}

async function saveEmailPreference(key, value) {
    if (!emailPreferences || emailPreferencesSaving) return;

    const previous = { ...emailPreferences };
    const updatedPreferences = key === "enabled"
        ? { enabled: value, dailyExerciseReminder: value }
        : { [key]: value };
    emailPreferences = { ...emailPreferences, ...updatedPreferences };
    emailPreferencesSaving = true;
    updateEmailPreferencesUI();

    try {
        const data = await requestJson("/api/settings/email-notifications", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updatedPreferences)
        });
        emailPreferences = data.preferences;
    } catch (error) {
        emailPreferences = previous;
        window.showToast(error.message || "Could not save preferences.", { type: "error" });
    } finally {
        emailPreferencesSaving = false;
        updateEmailPreferencesUI();
    }
}

dailyReminderPreference.addEventListener("change", () => {
    const shouldRemind = dailyReminderPreference.value === "remind";
    saveEmailPreference("enabled", shouldRemind);
});

if (signedInUser) {
    updateEmailPreferencesUI();
    loadEmailPreferences();
}

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
