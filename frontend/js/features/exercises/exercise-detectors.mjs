import { MAX_PLANK_DURATION_SECONDS } from "./exercise-limits.mjs";

const VISIBILITY_THRESHOLD = 0.35;
const SMOOTHING_ALPHA = 0.55;
const FAST_MOVEMENT_DELTA = 22;
const FAST_MOVEMENT_ALPHA = 0.85;
const MIN_SEGMENT_LENGTH = 0.015;
const DEFAULT_LOST_GRACE_MS = 450;
const DEFAULT_MIN_REP_INTERVAL_MS = 550;
const DEFAULT_DETECTION_MODE = "forgiving";

const LANDMARKS = {
    left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
    right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }
};

export const DETECTION_MODE_CONFIG = Object.freeze({
    strict: Object.freeze({
        visibilityFloor: 0.45,
        rangeFraction: 0.1,
        phaseHoldMs: 100,
        trackingGraceMs: 220,
        movementScale: 1.1
    }),
    forgiving: Object.freeze({
        visibilityFloor: 0,
        rangeFraction: 0.1,
        phaseHoldMs: 0,
        trackingGraceMs: 500,
        movementScale: 0.9
    })
});

export const EXERCISE_LANDMARK_REQUIREMENTS = Object.freeze({
    "squats": Object.freeze({
        side: Object.freeze([
            Object.freeze([23, 25, 27]),
            Object.freeze([24, 26, 28])
        ])
    }),
    "push-ups": Object.freeze({
        side: Object.freeze([
            Object.freeze([11, 13, 15]),
            Object.freeze([12, 14, 16])
        ]),
        front: Object.freeze([Object.freeze([11, 13, 15, 12, 14, 16])]),
    }),
    "pull-ups": Object.freeze({
        side: Object.freeze([
            Object.freeze([11, 13, 15]),
            Object.freeze([12, 14, 16])
        ]),
        front: Object.freeze([Object.freeze([11, 13, 15, 12, 14, 16])]),
    }),
    "biceps-curls": Object.freeze({
        side: Object.freeze([
            Object.freeze([11, 13, 15]),
            Object.freeze([12, 14, 16])
        ])
    }),
    "triceps-extension": Object.freeze({
        side: Object.freeze([
            Object.freeze([11, 13, 15]),
            Object.freeze([12, 14, 16])
        ])
    }),
    "shoulder-press": Object.freeze({
        side: Object.freeze([
            Object.freeze([11, 13, 15]),
            Object.freeze([12, 14, 16])
        ])
    }),
    "lateral-raises": Object.freeze({
        side: Object.freeze([
            Object.freeze([11, 13, 23]),
            Object.freeze([12, 14, 24])
        ])
    }),
    "jumping-jacks": Object.freeze({
        any: Object.freeze([Object.freeze([11, 12, 15, 16, 23, 24, 27, 28])])
    }),
    "skipping-rope": Object.freeze({
        any: Object.freeze([Object.freeze([11, 12, 23, 24, 25, 26, 27, 28])])
    }),
    "plank": Object.freeze({
        side: Object.freeze([
            Object.freeze([11, 13, 15, 23, 27]),
            Object.freeze([12, 14, 16, 24, 28])
        ]),
        front: Object.freeze([Object.freeze([11, 13, 15, 23, 27, 12, 14, 16, 24, 28])])
    })
});

function detectionThresholds(thresholds, mode, startKey = null) {
    const config = DETECTION_MODE_CONFIG[mode] || DETECTION_MODE_CONFIG.forgiving;
    const result = {
        ...thresholds,
        mode: DETECTION_MODE_CONFIG[mode] ? mode : DEFAULT_DETECTION_MODE,
        visibility: Math.max(thresholds.visibility, config.visibilityFloor),
        bottomHoldMs: config.phaseHoldMs,
        maxLostFramesGraceMs: config.trackingGraceMs,
        maxFrameGapMs: Math.min(
            thresholds.maxFrameGapMs ?? config.trackingGraceMs,
            config.trackingGraceMs
        ),
        movementScale: config.movementScale
    };

    if (Number.isFinite(thresholds.minRepIntervalMs)) {
        result.minRepIntervalMs = Math.round(
            thresholds.minRepIntervalMs * config.movementScale
        );
    }

    const direction = result.mode === "strict" ? 1 : -1;
    if (Number.isFinite(thresholds.armsUpMin) &&
        Number.isFinite(thresholds.armsDownMax)) {
        const adjustment = Math.abs(
            thresholds.armsUpMin - thresholds.armsDownMax
        ) * config.rangeFraction * direction;
        result.armsUpMin += adjustment;
        result.armsDownMax -= adjustment;
    }
    if (Number.isFinite(thresholds.feetOpenMin) &&
        Number.isFinite(thresholds.feetClosedMax)) {
        const adjustment = Math.abs(
            thresholds.feetOpenMin - thresholds.feetClosedMax
        ) * config.rangeFraction * direction;
        result.feetOpenMin += adjustment;
        result.feetClosedMax -= adjustment;
    }
    if (Number.isFinite(thresholds.minFootClearance)) {
        result.minFootClearance *= config.movementScale;
        result.landingTolerance /= config.movementScale;
    }
    if (Number.isFinite(thresholds.maxBodyLineAngle)) {
        result.maxBodyLineAngle *= result.mode === "strict"
            ? 1 - config.rangeFraction
            : 1 + config.rangeFraction;
        result.minFrontalBodyLineAngle +=
            (90 - thresholds.minFrontalBodyLineAngle) *
            config.rangeFraction * direction;
        result.maxHipDeviation *= config.movementScale;
        result.minSupportArmAngle *= config.movementScale;
    }

    if (startKey && Number.isFinite(thresholds[startKey]) &&
        Number.isFinite(thresholds.bottom)) {
        const range = Math.abs(thresholds[startKey] - thresholds.bottom);
        const direction = Math.sign(thresholds[startKey] - thresholds.bottom);
        const adjustment = range * config.rangeFraction *
            (result.mode === "strict" ? 1 : -1);
        result[startKey] = thresholds[startKey] + direction * adjustment;
        result.bottom = thresholds.bottom - direction * adjustment;
    }

    return result;
}

