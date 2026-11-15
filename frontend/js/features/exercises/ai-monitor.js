import { createExerciseDetector } from "./exercise-detectors.mjs";
import { MAX_PLANK_DURATION_SECONDS } from "./exercise-limits.mjs";
import {
    acquireCameraStream,
    applyCameraZoom,
    attachCameraStream,
    cameraErrorMessage,
    detachCameraStream,
    stopCameraStream
} from "./camera-lifecycle.js";
import {
    createPoseLandmarker,
    createPoseLandmarkerWithFallback,
    detectPoseFrame,
    INFERENCE_INTERVAL_MS
} from "./pose-inference.js";
import { createPoseRenderer } from "./pose-rendering.js";
import {
    createSmartCameraPreview,
    getSmartCameraPromptState
} from "./smart-camera-preview.js";
import { createWorkoutReview } from "./workout-review.js";
import {
    CAMERA_PREFERENCE_CHANGE_EVENT,
    SMART_CAMERA_MODE_CHANGE_EVENT,
    getCameraMirrorPreference,
    getCameraMirrorPreferenceKey,
    getSmartCameraModePreference,
    getSmartCameraModePreferenceKey,
    EXERCISE_SOUND_CHANGE_EVENT,
    getExerciseSoundPreference,
    getExerciseSoundPreferenceKey,
    getStrictAiPreference,
    getFrontViewPreference
} from "./camera-preference.js";

const MAX_REPETITIONS = 10000;
const SHARED_EXERCISE_FEEDBACK = new Set([
    "Can't see u.",
    "Get set.",
    "Nice rep."
]);
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function roundedDuration(milliseconds) {
    return Math.max(0, Math.floor(milliseconds / 1000));
}

export { getSmartCameraPromptState };

