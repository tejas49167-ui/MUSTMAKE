(() => {
    "use strict";

    const EXERCISE_CACHE_KEY = "mustmake_exercises_v4";
    const OUTDATED_EXERCISE_CACHE_KEYS = [
        "mustmake_exercises_v3",
        "mustmake_exercises_v2",
        "mustmake_exercises"
    ];
    const PENDING_WORKOUT_KEY = "mustmake_pending_workout";
    const root = document.getElementById("exerciseDetail");
    const slug = document.body.dataset.exerciseSlug;
    if (!root || !slug) return;

    function clearOutdatedExerciseCaches() {
        OUTDATED_EXERCISE_CACHE_KEYS.forEach(key => sessionStorage.removeItem(key));
    }

    function readPendingWorkout() {
        try {
            const pending = JSON.parse(sessionStorage.getItem(PENDING_WORKOUT_KEY) || "null");
            if (pending?.slug !== slug ||
                !["manual", "ai"].includes(pending.mode) ||
                !pending.payload || typeof pending.payload !== "object") {
                return null;
            }
            return pending;
        } catch (error) {
            console.warn("Could not read the pending workout.", error);
            return null;
        }
    }

    function storePendingWorkout(mode, payload) {
        try {
            sessionStorage.setItem(PENDING_WORKOUT_KEY, JSON.stringify({
                slug,
                mode,
                payload
            }));
            return true;
        } catch (error) {
            console.warn("Could not preserve the pending workout.", error);
            return false;
        }
    }

    function clearPendingWorkout() {
        try {
            const pending = readPendingWorkout();
            if (pending) sessionStorage.removeItem(PENDING_WORKOUT_KEY);
        } catch (error) {
            console.warn("Could not clear the pending workout.", error);
        }
    }

    const pendingWorkout = readPendingWorkout();

    const escapeHTML = value =>
        String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);

    function cacheExercises(exercises) {
        try {
            sessionStorage.setItem(EXERCISE_CACHE_KEY, JSON.stringify(exercises));
            clearOutdatedExerciseCaches();
        } catch (error) {
            console.warn("Could not cache the exercise catalog.", error);
        }
    }

    function renderMedia(exercise) {
        const media = exercise.media;
        if (!media) return "";

        if (media.type === "image") {
            return `
                <img
                    class="exercise-media"
                    src="${escapeHTML(media.src)}"
                    alt="${escapeHTML(exercise.name)} demonstration"
                    loading="lazy"
                >
            `;
        }

        return `
            <video
                class="exercise-media exercise-demo"
                autoplay
                muted
                loop
                playsinline
                disablepictureinpicture
                controlslist="nodownload noplaybackrate noremoteplayback"
                preload="metadata"
                aria-label="${escapeHTML(exercise.name)} demonstration"
            >
                <source
                    src="${escapeHTML(media.src)}"
                    type="video/mp4"
                >
            </video>
        `;
    }

    function renderField(field, exercise) {
        const id = `workout-${field.name}`;
        const max = field.name === "reps"
            ? 150
            : field.name === "sets"
                ? 10
                : exercise.manualType === "duration" && field.name === "duration"
                    ? 900
                    : exercise.manualType === "distance-duration" && field.name === "amount"
                        ? 50
                        : null;
        return `
            <div class="exercise-form-field">
                <label for="${escapeHTML(id)}">${escapeHTML(field.label)}</label>
                <input
                    id="${escapeHTML(id)}"
                    name="${escapeHTML(field.name)}"
                    type="number"
                    min="${escapeHTML(field.min)}"
                    ${max == null ? "" : `max="${max}"`}
                    step="${escapeHTML(field.step)}"
                    inputmode="decimal"
                    required
                >
            </div>
        `;
    }

    function renderManualMode(exercise) {
        return `
            <div class="exercise-mode-content">
                <form id="manualWorkoutForm" class="exercise-workout-form">
                    <div class="exercise-form-grid">
                        ${exercise.fields.map(field => renderField(field, exercise)).join("")}
                    </div>
                    <button class="main-button exercise-done-button" type="submit">Done</button>
                </form>
            </div>
        `;
    }

    function renderAiMode(exercise) {
        const isPlank = exercise.slug === "plank";
        const isJumpCount = exercise.slug === "skipping-rope";
        const weightField = exercise.fields.find(field => field.name === "weight");

        const correctionLabel = isPlank
            ? "Plank time (seconds)"
            : isJumpCount
                ? "Jumps"
                : "Repetitions";

        return `
            <div class="exercise-monitor">

                <p id="monitorFeedback" aria-live="polite">Loading AI.</p>
                <p class="monitor-ai-disclaimer">For good count keep distance so you cover yourself fully in the frame</p>

                <div class="monitor-heading">
                    <span id="monitorStatus" class="monitor-status" role="status" aria-live="polite">Ready</span>
                </div>

                <div class="monitor-preview-slot">
                    <div class="monitor-preview">
                        <video id="monitorVideo" playsinline muted hidden aria-label="Live camera preview"></video>
                        <canvas id="monitorCanvas" width="640" height="480" aria-label="Detected body landmarks and skeleton overlay"></canvas>
                        <div class="monitor-preview-placeholder" role="status" aria-live="polite">
                            <strong id="monitorSmartScrollPrompt" hidden>Scroll ↓</strong>
                        </div>
                        <div class="monitor-smart-overlay"></div>
                    </div>
                </div>

                <p id="monitorCameraStatus" class="monitor-camera-status" hidden></p>

                <div class="monitor-controls" aria-label="Monitoring controls">
                    <button id="monitorFinish" class="secondary-button" type="button" disabled>Finish Session</button>
                </div>

                <div class="monitor-stats monitor-stats-single" aria-label="Live session statistics">
                    ${isPlank ? "" : `
                        <div class="monitor-stat monitor-stat-repetitions">
                            <strong id="monitorRepCount" aria-live="polite">0</strong>
                        </div>
                    `}

                    ${isPlank ? `
                        <div class="monitor-stat">
                            <span>Correct plank time</span>
                            <strong id="monitorSessionTime">00:00</strong>
                        </div>
                    ` : ""}
                </div>

                <dialog id="monitorSummary" class="monitor-summary" aria-labelledby="monitorSummaryTitle" aria-modal="true">
                    <div class="monitor-section-heading">
                        <div>
                            <h3 id="monitorSummaryTitle">Review</h3>
                            <p>${escapeHTML(exercise.name)}</p>
                        </div>
                    </div>

                    ${weightField ? `<div class="monitor-exercise-fields">${renderField(weightField, exercise)}</div>` : ""}

                    <div class="exercise-form-field monitor-exercise-fields">
                        <label for="monitorCorrection">${correctionLabel}</label>
                        <input
                            id="monitorCorrection"
                            name="${isPlank ? "reviewedDuration" : isJumpCount ? "reviewedJumps" : "reviewedReps"}"
                            type="number"
                            min="1"
                            max="150"
                            step="1"
                            inputmode="numeric"
                            required
                            aria-describedby="monitorCorrectionError"
                        >
                        <p id="monitorCorrectionError" class="exercise-form-message" role="alert"></p>
                    </div>

                    <p id="monitorSignInPrompt" class="monitor-sign-in-prompt" role="status" hidden>
                        <span>Sign in to save this reviewed workout.</span>
                        <a href="/login">Sign in</a>
                    </p>

                    <div class="monitor-review-controls">
                        <button id="monitorSave" class="main-button monitor-save" type="button" disabled>Save Workout</button>
                        <button id="monitorDiscard" class="secondary-button monitor-discard" type="button" disabled>Discard Session</button>
                    </div>
                </dialog>
            </div>
        `;
    }

    function render(exercise) {
        const detectorSupported = [
            "squats",
            "push-ups",
            "plank",
            "pull-ups",
            "jumping-jacks",
            "skipping-rope",
            "biceps-curls",
            "shoulder-press",
            "lateral-raises",
            "triceps-extension"
        ].includes(exercise.slug);

        const supportedModes = Array.isArray(exercise.modes)
            ? exercise.modes.filter(mode => mode === "ai" || mode === "manual")
            : ["manual"];

        const availableModes = supportedModes.filter(
            mode => mode !== "ai" || detectorSupported
        );

        const hasAiMode = availableModes.includes("ai");
        const hasManualMode = availableModes.includes("manual");

        const selectedMode = pendingWorkout &&
            availableModes.includes(pendingWorkout.mode)
            ? pendingWorkout.mode
            : hasAiMode
                ? "ai"
                : hasManualMode
                    ? "manual"
                    : null;

        const modeLabel = mode => mode === "ai" ? "AI Mode" : "Manual Entry";

        const modeButtons = availableModes.length > 1
            ? `
                <div class="exercise-mode-tabs" role="tablist" aria-label="Workout mode">
                    ${availableModes.map(mode => `
                        <button
                            type="button"
                            role="tab"
                            id="${mode}ModeTab"
                            tabindex="${mode === selectedMode ? "0" : "-1"}"
                            aria-selected="${mode === selectedMode}"
                            aria-controls="exerciseModeContent"
                            data-exercise-mode="${mode}"
                        >${modeLabel(mode)}</button>
                    `).join("")}
                </div>
            `
            : "";

        let monitorModulePromise = null;
        let currentMonitor = null;
        let savedMonitorSnapshot = null;
        let renderGeneration = 0;

        function loadAiMonitor() {
            const generation = ++renderGeneration;

            if (!monitorModulePromise) {
                monitorModulePromise = import("./ai-monitor.js");
            }

            modeContent.dataset.mode = "ai";
            modeContent.querySelector("#monitorStatus").textContent = "Loading AI monitor…";
            modeContent.querySelector("#monitorFeedback").textContent =
                "Loading AI…";

            monitorModulePromise
                .then(({ mountAiMonitor }) => {
                    if (
                        generation !== renderGeneration ||
                        modeContent.dataset.mode !== "ai"
                    ) {
                        return;
                    }

                    currentMonitor = mountAiMonitor(
                        modeContent,
                        exercise,
                        savedMonitorSnapshot,
                        pendingWorkout?.mode === "ai" ? pendingWorkout.payload : null,
                        payload => storePendingWorkout("ai", payload),
                        clearPendingWorkout
                    );

                    savedMonitorSnapshot = null;
                })
                .catch(error => {
                    console.error("Could not load the AI monitor:", error);

                    if (
                        generation !== renderGeneration ||
                        modeContent.dataset.mode !== "ai"
                    ) {
                        return;
                    }

                    modeContent.querySelector("#monitorStatus").textContent =
                        "AI monitor unavailable";

                    modeContent.querySelector("#monitorFeedback").textContent =
                        "AI unavailable.";
                });
        }

        function renderMode(mode) {
            if (
                currentMonitor?.canSwitch &&
                !currentMonitor.canSwitch()
            ) {
                return false;
            }

            if (currentMonitor) {
                savedMonitorSnapshot = currentMonitor.dispose();
                currentMonitor = null;
            }

            renderGeneration += 1;
            modeContent.dataset.mode = mode;

            modeContent.setAttribute(
                "aria-labelledby",
                mode === "ai" ? "aiModeTab" : "manualModeTab"
            );

            modeContent.innerHTML = mode === "ai"
                ? renderAiMode(exercise)
                : renderManualMode(exercise);

            if (mode === "ai") {
                loadAiMonitor();
            } else {
                bindManualForm(exercise);
            }

            return true;
        }

        const initialModeContent = selectedMode === "ai"
            ? renderAiMode(exercise)
            : selectedMode === "manual"
                ? renderManualMode(exercise)
                : '<p class="no-workout">No workout modes are configured for this exercise.</p>';

        const panelAttributes = availableModes.length > 1
            ? `role="tabpanel" aria-labelledby="${selectedMode}ModeTab" tabindex="0"`
            : selectedMode
                ? `aria-labelledby="${selectedMode === "ai" ? "aiModeTitle" : "exerciseModeTitle"}"`
                : "";

        const unsupportedAiMessage =
            supportedModes.includes("ai") && !detectorSupported
                ? '<p class="monitor-unavailable-note" role="note">AI monitoring is not available for this exercise yet. Manual Entry is still available.</p>'
                : "";

        document.title = `${exercise.name} | MUSTMAKE`;

        root.innerHTML = `
            <header class="exercise-detail-heading">
                <h1>${escapeHTML(exercise.name)}</h1>
            </header>

            <div class="exercise-detail-layout">
                <section class="exercise-demo-panel" aria-label="Exercise demonstration">
                    <div class="exercise-detail-media-content">
                        ${renderMedia(exercise)}
                        <p class="exercise-growth-tagline">
                            It's your <span>growth,</span> keep it real
                        </p>
                    </div>
                </section>

                <section class="exercise-workout-panel" aria-label="Workout modes">
                    ${modeButtons}
                    ${unsupportedAiMessage}

                    <div
                        id="exerciseModeContent"
                        class="exercise-mode-panel"
                        ${panelAttributes}
                    >
                        ${initialModeContent}
                    </div>
                </section>
            </div>
        `;

        root.removeAttribute("aria-live");

        const modeContent = root.querySelector("#exerciseModeContent");
        modeContent.dataset.mode = selectedMode || "";

        const tabs = [...root.querySelectorAll("[data-exercise-mode]")];

        tabs.forEach(tab => {
            tab.addEventListener("click", () => {
                const mode = tab.dataset.exerciseMode;

                if (!renderMode(mode)) return;

                tabs.forEach(item => {
                    const selected = item === tab;
                    item.setAttribute("aria-selected", String(selected));
                    item.tabIndex = selected ? 0 : -1;
                });
            });

            tab.addEventListener("keydown", event => {
                if (!tabs.length) return;

                let nextIndex = tabs.indexOf(tab);

                if (event.key === "ArrowRight") {
                    nextIndex = (nextIndex + 1) % tabs.length;
                } else if (event.key === "ArrowLeft") {
                    nextIndex = (nextIndex - 1 + tabs.length) % tabs.length;
                } else if (event.key === "Home") {
                    nextIndex = 0;
                } else if (event.key === "End") {
                    nextIndex = tabs.length - 1;
                } else {
                    return;
                }

                event.preventDefault();
                tabs[nextIndex].focus();
                tabs[nextIndex].click();
            });
        });

        if (selectedMode === "manual") {
            bindManualForm(exercise);
        } else if (selectedMode === "ai") {
            loadAiMonitor();
        }
    }

    function buildWorkoutPayload(exercise, form) {
        const values = new FormData(form);
        const payload = { exercise: exercise.name };

        exercise.fields.forEach(field => {
            const value = Number(values.get(field.name));

            if (field.name === "durationMinutes") {
                payload.duration = Math.round(value * 60);
            } else {
                payload[field.name] = value;
            }
        });

        if (exercise.manualType === "distance-duration") {
            payload.unit = "km";
        }

        if (exercise.manualType === "jumps-duration") {
            payload.unit = "jumps";
        }

        return payload;
    }

    function bindManualForm(exercise) {
        const form = root.querySelector("#manualWorkoutForm");
        if (!form) return;

        if (pendingWorkout?.mode === "manual") {
            exercise.fields.forEach(field => {
                const input = form.elements.namedItem(field.name);
                if (input && pendingWorkout.payload[field.name] != null) {
                    input.value = pendingWorkout.payload[field.name];
                }
            });
            window.showToast("You're signed in. Your workout is ready to save again.", { type: "info" });
        }

        form.addEventListener("submit", async event => {
            event.preventDefault();

            const button = form.querySelector("button[type='submit']");
            const token = localStorage.getItem("token");

            if (!token) {
                const values = Object.fromEntries(new FormData(form).entries());
                if (!storePendingWorkout("manual", values)) {
                    window.showToast("Could not preserve your workout. Please try again before signing in.", { type: "error" });
                    return;
                }
                window.showToast("Please sign in to save your workout.", {
                    type: "info",
                    action: { label: "Sign in", href: "/login" }
                });
                return;
            }

            button.disabled = true;
            const saveToast = window.showToast("Saving your workout…", { type: "loading" });

            try {
                const response = await fetch(
                    `${window.API_URL}/api/workouts`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${token}`
                        },
                        body: JSON.stringify(
                            buildWorkoutPayload(exercise, form)
                        )
                    }
                );

                const data = await response.json().catch(() => ({}));

                if (response.status === 401) {
                    window.clearPrivateCaches();
                    localStorage.removeItem("token");
                    localStorage.removeItem("user");

                    if (!storePendingWorkout(
                        "manual",
                        Object.fromEntries(new FormData(form).entries())
                    )) {
                        saveToast?.update("Your sign-in expired, and your workout could not be preserved. Please retry before signing in.", { type: "error" });
                        return;
                    }
                    saveToast?.update("Your session expired. Sign in again to save this workout.", {
                        type: "warning",
                        action: { label: "Sign in", href: "/login" }
                    });
                    return;
                }

                if (!response.ok) {
                    saveToast?.update(
                        data.message || "Could not save this workout. Check the values and try again.",
                        { type: "error" }
                    );
                    return;
                }

                clearPendingWorkout();
                form.reset();
                window.location.replace("/today");
            } catch (error) {
                console.error("Save workout error:", error);

                saveToast?.update("Could not connect to the server. Please try again.", { type: "error" });
            } finally {
                button.disabled = false;
            }
        });
    }

    async function loadExercises() {
        let cachedExercises;

        try {
            cachedExercises = JSON.parse(
                sessionStorage.getItem(EXERCISE_CACHE_KEY) || "null"
            );
            if (!Array.isArray(cachedExercises)) {
                clearOutdatedExerciseCaches();
                sessionStorage.removeItem(EXERCISE_CACHE_KEY);
            }
        } catch (error) {
            console.warn("Could not read the cached exercise catalog.", error);
        }

        if (Array.isArray(cachedExercises)) {
            return cachedExercises;
        }

        let catalogError;

        try {
            const response = await fetch("/data/exercises.json?v=4", { cache: "no-cache" });

            if (!response.ok) {
                throw new Error(
                    `Exercise catalog returned ${response.status}.`
                );
            }

            const exercises = await response.json();

            if (!Array.isArray(exercises)) {
                throw new Error("Exercise catalog returned invalid data.");
            }

            cacheExercises(exercises);
            return exercises;
        } catch (error) {
            catalogError = error;
        }

        try {
            const response = await fetch(
                `${window.API_URL}/api/exercises?v=4`,
                { cache: "no-cache" }
            );

            if (!response.ok) {
                throw new Error(
                    `Exercise API returned ${response.status}.`
                );
            }

            const exercises = await response.json();

            if (!Array.isArray(exercises)) {
                throw new Error(
                    "Exercise API returned an invalid catalog."
                );
            }

            cacheExercises(exercises);
            return exercises;
        } catch (apiError) {
            console.error(
                "Exercise catalog fallback failed:",
                catalogError
            );
            throw apiError;
        }
    }

    async function loadExercise() {
        try {
            const exercises = await loadExercises();
            const exercise = exercises.find(item => item.slug === slug);

            if (!exercise) {
                throw new Error("This exercise could not be found.");
            }

            render(exercise);
        } catch (error) {
            console.error("Exercise detail error:", error);
            root.innerHTML = '<a class="exercise-back-link" href="/today">&larr; Back to exercises</a>';
            window.showToast(error.message || "This exercise could not be loaded.", {
                type: "error",
                action: { label: "Back to exercises", href: "/today" }
            });
        }
    }

    loadExercise();
})();