function visibleRequirement(landmarks, indexes, threshold) {
    return indexes.some(group =>
        group.every(index => visible(landmarks?.[index], threshold))
    );
}

function getDetectionMode(options) {
    return options.strict === false
        ? "forgiving"
        : options.mode || DEFAULT_DETECTION_MODE;
}

export const SQUAT_THRESHOLDS = Object.freeze({
    visibility: VISIBILITY_THRESHOLD,
    standing: 150,
    descending: 140,
    bottom: 115,
    ascending: 125,
    settleMs: 0,
    establishMs: 150,
    returnMs: 0,
    minRepIntervalMs: 600
});

export const PUSH_UP_THRESHOLDS = Object.freeze({
    visibility: 0.3,
    starting: 140,
    lowering: 128,
    bottom: 115,
    returning: 125,
    minShoulderDropRatio: 0.05,
    settleMs: 0,
    establishMs: 120,
    returnMs: 0,
    maxLostFramesGraceMs: 500,
    maxSideAngleDifference: 35,
    minRepIntervalMs: 550
});

export const PLANK_THRESHOLDS = Object.freeze({
    visibility: 0.35,
    maxBodyLineAngle: 60,
    minFrontalBodyLineAngle: 75,
    maxHipDeviation: 0.24,
    minBodyLength: 0.18,
    minSupportArmAngle: 45,
    maxFrameGapMs: 500
});

export const EXERCISE_THRESHOLDS = Object.freeze({
    "pull-ups": {
        visibility: 0.35,
        start: 140,
        active: 130,
        bottom: 108,
        return: 128,
        settleMs: 0,
        establishMs: 120,
        returnMs: 0,
        minRepIntervalMs: 600,
        maxSideAngleDifference: 35,
        minShoulderRiseRatio: 0.05,
        name: "pull-up"
    },
    "biceps-curls": {
        visibility: 0.3,
        start: 132,
        active: 122,
        bottom: 108,
        return: 120,
        settleMs: 0,
        establishMs: 100,
        returnMs: 0,
        minRepIntervalMs: 500,
        name: "biceps curl"
    },
    "triceps-extension": {
        visibility: 0.3,
        start: 85,
        active: 98,
        bottom: 130,
        return: 112,
        settleMs: 0,
        establishMs: 100,
        returnMs: 0,
        minRepIntervalMs: 500,
        name: "triceps extension"
    },
    "shoulder-press": {
        visibility: 0.3,
        start: 110,
        active: 118,
        bottom: 136,
        return: 120,
        settleMs: 0,
        establishMs: 100,
        returnMs: 0,
        minRepIntervalMs: 550,
        name: "shoulder press"
    },
    "lateral-raises": {
        visibility: 0.35,
        start: 38,
        active: 48,
        bottom: 72,
        return: 52,
        settleMs: 0,
        establishMs: 120,
        returnMs: 0,
        minRepIntervalMs: 550,
        name: "lateral raise"
    }
});

function visible(landmark, threshold) {
    return Boolean(landmark) &&
        Number.isFinite(landmark.x) &&
        Number.isFinite(landmark.y) &&
        Number.isFinite(landmark.visibility) &&
        landmark.visibility >= threshold;
}

function angleAt(a, vertex, c) {
    const firstX = a.x - vertex.x;
    const firstY = a.y - vertex.y;
    const secondX = c.x - vertex.x;
    const secondY = c.y - vertex.y;
    const firstLength = Math.hypot(firstX, firstY);
    const secondLength = Math.hypot(secondX, secondY);
    if (firstLength < MIN_SEGMENT_LENGTH || secondLength < MIN_SEGMENT_LENGTH) return null;
    const cosine = Math.max(-1, Math.min(1,
        (firstX * secondX + firstY * secondY) / (firstLength * secondLength)
    ));
    return Math.acos(cosine) * 180 / Math.PI;
}

function angleAt3d(a, vertex, c) {
    if (![a, vertex, c].every(point => Number.isFinite(point.z))) {
        return angleAt(a, vertex, c);
    }

    const first = [a.x - vertex.x, a.y - vertex.y, a.z - vertex.z];
    const second = [c.x - vertex.x, c.y - vertex.y, c.z - vertex.z];
    const firstLength = Math.hypot(...first);
    const secondLength = Math.hypot(...second);
    if (firstLength < MIN_SEGMENT_LENGTH || secondLength < MIN_SEGMENT_LENGTH) return null;
    const cosine = Math.max(-1, Math.min(1,
        first.reduce((sum, value, index) => sum + value * second[index], 0) /
            (firstLength * secondLength)
    ));
    return Math.acos(cosine) * 180 / Math.PI;
}

