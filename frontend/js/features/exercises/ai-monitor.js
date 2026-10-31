import { createExerciseDetector } from "./exercise-detectors.mjs";
import {
    CAMERA_PREFERENCE_CHANGE_EVENT,
    SMART_CAMERA_MODE_CHANGE_EVENT,
    getCameraMirrorPreference,
    getCameraMirrorPreferenceKey,
    getSmartCameraModePreference,
    getSmartCameraModePreferenceKey,
    EXERCISE_SOUND_CHANGE_EVENT,
    getExerciseSoundPreference,
    getExerciseSoundPreferenceKey
} from "./camera-preference.js";

const MEDIAPIPE_VERSION = "1.1.1";
const MEDIAPIPE_MODULE =
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM =
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const POSE_MODEL =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const MAX_REPETITIONS = 10000;
const MAX_REVIEWED_VALUE = 150;
const SHARED_EXERCISE_FEEDBACK = new Set([
    "Can't see u.",
    "Get set.",
    "Nice rep."
]);
const INFERENCE_INTERVAL_MS = 110;

const CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
    [27, 29], [29, 31], [24, 26], [26, 28], [28, 30], [30, 32]
];

let visionModulePromise;

function loadVisionModule() {
    if (!visionModulePromise) {
        visionModulePromise = import(MEDIAPIPE_MODULE).catch(error => {
            visionModulePromise = null;

            throw new Error(
                "Could not load the MediaPipe pose library. Check your internet connection and try again.",
                { cause: error }
            );
        });
    }

    return visionModulePromise;
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function cameraErrorMessage(error) {
    if (!window.isSecureContext) {
        return "Use HTTPS.";
    }

    if (
        error?.name === "NotAllowedError" ||
        error?.name === "SecurityError"
    ) {
        return "Allow camera access.";
    }

    if (
        error?.name === "NotFoundError" ||
        error?.name === "DevicesNotFoundError"
    ) {
        return "No camera found.";
    }

    if (
        error?.name === "NotReadableError" ||
        error?.name === "TrackStartError"
    ) {
        return "Camera in use.";
    }

    if (error?.name === "OverconstrainedError") {
        return "Try another camera.";
    }

    return "Camera unavailable.";
}

async function createPoseLandmarker(delegate) {
    const { FilesetResolver, PoseLandmarker } =
        await loadVisionModule();

    const fileset = await FilesetResolver.forVisionTasks(
        MEDIAPIPE_WASM
    );

    const buildOptions = delegate => ({
        baseOptions: {
            modelAssetPath: POSE_MODEL,
            delegate
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55
    });

    return PoseLandmarker.createFromOptions(
        fileset,
        buildOptions(delegate)
    );
}

async function createPoseLandmarkerWithFallback() {
    try {
        return {
            landmarker: await createPoseLandmarker("GPU"),
            delegate: "GPU"
        };
    } catch {
        try {
            return {
                landmarker: await createPoseLandmarker("CPU"),
                delegate: "CPU"
            };
        } catch (error) {
            throw new Error(
                "Pose detection could not initialize on this device.",
                { cause: error }
            );
        }
    }
}

function roundedDuration(milliseconds) {
    return Math.max(0, Math.floor(milliseconds / 1000));
}

export function mountAiMonitor(
    root,
    exercise,
    snapshot = null,
    pendingWorkout = null,
    onSignInRequired = null,
    onWorkoutSaved = null
) {
    const isPlank = exercise.slug === "plank";
    const isJumpCount = exercise.slug === "skipping-rope";

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

    const context = canvas.getContext("2d");
    const detector = createExerciseDetector(exercise.slug);
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
    let reviewHistoryGuard = false;
    let reviewHistoryUrl = null;

    let sessionStarted = Boolean(
        snapshot?.sessionStarted || snapshot?.finished
    );

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

        const showScrollPrompt =
            smartCameraEnabled &&
            !previewTargetFullscreen &&
            !["error", "finished", "saved"].includes(lifecycle);

        smartCameraPrompt.hidden = !showScrollPrompt;
        placeholder.hidden = Boolean(landmarker) && !showScrollPrompt;
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

        if (state === "finished") {
            protectReviewFromBack();
        }

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

    function clearOverlay() {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    function resizeCanvas() {
        if (previewTransitioning) return;

        const bounds = canvas.getBoundingClientRect();

        if (!bounds.width || !bounds.height) {
            return;
        }

        const ratio = Math.max(
            1,
            window.devicePixelRatio || 1
        );

        const pixelWidth = Math.max(
            1,
            Math.round(bounds.width * ratio)
        );

        const pixelHeight = Math.max(
            1,
            Math.round(bounds.height * ratio)
        );

        const sizeChanged =
            canvas.width !== pixelWidth ||
            canvas.height !== pixelHeight;

        if (canvas.width !== pixelWidth) {
            canvas.width = pixelWidth;
        }

        if (canvas.height !== pixelHeight) {
            canvas.height = pixelHeight;
        }

        context.setTransform(
            pixelWidth / bounds.width,
            0,
            0,
            pixelHeight / bounds.height,
            0,
            0
        );

        if (sizeChanged) clearOverlay();
    }

    function updatePreviewAspectRatio() {
        if (!video.videoWidth || !video.videoHeight) {
            return;
        }

        const aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
        preview.style.aspectRatio = aspectRatio;
        previewSlot.style.aspectRatio = aspectRatio;

        requestAnimationFrame(() => {
            if (!disposed) {
                resizeCanvas();
            }
        });
    }

    function drawPose(landmarks) {
        resizeCanvas();
        clearOverlay();

        if (
            !landmarks?.length ||
            !video.videoWidth ||
            !video.videoHeight
        ) {
            return;
        }

        const bounds = canvas.getBoundingClientRect();

        if (
            !bounds.width ||
            !bounds.height ||
            !canvas.width ||
            !canvas.height
        ) {
            return;
        }

        const fitScale = preview.classList.contains("is-fullscreen")
            ? Math.max
            : Math.min;
        const scale = fitScale(
            bounds.width / video.videoWidth,
            bounds.height / video.videoHeight
        );

        const drawnWidth = video.videoWidth * scale;
        const drawnHeight = video.videoHeight * scale;
        const offsetX = (bounds.width - drawnWidth) / 2;
        const offsetY = (bounds.height - drawnHeight) / 2;
        const scaleX = canvas.width / bounds.width;
        const scaleY = canvas.height / bounds.height;

        context.save();

        context.setTransform(
            scaleX,
            0,
            0,
            scaleY,
            0,
            0
        );

        context.lineWidth = 3;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(74, 222, 128, 0.95)";
        context.fillStyle = "#f8fafc";

        const visibilityOf = landmark =>
            landmark?.visibility ?? landmark?.presence ?? 1;

        const point = index => {
            const landmark = landmarks[index];

            if (
                !landmark ||
                visibilityOf(landmark) < 0.35
            ) {
                return null;
            }

            return {
                x: landmark.x * drawnWidth + offsetX,
                y: landmark.y * drawnHeight + offsetY
            };
        };

        for (const [fromIndex, toIndex] of CONNECTIONS) {
            const from = point(fromIndex);
            const to = point(toIndex);

            if (!from || !to) {
                continue;
            }

            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.stroke();
        }

        landmarks.forEach((landmark, index) => {
            if (visibilityOf(landmark) < 0.45) {
                return;
            }

            const position = point(index);

            if (!position) {
                return;
            }

            context.beginPath();
            context.arc(
                position.x,
                position.y,
                3.5,
                0,
                Math.PI * 2
            );
            context.fill();
        });

        context.restore();
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
        if (stream) {
            stream.getTracks().forEach(track => {
                track.onended = null;
                track.stop();
            });

            stream = null;
        }

        video.pause();
        video.srcObject = null;
        video.hidden = true;
        updateSmartCameraPreview();
        cameraStatus.textContent = "Camera off";

        clearOverlay();
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
            if (disposed || lifecycle !== "running") {
                closeLandmarker();
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
                result = landmarker.detectForVideo(
                    video,
                    timestamp
                );
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
            setFeedback(
                "Welcome back."
            );

            animationFrame = requestAnimationFrame(processFrames);
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
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: "user",
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    zoom: { ideal: 1 }
                },
                audio: false
            });

            cameraEnded = false;

            if (disposed) {
                stream.getTracks().forEach(track => track.stop());
                stream = null;
                return;
            }

            const videoTrack = stream.getVideoTracks()[0];

            const zoomRange =
                videoTrack.getCapabilities?.().zoom;

            if (
                zoomRange &&
                Number.isFinite(zoomRange.min)
            ) {
                try {
                    await videoTrack.applyConstraints({
                        zoom: { exact: zoomRange.min }
                    });
                } catch (error) {
                    console.warn(
                        "Could not set the camera to its widest zoom.",
                        error
                    );
                }
            }

            video.srcObject = stream;
            video.hidden = false;
            updateSmartCameraPreview();

            await video.play();

            updatePreviewAspectRatio();

            cameraStatus.textContent = "Camera connected";

            stream.getVideoTracks().forEach(track => {
                track.onended = () => {
                    if (
                        !["initializing", "running"].includes(lifecycle)
                    ) {
                        return;
                    }

                    cameraEnded = true;
                    endActiveInterval();
                    releaseMonitoring();

                    const message =
                        "Camera disconnected.";

                    setFeedback(message);
                    setStatus("error", message);
                };
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

    function discardSession(alreadyConfirmed = false) {
        if (discardInProgress || !["finished", "saved"].includes(lifecycle)) {
            return;
        }

        if (
            !alreadyConfirmed &&
            !window.confirm("Discard this session? It will not be saved.")
        ) {
            return;
        }
        discardInProgress = true;
        rawCount = 0;
        elapsedMs = 0;
        sessionStarted = false;

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

    function protectReviewFromBack() {
        if (reviewHistoryGuard) return;
        reviewHistoryUrl ??= window.location.href;
        window.history.pushState(
            { ...window.history.state, mustmakeWorkoutReview: true },
            "",
            reviewHistoryUrl
        );
        reviewHistoryGuard = true;
    }

    function handleReviewBack() {
        if (!reviewHistoryGuard) return;
        reviewHistoryGuard = false;

        if (lifecycle !== "finished" || saveInFlight) return;

        if (window.confirm("Discard this session? It will not be saved.")) {
            discardSession(true);
            return;
        }

        protectReviewFromBack();
    }
    function correctedCount() {
        const value = correction.value.trim();
        const parsed = Number(value);
        const minimum = 1;
        const maximum = MAX_REVIEWED_VALUE;

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
                    ? "Don't lie, enter truth."
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
            (
                !Number.isFinite(weight) ||
                weight < 0.5 ||
                weight > 1000 ||
                !Number.isInteger(weight * 2)
            )
        ) {
            weightInput.setCustomValidity(
                "Enter a weight of at least 0.5 kg in 0.5 kg increments."
            );

            weightInput.reportValidity();
            return;
        }

        weightInput?.setCustomValidity("");

        const payload = isPlank
            ? {
                exercise: exercise.name,
                duration: reviewedValue
            }
            : isJumpCount
                ? {
                    exercise: exercise.name,
                    amount: reviewedValue,
                    unit: "jumps"
                }
                : {
                    exercise: exercise.name,
                    reps: reviewedValue,
                    sets: 1,
                    ...(weightInput ? { weight } : {})
                };

        const token = localStorage.getItem("token");

        if (!token) {
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
            const response = await fetch(
                `${window.API_URL}/api/workouts`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                }
            );

            if (response.status === 401) {
                window.clearPrivateCaches?.();

                localStorage.removeItem("token");
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

            let data;

            try {
                data = await response.json();
            } catch {
                throw new Error(
                    "The server returned an unreadable response. Your session is still available to retry."
                );
            }

            if (!response.ok) {
                throw new Error(
                    data?.message ||
                    `Could not save this workout (HTTP ${response.status}).`
                );
            }

            const responseConfirmsWorkout = isPlank
                ? Number(data?.duration) === reviewedValue
                : isJumpCount
                    ? Number(data?.amount) === reviewedValue &&
                        data?.unit === "jumps"
                    : Number(data?.reps) === reviewedValue &&
                        Number(data?.sets) === 1;

            if (
                !data ||
                typeof data !== "object" ||
                data.exercise !== exercise.name ||
                !responseConfirmsWorkout ||
                (
                    weightInput &&
                    Number(data?.weight) !== weight
                )
            ) {
                throw new Error(
                    "The server response did not confirm this workout. Your reviewed session is still available."
                );
            }

            window.clearPrivateCaches?.();
            onWorkoutSaved?.();

            if (soundEnabled) {
                try {
                    sessionStorage.setItem("mustmake_pending_finish_sound", "true");
                } catch (error) {
                    console.warn("Could not queue the session finish sound.", error);
                }
            }
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

    window.addEventListener(
        "popstate",
        handleReviewBack,
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
