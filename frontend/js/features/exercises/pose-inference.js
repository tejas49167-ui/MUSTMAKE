const MEDIAPIPE_VERSION = "1.1.1";
const MEDIAPIPE_MODULE =
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
const MEDIAPIPE_WASM =
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const POSE_MODEL =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export const INFERENCE_INTERVAL_MS = 110;

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

export async function createPoseLandmarker(delegate) {
    const { FilesetResolver, PoseLandmarker } = await loadVisionModule();
    const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
    const options = {
        baseOptions: {
            modelAssetPath: POSE_MODEL,
            delegate
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.55
    };

    return PoseLandmarker.createFromOptions(fileset, options);
}

export async function createPoseLandmarkerWithFallback() {
    try {
        return {
            landmarker: await createPoseLandmarker("CPU"),
            delegate: "CPU"
        };
    } catch {
        try {
            return {
                landmarker: await createPoseLandmarker("GPU"),
                delegate: "GPU"
            };
        } catch (error) {
            throw new Error(
                "Pose detection could not initialize on this device.",
                { cause: error }
            );
        }
    }
}

export function detectPoseFrame(landmarker, video, timestamp) {
    return landmarker.detectForVideo(video, timestamp);
}