function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function smoothedAngle(previous, current) {
    if (previous == null) return current;
    const alpha = Math.abs(current - previous) >= FAST_MOVEMENT_DELTA
        ? FAST_MOVEMENT_ALPHA
        : SMOOTHING_ALPHA;
    return previous * (1 - alpha) + current * alpha;
}

class RepDetector {
    constructor(thresholds, initialLabel = "Get set.", lostTrackingLabel = "Can't see u.") {
        this.thresholds = thresholds;
        this.initialLabel = initialLabel;
        this.lostTrackingLabel = lostTrackingLabel;
        this.reset();
    }

    reset(count = 0) {
        this.count = count;
        this.lastRepAt = -Infinity;
        this.resetMovement();
    }

    resetMovement() {
        this.state = "unknown";
        this.filteredAngle = null;
        this.pendingState = null;
        this.pendingSince = 0;
        this.lastSeenAt = null;
        this.feedback = this.initialLabel;
    }

    loseTracking(now = null) {
        const graceMs = this.thresholds?.maxLostFramesGraceMs ?? DEFAULT_LOST_GRACE_MS;
        if (
            now != null &&
            this.lastSeenAt != null &&
            now - this.lastSeenAt <= graceMs &&
            this.state !== "unknown"
        ) {
            return false;
        }
        this.state = "unknown";
        this.filteredAngle = null;
        this.pendingState = null;
        this.feedback = this.lostTrackingLabel;
        return true;
    }

    resumeTracking(now) {
        const graceMs = this.thresholds?.maxLostFramesGraceMs ?? DEFAULT_LOST_GRACE_MS;
        if (this.lastSeenAt != null && now - this.lastSeenAt > graceMs) {
            this.resetMovement();
        }
        this.lastSeenAt = now;
    }

    completeRep(now) {
        const minInterval = this.thresholds?.minRepIntervalMs ?? DEFAULT_MIN_REP_INTERVAL_MS;
        if (now - this.lastRepAt < minInterval) {
            return false;
        }
        this.count += 1;
        this.lastRepAt = now;
        this.feedback = "Nice rep.";
        return true;
    }

    holdTransition(nextState, now, duration, onTransition) {
        if (duration <= 0) {
            this.pendingState = null;
            onTransition();
            return true;
        }
        if (this.pendingState !== nextState) {
            this.pendingState = nextState;
            this.pendingSince = now;
            return false;
        }
        if (now - this.pendingSince < duration) return false;
        this.pendingState = null;
        onTransition();
        return true;
    }

    clearPending() {
        this.pendingState = null;
    }

    result(angle) {
        return {
            count: this.count,
            state: this.state,
            angle,
            feedback: this.feedback
        };
    }
}

export class SquatDetector extends RepDetector {
    constructor(thresholds = SQUAT_THRESHOLDS, options = {}) {
        const mode = getDetectionMode(options);
        super(detectionThresholds(thresholds, mode, "standing"), "Get set.", "Can't see legs.");
    }

