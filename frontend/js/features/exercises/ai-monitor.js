import { createExerciseDetector } from "./exercise-detectors.mjs";

const MEDIAPIPE_VERSION = "1.1.1";
const MEDIAPIPE_MODULE =
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM =
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const POSE_MODEL =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const MAX_REPETITIONS = 10000;
const MAX_REVIEWED_VALUE = 150;
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
        return "Camera access requires HTTPS or localhost. Open this page in a secure context and try again.";
    }

    if (
        error?.name === "NotAllowedError" ||
        error?.name === "SecurityError"
    ) {
        return "Camera permission was denied. Allow camera access in your browser settings, then try again.";
    }

    if (
        error?.name === "NotFoundError" ||
        error?.name === "DevicesNotFoundError"
    ) {
        return "No camera was found. Connect a camera and try again.";
    }

    if (
        error?.name === "NotReadableError" ||
        error?.name === "TrackStartError"
    ) {
        return "The camera is unavailable or being used by another app. Close other camera apps and try again.";
    }

    if (error?.name === "OverconstrainedError") {
        return "The camera could not provide a supported video mode. Try another camera.";
    }

    return "Could not start the camera. Check your browser and camera settings, then try again.";
}

async function createPoseLandmarker() {
    const { FilesetResolver, PoseLandmarker } =
        await loadVisionModule();

    const fileset = await FilesetResolver.forVisionTasks(
        MEDIAPIPE_WASM
    );

    try {
        return await PoseLandmarker.createFromOptions(
            fileset,
            {
                baseOptions: {
                    modelAssetPath: POSE_MODEL,
                    delegate: "CPU"
                },
                runningMode: "VIDEO",
                numPoses: 1,
                minPoseDetectionConfidence: 0.70,
                minPosePresenceConfidence: 0.70,
                minTrackingConfidence: 0.75
            }
        );
    } catch (error) {
        throw new Error(
            "Pose detection could not initialize on this device.",
            { cause: error }
        );
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
    const placeholder = root.querySelector(".monitor-preview-placeholder");
    const status = root.querySelector("#monitorStatus");
    const cameraStatus = root.querySelector("#monitorCameraStatus");
    const feedback = root.querySelector("#monitorFeedback");
    const countOutput = root.querySelector("#monitorRepCount");
    const timeOutput = root.querySelector("#monitorSessionTime");
    const finishButton = root.querySelector("#monitorFinish");
    const summary = root.querySelector("#monitorSummary");
    const summaryExercise = root.querySelector("#monitorSummaryExercise");
    const summaryMetric = root.querySelector("#monitorSummaryMetric");
    const correction = root.querySelector("#monitorCorrection");
    const weightInput = root.querySelector("#workout-weight");
    const correctionError = root.querySelector("#monitorCorrectionError");
    const saveButton = root.querySelector("#monitorSave");
    const discardButton = root.querySelector("#monitorDiscard");
    const saveMessage = root.querySelector("#monitorSaveMessage");

    const context = canvas.getContext("2d");
    const detector = createExerciseDetector(exercise.slug);
    const listeners = new AbortController();

    let lifecycle = "idle";
    let stream = null;
    let landmarker = null;
    let animationFrame = null;
    let resizeObserver = null;
    let disposed = false;
    let lastInferenceAt = 0;
    let lastTimestamp = 0;

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
    let cameraEnded = false;

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

    function setStatus(state, message) {
        lifecycle = state;
        status.dataset.state = state;
        status.textContent = message;

        finishButton.disabled =
            !["ready", "running"].includes(state) &&
            !(state === "error" && sessionStarted);

        saveButton.disabled =
            !["finished", "saving"].includes(state) ||
            saveInFlight;

        discardButton.disabled = state !== "finished";

        correction.disabled =
            state === "saving" || state === "saved";

        if (
            state === "finished" ||
            state === "saving" ||
            state === "saved"
        ) {
            summary.hidden = false;
        }
    }

    function setFeedback(message) {
        feedback.textContent = message;
    }

    function clearOverlay() {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    function resizeCanvas() {
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

        clearOverlay();
    }

    function updatePreviewAspectRatio() {
        if (!video.videoWidth || !video.videoHeight) {
            return;
        }

        preview.style.aspectRatio =
            `${video.videoWidth} / ${video.videoHeight}`;

        requestAnimationFrame(() => {
            if (!disposed) {
                resizeCanvas();
            }
        });
    }

    function drawPose(landmarks) {
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

        const scale = Math.min(
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
                visibilityOf(landmark) < 0.4
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
            if (visibilityOf(landmark) < 0.5) {
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
        placeholder.hidden = false;
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

    function updateCurrentPose(landmarks) {
        if (!landmarks?.length) {
            clearOverlay();

            if (isPlank) {
                const result = detector.update(
                    null,
                    performance.now()
                );

                elapsedMs = result.elapsedMs;
                setFeedback(result.feedback);
                updateClock();
            } else {
                detector.loseTracking();

                setFeedback(
                    "Person not detected. Move fully into the camera frame."
                );
            }

            return;
        }

        drawPose(landmarks);

        const result = detector.update(
            landmarks,
            performance.now()
        );

        if (isPlank) {
            elapsedMs = result.elapsedMs;
            updateClock();
        } else {
            rawCount = result.count;

            if (countOutput) {
                countOutput.textContent = String(rawCount);
            }
        }

        setFeedback(result.feedback);
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

            try {
                const result = landmarker.detectForVideo(
                    video,
                    timestamp
                );

                const pose = result.landmarks?.[0] || null;

                updateCurrentPose(pose);
            } catch (error) {
                console.error("Pose inference error:", error);

                endActiveInterval();
                releaseMonitoring();

                const message =
                    "Pose tracking stopped unexpectedly. Restart monitoring to try again.";

                cameraStatus.textContent = "Tracking stopped";
                setFeedback(message);
                setStatus("error", message);

                return;
            }
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
                "Tracking paused while this page is hidden. Return to the page to resume."
            );
        } else if (
            !document.hidden &&
            lifecycle === "running" &&
            animationFrame == null
        ) {
            setFeedback(
                "Tracking resumed. Stand in view to re-establish your starting position."
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
                "Camera access is not supported by this browser. Try a current browser over HTTPS.";

            setStatus("error", message);
            setFeedback(message);
            return;
        }

        setStatus(
            "initializing",
            "Requesting camera and loading pose tracking…"
        );

        cameraStatus.textContent = "Connecting…";

        setFeedback(
            "Allow camera access when your browser asks. Camera video stays on this device."
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
            placeholder.hidden = true;

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
                        "Camera connection ended. Start monitoring again when ready.";

                    setFeedback(message);
                    setStatus("error", message);
                };
            });

            landmarker = await createPoseLandmarker();

            if (disposed) {
                releaseMonitoring();
                return;
            }

            if (cameraEnded) {
                throw new Error(
                    "Camera connection ended while pose tracking was loading."
                );
            }

            detector.reset(isPlank ? elapsedMs : rawCount);

            lastInferenceAt = 0;
            lastTimestamp = 0;

            sessionStarted = true;
            summary.hidden = true;

            setStatus("running", "Monitoring");

            setFeedback(
                "Pose tracking is ready. Stand in view to establish your starting position."
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
                    : error?.message ||
                        "AI monitoring could not start. Try again.";

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

        summaryExercise.textContent = exercise.name;

        const reviewValue = isPlank
            ? roundedDuration(elapsedMs)
            : rawCount;

        summaryMetric.textContent = isPlank
            ? formatTime(reviewValue)
            : String(rawCount);

        correction.value = String(reviewValue);
        correctionError.textContent = "";
        saveMessage.textContent = "";

        setFeedback(
            isPlank
                ? "Session finished. Review the time counted while your plank posture was aligned."
                : "Session finished. Review the detected count and make any needed correction."
        );

        setStatus(
            "finished",
            "Session finished. Review before saving."
        );

        correction.focus();
    }

    function discardSession() {
        if (!["finished", "saved"].includes(lifecycle)) {
            return;
        }

        if (
            !window.confirm(
                "Discard this session? It will not be saved."
            )
        ) {
            return;
        }

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

        summary.hidden = true;
        correction.value = "0";
        correctionError.textContent = "";
        saveMessage.textContent = "";

        onWorkoutSaved?.();

        setFeedback(
            "Session discarded. Start monitoring when you are ready."
        );

        setStatus("idle", "Camera off");
    }

    function correctedCount() {
        const value = correction.value.trim();
        const parsed = Number(value);
        const minimum = 0;
        const maximum = MAX_REVIEWED_VALUE;

        const valid =
            value !== "" &&
            Number.isSafeInteger(parsed) &&
            parsed >= minimum &&
            parsed <= maximum;

        correctionError.textContent = valid
            ? ""
            : `Range has to be between ${minimum} to ${maximum}${isPlank ? " seconds" : isJumpCount ? " jumps" : ""}.`;

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
                saveMessage.textContent =
                    "Could not preserve this workout. Please try again before signing in.";
                return;
            }

            saveMessage.textContent =
                "Please sign in to save this workout.";

            const link = document.createElement("a");
            link.href = "/login";
            link.textContent = " Sign in";

            saveMessage.append(link);
            return;
        }

        saveInFlight = true;

        setStatus("saving", "Saving reviewed workout…");

        saveMessage.textContent =
            "Saving your reviewed workout…";

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
                    saveMessage.textContent =
                        "Your sign-in expired, and this workout could not be preserved. Retry before signing in.";

                    setStatus(
                        "finished",
                        "Sign-in required to save."
                    );

                    return;
                }

                saveMessage.textContent =
                    "Your sign-in expired. Sign in again; this reviewed session has not been discarded.";

                const link = document.createElement("a");
                link.href = "/login";
                link.textContent = " Sign in";

                saveMessage.append(link);

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

            saveMessage.textContent =
                "Workout saved successfully. ";

            const todayLink = document.createElement("a");
            todayLink.href = "/today";
            todayLink.textContent = "View today";

            const historyLink = document.createElement("a");
            historyLink.href = "/history";
            historyLink.textContent = "Open history";

            saveMessage.append(
                todayLink,
                document.createTextNode(" or "),
                historyLink,
                document.createTextNode(".")
            );

            setStatus("saved", "Workout saved.");
        } catch (error) {
            console.error("AI workout save error:", error);

            saveMessage.textContent =
                error.message ||
                "Could not connect to the server. Your reviewed session is still available to retry.";

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

        releaseMonitoring();

        listeners.abort();
        resizeObserver?.disconnect();

        return saveSnapshot();
    }

    finishButton.addEventListener(
        "click",
        finishSession,
        { signal: listeners.signal }
    );

    saveButton.addEventListener(
        "click",
        saveWorkout,
        { signal: listeners.signal }
    );

    discardButton.addEventListener(
        "click",
        discardSession,
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
        "resize",
        resizeCanvas,
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

        summaryExercise.textContent = exercise.name;

        summaryMetric.textContent = isPlank
            ? formatTime(roundedDuration(elapsedMs))
            : String(rawCount);

        correction.value = String(
            snapshot.reviewedCount ?? (
                isPlank
                    ? roundedDuration(elapsedMs)
                    : rawCount
            )
        );

        summary.hidden = false;

        if (snapshot.saved) {
            saveMessage.textContent =
                "Workout saved successfully.";

            setStatus("saved", "Workout saved.");
        } else {
            setStatus(
                "finished",
                "Session finished. Review before saving."
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

        summaryExercise.textContent = exercise.name;

        summaryMetric.textContent = isPlank
            ? formatTime(reviewedValue)
            : String(reviewedValue);

        correction.value = String(reviewedValue);

        if (
            weightInput &&
            Number.isFinite(Number(pendingWorkout.weight))
        ) {
            weightInput.value = String(pendingWorkout.weight);
        }

        sessionStarted = true;

        saveMessage.textContent =
            "You're signed in. Review your workout and save it again.";

        setStatus("finished", "Workout ready to save.");
    } else if (snapshot) {
        setStatus("ready", "Monitoring paused");

        setFeedback(
            "Monitoring paused. Your detected count is retained; you can resume or finish the session."
        );
    } else {
        setStatus("idle", "Camera off");
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