export function mountAiMonitor(
    root,
    exercise,
    snapshot = null,
    pendingWorkout = null,
    onSignInRequired = null,
    onWorkoutSaved = null,
    onSessionStateChange = null
) {
    const isPlank = exercise.slug === "plank";
    const isJumpCount = exercise.slug === "skipping-rope";
    const weightField = exercise.fields?.find(field => field.name === "weight");
    const minWeight = weightField?.min ?? 0;
    const maxWeight = weightField?.max ?? 60;
    const weightStep = weightField?.step ?? 0.5;
    const maxPlankDuration = exercise.fields?.find(field => field.name === "duration")?.max ??
        MAX_PLANK_DURATION_SECONDS;

    const video = root.querySelector("#monitorVideo");
    const canvas = root.querySelector("#monitorCanvas");
    const preview = root.querySelector(".monitor-preview");
    const previewSlot = root.querySelector(".monitor-preview-slot");
    const smartCameraPrompt = root.querySelector("#monitorSmartScrollPrompt");
    const smartOverlay = root.querySelector(".monitor-smart-overlay");
    const monitor = root.querySelector(".exercise-monitor");
    const placeholder = root.querySelector(".monitor-preview-placeholder");
    const status = root.querySelector("#monitorStatus");
    const cameraStatus = root.querySelector("#monitorCameraStatus");
    const feedback = root.querySelector("#monitorFeedback");
    const countOutput = root.querySelector("#monitorRepCount");
    const timeOutput = root.querySelector("#monitorSessionTime");
    const finishButton = root.querySelector("#monitorFinish");
    const monitorControls = root.querySelector(".monitor-controls");
    const weightInput = root.querySelector("#workout-weight");
    const saveButton = root.querySelector("#monitorSave");
    const discardButton = root.querySelector("#monitorDiscard");
    const correctionError = root.querySelector("#monitorCorrectionError");
    const signInPrompt = root.querySelector("#monitorSignInPrompt");
    const signInPromptMessage = signInPrompt?.querySelector("span");
    const monitorStats = root.querySelector(".monitor-stats");

    const detector = createExerciseDetector(exercise.slug, {
        mode: getStrictAiPreference() ? "strict" : "forgiving",
        frontView: getFrontViewPreference()
    });
    const listeners = new AbortController();
    const repSound = typeof Audio !== "undefined"
        ? new Audio("/assets/nice_rep.mp3")
        : null;
    if (repSound) {
        repSound.preload = "auto";
        repSound.load();
    }

    function applyCameraMirrorPreference() {
        preview.dataset.mirrored = String(getCameraMirrorPreference());
    }

    applyCameraMirrorPreference();

    let lifecycle = "idle";
    let windowFocused = typeof document.hasFocus !== "function" || document.hasFocus();
    let pausedInBackground = false;
    let stream = null;
    let landmarker = null;
    let landmarkerDelegate = null;
    let animationFrame = null;
    let resizeObserver = null;
    let disposed = false;
    let lastInferenceAt = 0;
    let lastTimestamp = 0;
    let cameraRequestId = 0;
    let cameraRestartPromise = null;
    let lastFeedbackAnimationAt = -Infinity;
    let soundEnabled = getExerciseSoundPreference();

    let elapsedMs = Math.max(
        0,
        Number(snapshot?.elapsedMs) || 0
    );

    let rawCount = Math.max(
        0,
        Math.min(
            MAX_REPETITIONS,
            Number(snapshot?.rawCount) || 0
        )
    );

    let cameraEnded = false;
    const smartCameraPreview = createSmartCameraPreview({
        preview,
        previewSlot,
        prompt: smartCameraPrompt,
        placeholder,
        monitor,
        smartOverlay,
        overlayNodes: [
            status.closest(".monitor-heading"),
            monitorStats,
            feedback,
            monitorControls
        ],
        resizeCanvas: () => resizeCanvas(),
        getLifecycle: () => lifecycle,
        hasLandmarker: () => Boolean(landmarker),
        isDisposed: () => disposed,
        signal: listeners.signal
    });
    const renderer = createPoseRenderer({
        canvas,
        video,
        preview,
        previewSlot,
        isTransitioning: smartCameraPreview.isTransitioning,
        isDisposed: () => disposed
    });
    const {
        clear: clearOverlay,
        draw: drawPose,
        resize: resizeCanvas,
        updateAspectRatio: updatePreviewAspectRatio
    } = renderer;
    smartCameraPreview.setEnabled(getSmartCameraModePreference());

    let sessionStarted = Boolean(
        snapshot?.sessionStarted || snapshot?.finished
    );
    onSessionStateChange?.(sessionStarted);

    if (countOutput) {
        countOutput.textContent = String(rawCount);
    }

    if (timeOutput) {
        timeOutput.textContent = formatTime(
            roundedDuration(elapsedMs)
        );
    }

    detector.reset(isPlank ? elapsedMs : rawCount);
    let review;

    function setStatus(state, message) {
        lifecycle = state;
        status.dataset.state = state;
        status.textContent = message;
        smartCameraPreview.setLifecycle(state);

        finishButton.disabled =
            !["ready", "running"].includes(state) &&
            !(state === "error" && sessionStarted);

        review?.setStatus(state);
    }

    review = createWorkoutReview({
        exercise,
        isPlank,
        isJumpCount,
        maxPlankDuration,
        minWeight,
        maxWeight,
        weightStep,
        initialValue: rawCount,
        elements: {
            finishButton,
            summary: root.querySelector("#monitorSummary"),
            correction: root.querySelector("#monitorCorrection"),
            correctionError,
            weightInput,
            signInPrompt,
            signInPromptMessage,
            saveButton,
            discardButton
        },
        signal: listeners.signal,
        getLifecycle: () => lifecycle,
        getSessionValues: () => ({
            rawCount,
            elapsedMs,
            sessionStarted,
            soundEnabled
        }),
        isDisposed: () => disposed,
        isPreviewTransitioning: smartCameraPreview.isTransitioning,
        endSession: () => {
            endActiveInterval();
            releaseMonitoring();
        },
        onResetSession: () => {
            rawCount = 0;
            elapsedMs = 0;
            sessionStarted = false;
            onSessionStateChange?.(false);
            detector.reset();

            if (countOutput) countOutput.textContent = "0";
            if (timeOutput) timeOutput.textContent = "00:00";
        },
        onSessionStateChange,
        onStatus: setStatus,
        setFeedback,
        onSignInRequired,
        onWorkoutSaved
    });

    function setFeedback(message) {
        const nextMessage = String(message ?? "");
        if (feedback.textContent === nextMessage) return;

        feedback.textContent = nextMessage;
        feedback.dataset.tone = nextMessage === "Get set."
            ? "setup"
            : /^(Nice rep|Nice jump|Strong form|Great|Perfect)\b/i.test(nextMessage)
                ? "positive"
                : "negative";
        const now = performance.now();
        if (now - lastFeedbackAnimationAt < 350) return;

        lastFeedbackAnimationAt = now;
        feedback.classList.remove("is-animating");
        void feedback.offsetWidth;
        feedback.classList.add("is-animating");
    }

    function playRepSound() {
        if (!soundEnabled || !repSound) return;
        repSound.currentTime = 0;
        repSound.play().catch(error => {
            console.warn("Could not play the rep sound.", error);
        });
    }

    function setExerciseFeedback(message) {
        if (message === "Nice jump.") {
            setFeedback("Nice rep.");
            return;
        }

        if (message?.startsWith("Can't see ")) {
            setFeedback(message);
            return;
        }

        if (SHARED_EXERCISE_FEEDBACK.has(message)) {
            setFeedback(message);
            return;
        }

        if (feedback.textContent.startsWith("Can't see ")) {
            setFeedback("Get set.");
        }
    }

    function updateClock() {
        if (isPlank && timeOutput) {
            timeOutput.textContent = formatTime(
                roundedDuration(detector.elapsedMs)
            );
        }
    }

    function stopProcessing() {
        if (animationFrame != null) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
    }

    function releaseCamera() {
        cameraRequestId += 1;

        if (stream) {
            stopCameraStream(stream);
            stream = null;
        }

        detachCameraStream(video);
        smartCameraPreview.refresh();
        cameraStatus.textContent = "Camera off";

        clearOverlay();
    }

    function isPageInactive() {
        return document.hidden || !windowFocused;
    }

    function releaseStartStream(startStream) {
        if (!startStream) return;

        stopCameraStream(startStream);
        if (stream === startStream) {
            stream = null;
        }
        if (video.srcObject === startStream) {
            detachCameraStream(video);
        }
    }

    function handleCameraTrackEnded() {
        if (!["initializing", "running"].includes(lifecycle)) {
            return;
        }

        cameraEnded = true;
        endActiveInterval();
        releaseMonitoring();

        const message = "Camera disconnected.";
        setFeedback(message);
        setStatus("error", message);
    }

    async function resumeCamera() {
        if (
            cameraRestartPromise ||
            disposed ||
            isPageInactive() ||
            lifecycle !== "running" ||
            stream
        ) {
            return;
        }

        const requestId = ++cameraRequestId;
        let resumedStream = null;
        cameraStatus.textContent = "Connecting…";
        cameraRestartPromise = (async () => {
            try {
                resumedStream = await acquireCameraStream();

                if (
                    requestId !== cameraRequestId ||
                    disposed ||
                    isPageInactive() ||
                    lifecycle !== "running"
                ) {
                    stopCameraStream(resumedStream);
                    return;
                }

                stream = resumedStream;
                cameraEnded = false;
                const videoTrack = resumedStream.getVideoTracks()[0];
                await applyCameraZoom(videoTrack);

                if (
                    requestId !== cameraRequestId ||
                    disposed ||
                    isPageInactive() ||
                    lifecycle !== "running"
                ) {
                    if (stream === resumedStream) releaseCamera();
                    return;
                }

                attachCameraStream(video, resumedStream);
                smartCameraPreview.refresh();
                await video.play();

                if (
                    requestId !== cameraRequestId ||
                    disposed ||
                    isPageInactive() ||
                    lifecycle !== "running"
                ) {
                    if (stream === resumedStream) releaseCamera();
                    return;
                }

                videoTrack.onended = handleCameraTrackEnded;
                cameraStatus.textContent = "Camera connected";
                lastInferenceAt = 0;
                lastTimestamp = 0;
                resizeCanvas();
                setFeedback("Welcome back.");
                animationFrame = requestAnimationFrame(processFrames);
            } catch (error) {
                if (
                    requestId !== cameraRequestId ||
                    disposed ||
                    isPageInactive() ||
                    lifecycle !== "running"
                ) {
                    if (stream === resumedStream) releaseCamera();
                    else stopCameraStream(resumedStream);
                    return;
                }

                if (stream === resumedStream) releaseCamera();
                const message = cameraErrorMessage(error);
                cameraStatus.textContent = "Camera off";
                setFeedback(message);
            } finally {
                cameraRestartPromise = null;

                if (
                    !disposed &&
                    !isPageInactive() &&
                    lifecycle === "running" &&
                    !stream &&
                    requestId !== cameraRequestId
                ) {
                    void resumeCamera();
                }
            }
        })();

        await cameraRestartPromise;
    }

    function closeLandmarker() {
        if (landmarker) {
            try {
                landmarker.close();
            } catch (error) {
                console.warn(
                    "Could not close pose detector cleanly.",
                    error
                );
            }

            landmarker = null;
            landmarkerDelegate = null;
        }
    }

    function endActiveInterval() {
        if (isPlank) {
            detector.pause();
            elapsedMs = detector.elapsedMs;
            updateClock();
        }
    }

    function releaseMonitoring() {
        stopProcessing();
        releaseCamera();
        closeLandmarker();
    }

    async function switchToCpuAfterInferenceError(error) {
        console.warn(
            "GPU pose inference failed; switching to CPU.",
            error
        );

        const gpuLandmarker = landmarker;
        landmarker = null;
        landmarkerDelegate = null;

        try {
            gpuLandmarker?.close();
        } catch (closeError) {
            console.warn(
                "Could not close the GPU pose detector cleanly.",
                closeError
            );
        }

        try {
            landmarker = await createPoseLandmarker("CPU");
            landmarkerDelegate = "CPU";

            if (disposed || lifecycle !== "running") {
                closeLandmarker();
                return;
            }

            lastInferenceAt = 0;
            lastTimestamp = 0;
            resizeCanvas();
            smartCameraPreview.refresh();
            animationFrame = requestAnimationFrame(processFrames);
        } catch (cpuError) {
            if (disposed) {
                releaseMonitoring();
                return;
            }

            console.error(
                "CPU pose inference fallback failed:",
                cpuError
            );
            endActiveInterval();
            releaseMonitoring();

            const message = "AI paused. Finish session to review.";
            cameraStatus.textContent = "Tracking stopped";
            setFeedback(message);
            setStatus("error", message);
        }
    }

    function updateCurrentPose(landmarks) {
        const now = performance.now();

        if (!landmarks?.length) {
            clearOverlay();

            if (isPlank) {
                const result = detector.update(
                    null,
                    now
                );

                elapsedMs = result.elapsedMs;
                setExerciseFeedback(result.feedback);
                updateClock();
            } else {
                detector.loseTracking(now);
                setExerciseFeedback(detector.feedback);
            }

            return;
        }

        drawPose(landmarks);

        const previousCount = rawCount;
        const result = detector.update(
            landmarks,
            now
        );

        if (isPlank) {
            elapsedMs = result.elapsedMs;
            updateClock();
        } else {
            rawCount = Math.min(MAX_REPETITIONS, result.count);

            if (countOutput) {
                countOutput.textContent = String(rawCount);
            }
            if (rawCount > previousCount) {
                playRepSound();
            }
        }

        setExerciseFeedback(result.feedback);
    }

    function processFrames(now) {
        if (
            disposed ||
            lifecycle !== "running" ||
            document.hidden
        ) {
            return;
        }

        if (
            now - lastInferenceAt >= INFERENCE_INTERVAL_MS &&
            video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
            lastInferenceAt = now;

            const timestamp = Math.max(
                now,
                lastTimestamp + 1
            );

            lastTimestamp = timestamp;

            let result;
            try {
                result = detectPoseFrame(landmarker, video, timestamp);
            } catch (error) {
                if (landmarkerDelegate === "GPU") {
                    stopProcessing();
                    void switchToCpuAfterInferenceError(error);
                    return;
                }

                console.error("Pose inference error:", error);
                endActiveInterval();
                releaseMonitoring();

                const message = "AI paused. Finish session to review.";
                cameraStatus.textContent = "Tracking stopped";
                setFeedback(message);
                setStatus("error", message);
                return;
            }

            const pose = result.landmarks?.[0] || null;
            updateCurrentPose(pose);
        }

        if (isPlank) {
            updateClock();
        }

        animationFrame = requestAnimationFrame(processFrames);
    }

    function pauseForBackground() {
        const alreadyPaused = pausedInBackground;
        pausedInBackground = true;

        if (lifecycle === "initializing") {
            releaseMonitoring();
            setStatus("idle", "Ready");
            setFeedback("Paused in background.");
            return;
        }

        if (lifecycle !== "running" || alreadyPaused) return;

        stopProcessing();
        clearOverlay();
        releaseCamera();

        if (isPlank) {
            detector.pause();
            elapsedMs = detector.elapsedMs;
            updateClock();
        } else {
            detector.loseTracking();
        }

        setFeedback("Paused in background.");
    }

    function resumeWhenActive() {
        if (disposed || isPageInactive()) return;

        if (lifecycle === "running" && pausedInBackground) {
            pausedInBackground = false;
            void resumeCamera();
            return;
        }

        if (lifecycle === "idle" && !snapshot?.finished && !pendingWorkout) {
            pausedInBackground = false;
            void startMonitoring();
        }
    }

    function handleVisibilityChange() {
        if (document.hidden) {
            pauseForBackground();
        } else {
            resumeWhenActive();
        }
    }

    function handleWindowBlur() {
        windowFocused = false;
        pauseForBackground();
    }

    function handleWindowFocus() {
        windowFocused = true;
        resumeWhenActive();
    }

    async function startMonitoring() {
        if (
            disposed ||
            isPageInactive() ||
            !["idle", "ready", "error"].includes(lifecycle)
        ) {
            return;
        }

        pausedInBackground = false;
        const requestId = ++cameraRequestId;
        const isRequestCurrent = () =>
            requestId === cameraRequestId && !disposed && !isPageInactive();
        let startStream = null;

        if (!window.isSecureContext) {
            const message = cameraErrorMessage({
                name: "SecurityError"
            });

            setStatus("error", message);
            setFeedback(message);
            return;
        }

        if (!navigator.mediaDevices?.getUserMedia) {
            const message =
                "Camera unsupported.";

            setStatus("error", message);
            setFeedback(message);
            return;
        }

        setStatus(
            "initializing",
            "Starting AI."
        );

        cameraStatus.textContent = "Connecting…";

        setFeedback(
            "Allow camera."
        );

        try {
            startStream = await acquireCameraStream();

            if (!isRequestCurrent()) {
                stopCameraStream(startStream);
                return;
            }

            stream = startStream;

            cameraEnded = false;

            const videoTrack = stream.getVideoTracks()[0];

            await applyCameraZoom(videoTrack);

            if (!isRequestCurrent()) {
                releaseStartStream(startStream);
                return;
            }

            attachCameraStream(video, stream);
            smartCameraPreview.refresh();

            await video.play();

            if (!isRequestCurrent()) {
                releaseStartStream(startStream);
                return;
            }

            updatePreviewAspectRatio();

            cameraStatus.textContent = "Camera connected";

            stream.getVideoTracks().forEach(track => {
                track.onended = handleCameraTrackEnded;
            });

            const initializedLandmarker =
                await createPoseLandmarkerWithFallback();

            if (!isRequestCurrent()) {
                try {
                    initializedLandmarker.landmarker?.close();
                } catch (error) {
                    console.warn("Could not close pose detector cleanly.", error);
                }
                releaseStartStream(startStream);
                return;
            }

            landmarker = initializedLandmarker.landmarker;
            landmarkerDelegate = initializedLandmarker.delegate;

            if (cameraEnded) {
                throw new Error(
                    "Camera connection ended while pose tracking was loading."
                );
            }

            smartCameraPreview.refresh();
            resizeCanvas();
            detector.reset(isPlank ? elapsedMs : rawCount);

            lastInferenceAt = 0;
            lastTimestamp = 0;

            sessionStarted = true;
            onSessionStateChange?.(true);

            setStatus("running", "Monitoring");

            setFeedback(
                "Get set."
            );

            animationFrame = requestAnimationFrame(processFrames);
        } catch (error) {
            if (!isRequestCurrent()) {
                releaseStartStream(startStream);
                return;
            }

            console.error(
                "AI monitoring initialization error:",
                error
            );

            endActiveInterval();
            releaseMonitoring();

            const message =
                error?.name === "SecurityError" ||
                error?.name === "NotAllowedError" ||
                error?.name === "NotFoundError" ||
                error?.name === "NotReadableError" ||
                error?.name === "OverconstrainedError"
                    ? cameraErrorMessage(error)
                    : "AI failed. Retry.";

            cameraStatus.textContent = "Camera off";
            setFeedback(message);
            setStatus("error", message);
        }
    }

    function saveSnapshot() {
        return {
            rawCount,
            elapsedMs: isPlank ? detector.elapsedMs : 0,
            finished: [
                "finished",
                "saving",
                "saved"
            ].includes(lifecycle),
            saved: lifecycle === "saved",
            sessionStarted,
            reviewedCount: review.getReviewedValue()
        };
    }

    function handlePageHide() {
        dispose();
    }

    function dispose() {
        if (disposed) {
            return null;
        }

        endActiveInterval();
        disposed = true;

        review.dispose();

        releaseMonitoring();

        listeners.abort();
        resizeObserver?.disconnect();
        smartCameraPreview.dispose();

        return saveSnapshot();
    }

    document.addEventListener(
        "visibilitychange",
        handleVisibilityChange,
        { signal: listeners.signal }
    );

    window.addEventListener("blur", handleWindowBlur, {
        signal: listeners.signal
    });
    window.addEventListener("focus", handleWindowFocus, {
        signal: listeners.signal
    });

    window.addEventListener(
        "pagehide",
        handlePageHide,
        { signal: listeners.signal }
    );

    video.addEventListener(
        "loadedmetadata",
        updatePreviewAspectRatio,
        { signal: listeners.signal }
    );

    video.addEventListener(
        "resize",
        updatePreviewAspectRatio,
        { signal: listeners.signal }
    );

    window.addEventListener(
        CAMERA_PREFERENCE_CHANGE_EVENT,
        applyCameraMirrorPreference,
        { signal: listeners.signal }
    );

    window.addEventListener(
        SMART_CAMERA_MODE_CHANGE_EVENT,
        event => smartCameraPreview.setEnabled(event.detail?.enabled),
        { signal: listeners.signal }
    );

    window.addEventListener(
        EXERCISE_SOUND_CHANGE_EVENT,
        event => {
            soundEnabled = Boolean(event.detail?.enabled);
        },
        { signal: listeners.signal }
    );

    window.addEventListener(
        "storage",
        event => {
            if (event.key === "user" || event.key === getCameraMirrorPreferenceKey()) {
                applyCameraMirrorPreference();
            }
            if (event.key === "user" || event.key === getSmartCameraModePreferenceKey()) {
                smartCameraPreview.setEnabled(getSmartCameraModePreference());
            }
            if (event.key === "user" || event.key === getExerciseSoundPreferenceKey()) {
                soundEnabled = getExerciseSoundPreference();
            }
        },
        { signal: listeners.signal }
    );

    if ("ResizeObserver" in window) {
        resizeObserver = new ResizeObserver(resizeCanvas);
        resizeObserver.observe(canvas);
    }

    resizeCanvas();

    if (snapshot?.finished) {
        elapsedMs = Math.max(
            0,
            Number(snapshot.elapsedMs) || 0
        );

        rawCount = Math.max(
            0,
            Math.min(
                MAX_REPETITIONS,
                Number(snapshot.rawCount) || 0
            )
        );

        if (countOutput) {
            countOutput.textContent = String(rawCount);
        }

        if (timeOutput) {
            timeOutput.textContent = formatTime(
                roundedDuration(elapsedMs)
            );
        }

        review.setReviewedValue(
            snapshot.reviewedCount ?? (
                isPlank
                    ? roundedDuration(elapsedMs)
                    : rawCount
            )
        );

        if (snapshot.saved) {
            setStatus("saved", "Workout saved.");
        } else {
            setFeedback(
                isPlank
                    ? "Review your time."
                    : "Review your count."
            );

            setStatus(
                "finished",
                "Session finished."
            );
        }
    } else if (pendingWorkout) {
        const reviewedValue = isPlank
            ? Number(pendingWorkout.duration)
            : isJumpCount
                ? Number(pendingWorkout.amount)
                : Number(pendingWorkout.reps);

        if (isPlank) {
            elapsedMs = reviewedValue * 1000;
            detector.reset(elapsedMs);

            if (timeOutput) {
                timeOutput.textContent =
                    formatTime(reviewedValue);
            }
        } else {
            rawCount = reviewedValue;
            detector.reset(rawCount);

            if (countOutput) {
                countOutput.textContent = String(rawCount);
            }
        }

        review.setReviewedValue(reviewedValue);

        if (
            weightInput &&
            Number.isFinite(Number(pendingWorkout.weight))
        ) {
            weightInput.value = String(pendingWorkout.weight);
        }

        sessionStarted = true;
        onSessionStateChange?.(true);

        window.showToast("You're signed in. Review your workout and save it again.", {
            type: "info"
        });

        setStatus("finished", "Workout ready to save.");
    } else if (snapshot) {
        setStatus("ready", "Monitoring paused");

        setFeedback(
            "Count saved."
        );
    } else {
        setStatus("idle", "Ready");
    }

    if (!snapshot?.finished && !pendingWorkout) {
        void startMonitoring();
    }

    return {
        dispose,
        snapshot: saveSnapshot,
        canSwitch: () => lifecycle !== "saving"
    };
}