    update(landmarks, now = performance.now()) {
        const angles = [];
        for (const side of Object.values(LANDMARKS)) {
            const hip = landmarks?.[side.hip];
            const knee = landmarks?.[side.knee];
            const ankle = landmarks?.[side.ankle];
            const required = side === LANDMARKS.left
                ? EXERCISE_LANDMARK_REQUIREMENTS.squats.side[0]
                : EXERCISE_LANDMARK_REQUIREMENTS.squats.side[1];
            if (!visibleRequirement(landmarks, [required], this.thresholds.visibility)) continue;
            const angle = angleAt(hip, knee, ankle);
            if (angle != null) angles.push(angle);
        }
        if (!angles.length) {
            this.loseTracking(now);
            return this.result(this.filteredAngle);
        }

        this.resumeTracking(now);
        const angle = this.filteredAngle = smoothedAngle(this.filteredAngle, average(angles));
        const t = this.thresholds;

        if (this.state === "unknown") {
            this.feedback = "Get set.";
            if (angle >= t.standing) {
                this.holdTransition("standing", now, t.establishMs, () => {
                    this.state = "standing";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "standing" || this.state === "descending") {
            if (angle <= t.bottom) {
                this.holdTransition("bottom", now, t.bottomHoldMs, () => {
                    this.state = "bottom";
                });
            } else {
                this.clearPending();
                if (angle <= t.descending) {
                    this.state = "descending";
                } else if (angle >= t.standing) {
                    this.state = "standing";
                }
            }
        } else if (this.state === "bottom") {
            if (angle >= t.ascending && angle < t.standing) {
                this.state = "ascending";
            }
        } else if (this.state === "ascending") {
            if (angle >= t.standing) {
                this.holdTransition("standing", now, t.returnMs, () => {
                    this.state = "standing";
                    this.completeRep(now);
                });
            } else if (angle >= t.ascending) {
                this.state = "ascending";
            } else if (angle <= t.bottom) {
                this.state = "bottom";
            }
        }

        return this.result(angle);
    }

}

export class PushUpDetector extends RepDetector {
    constructor(thresholds = PUSH_UP_THRESHOLDS, options = {}) {
        const mode = getDetectionMode(options);
        super(detectionThresholds(thresholds, mode, "starting"), "Get set.", "Can't see arm.");
        this.frontView = Boolean(options.frontView);
        this.startShoulderWristY = null;
        this.startArmLength = null;
    }

    resetMovement() {
        super.resetMovement();
        this.startShoulderWristY = null;
        this.startArmLength = null;
        this.expectedSideCount = null;
    }

    update(landmarks, now = performance.now()) {
        if (this.frontView) return this.updateFrontView(landmarks, now);

        const t = this.thresholds;
        const validSides = [];

        for (const side of Object.values(LANDMARKS)) {
            const shoulder = landmarks?.[side.shoulder];
            const elbow = landmarks?.[side.elbow];
            const wrist = landmarks?.[side.wrist];

            const required = side === LANDMARKS.left
                ? EXERCISE_LANDMARK_REQUIREMENTS["push-ups"].side[0]
                : EXERCISE_LANDMARK_REQUIREMENTS["push-ups"].side[1];
            if (!visibleRequirement(landmarks, [required], t.visibility)) continue;

            const armAngle = angleAt3d(shoulder, elbow, wrist);
            if (armAngle == null) continue;

            const upperArmLength = Math.hypot(shoulder.x - elbow.x, shoulder.y - elbow.y);
            if (upperArmLength < 0.02) continue;

            const armLength = upperArmLength + Math.hypot(elbow.x - wrist.x, elbow.y - wrist.y);
            const shoulderWristY = (wrist.y - shoulder.y) / Math.max(armLength, 0.1);

            validSides.push({
                angle: armAngle,
                shoulderWristY,
                confidence: (shoulder.visibility + elbow.visibility + wrist.visibility) / 3
            });
        }

        if (!validSides.length) {
            if (this.loseTracking(now)) {
                this.startShoulderWristY = null;
                this.startArmLength = null;
                this.expectedSideCount = null;
            }
            return this.result(this.filteredAngle);
        }

        validSides.sort((a, b) => b.confidence - a.confidence);
        const bestSide = validSides[0];
        const averageSides = validSides.length === 2 &&
            validSides[1].confidence >= bestSide.confidence - 0.2 &&
            Math.abs(validSides[0].angle - validSides[1].angle) <= t.maxSideAngleDifference;
        const totalConfidence = averageSides
            ? validSides[0].confidence + validSides[1].confidence
            : 1;
        const rawAngle = averageSides
            ? validSides.reduce((sum, side) => sum + side.angle * side.confidence, 0) / totalConfidence
            : bestSide.angle;
        const currentShoulderWristY = averageSides
            ? validSides.reduce((sum, side) => sum + side.shoulderWristY * side.confidence, 0) / totalConfidence
            : bestSide.shoulderWristY;

        return this.updateCycle(rawAngle, currentShoulderWristY, validSides.length, now);
    }

    updateCycle(rawAngle, currentShoulderWristY, sideCount, now, armLength = null) {
        const t = this.thresholds;
        this.resumeTracking(now);
        const angle = this.filteredAngle = smoothedAngle(this.filteredAngle, rawAngle);
        const hasRealChestDrop = this.startShoulderWristY == null ||
            (this.startShoulderWristY - currentShoulderWristY) /
                Math.max(this.startArmLength || armLength || 1, MIN_SEGMENT_LENGTH) >=
                t.minShoulderDropRatio * t.movementScale;

        if (this.state === "unknown") {
            this.feedback = "Get set.";
            if (angle >= t.starting) {
                this.holdTransition("starting", now, t.establishMs, () => {
                    this.state = "starting";
                    this.startShoulderWristY = currentShoulderWristY;
                    this.startArmLength = armLength;
                    this.expectedSideCount = sideCount;
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "starting" || this.state === "lowering") {
            if (angle >= t.starting) {
                this.startShoulderWristY = this.startShoulderWristY == null
                    ? currentShoulderWristY
                    : Math.max(
                        this.startShoulderWristY * 0.9 + currentShoulderWristY * 0.1,
                        currentShoulderWristY
                    );
                this.startArmLength = armLength;
                this.state = "starting";
                this.clearPending();
            } else if (angle <= t.bottom && hasRealChestDrop) {
                this.holdTransition("bottom", now, t.bottomHoldMs, () => {
                    this.state = "bottom";
                });
            } else {
                this.clearPending();
                if (angle <= t.lowering) this.state = "lowering";
            }
        } else if (this.state === "bottom" || this.state === "returning") {
            if (angle >= t.starting) {
                if (this.expectedSideCount != null && sideCount < this.expectedSideCount) {
                    this.clearPending();
                    this.state = "returning";
                } else {
                    this.holdTransition("starting", now, t.returnMs, () => {
                        this.state = "starting";
                        this.startShoulderWristY = currentShoulderWristY;
                        this.startArmLength = armLength;
                        this.completeRep(now);
                    });
                }
            } else {
                this.clearPending();
                if (angle >= t.returning) {
                    this.state = "returning";
                } else if (angle <= t.bottom) {
                    this.state = "bottom";
                }
            }
        }

        return this.result(angle);
    }

    updateFrontView(landmarks, now) {
        const t = this.thresholds;
        const required = EXERCISE_LANDMARK_REQUIREMENTS["push-ups"].front;
        if (!visibleRequirement(landmarks, required, t.visibility)) {
            if (this.loseTracking(now)) {
                this.startShoulderWristY = null;
                this.startArmLength = null;
                this.expectedSideCount = null;
            }
            return this.result(this.filteredAngle);
        }

        const sides = [LANDMARKS.left, LANDMARKS.right].map(side => {
            const shoulder = landmarks[side.shoulder];
            const elbow = landmarks[side.elbow];
            const wrist = landmarks[side.wrist];
            const angle = angleAt(shoulder, elbow, wrist);
            const upperArmLength = Math.hypot(
                shoulder.x - elbow.x,
                shoulder.y - elbow.y
            );
            if (angle == null || upperArmLength < 0.02) return null;

            const armLength = upperArmLength + Math.hypot(
                elbow.x - wrist.x,
                elbow.y - wrist.y
            );
            return {
                angle,
                shoulderWristY: wrist.y - shoulder.y,
                armLength
            };
        });

        if (
            sides.some(side => !side) ||
            Math.abs(sides[0].angle - sides[1].angle) > t.maxSideAngleDifference
        ) {
            if (this.loseTracking(now)) {
                this.startShoulderWristY = null;
                this.expectedSideCount = null;
            }
            return this.result(this.filteredAngle);
        }

        const rawAngle = average(sides.map(side => side.angle));
        const currentShoulderWristY = average(sides.map(side => side.shoulderWristY));
        const currentArmLength = average(sides.map(side => side.armLength));
        return this.updateCycle(rawAngle, currentShoulderWristY, 2, now, currentArmLength);
    }
}

class AngleCycleDetector extends RepDetector {
    constructor(thresholds, lostTrackingLabel) {
        super(thresholds, "Get set.", lostTrackingLabel);
    }

    updateAngle(angle, now) {
        if (!Number.isFinite(angle)) {
            this.loseTracking(now);
            return this.result(this.filteredAngle);
        }

        this.resumeTracking(now);
        const t = this.thresholds;
        const filtered = this.filteredAngle = smoothedAngle(this.filteredAngle, angle);
        const descending = t.start > t.bottom;

        const atStart = descending ? filtered >= t.start : filtered <= t.start;
        const atActive = descending ? filtered <= t.active : filtered >= t.active;
        const atBottom = descending ? filtered <= t.bottom : filtered >= t.bottom;
        const atReturn = descending ? filtered >= t.return : filtered <= t.return;

        if (this.state === "unknown") {
            this.feedback = "Get set.";
            if (atStart) {
                this.holdTransition("start", now, t.establishMs, () => {
                    this.state = "start";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "start" || this.state === "active") {
            if (atBottom) {
                this.holdTransition("bottom", now, t.bottomHoldMs, () => {
                    this.state = "bottom";
                });
            } else {
                this.clearPending();
                if (atActive) {
                    this.state = "active";
                } else if (atStart) {
                    this.state = "start";
                }
            }
        } else if (this.state === "bottom" || this.state === "returning") {
            if (atStart) {
                this.holdTransition("start", now, t.returnMs, () => {
                    this.state = "start";
                    this.completeRep(now);
                });
            } else if (atReturn) {
                this.state = "returning";
            } else if (atBottom) {
                this.state = "bottom";
            }
        }

        return this.result(filtered);
    }
}

function armCycleAngles(landmarks, slug, thresholds) {
    const values = [];
    for (const [name, side] of Object.entries(LANDMARKS)) {
        const shoulder = landmarks?.[side.shoulder];
        const elbow = landmarks?.[side.elbow];
        const wrist = landmarks?.[side.wrist];
        const required = EXERCISE_LANDMARK_REQUIREMENTS[slug].side[
            name === "left" ? 0 : 1
        ];
        if (!visibleRequirement(landmarks, [required], thresholds.visibility)) continue;
        const angle = angleAt(shoulder, elbow, wrist);
        if (angle == null) continue;
        const upperArmLength = Math.hypot(shoulder.x - elbow.x, shoulder.y - elbow.y);
        if (upperArmLength < 0.02) continue;
        values.push({ side: name, angle });
    }
    return values;
}

function shoulderRaiseAngles(landmarks, slug, thresholds) {
    const values = [];
    for (const [name, side] of Object.entries(LANDMARKS)) {
        const shoulder = landmarks?.[side.shoulder];
        const elbow = landmarks?.[side.elbow];
        const hip = landmarks?.[side.hip];
        const required = EXERCISE_LANDMARK_REQUIREMENTS[slug].side[
            name === "left" ? 0 : 1
        ];
        if (!visibleRequirement(landmarks, [required], thresholds.visibility)) continue;
        const angle = angleAt(hip, shoulder, elbow);
        if (angle != null) values.push({ side: name, angle });
    }
    return values;
}

export class ExerciseArmDetector extends AngleCycleDetector {
    constructor(slug, options = {}) {
        const baseConfig = EXERCISE_THRESHOLDS[slug];
        if (!baseConfig) throw new Error(`No arm detector configuration exists for ${slug}.`);
        const mode = getDetectionMode(options);
        const config = detectionThresholds(baseConfig, mode, "start");
        const lostTrackingLabel = slug === "pull-ups"
            ? "Can't see hands/hips."
            : slug === "lateral-raises"
                ? "Can't see arms."
                : "Can't see hands.";

        super(config, lostTrackingLabel);
        this.slug = slug;
        this.sideDetectors = Object.fromEntries(
            Object.keys(LANDMARKS).map(side => [
                side,
                new AngleCycleDetector(config, lostTrackingLabel)
            ])
        );
    }

    reset(count = 0) {
        super.reset(count);
        for (const detector of Object.values(this.sideDetectors || {})) {
            detector.reset();
        }
    }

    loseTracking(now = null) {
        super.loseTracking(now);
        for (const detector of Object.values(this.sideDetectors || {})) {
            detector.loseTracking(now);
        }
    }

    update(landmarks, now = performance.now()) {
        const angles = this.thresholds.name === "lateral raise"
            ? shoulderRaiseAngles(landmarks, this.slug, this.thresholds)
            : armCycleAngles(landmarks, this.slug, this.thresholds);

        if (!angles.length) {
            this.loseTracking(now);
            return this.result(this.filteredAngle);
        }

        this.resumeTracking(now);
        const bySide = new Map(angles.map(({ side, angle }) => [side, angle]));
        let repCompletedThisFrame = false;

        for (const [side, detector] of Object.entries(this.sideDetectors)) {
            const angle = bySide.get(side);
            if (angle == null) {
                detector.loseTracking(now);
                continue;
            }
            const previousCount = detector.count;
            detector.updateAngle(angle, now);
            if (detector.count > previousCount) {
                repCompletedThisFrame = true;
            }
        }

        if (repCompletedThisFrame) {
            this.completeRep(now);
        } else if (this.feedback !== "Nice rep.") {
            this.feedback = "Get set.";
        }

        const activeDetectors = Object.values(this.sideDetectors)
            .filter(detector => detector.state !== "unknown");
        const current = activeDetectors.sort((first, second) =>
            ["start", "active", "bottom", "returning"].indexOf(second.state) -
            ["start", "active", "bottom", "returning"].indexOf(first.state)
        )[0];

        const angle = average(angles.map(value => value.angle));
        this.state = current?.state || "unknown";
        this.filteredAngle = angle;
        return this.result(angle);
    }
}

export class FrontPullUpDetector extends RepDetector {
    constructor(options = {}) {
        const mode = getDetectionMode(options);
        super(
            detectionThresholds(EXERCISE_THRESHOLDS["pull-ups"], mode, "start"),
            "Get set.",
            "Can't see hands/hips."
        );
        this.baselineShoulderWristY = null;
        this.baselineArmLength = null;
    }

    resetMovement() {
        super.resetMovement();
        this.baselineShoulderWristY = null;
        this.baselineArmLength = null;
    }

    update(landmarks, now = performance.now()) {
        const t = this.thresholds;
        const required = EXERCISE_LANDMARK_REQUIREMENTS["pull-ups"].front;
        if (!visibleRequirement(landmarks, required, t.visibility)) {
            this.loseTracking(now);
            return this.result(this.filteredAngle);
        }

        const sides = [LANDMARKS.left, LANDMARKS.right].map(side => {
            const shoulder = landmarks[side.shoulder];
            const elbow = landmarks[side.elbow];
            const wrist = landmarks[side.wrist];
            const angle = angleAt(shoulder, elbow, wrist);
            const upperArmLength = Math.hypot(
                shoulder.x - elbow.x,
                shoulder.y - elbow.y
            );
            if (angle == null || upperArmLength < 0.02) return null;

            const armLength = upperArmLength + Math.hypot(
                elbow.x - wrist.x,
                elbow.y - wrist.y
            );
            return {
                angle,
                shoulderWristY: wrist.y - shoulder.y,
                armLength
            };
        });

        if (
            sides.some(side => !side) ||
            Math.abs(sides[0].angle - sides[1].angle) > t.maxSideAngleDifference
        ) {
            this.loseTracking(now);
            return this.result(this.filteredAngle);
        }

        this.resumeTracking(now);
        const angle = this.filteredAngle = smoothedAngle(
            this.filteredAngle,
            average(sides.map(side => side.angle))
        );
        const currentShoulderWristY = average(sides.map(side => side.shoulderWristY));
        const currentArmLength = average(sides.map(side => side.armLength));
        const hasShoulderRise = this.baselineShoulderWristY != null &&
            (currentShoulderWristY - this.baselineShoulderWristY) /
                Math.max(this.baselineArmLength || currentArmLength, MIN_SEGMENT_LENGTH) >=
                t.minShoulderRiseRatio * t.movementScale;
        const returnedToHang = this.baselineShoulderWristY == null ||
            (currentShoulderWristY - this.baselineShoulderWristY) /
                Math.max(this.baselineArmLength || currentArmLength, MIN_SEGMENT_LENGTH) <=
                t.minShoulderRiseRatio * t.movementScale;

        if (this.state === "unknown") {
            this.feedback = "Get set.";
            if (angle >= t.start) {
                this.holdTransition("start", now, t.establishMs, () => {
                    this.state = "start";
                    this.baselineShoulderWristY = currentShoulderWristY;
                    this.baselineArmLength = currentArmLength;
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "start" || this.state === "active") {
            if (angle >= t.start) {
                this.baselineShoulderWristY = this.baselineShoulderWristY == null
                    ? currentShoulderWristY
                    : Math.min(this.baselineShoulderWristY, currentShoulderWristY);
                this.baselineArmLength = currentArmLength;
                this.state = "start";
                this.clearPending();
            } else if (angle <= t.bottom && hasShoulderRise) {
                this.holdTransition("bottom", now, t.bottomHoldMs, () => {
                    this.state = "bottom";
                });
            } else {
                this.clearPending();
                if (angle <= t.active) this.state = "active";
            }
        } else if (this.state === "bottom" || this.state === "returning") {
            if (angle >= t.start && returnedToHang) {
                this.holdTransition("start", now, t.returnMs, () => {
                    this.state = "start";
                    this.baselineShoulderWristY = currentShoulderWristY;
                    this.baselineArmLength = currentArmLength;
                    this.completeRep(now);
                });
            } else {
                this.clearPending();
                if (angle >= t.return) {
                    this.state = "returning";
                } else if (angle <= t.bottom) {
                    this.state = "bottom";
                }
            }
        }

        return this.result(angle);
    }
}

export const JUMPING_JACK_THRESHOLDS = Object.freeze({
    visibility: 0.35,
    armsDownMax: 0.48,
    armsUpMin: 0.58,
    feetClosedMax: 0.85,
    feetOpenMin: 0.92,
    settleMs: 0,
    establishMs: 120,
    returnMs: 0,
    minRepIntervalMs: 320
});

export class JumpingJackDetector extends RepDetector {
    constructor(thresholds = JUMPING_JACK_THRESHOLDS, options = {}) {
        const mode = getDetectionMode(options);
        super(detectionThresholds(thresholds, mode), "Get set.", "Can't see hands/legs.");
    }

    update(landmarks, now = performance.now()) {
        const t = this.thresholds;
        const required = EXERCISE_LANDMARK_REQUIREMENTS["jumping-jacks"].any;
        if (!visibleRequirement(landmarks, required, t.visibility)) {
            this.loseTracking(now);
            return this.result(null);
        }
        const shoulderWidth = Math.abs(landmarks[11].x - landmarks[12].x);
        const hipWidth = Math.abs(landmarks[23].x - landmarks[24].x);
        if (shoulderWidth < 0.02 || hipWidth < 0.015) {
            this.loseTracking(now);
            return this.result(null);
        }

        this.resumeTracking(now);
        const armHeight = (
            (landmarks[11].y - landmarks[15].y) +
            (landmarks[12].y - landmarks[16].y)
        ) / (2 * shoulderWidth);
        const legWidth = Math.abs(landmarks[27].x - landmarks[28].x) / hipWidth;

        const armsOpen = armHeight >= t.armsUpMin;
        const legsOpen = legWidth >= t.feetOpenMin;
        const jumping = armsOpen || legsOpen;
        const closed = armHeight <= t.armsDownMax && legWidth <= t.feetClosedMax;

        if (this.state === "unknown") {
            this.feedback = "Get set.";
            if (closed) {
                this.holdTransition("closed", now, t.establishMs, () => {
                    this.state = "closed";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "closed") {
            if (jumping) {
                this.holdTransition("open", now, t.settleMs, () => {
                    this.state = "open";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "open") {
            if (closed) {
                this.holdTransition("closed", now, t.returnMs, () => {
                    this.state = "closed";
                    this.completeRep(now);
                });
            } else {
                this.clearPending();
            }
        }
        return this.result(jumping ? "open" : closed ? "closed" : this.state);
    }
}

export const SKIPPING_ROPE_THRESHOLDS = Object.freeze({
    visibility: 0.35,
    minFootClearance: 0.04,
    landingTolerance: 0.018,
    settleMs: 0,
    establishMs: 120,
    returnMs: 0,
    minRepIntervalMs: 240
});

export class SkippingRopeDetector extends RepDetector {
    constructor(thresholds = SKIPPING_ROPE_THRESHOLDS, options = {}) {
        const mode = getDetectionMode(options);
        super(detectionThresholds(thresholds, mode), "Get set.", "Can't see legs.");
        this.baselineHipY = null;
    }

    resetMovement() {
        super.resetMovement();
        this.baselineHipY = null;
    }

    update(landmarks, now = performance.now()) {
        const t = this.thresholds;
        const required = EXERCISE_LANDMARK_REQUIREMENTS["skipping-rope"].any;
        if (!visibleRequirement(landmarks, required, t.visibility)) {
            this.loseTracking(now);
            return this.result(null);
        }
        const leftLeg = angleAt(landmarks[23], landmarks[25], landmarks[27]);
        const rightLeg = angleAt(landmarks[24], landmarks[26], landmarks[28]);
        const hipY = (landmarks[23].y + landmarks[24].y) / 2;
        const torsoLength = (
            Math.hypot(landmarks[11].x - landmarks[23].x, landmarks[11].y - landmarks[23].y) +
            Math.hypot(landmarks[12].x - landmarks[24].x, landmarks[12].y - landmarks[24].y)
        ) / 2;

        if (
            leftLeg == null ||
            rightLeg == null ||
            Math.abs(leftLeg - rightLeg) > 90 ||
            Math.abs(landmarks[27].x - landmarks[28].x) > 0.45 ||
            torsoLength < MIN_SEGMENT_LENGTH
        ) {
            this.loseTracking(now);
            return this.result(null);
        }

        this.resumeTracking(now);
        if (this.state === "unknown") {
            this.feedback = "Get set.";
            this.baselineHipY = this.baselineHipY == null
                ? hipY
                : this.baselineHipY * 0.8 + hipY * 0.2;
            if (leftLeg > 140 && rightLeg > 140) {
                this.holdTransition("grounded", now, t.establishMs, () => {
                    this.state = "grounded";
                    this.baselineHipY = hipY;
                });
            } else {
                this.clearPending();
            }
        } else {
            const rise = (this.baselineHipY - hipY) / torsoLength;
            if (this.state === "grounded") {
                if (rise >= t.minFootClearance) {
                    this.holdTransition("airborne", now, t.settleMs, () => {
                        this.state = "airborne";
                    });
                } else {
                    this.clearPending();
                    this.baselineHipY = this.baselineHipY * 0.96 + hipY * 0.04;
                }
            } else if (this.state === "airborne") {
                if (rise <= t.landingTolerance) {
                    this.holdTransition("grounded", now, t.returnMs, () => {
                        this.state = "grounded";
                        this.baselineHipY = this.baselineHipY * 0.85 + hipY * 0.15;
                        this.completeRep(now);
                    });
                } else {
                    this.clearPending();
                }
            }
        }
        return this.result(hipY);
    }
}

export class PlankTimerDetector {
    constructor(thresholds = PLANK_THRESHOLDS, options = {}) {
        const mode = getDetectionMode(options);
        this.thresholds = detectionThresholds(thresholds, mode);
        this.reset();
    }

    reset(elapsedMs = 0) {
        this.elapsedMs = Math.max(0, Number(elapsedMs) || 0);
        this.lastValidAt = null;
        this.isCorrect = false;
        this.feedback = "Get set.";
        this.lostTrackingLabel = "Can't see legs.";
    }

    pause() {
        this.lastValidAt = null;
        this.isCorrect = false;
    }

    update(landmarks, now = performance.now()) {
        const t = this.thresholds;
        const sideCandidates = [
            { shoulder: 11, elbow: 13, wrist: 15, hip: 23, ankle: 27 },
            { shoulder: 12, elbow: 14, wrist: 16, hip: 24, ankle: 28 }
        ];
        let hasVisibleBody = false;
        let hasVisibleSupport = false;

        for (const [sideIndex, side] of sideCandidates.entries()) {
            const shoulder = landmarks?.[side.shoulder];
            const elbow = landmarks?.[side.elbow];
            const wrist = landmarks?.[side.wrist];
            const hip = landmarks?.[side.hip];
            const ankle = landmarks?.[side.ankle];
            if ([shoulder, hip, ankle].every(point => visible(point, t.visibility))) {
                hasVisibleBody = true;
            }
            if ([elbow, wrist].every(point => visible(point, t.visibility))) {
                hasVisibleSupport = true;
            }
            const required = EXERCISE_LANDMARK_REQUIREMENTS.plank.side[sideIndex];
            if (!visibleRequirement(landmarks, [required], t.visibility)) continue;

            const deltaX = ankle.x - shoulder.x;
            const deltaY = ankle.y - shoulder.y;
            const armAngle = angleAt(shoulder, elbow, wrist);
            const bodyLength = Math.hypot(deltaX, deltaY);
            if (armAngle == null || armAngle < t.minSupportArmAngle) continue;
            if (bodyLength < t.minBodyLength) continue;

            const bodyLineAngle = Math.atan2(Math.abs(deltaY), Math.abs(deltaX)) * 180 / Math.PI;
            const hipDeviation = Math.abs(
                deltaX * (shoulder.y - hip.y) - (shoulder.x - hip.x) * deltaY
            ) / bodyLength;
            const bodyIsAligned =
                bodyLineAngle <= t.maxBodyLineAngle ||
                bodyLineAngle >= t.minFrontalBodyLineAngle;
            if (!bodyIsAligned || hipDeviation > bodyLength * t.maxHipDeviation) {
                continue;
            }

            if (this.lastValidAt != null) {
                const delta = now - this.lastValidAt;
                if (delta > 0) {
                    this.elapsedMs = Math.min(
                        MAX_PLANK_DURATION_SECONDS * 1000,
                        this.elapsedMs + Math.min(delta, t.maxFrameGapMs)
                    );
                }
            }
            this.lastValidAt = now;
            this.isCorrect = true;
            this.feedback = "Nice rep.";
            return this.result(true);
        }

        this.pause();
        this.feedback = !hasVisibleBody
            ? this.lostTrackingLabel
            : !hasVisibleSupport
                ? "Can't see hands."
                : "Get set.";
        return this.result(false);
    }

    result(correct) {
        return {
            count: Math.floor(this.elapsedMs / 1000),
            elapsedMs: this.elapsedMs,
            state: correct ? "holding" : "paused",
            isCorrect: correct,
            feedback: this.feedback
        };
    }
}

export function createExerciseDetector(slug, options = {}) {
    if (slug === "squats") return new SquatDetector(SQUAT_THRESHOLDS, options);
    if (slug === "push-ups") return new PushUpDetector(PUSH_UP_THRESHOLDS, options);
    if (slug === "plank") return new PlankTimerDetector(PLANK_THRESHOLDS, options);
    if (slug === "jumping-jacks") return new JumpingJackDetector(JUMPING_JACK_THRESHOLDS, options);
    if (slug === "skipping-rope") return new SkippingRopeDetector(SKIPPING_ROPE_THRESHOLDS, options);
    if (slug === "pull-ups" && options.frontView) return new FrontPullUpDetector(options);
    if (EXERCISE_THRESHOLDS[slug]) return new ExerciseArmDetector(slug, options);
    return null;
}