const CAMERA_MIRROR_KEY_PREFIX = "mustmake_camera_mirror:";
const SMART_CAMERA_MODE_KEY_PREFIX = "mustmake_smart_camera_mode:";
const EXERCISE_SOUND_KEY_PREFIX = "mustmake_exercise_sound:";
const STRICT_AI_KEY_PREFIX = "mustmake_strict_ai:";
const FRONT_VIEW_KEY_PREFIX = "mustmake_front_view:";
const CAMERA_PREFERENCE_CHANGE_EVENT = "mustmake:camera-preference-change";
const SMART_CAMERA_MODE_CHANGE_EVENT = "mustmake:smart-camera-mode-change";
const EXERCISE_SOUND_CHANGE_EVENT = "mustmake:exercise-sound-change";

function getPreferenceUserKey() {
    let user = null;

    try {
        user = JSON.parse(localStorage.getItem("user") || "null");
    } catch {
        // Use the separate guest preference when no readable account is stored.
    }

    const identity = user?._id ?? user?.id ?? user?.email ?? user?.username;
    const userKey = identity == null
        ? "guest"
        : String(identity).trim().toLowerCase();

    return encodeURIComponent(userKey);
}

export function getCameraMirrorPreferenceKey() {
    return `${CAMERA_MIRROR_KEY_PREFIX}${getPreferenceUserKey()}`;
}

export function getSmartCameraModePreferenceKey() {
    return `${SMART_CAMERA_MODE_KEY_PREFIX}${getPreferenceUserKey()}`;
}

export function getExerciseSoundPreferenceKey() {
    return `${EXERCISE_SOUND_KEY_PREFIX}${getPreferenceUserKey()}`;
}

export function getStrictAiPreferenceKey() {
    return `${STRICT_AI_KEY_PREFIX}${getPreferenceUserKey()}`;
}

export function getFrontViewPreferenceKey() {
    return `${FRONT_VIEW_KEY_PREFIX}${getPreferenceUserKey()}`;
}

export function getCameraMirrorPreference() {
    try {
        return localStorage.getItem(getCameraMirrorPreferenceKey()) !== "false";
    } catch {
        return true;
    }
}

export function setCameraMirrorPreference(mirrored) {
    const value = Boolean(mirrored);

    try {
        localStorage.setItem(
            getCameraMirrorPreferenceKey(),
            String(value)
        );
    } catch (error) {
        console.warn("Could not save the camera preview preference.", error);
        return false;
    }

    window.dispatchEvent(new CustomEvent(CAMERA_PREFERENCE_CHANGE_EVENT, {
        detail: { mirrored: value }
    }));

    return true;
}

export function getSmartCameraModePreference() {
    try {
        return localStorage.getItem(getSmartCameraModePreferenceKey()) === "true";
    } catch {
        return false;
    }
}

export function setSmartCameraModePreference(enabled) {
    const value = Boolean(enabled);

    try {
        localStorage.setItem(
            getSmartCameraModePreferenceKey(),
            String(value)
        );
    } catch (error) {
        console.warn("Could not save the smart camera preference.", error);
        return false;
    }

    window.dispatchEvent(new CustomEvent(SMART_CAMERA_MODE_CHANGE_EVENT, {
        detail: { enabled: value }
    }));

    return true;
}

export function getExerciseSoundPreference() {
    try {
        return localStorage.getItem(getExerciseSoundPreferenceKey()) !== "false";
    } catch {
        return true;
    }
}

export function setExerciseSoundPreference(enabled) {
    const value = Boolean(enabled);

    try {
        localStorage.setItem(getExerciseSoundPreferenceKey(), String(value));
    } catch (error) {
        console.warn("Could not save the exercise sound preference.", error);
        return false;
    }

    window.dispatchEvent(new CustomEvent(EXERCISE_SOUND_CHANGE_EVENT, {
        detail: { enabled: value }
    }));

    return true;
}

export function getStrictAiPreference() {
    try {
        return localStorage.getItem(getStrictAiPreferenceKey()) !== "false";
    } catch {
        return true;
    }
}

export function setStrictAiPreference(enabled) {
    const value = Boolean(enabled);

    try {
        localStorage.setItem(getStrictAiPreferenceKey(), String(value));
    } catch (error) {
        console.warn("Could not save the Strict AI preference.", error);
        return false;
    }

    return true;
}

export function getFrontViewPreference() {
    try {
        return localStorage.getItem(getFrontViewPreferenceKey()) === "true";
    } catch {
        return false;
    }
}

export function setFrontViewPreference(enabled) {
    const value = Boolean(enabled);

    try {
        localStorage.setItem(getFrontViewPreferenceKey(), String(value));
    } catch (error) {
        console.warn("Could not save the Front View preference.", error);
        return false;
    }

    return true;
}

export {
    CAMERA_PREFERENCE_CHANGE_EVENT,
    SMART_CAMERA_MODE_CHANGE_EVENT,
    EXERCISE_SOUND_CHANGE_EVENT
};
