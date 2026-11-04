const VISIBILITY_THRESHOLD = 0.35;
const SMOOTHING_ALPHA = 0.55;
const FAST_MOVEMENT_DELTA = 22;
const FAST_MOVEMENT_ALPHA = 0.85;
const MIN_SEGMENT_LENGTH = 0.015;
const DEFAULT_LOST_GRACE_MS = 450;
const DEFAULT_MIN_REP_INTERVAL_MS = 550;

const LANDMARKS = {
    left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
    right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }
};

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
    constructor(thresholds = SQUAT_THRESHOLDS) {
        super(thresholds, "Get set.", "Can't see legs.");
    }

    loseTracking() {
        this.resetMovement();
        this.feedback = this.lostTrackingLabel;
        return true;
    }

    update(landmarks, now = performance.now()) {
        const angles = [];
        for (const side of Object.values(LANDMARKS)) {
            const hip = landmarks?.[side.hip];
            const knee = landmarks?.[side.knee];
            const ankle = landmarks?.[side.ankle];
            if (![hip, knee, ankle].every(point => visible(point, this.thresholds.visibility))) continue;
            const angle = angleAt(hip, knee, ankle);
            if (angle != null) angles.push(angle);
        }
        if (!angles.length) {
            this.loseTracking(now);
            return this.result(this.filteredAngle);
        }

        this.lastSeenAt = now;
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
                this.pendingState = null;
                this.state = "bottom";
            } else if (angle <= t.descending) {
                this.state = "descending";
            } else if (angle >= t.standing) {
                this.state = "standing";
            }
        } else if (this.state === "bottom" || this.state === "ascending") {
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
    constructor(thresholds = PUSH_UP_THRESHOLDS) {
        super(thresholds, "Get set.", "Can't see arm.");
        this.startShoulderWristY = null;
    }

    resetMovement() {
        super.resetMovement();
        this.startShoulderWristY = null;
        this.expectedSideCount = null;
    }

    update(landmarks, now = performance.now()) {
        const t = this.thresholds;
        const validSides = [];

        for (const side of Object.values(LANDMARKS)) {
            const shoulder = landmarks?.[side.shoulder];
            const elbow = landmarks?.[side.elbow];
            const wrist = landmarks?.[side.wrist];

            if (![shoulder, elbow, wrist].every(p => visible(p, t.visibility))) continue;

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
                this.expectedSideCount = null;
            }
            return this.result(this.filteredAngle);
        }

        this.lastSeenAt = now;
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

        const angle = this.filteredAngle = smoothedAngle(this.filteredAngle, rawAngle);
        const hasRealChestDrop = this.startShoulderWristY == null ||
            (this.startShoulderWristY - currentShoulderWristY) >= t.minShoulderDropRatio;

        if (this.state === "unknown") {
            this.feedback = "Get set.";
            if (angle >= t.starting) {
                this.holdTransition("starting", now, t.establishMs, () => {
                    this.state = "starting";
                    this.startShoulderWristY = currentShoulderWristY;
                    this.expectedSideCount = validSides.length;
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "starting" || this.state === "lowering") {
            if (angle >= t.starting) {
                this.startShoulderWristY = this.startShoulderWristY == null
                    ? currentShoulderWristY
                    : Math.max(this.startShoulderWristY * 0.9 + currentShoulderWristY * 0.1, currentShoulderWristY);
                this.state = "starting";
            } else if (angle <= t.bottom && hasRealChestDrop) {
                this.pendingState = null;
                this.state = "bottom";
            } else if (angle <= t.lowering) {
                this.state = "lowering";
            }
        } else if (this.state === "bottom" || this.state === "returning") {
            if (angle >= t.starting) {
                if (
                    this.expectedSideCount != null &&
                    validSides.length < this.expectedSideCount
                ) {
                    this.clearPending();
                    this.state = "returning";
                } else {
                    this.holdTransition("starting", now, t.returnMs, () => {
                        this.state = "starting";
                        this.startShoulderWristY = currentShoulderWristY;
                        this.completeRep(now);
                    });
                }
            } else if (angle >= t.returning) {
                this.state = "returning";
            } else if (angle <= t.bottom) {
                this.state = "bottom";
            }
        }

        return this.result(angle);
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

        this.lastSeenAt = now;
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
                this.pendingState = null;
                this.state = "bottom";
            } else if (atActive) {
                this.state = "active";
            } else if (atStart) {
                this.state = "start";
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

function armCycleAngles(landmarks, thresholds) {
    const values = [];
    const needsHip = thresholds.name === "pull-up";
    for (const [name, side] of Object.entries(LANDMARKS)) {
        const shoulder = landmarks?.[side.shoulder];
        const elbow = landmarks?.[side.elbow];
        const wrist = landmarks?.[side.wrist];
        const hip = landmarks?.[side.hip];
        if (![shoulder, elbow, wrist].every(point =>
            visible(point, thresholds.visibility)
        ) || (needsHip && !visible(hip, thresholds.visibility))) continue;
        const angle = angleAt(shoulder, elbow, wrist);
        if (angle == null) continue;
        const upperArmLength = Math.hypot(shoulder.x - elbow.x, shoulder.y - elbow.y);
        if (upperArmLength < 0.02) continue;
        values.push({ side: name, angle });
    }
    return values;
}

function shoulderRaiseAngles(landmarks, thresholds) {
    const values = [];
    for (const [name, side] of Object.entries(LANDMARKS)) {
        const shoulder = landmarks?.[side.shoulder];
        const elbow = landmarks?.[side.elbow];
        const hip = landmarks?.[side.hip];
        if (![shoulder, elbow, hip].every(point =>
            visible(point, thresholds.visibility)
        )) continue;
        const angle = angleAt(hip, shoulder, elbow);
        if (angle != null) values.push({ side: name, angle });
    }
    return values;
}

export class ExerciseArmDetector extends AngleCycleDetector {
    constructor(slug) {
        const config = EXERCISE_THRESHOLDS[slug];
        if (!config) throw new Error(`No arm detector configuration exists for ${slug}.`);
        const lostTrackingLabel = slug === "pull-ups"
            ? "Can't see hands/hips."
            : slug === "lateral-raises"
                ? "Can't see arms."
                : "Can't see hands.";

        super(config, lostTrackingLabel);
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
            ? shoulderRaiseAngles(landmarks, this.thresholds)
            : armCycleAngles(landmarks, this.thresholds);

        if (!angles.length) {
            this.loseTracking(now);
            return this.result(this.filteredAngle);
        }

        this.lastSeenAt = now;
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
    constructor(thresholds = JUMPING_JACK_THRESHOLDS) {
        super(thresholds, "Get set.", "Can't see hands/legs.");
    }

    update(landmarks, now = performance.now()) {
        const t = this.thresholds;
        const required = [11, 12, 15, 16, 23, 24, 27, 28];
        if (!required.every(index => visible(landmarks?.[index], t.visibility))) {
            this.loseTracking(now);
            return this.result(null);
        }
        const shoulderWidth = Math.abs(landmarks[11].x - landmarks[12].x);
        const hipWidth = Math.abs(landmarks[23].x - landmarks[24].x);
        if (shoulderWidth < 0.02 || hipWidth < 0.015) {
            this.loseTracking(now);
            return this.result(null);
        }

        this.lastSeenAt = now;
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
    constructor(thresholds = SKIPPING_ROPE_THRESHOLDS) {
        super(thresholds, "Get set.", "Can't see legs.");
        this.baselineHipY = null;
    }

    resetMovement() {
        super.resetMovement();
        this.baselineHipY = null;
    }

    update(landmarks, now = performance.now()) {
        const t = this.thresholds;
        const required = [11, 12, 23, 24, 25, 26, 27, 28];
        if (!required.every(index => visible(landmarks?.[index], t.visibility))) {
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

        this.lastSeenAt = now;

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
    constructor(thresholds = PLANK_THRESHOLDS) {
        this.thresholds = thresholds;
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

        for (const side of sideCandidates) {
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
            if (![shoulder, elbow, wrist, hip, ankle].every(point =>
                visible(point, t.visibility)
            )) continue;

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
                    this.elapsedMs += Math.min(delta, t.maxFrameGapMs);
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

export function createExerciseDetector(slug) {
    if (slug === "squats") return new SquatDetector();
    if (slug === "push-ups") return new PushUpDetector();
    if (slug === "plank") return new PlankTimerDetector();
    if (slug === "jumping-jacks") return new JumpingJackDetector();
    if (slug === "skipping-rope") return new SkippingRopeDetector();
    if (EXERCISE_THRESHOLDS[slug]) return new ExerciseArmDetector(slug);
    return null;
}