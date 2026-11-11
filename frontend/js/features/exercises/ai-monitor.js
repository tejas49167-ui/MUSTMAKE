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
    buildReviewedWorkoutPayload,
    isValidWorkoutWeight,
    saveReviewedWorkout
} from "./workout-save-flow.js";
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
const MAX_REVIEWED_VALUE = 150;
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

export function getSmartCameraPromptState(enabled, previewFullscreen, lifecycle) {
    if (!enabled || previewFullscreen) return null;
    if (lifecycle === "idle" || lifecycle === "initializing") return "preparing";
    if (lifecycle === "running") return "scroll";
    return null;
}

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
    const summary = root.querySelector("#monitorSummary");
    const correction = root.querySelector("#monitorCorrection");
    const weightInput = root.querySelector("#workout-weight");
    const correctionError = root.querySelector("#monitorCorrectionError");
    const signInPrompt = root.querySelector("#monitorSignInPrompt");
    const signInPromptMessage = signInPrompt?.querySelector("span");
    const saveButton = root.querySelector("#monitorSave");
    const discardButton = root.querySelector("#monitorDiscard");
    const monitorHeading = status.closest(".monitor-heading");
    const monitorStats = root.querySelector(".monitor-stats");
    const smartOverlayNodes = [
        monitorHeading,
        monitorStats,
        feedback,
        monitorControls
    ].filter(Boolean);
    const smartOverlaySlots = smartOverlayNodes.map(node => {
        const marker = document.createComment("smart camera overlay position");
        node.parentNode.insertBefore(marker, node);
        return { marker, node };
    });

    function findScrollContainer(element) {
        let ancestor = element.parentElement;

        while (
            ancestor &&
            ancestor !== document.body &&
            ancestor !== document.documentElement
        ) {
            const style = window.getComputedStyle(ancestor);
            const canScroll = /(auto|scroll|overlay)/.test(style.overflowY);
            if (canScroll && ancestor.scrollHeight > ancestor.clientHeight + 1) {
                return ancestor;
            }
            ancestor = ancestor.parentElement;
        }

        return document.scrollingElement || document.documentElement;
    }

    const scrollContainer = findScrollContainer(previewSlot);

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
    let smartCameraEnabled = false;
    let smartScrollArmed = false;
    let lastScrollPosition = 0;
    let scrollFrame = null;
    let previewFixed = false;
    let previewTargetFullscreen = false;
    let previewTransitioning = false;
    let previewTransitionGeneration = 0;
    let previewTransitionTimer = null;

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

    let saveInFlight = false;
    let discardInProgress = false;
    let cameraEnded = false;
    const renderer = createPoseRenderer({
        canvas,
        video,
        preview,
        previewSlot,
        isTransitioning: () => previewTransitioning,
        isDisposed: () => disposed
    });
    const {
        clear: clearOverlay,
        draw: drawPose,
        resize: resizeCanvas,
        updateAspectRatio: updatePreviewAspectRatio
    } = renderer;

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

    correction.value = String(rawCount);
    detector.reset(isPlank ? elapsedMs : rawCount);
    lastScrollPosition = getScrollPosition();

    function getScrollPosition() {
        if (
            scrollContainer === document.scrollingElement ||
            scrollContainer === document.documentElement ||
            scrollContainer === document.body
        ) {
            return window.scrollY || scrollContainer.scrollTop || 0;
        }
        return scrollContainer.scrollTop;
    }

    function getVisibleViewport() {
        const viewport = window.visualViewport;
        return {
            left: viewport?.offsetLeft ?? 0,
            top: viewport?.offsetTop ?? 0,
            width: viewport?.width ?? window.innerWidth,
            height: viewport?.height ?? window.innerHeight
        };
    }

    function setPreviewGeometry(rect) {
        preview.style.left = `${rect.left}px`;
        preview.style.top = `${rect.top}px`;
        preview.style.width = `${rect.width}px`;
        preview.style.height = `${rect.height}px`;
    }

    function getPreviewTransform(from, to) {
        const scaleX = from.width / to.width;
        const scaleY = from.height / to.height;
        const offsetX = from.left - to.left;
        const offsetY = from.top - to.top;
        return `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`;
    }

    function updateSmartCameraPreview() {
        preview.dataset.smartCameraMode = String(smartCameraEnabled);

        const promptState = getSmartCameraPromptState(
            smartCameraEnabled,
            previewTargetFullscreen,
            lifecycle
        );
        const showPreparation = promptState === "preparing";
        const showScrollPrompt = promptState === "scroll";

        if (promptState === "preparing") {
            smartCameraPrompt.textContent = "Preparing camera...";
        } else if (promptState === "scroll") {
            smartCameraPrompt.textContent = "Scroll ↓";
        }
        smartCameraPrompt.hidden = !showPreparation && !showScrollPrompt;
        placeholder.hidden = smartCameraEnabled
            ? !showPreparation && !showScrollPrompt
            : Boolean(landmarker);
    }

    function getFullscreenPreviewGeometry() {
        return getVisibleViewport();
    }

    function finishPreviewTransition(generation) {
        if (generation !== previewTransitionGeneration || !previewTransitioning) {
            return;
        }

        clearTimeout(previewTransitionTimer);
        previewTransitionTimer = null;
        previewTransitioning = false;
        preview.style.removeProperty("transform");

        if (previewTargetFullscreen) {
            preview.classList.add("smart-camera-visible");
            document.body.classList.add("smart-camera-fullscreen");
        } else {
            previewSlot.append(preview);
            preview.classList.remove(
                "is-fixed",
                "is-fullscreen",
                "smart-camera-visible"
            );
            ["left", "top", "width", "height", "transition"].forEach(property => {
                preview.style.removeProperty(property);
            });
            previewFixed = false;
            document.body.classList.remove("smart-camera-fullscreen");
            if (!smartCameraEnabled) restoreSmartOverlayNodes();
        }

        updateSmartCameraPreview();
        resizeCanvas();
    }

    function transitionPreview(fullscreen) {
        if (previewTargetFullscreen === fullscreen) return;

        if (!fullscreen) {
            previewTargetFullscreen = false;
            previewTransitionGeneration += 1;
            const generation = previewTransitionGeneration;
            clearTimeout(previewTransitionTimer);
            previewTransitionTimer = null;
            previewTransitioning = true;
            document.body.classList.remove("smart-camera-fullscreen");
            updateSmartCameraPreview();
            finishPreviewTransition(generation);
            return;
        }

        const current = preview.getBoundingClientRect();
        if (!current.width || !current.height) return;

        previewTargetFullscreen = fullscreen;
        previewTransitionGeneration += 1;
        const generation = previewTransitionGeneration;
        clearTimeout(previewTransitionTimer);
        previewTransitioning = true;
        updateSmartCameraPreview();

        preview.style.transition = "none";
        preview.style.transform = "none";
        setPreviewGeometry(current);
        if (!previewFixed) {
            preview.classList.add("is-fixed");
            previewFixed = true;
            document.body.append(preview);
        }
        void preview.offsetWidth;

        preview.style.transition =
            "border-radius 360ms ease, border-color 300ms ease, box-shadow 300ms ease";
        if (fullscreen) preview.classList.add("smart-camera-visible");
        if (fullscreen) preview.classList.add("is-fullscreen");
        const target = getFullscreenPreviewGeometry();
        setPreviewGeometry(target);
        preview.style.transform = getPreviewTransform(current, target);
        void preview.offsetWidth;
        preview.style.removeProperty("transition");
        void preview.offsetWidth;

        requestAnimationFrame(() => {
            if (disposed || generation !== previewTransitionGeneration) return;
            preview.style.removeProperty("transform");
        });

        previewTransitionTimer = window.setTimeout(
            () => finishPreviewTransition(generation),
            420
        );
    }

    function retargetPreviewGeometry(target) {
        if (!previewFixed || !previewTransitioning) return;
        const generation = previewTransitionGeneration;
        const current = preview.getBoundingClientRect();
        preview.style.transition = "none";
        preview.style.transform = "none";
        setPreviewGeometry(current);
        void preview.offsetWidth;
        setPreviewGeometry(target);
        preview.style.transform = getPreviewTransform(current, target);
        void preview.offsetWidth;
        preview.style.removeProperty("transition");
        void preview.offsetWidth;
        requestAnimationFrame(() => {
            if (
                disposed ||
                generation !== previewTransitionGeneration ||
                !previewTransitioning
            ) {
                return;
            }
            preview.style.removeProperty("transform");
        });
        clearTimeout(previewTransitionTimer);
        previewTransitionTimer = window.setTimeout(
            () => finishPreviewTransition(generation),
            420
        );
    }

    function retargetExpandedPreview() {
        if (previewTargetFullscreen) return;
        retargetPreviewGeometry(previewSlot.getBoundingClientRect());
    }

    function restoreSmartOverlayNodes() {
        smartOverlaySlots.forEach(({ marker, node }) => {
            if (marker.parentNode) {
                marker.parentNode.insertBefore(node, marker.nextSibling);
            }
        });
    }

    function applySmartCameraPreference(enabled = getSmartCameraModePreference()) {
        const nextEnabled = Boolean(enabled);
        if (smartCameraEnabled === nextEnabled) return;

        smartCameraEnabled = nextEnabled;
        monitor.dataset.smartCameraMode = String(nextEnabled);
        smartScrollArmed = false;
        lastScrollPosition = getScrollPosition();
        updateSmartCameraPreview();

        if (nextEnabled) {
            smartOverlayNodes.forEach(node => smartOverlay.append(node));
        } else {
            if (previewTargetFullscreen || previewFixed) {
                transitionPreview(false);
            } else {
                restoreSmartOverlayNodes();
            }
        }
    }

    function updateSmartCameraOnScroll() {
        if (!smartCameraEnabled || lifecycle !== "running") {
            lastScrollPosition = getScrollPosition();
            return;
        }

        const currentScrollPosition = Math.max(0, getScrollPosition());
        if (currentScrollPosition > lastScrollPosition) smartScrollArmed = true;
        lastScrollPosition = currentScrollPosition;
        if (!smartScrollArmed) return;

        const shouldBeFullscreen = currentScrollPosition > 0.5;
        if (!shouldBeFullscreen && previewFixed && !previewTargetFullscreen) {
            retargetExpandedPreview();
        } else {
            transitionPreview(shouldBeFullscreen);
        }
    }

    function scheduleSmartCameraScrollUpdate() {
        if (scrollFrame != null) return;

        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = null;
            updateSmartCameraOnScroll();
        });
    }

    function handleSmartCameraWheel(event) {
        if (
            !smartCameraEnabled ||
            lifecycle !== "running" ||
            event.ctrlKey ||
            event.deltaY === 0 ||
            scrollContainer.scrollHeight > scrollContainer.clientHeight + 1
        ) {
            return;
        }

        transitionPreview(event.deltaY > 0);
    }

    function handlePreviewTransitionEnd(event) {
        if (
            event.target === preview &&
            event.propertyName === "transform"
        ) {
            finishPreviewTransition(previewTransitionGeneration);
        }
    }

    function handleWindowResize() {
        if (previewFixed && previewTargetFullscreen) {
            if (previewTransitioning) {
                retargetPreviewGeometry(getFullscreenPreviewGeometry());
            } else {
                preview.style.transition = "none";
                setPreviewGeometry(getFullscreenPreviewGeometry());
                void preview.offsetWidth;
                preview.style.removeProperty("transition");
            }
        } else {
            retargetExpandedPreview();
        }
        resizeCanvas();
    }

    function handleVisualViewportScroll() {
        if (!previewFixed || !previewTargetFullscreen || previewTransitioning) {
            return;
        }

        preview.style.transition = "none";
        setPreviewGeometry(getFullscreenPreviewGeometry());
        resizeCanvas();
        void preview.offsetWidth;
        preview.style.removeProperty("transition");
    }

    monitor.dataset.smartCameraMode = "false";
    applySmartCameraPreference();

    function setStatus(state, message) {
        lifecycle = state;
        status.dataset.state = state;
        status.textContent = message;
        updateSmartCameraPreview();

        if (state === "running") {
            smartScrollArmed = false;
            lastScrollPosition = getScrollPosition();
        } else if (previewTargetFullscreen) {
            transitionPreview(false);
        }

        finishButton.disabled =
            !["ready", "running"].includes(state) &&
            !(state === "error" && sessionStarted);

        saveButton.disabled =
            !["finished", "saving"].includes(state) ||
            saveInFlight;

        discardButton.disabled = state !== "finished";

        correction.disabled =
            state === "saving" || state === "saved";

        if (state === "finished" || state === "saving") {
            if (!summary.open) {
                summary.showModal();
                correction.focus({ preventScroll: true });
            }
        } else if (summary.open) {
            summary.close();
        }
    }

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
        updateSmartCameraPreview();
        cameraStatus.textContent = "Camera off";

        clearOverlay();
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
            document.hidden ||
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
                    document.hidden ||
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
                    document.hidden ||
                    lifecycle !== "running"
                ) {
                    if (stream === resumedStream) releaseCamera();
                    return;
                }

                attachCameraStream(video, resumedStream);
                updateSmartCameraPreview();
                await video.play();

                if (
                    requestId !== cameraRequestId ||
                    disposed ||
                    document.hidden ||
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
                    document.hidden ||
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
                    !document.hidden &&
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
            updateSmartCameraPreview();
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

    function handleVisibilityChange() {
        if (
            document.hidden &&
            lifecycle === "running"
        ) {
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

            setFeedback(
                "Paused in background."
            );
        } else if (
            !document.hidden &&
            lifecycle === "running" &&
            animationFrame == null
        ) {
            void resumeCamera();
        }
    }

    async function startMonitoring() {
        if (
            disposed ||
            !["idle", "ready", "error"].includes(lifecycle)
        ) {
            return;
        }

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
            stream = await acquireCameraStream();

            cameraEnded = false;

            if (disposed) {
                stopCameraStream(stream);
                stream = null;
                return;
            }

            const videoTrack = stream.getVideoTracks()[0];

            await applyCameraZoom(videoTrack);

            attachCameraStream(video, stream);
            updateSmartCameraPreview();

            await video.play();

            updatePreviewAspectRatio();

            cameraStatus.textContent = "Camera connected";

            stream.getVideoTracks().forEach(track => {
                track.onended = handleCameraTrackEnded;
            });

            const initializedLandmarker =
                await createPoseLandmarkerWithFallback();
            landmarker = initializedLandmarker.landmarker;
            landmarkerDelegate = initializedLandmarker.delegate;

            if (disposed) {
                releaseMonitoring();
                return;
            }

            if (cameraEnded) {
                throw new Error(
                    "Camera connection ended while pose tracking was loading."
                );
            }

            updateSmartCameraPreview();
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
            if (disposed) {
                releaseMonitoring();
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

    function finishSession() {
        if (
            !["ready", "running"].includes(lifecycle) &&
            !(lifecycle === "error" && sessionStarted)
        ) {
            return;
        }

        endActiveInterval();
        releaseMonitoring();

        const reviewValue = isPlank
            ? roundedDuration(elapsedMs)
            : rawCount;

        correction.value = String(reviewValue);
        correctionError.textContent = "";

        setFeedback(
            isPlank
                ? "Review your time."
                : "Review your count."
        );

        setStatus(
            "finished",
            "Session finished."
        );

        const revealReview = () => {
            if (disposed || lifecycle !== "finished") return;

            correction.focus({ preventScroll: true });
        };

        if (previewTransitioning) {
            window.setTimeout(revealReview, 380);
        } else {
            revealReview();
        }
    }

    function discardSession() {
        if (discardInProgress || !["finished", "saved"].includes(lifecycle)) {
            return;
        }

        if (!window.confirm("Discard this session? It will not be saved.")) {
            return;
        }
        discardInProgress = true;
        rawCount = 0;
        elapsedMs = 0;
        sessionStarted = false;
        onSessionStateChange?.(false);

        detector.reset();

        if (countOutput) {
            countOutput.textContent = "0";
        }

        if (timeOutput) {
            timeOutput.textContent = "00:00";
        }

        if (summary.open) summary.close();
        correction.value = "0";
        correctionError.textContent = "";

        onWorkoutSaved?.();
        if (soundEnabled) {
            try {
                sessionStorage.setItem("mustmake_pending_discard_sound", "true");
            } catch (error) {
                console.warn("Could not queue the session discard sound.", error);
            }
        }
        window.location.replace("/today");
    }

    function correctedCount() {
        const value = correction.value.trim();
        const parsed = Number(value);
        const minimum = 1;
        const maximum = isPlank ? maxPlankDuration : MAX_REVIEWED_VALUE;

        const valid =
            value !== "" &&
            Number.isSafeInteger(parsed) &&
            parsed >= minimum &&
            parsed <= maximum;

        correctionError.textContent = valid
            ? ""
            : parsed < minimum
                ? "Cannot be zero."
                : parsed > maximum
                    ? isPlank
                        ? `1–${maximum} sec.`
                        : "Don't lie, enter truth."
                    : `${minimum}–${maximum}${isPlank ? " sec" : isJumpCount ? " jumps" : " reps"}.`;

        correction.setAttribute(
            "aria-invalid",
            String(!valid)
        );

        return valid ? parsed : null;
    }

    async function saveWorkout() {
        if (
            lifecycle !== "finished" ||
            saveInFlight
        ) {
            return;
        }

        const reviewedValue = correctedCount();

        if (reviewedValue == null) {
            return;
        }

        const weight = weightInput
            ? Number(weightInput.value)
            : null;

        if (
            weightInput &&
            !isValidWorkoutWeight(weight, minWeight, maxWeight, weightStep)
        ) {
            weightInput.setCustomValidity(
                `Enter a weight from ${minWeight} to ${maxWeight} kg in ${weightStep} kg increments.`
            );

            weightInput.reportValidity();
            return;
        }

        weightInput?.setCustomValidity("");

        const payload = buildReviewedWorkoutPayload({
            exerciseName: exercise.name,
            isPlank,
            isJumpCount,
            reviewedValue,
            weight: weightInput ? weight : null
        });

        const isSignedIn = Boolean(localStorage.getItem("user"));

        if (!isSignedIn) {
            if (!onSignInRequired?.(payload)) {
                if (signInPromptMessage) {
                    signInPromptMessage.textContent =
                        "Could not preserve this workout. Please try again before signing in.";
                }
                if (signInPrompt) signInPrompt.hidden = false;
                return;
            }

            if (signInPromptMessage) {
                signInPromptMessage.textContent =
                    "Sign in to save this reviewed workout.";
            }
            if (signInPrompt) signInPrompt.hidden = false;
            return;
        }

        if (signInPrompt) signInPrompt.hidden = true;
        saveInFlight = true;

        setStatus("saving", "Saving reviewed workout…");
        const saveToast = window.showToast("Saving your reviewed workout…", { type: "loading" });

        try {
            const saveResult = await saveReviewedWorkout({
                payload,
                exerciseName: exercise.name,
                isPlank,
                isJumpCount,
                reviewedValue,
                weight,
                hasWeight: Boolean(weightInput)
            });

            if (saveResult.status === 401) {
                window.clearPrivateCaches?.();

                localStorage.removeItem("user");

                if (!onSignInRequired?.(payload)) {
                    saveToast?.update(
                        "Your sign-in expired, and this workout could not be preserved. Retry before signing in.",
                        { type: "error" }
                    );

                    setStatus(
                        "finished",
                        "Sign-in required to save."
                    );

                    return;
                }

                saveToast?.update(
                    "Your sign-in expired. Sign in again; this reviewed session has not been discarded.",
                    { type: "warning", action: { label: "Sign in", href: "/login" } }
                );

                setStatus(
                    "finished",
                    "Sign-in required to save."
                );

                return;
            }

            window.clearPrivateCaches?.();
            onWorkoutSaved?.();
            onSessionStateChange?.(false);
            window.queueWorkoutCompletion?.(soundEnabled);
            window.location.replace("/today");
            return;
        } catch (error) {
            console.error("AI workout save error:", error);

            saveToast?.update(
                error.message || "Could not connect to the server. Your reviewed session is still available to retry.",
                { type: "error" }
            );

            setStatus(
                "finished",
                "Save failed. Review is preserved; retry when ready."
            );
        } finally {
            saveInFlight = false;

            if (
                lifecycle === "finished" ||
                lifecycle === "saved"
            ) {
                saveButton.disabled = lifecycle === "saved";
            }
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
            reviewedCount: correction.value
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

        if (summary.open) summary.close();

        releaseMonitoring();

        listeners.abort();
        resizeObserver?.disconnect();
        if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
        clearTimeout(previewTransitionTimer);
        previewSlot.append(preview);
        preview.classList.remove(
            "is-fixed",
            "is-fullscreen",
            "smart-camera-visible"
        );
        ["left", "top", "width", "height", "transition"].forEach(property => {
            preview.style.removeProperty(property);
        });
        previewFixed = false;
        document.body.classList.remove("smart-camera-fullscreen");

        return saveSnapshot();
    }

    finishButton.addEventListener(
        "click",
        finishSession,
        { signal: listeners.signal }
    );

    summary.addEventListener(
        "cancel",
        event => event.preventDefault(),
        { signal: listeners.signal }
    );

    saveButton.addEventListener(
        "click",
        saveWorkout,
        { signal: listeners.signal }
    );

    discardButton.addEventListener(
        "click",
        () => discardSession(),
        { signal: listeners.signal }
    );

    correction.addEventListener(
        "input",
        correctedCount,
        { signal: listeners.signal }
    );

    document.addEventListener(
        "visibilitychange",
        handleVisibilityChange,
        { signal: listeners.signal }
    );

    window.addEventListener(
        "pagehide",
        handlePageHide,
        { signal: listeners.signal }
    );

    window.addEventListener("resize", handleWindowResize, {
        signal: listeners.signal
    });

    window.visualViewport?.addEventListener("resize", handleWindowResize, {
        signal: listeners.signal
    });

    window.visualViewport?.addEventListener("scroll", handleVisualViewportScroll, {
        signal: listeners.signal
    });

    window.addEventListener("scroll", scheduleSmartCameraScrollUpdate, {
        passive: true,
        signal: listeners.signal
    });

    scrollContainer.addEventListener("scroll", scheduleSmartCameraScrollUpdate, {
        passive: true,
        signal: listeners.signal
    });

    document.addEventListener("scroll", scheduleSmartCameraScrollUpdate, {
        capture: true,
        passive: true,
        signal: listeners.signal
    });

    document.addEventListener("wheel", handleSmartCameraWheel, {
        passive: true,
        signal: listeners.signal
    });

    preview.addEventListener("transitionend", handlePreviewTransitionEnd, {
        signal: listeners.signal
    });

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
        event => applySmartCameraPreference(event.detail?.enabled),
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
                applySmartCameraPreference();
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

        correction.value = String(
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

        correction.value = String(reviewedValue);

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
