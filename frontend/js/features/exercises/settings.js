import {
    getCameraMirrorPreference,
    setCameraMirrorPreference,
    getSmartCameraModePreference,
    setSmartCameraModePreference,
    getExerciseSoundPreference,
    setExerciseSoundPreference
} from "./camera-preference.js";

const toggle = document.getElementById("cameraMirrorToggle");
const smartCameraToggle = document.getElementById("smartCameraToggle");
const exerciseSoundToggle = document.getElementById("exerciseSoundToggle");
const dangerZone = document.getElementById("dangerZone");
const deleteAccountButton = document.getElementById("deleteAccountButton");

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

deleteAccountButton.addEventListener("click", async () => {
    const confirmed = window.confirm(
        "Delete your account permanently? This will also delete your profile, workouts, and competition links. This action cannot be undone."
    );
    if (!confirmed) return;

    deleteAccountButton.disabled = true;
    const deleteToast = window.showToast("Deleting account…", { type: "loading" });

    try {
        const response = await fetch(`${window.API_URL}/api/account`, {
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
            await fetch(`${window.API_URL}/api/auth/logout`, { method: "POST" });
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
