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

function savePreference(key, value, warning, eventName, detail) {
    try {
        localStorage.setItem(key, String(value));
    } catch (error) {
        console.warn(warning, error);
        return false;
    }

    if (eventName) {
        window.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
    return true;
}

function readPreference(key, fallback) {
    try {
        return localStorage.getItem(key);
    } catch {
        return fallback;
    }
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
    return readPreference(getCameraMirrorPreferenceKey(), null) !== "false";
}

export function setCameraMirrorPreference(mirrored) {
    const value = Boolean(mirrored);
    return savePreference(
        getCameraMirrorPreferenceKey(),
        value,
        "Could not save the camera preview preference.",
        CAMERA_PREFERENCE_CHANGE_EVENT,
        { mirrored: value }
    );
}

export function getSmartCameraModePreference() {
    return readPreference(getSmartCameraModePreferenceKey(), null) === "true";
}

export function setSmartCameraModePreference(enabled) {
    const value = Boolean(enabled);
    return savePreference(
        getSmartCameraModePreferenceKey(),
        value,
        "Could not save the smart camera preference.",
        SMART_CAMERA_MODE_CHANGE_EVENT,
        { enabled: value }
    );
}

export function getExerciseSoundPreference() {
    return readPreference(getExerciseSoundPreferenceKey(), null) !== "false";
}

export function setExerciseSoundPreference(enabled) {
    const value = Boolean(enabled);
    return savePreference(
        getExerciseSoundPreferenceKey(),
        value,
        "Could not save the exercise sound preference.",
        EXERCISE_SOUND_CHANGE_EVENT,
        { enabled: value }
    );
}

export function getStrictAiPreference() {
    return readPreference(getStrictAiPreferenceKey(), null) !== "false";
}

export function setStrictAiPreference(enabled) {
    const value = Boolean(enabled);
    return savePreference(
        getStrictAiPreferenceKey(),
        value,
        "Could not save the Strict AI preference."
    );
}

export function getFrontViewPreference() {
    return readPreference(getFrontViewPreferenceKey(), null) === "true";
}

export function setFrontViewPreference(enabled) {
    const value = Boolean(enabled);
    return savePreference(
        getFrontViewPreferenceKey(),
        value,
        "Could not save the Front View preference."
    );
}

export {
    CAMERA_PREFERENCE_CHANGE_EVENT,
    SMART_CAMERA_MODE_CHANGE_EVENT,
    EXERCISE_SOUND_CHANGE_EVENT
};
