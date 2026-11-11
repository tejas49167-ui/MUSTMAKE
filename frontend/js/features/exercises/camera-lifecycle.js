export function acquireCameraStream() {
    return navigator.mediaDevices.getUserMedia({
        video: {
            facingMode: "user",
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            zoom: { ideal: 1 }
        },
        audio: false
    });
}

export async function applyCameraZoom(videoTrack) {
    const zoomRange = videoTrack.getCapabilities?.().zoom;
    if (!zoomRange || !Number.isFinite(zoomRange.min)) return;

    try {
        await videoTrack.applyConstraints({ zoom: { exact: zoomRange.min } });
    } catch (error) {
        console.warn("Could not set the camera to its widest zoom.", error);
    }
}

export function attachCameraStream(video, stream) {
    video.srcObject = stream;
    video.hidden = false;
}

export function stopCameraStream(stream) {
    stream?.getTracks().forEach(track => {
        track.onended = null;
        track.stop();
    });
}

export function detachCameraStream(video) {
    video.pause();
    video.srcObject = null;
    video.hidden = true;
}

export function cameraErrorMessage(error) {
    if (!window.isSecureContext) return "Use HTTPS.";

    if (["NotAllowedError", "SecurityError"].includes(error?.name)) {
        return "Allow camera access.";
    }
    if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) {
        return "No camera found.";
    }
    if (["NotReadableError", "TrackStartError"].includes(error?.name)) {
        return "Camera in use.";
    }
    if (error?.name === "OverconstrainedError") return "Try another camera.";

    return "Camera unavailable.";
}
