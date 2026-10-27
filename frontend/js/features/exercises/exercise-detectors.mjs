const VISIBILITY_THRESHOLD = 0.55;
const SMOOTHING_ALPHA = 0.5;
const MIN_SEGMENT_LENGTH = 0.015;

const LANDMARKS = {
    left: { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 },
    right: { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }
};

export const SQUAT_THRESHOLDS = Object.freeze({
    visibility: VISIBILITY_THRESHOLD,
    standing: 155,
    descending: 145,
    bottom: 105,
    ascending: 125,
    settleMs: 110,
    establishMs: 250,
    returnMs: 150
});

export const PUSH_UP_THRESHOLDS = Object.freeze({
    visibility: VISIBILITY_THRESHOLD,
    starting: 155,
    lowering: 140,
    bottom: 105,
    returning: 125,
    settleMs: 110,
    establishMs: 250,
    returnMs: 150,
    maxBodyLineAngle: 38,
    minFrontViewBodyLineAngle: 52
});

export const PLANK_THRESHOLDS = Object.freeze({
    visibility: 0.6,
    maxBodyLineAngle: 20,
    maxHipDeviation: 0.12,
    minBodyLength: 0.25,
    minSupportArmAngle: 65,
    maxFrameGapMs: 180
});

export const EXERCISE_THRESHOLDS = Object.freeze({
    "pull-ups": {
        visibility: VISIBILITY_THRESHOLD,
        start: 155,
        active: 115,
        bottom: 80,
        return: 125,
        settleMs: 110,
        establishMs: 250,
        returnMs: 150,
        name: "pull-up"
    },
    "biceps-curls": {
        visibility: VISIBILITY_THRESHOLD,
        start: 155,
        active: 125,
        bottom: 65,
        return: 105,
        settleMs: 110,
        establishMs: 250,
        returnMs: 150,
        name: "biceps curl"
    },
    "triceps-extension": {
        visibility: VISIBILITY_THRESHOLD,
        start: 70,
        active: 105,
        bottom: 155,
        return: 120,
        settleMs: 110,
        establishMs: 250,
        returnMs: 150,
        name: "triceps extension"
    },
    "shoulder-press": {
        visibility: VISIBILITY_THRESHOLD,
        start: 100,
        active: 125,
        bottom: 160,
        return: 135,
        settleMs: 110,
        establishMs: 250,
        returnMs: 150,
        name: "shoulder press"
    },
    "lateral-raises": {
        visibility: VISIBILITY_THRESHOLD,
        start: 20,
        active: 55,
        bottom: 100,
        return: 70,
        settleMs: 110,
        establishMs: 250,
        returnMs: 150,
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

function average(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function smoothedAngle(previous, current) {
    return previous == null ? current : previous * (1 - SMOOTHING_ALPHA) + current * SMOOTHING_ALPHA;
}

class RepDetector {
    constructor(thresholds, initialLabel) {
        this.thresholds = thresholds;
        this.initialLabel = initialLabel;
        this.reset();
    }

    reset(count = 0) {
        this.count = count;
        this.resetMovement();
    }

    resetMovement() {
        this.state = "unknown";
        this.filteredAngle = null;
        this.pendingState = null;
        this.pendingSince = 0;
        this.feedback = this.initialLabel;
    }

    loseTracking() {
        this.state = "unknown";
        this.filteredAngle = null;
        this.pendingState = null;
        this.feedback = "Person or required landmarks not reliably visible. Reposition in frame.";
    }

    holdTransition(nextState, now, duration, onTransition) {
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
        super(thresholds, "Stand in view to calibrate the squat monitor.");
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
            this.loseTracking();
            return this.result(null);
        }

        const angle = this.filteredAngle = smoothedAngle(this.filteredAngle, average(angles));
        const t = this.thresholds;

        if (this.state === "unknown") {
            this.feedback = "Stand upright in view to establish your starting position.";
            if (angle >= t.standing) {
                this.holdTransition("standing", now, t.establishMs, () => {
                    this.state = "standing";
                    this.feedback = "Standing position established. Begin a controlled squat.";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "standing") {
            this.feedback = "Standing position established. Begin a controlled squat.";
            if (angle <= t.descending) {
                this.holdTransition("descending", now, t.settleMs, () => {
                    this.state = "descending";
                    this.feedback = "Descending. Continue until a clear bottom position.";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "descending") {
            this.feedback = "Descending. Continue until a clear bottom position.";
            if (angle <= t.bottom) {
                this.holdTransition("bottom", now, t.settleMs, () => {
                    this.state = "bottom";
                    this.feedback = "Bottom position detected. Return to standing.";
                });
            } else if (angle >= t.standing) {
                this.holdTransition("standing", now, t.settleMs, () => {
                    this.state = "standing";
                    this.feedback = "Incomplete squat; return established. Try a fuller movement.";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "bottom") {
            this.feedback = "Bottom position detected. Return to standing.";
            if (angle >= t.ascending) {
                this.holdTransition("ascending", now, t.settleMs, () => {
                    this.state = "ascending";
                    this.feedback = "Ascending. Finish by returning to standing.";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "ascending") {
            this.feedback = "Ascending. Finish by returning to standing.";
            if (angle >= t.standing) {
                this.holdTransition("standing", now, t.returnMs, () => {
                    this.count += 1;
                    this.state = "standing";
                    this.feedback = "Squat completed. Begin the next repetition when ready.";
                });
            } else if (angle <= t.bottom) {
                this.holdTransition("bottom", now, t.settleMs, () => {
                    this.state = "bottom";
                    this.feedback = "Bottom position detected. Return to standing.";
                });
            } else {
                this.clearPending();
            }
        }
        return this.result(angle);
    }
}

export class PushUpDetector extends RepDetector {
    constructor(thresholds = PUSH_UP_THRESHOLDS) {
        super(thresholds, "Face the camera or turn side-on, then hold a straight starting position in view.");
    }

    update(landmarks, now = performance.now()) {
        const candidates = [];
        for (const side of Object.values(LANDMARKS)) {
            const shoulder = landmarks?.[side.shoulder];
            const elbow = landmarks?.[side.elbow];
            const wrist = landmarks?.[side.wrist];
            const hip = landmarks?.[side.hip];
            const ankle = landmarks?.[side.ankle];
            if (![shoulder, elbow, wrist, hip, ankle].every(point =>
                visible(point, this.thresholds.visibility)
            )) continue;

            const armAngle = angleAt(shoulder, elbow, wrist);
            const torsoLength = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
            if (armAngle == null || torsoLength < 0.04) continue;
            const bodyLineAngle = Math.atan2(
                Math.abs(shoulder.y - ankle.y),
                Math.abs(shoulder.x - ankle.x)
            ) * 180 / Math.PI;
            const sideView = bodyLineAngle <= this.thresholds.maxBodyLineAngle;
            const frontView = bodyLineAngle >= this.thresholds.minFrontViewBodyLineAngle;
            if (!sideView && !frontView) continue;
            candidates.push(armAngle);
        }
        if (!candidates.length) {
            this.loseTracking();
            return this.result(null);
        }

        const angle = this.filteredAngle = smoothedAngle(this.filteredAngle, average(candidates));
        const t = this.thresholds;

        if (this.state === "unknown") {
            this.feedback = "Face the camera or turn side-on and hold a straight starting position to calibrate.";
            if (angle >= t.starting) {
                this.holdTransition("starting", now, t.establishMs, () => {
                    this.state = "starting";
                    this.feedback = "Starting position established. Lower with control.";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "starting") {
            this.feedback = "Starting position established. Lower with control.";
            if (angle <= t.lowering) {
                this.holdTransition("lowering", now, t.settleMs, () => {
                    this.state = "lowering";
                    this.feedback = "Lowering. Continue to a clear bottom position.";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "lowering") {
            this.feedback = "Lowering. Continue to a clear bottom position.";
            if (angle <= t.bottom) {
                this.holdTransition("bottom", now, t.settleMs, () => {
                    this.state = "bottom";
                    this.feedback = "Bottom position detected. Press back to the starting position.";
                });
            } else if (angle >= t.starting) {
                this.holdTransition("starting", now, t.settleMs, () => {
                    this.state = "starting";
                    this.feedback = "Incomplete push-up; return established. Try a fuller movement.";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "bottom") {
            this.feedback = "Bottom position detected. Press back to the starting position.";
            if (angle >= t.returning) {
                this.holdTransition("returning", now, t.settleMs, () => {
                    this.state = "returning";
                    this.feedback = "Returning. Finish by extending your arms.";
                });
            } else {
                this.clearPending();
            }
        } else if (this.state === "returning") {
            this.feedback = "Returning. Finish by extending your arms.";
            if (angle >= t.starting) {
                this.holdTransition("starting", now, t.returnMs, () => {
                    this.count += 1;
                    this.state = "starting";
                    this.feedback = "Push-up completed. Begin the next repetition when ready.";
                });
            } else if (angle <= t.bottom) {
                this.holdTransition("bottom", now, t.settleMs, () => {
                    this.state = "bottom";
                    this.feedback = "Bottom position detected. Press back to the starting position.";
                });
            } else {
                this.clearPending();
            }
        }
        return this.result(angle);
    }
}

class AngleCycleDetector extends RepDetector {
    constructor(thresholds, initialLabel, phaseLabels) {
        super(thresholds, initialLabel);
        this.phaseLabels = phaseLabels;
    }

    updateAngle(angle, now) {
        if (!Number.isFinite(angle)) {
            this.loseTracking();
            return this.result(null);
        }
        const t = this.thresholds;
        const filtered = this.filteredAngle = smoothedAngle(this.filteredAngle, angle);
        const descending = t.start > t.bottom;

        if (this.state === "unknown") {
            this.feedback = this.initialLabel;
            const atStart = descending
                ? filtered >= t.start
                : filtered <= t.start;
            if (atStart) {
                this.holdTransition("start", now, t.establishMs, () => {
                    this.state = "start";
                    this.feedback = this.phaseLabels.start;
                });
            } else this.clearPending();
        } else if (this.state === "start") {
            this.feedback = this.phaseLabels.start;
            const movementStarted = descending
                ? filtered <= t.active
                : filtered >= t.active;
            if (movementStarted) {
                this.holdTransition("active", now, t.settleMs, () => {
                    this.state = "active";
                    this.feedback = this.phaseLabels.active;
                });
            } else this.clearPending();
        } else if (this.state === "active") {
            this.feedback = this.phaseLabels.active;
            const reachedBottom = descending
                ? filtered <= t.bottom
                : filtered >= t.bottom;
            if (reachedBottom) {
                this.holdTransition("bottom", now, t.settleMs, () => {
                    this.state = "bottom";
                    this.feedback = this.phaseLabels.bottom;
                });
            } else if (descending
                ? filtered >= t.start
                : filtered <= t.start) {
                this.holdTransition("start", now, t.settleMs, () => {
                    this.state = "start";
                    this.feedback = `${this.phaseLabels.start} Movement was incomplete; try a fuller range.`;
                });
            } else this.clearPending();
        } else if (this.state === "bottom") {
            this.feedback = this.phaseLabels.bottom;
            const returning = descending
                ? filtered >= t.return
                : filtered <= t.return;
            if (returning) {
                this.holdTransition("returning", now, t.settleMs, () => {
                    this.state = "returning";
                    this.feedback = this.phaseLabels.returning;
                });
            } else this.clearPending();
        } else if (this.state === "returning") {
            this.feedback = this.phaseLabels.returning;
            const returned = descending
                ? filtered >= t.start
                : filtered <= t.start;
            const returnedAgain = descending
                ? filtered <= t.bottom
                : filtered >= t.bottom;
            if (returned) {
                this.holdTransition("start", now, t.returnMs, () => {
                    this.count += 1;
                    this.state = "start";
                    this.feedback = `${t.name} completed. Begin the next repetition when ready.`;
                });
            } else if (returnedAgain) {
                this.holdTransition("bottom", now, t.settleMs, () => {
                    this.state = "bottom";
                    this.feedback = this.phaseLabels.bottom;
                });
            } else this.clearPending();
        }
        return this.result(filtered);
    }
}

function armCycleAngles(landmarks, thresholds) {
    const values = [];
    for (const [name, side] of Object.entries(LANDMARKS)) {
        const shoulder = landmarks?.[side.shoulder];
        const elbow = landmarks?.[side.elbow];
        const wrist = landmarks?.[side.wrist];
        const hip = landmarks?.[side.hip];
        if (![shoulder, elbow, wrist, hip].every(point =>
            visible(point, thresholds.visibility)
        )) continue;
        const angle = angleAt(shoulder, elbow, wrist);
        if (angle == null) continue;
        const upperArmLength = Math.hypot(shoulder.x - elbow.x, shoulder.y - elbow.y);
        const torsoLength = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
        if (upperArmLength < 0.025 || torsoLength < 0.06) continue;
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

function exerciseAngleConfig(slug) {
    const config = EXERCISE_THRESHOLDS[slug];
    if (!config) return null;
    const phaseLabels = slug === "pull-ups"
        ? {
            start: "Hang with arms extended in view. Begin pulling upward.",
            active: "Pulling up. Continue toward a clear top position.",
            bottom: "Top position detected. Lower with control.",
            returning: "Lowering. Finish by returning to an extended hang."
        }
        : slug === "biceps-curls"
            ? {
                start: "Stand with arms extended and elbows visible. Begin the curl.",
                active: "Curling. Continue toward a clear bent-elbow position.",
                bottom: "Curl position detected. Lower with control.",
                returning: "Lowering. Finish by extending the arm."
            }
            : slug === "triceps-extension"
                ? {
                    start: "Keep the upper arm steady with the elbow bent. Begin extending.",
                    active: "Extending the elbow. Continue to a clear straight-arm position.",
                    bottom: "Arm extension detected. Bend the elbow with control.",
                    returning: "Bending the elbow. Return to the starting position."
                }
                : slug === "shoulder-press"
                    ? {
                        start: "Hold your arms below shoulder height in view. Begin pressing up.",
                        active: "Pressing upward. Continue to a clear overhead position.",
                        bottom: "Overhead position detected. Lower with control.",
                        returning: "Lowering. Finish with arms below shoulder height."
                    }
                    : {
                        start: "Keep arms at your sides and shoulders visible. Begin raising.",
                        active: "Raising your arms. Continue toward shoulder height.",
                        bottom: "Raised-arm position detected. Lower with control.",
                        returning: "Lowering. Finish with arms back at your sides."
                    };
    return { config, phaseLabels };
}

export class ExerciseArmDetector extends AngleCycleDetector {
    constructor(slug) {
        const setup = exerciseAngleConfig(slug);
        if (!setup) throw new Error(`No arm detector configuration exists for ${slug}.`);
        super(
            setup.config,
            `Get into the starting position for a ${setup.config.name}.`,
            setup.phaseLabels
        );
        this.sideDetectors = Object.fromEntries(
            Object.keys(LANDMARKS).map(side => [side, new AngleCycleDetector(
                setup.config,
                `Get into the starting position for a ${setup.config.name}.`,
                setup.phaseLabels
            )])
        );
        this.lastRepAt = -Infinity;
    }

    reset(count = 0) {
        super.reset(count);
        for (const detector of Object.values(this.sideDetectors || {})) {
            detector.reset();
        }
        this.lastRepAt = -Infinity;
    }

    loseTracking() {
        super.loseTracking();
        for (const detector of Object.values(this.sideDetectors || {})) {
            detector.loseTracking();
        }
    }

    update(landmarks, now = performance.now()) {
        const angles = this.thresholds.name === "lateral raise"
            ? shoulderRaiseAngles(landmarks, this.thresholds)
            : armCycleAngles(landmarks, this.thresholds);
        const bySide = new Map(angles.map(({ side, angle }) => [side, angle]));
        const completed = [];
        for (const [side, detector] of Object.entries(this.sideDetectors)) {
            const angle = bySide.get(side);
            if (angle == null) {
                detector.loseTracking();
                continue;
            }
            const previousCount = detector.count;
            detector.updateAngle(angle, now);
            if (detector.count > previousCount) completed.push(detector);
        }

        if (completed.length && now - this.lastRepAt > 250) {
            this.count += 1;
            this.lastRepAt = now;
        }

        const activeDetectors = Object.values(this.sideDetectors)
            .filter(detector => detector.state !== "unknown");
        const current = activeDetectors.sort((first, second) =>
            ["start", "active", "bottom", "returning"].indexOf(second.state) -
            ["start", "active", "bottom", "returning"].indexOf(first.state)
        )[0];
        const angle = average(angles.map(value => value.angle));
        this.state = current?.state || "unknown";
        this.feedback = current?.feedback ||
            "Person or required landmarks not reliably visible. Reposition in frame.";
        this.filteredAngle = angle;
        return this.result(angle);
    }
}

export const JUMPING_JACK_THRESHOLDS = Object.freeze({
    visibility: VISIBILITY_THRESHOLD,
    armsDownMax: 0.35,
    armsUpMin: 0.75,
    feetClosedMax: 0.55,
    feetOpenMin: 1.15,
    settleMs: 100,
    establishMs: 250,
    returnMs: 130,
    maxFrameGapMs: 350
});

export class JumpingJackDetector extends RepDetector {
    constructor(thresholds = JUMPING_JACK_THRESHOLDS) {
        super(thresholds, "Face the camera with your upper body and feet in view.");
    }

    update(landmarks, now = performance.now()) {
        const t = this.thresholds;
        const required = [11, 12, 15, 16, 23, 24, 27, 28];
        if (!required.every(index => visible(landmarks?.[index], t.visibility))) {
            this.loseTracking();
            return this.result(null);
        }
        const shoulderWidth = Math.abs(landmarks[11].x - landmarks[12].x);
        const hipWidth = Math.abs(landmarks[23].x - landmarks[24].x);
        if (shoulderWidth < 0.045 || hipWidth < 0.025) {
            this.loseTracking();
            return this.result(null);
        }

        const armHeight = (
            (landmarks[11].y - landmarks[15].y) +
            (landmarks[12].y - landmarks[16].y)
        ) / (2 * shoulderWidth);
        const legWidth = Math.abs(landmarks[27].x - landmarks[28].x) / hipWidth;
        const armsUp = armHeight >= t.armsUpMin;
        const armsDown = armHeight <= t.armsDownMax;
        const feetOpen = legWidth >= t.feetOpenMin;
        const feetClosed = legWidth <= t.feetClosedMax;
        const jumping = armsUp && feetOpen;
        const closed = armsDown && feetClosed;

        if (this.state === "unknown") {
            this.feedback = "Stand with arms down and feet together to establish the starting position.";
            if (closed) {
                this.holdTransition("closed", now, t.establishMs, () => {
                    this.state = "closed";
                    this.feedback = "Starting position established. Jump and raise both arms.";
                });
            } else this.clearPending();
        } else if (this.state === "closed") {
            this.feedback = "Starting position established. Jump and raise both arms.";
            if (jumping) {
                this.holdTransition("open", now, t.settleMs, () => {
                    this.state = "open";
                    this.feedback = "Open position detected. Return to arms down and feet together.";
                });
            } else this.clearPending();
        } else if (this.state === "open") {
            this.feedback = "Open position detected. Return to arms down and feet together.";
            if (closed) {
                this.holdTransition("closed", now, t.returnMs, () => {
                    this.count += 1;
                    this.state = "closed";
                    this.feedback = "Jumping jack completed. Begin the next repetition when ready.";
                });
            } else this.clearPending();
        }
        return this.result(jumping ? "open" : closed ? "closed" : this.state);
    }
}

export const SKIPPING_ROPE_THRESHOLDS = Object.freeze({
    visibility: VISIBILITY_THRESHOLD,
    minFootClearance: 0.1,
    landingTolerance: 0.04,
    settleMs: 60,
    establishMs: 250,
    returnMs: 90,
    maxFrameGapMs: 300
});

export class SkippingRopeDetector extends RepDetector {
    constructor(thresholds = SKIPPING_ROPE_THRESHOLDS) {
        super(thresholds, "Stand upright with hips and both ankles visible to establish a baseline.");
        this.baselineHipY = null;
    }

    reset(count = 0) {
        super.reset(count);
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
            this.loseTracking();
            return this.result(null);
        }
        const leftLeg = angleAt(landmarks[23], landmarks[25], landmarks[27]);
        const rightLeg = angleAt(landmarks[24], landmarks[26], landmarks[28]);
        const hipY = (landmarks[23].y + landmarks[24].y) / 2;
        const torsoLength = (
            Math.hypot(landmarks[11].x - landmarks[23].x, landmarks[11].y - landmarks[23].y) +
            Math.hypot(landmarks[12].x - landmarks[24].x, landmarks[12].y - landmarks[24].y)
        ) / 2;
        if (leftLeg == null || rightLeg == null ||
            Math.abs(leftLeg - rightLeg) > 65 ||
            Math.abs(landmarks[27].x - landmarks[28].x) > 0.3 ||
            torsoLength < MIN_SEGMENT_LENGTH) {
            this.loseTracking();
            return this.result(null);
        }

        if (this.state === "unknown") {
            this.feedback = "Stand upright with hips and both ankles visible to establish a baseline.";
            if (this.baselineHipY == null) this.baselineHipY = hipY;
            else this.baselineHipY = this.baselineHipY * 0.8 + hipY * 0.2;
            const postureReady = leftLeg > 145 && rightLeg > 145;
            if (postureReady) {
                this.holdTransition("grounded", now, t.establishMs, () => {
                    this.state = "grounded";
                    this.baselineHipY = hipY;
                    this.feedback = "Baseline established. Jump lightly with both feet together.";
                });
            } else this.clearPending();
        } else {
            const rise = (this.baselineHipY - hipY) / torsoLength;
            if (this.state === "grounded") {
                this.feedback = "Jump lightly with both feet together. Counts require a clear rise and landing.";
                if (rise >= t.minFootClearance) {
                    this.holdTransition("airborne", now, t.settleMs, () => {
                        this.state = "airborne";
                        this.feedback = "Small jump detected. Land with both feet together.";
                    });
                } else {
                    this.clearPending();
                    this.baselineHipY = this.baselineHipY * 0.97 + hipY * 0.03;
                }
            } else if (this.state === "airborne") {
                this.feedback = "Small jump detected. Land with both feet together.";
                if (rise <= t.landingTolerance) {
                    this.holdTransition("grounded", now, t.returnMs, () => {
                        this.count += 1;
                        this.state = "grounded";
                        this.baselineHipY = hipY;
                        this.feedback = "Jump and landing detected. Continue at a steady pace.";
                    });
                } else this.clearPending();
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
        this.feedback = "Turn side-on and get into a straight plank position.";
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
        let hasStableSupport = false;

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
            hasStableSupport = true;
            if (bodyLength < t.minBodyLength) continue;
            const bodyLineAngle = Math.atan2(Math.abs(deltaY), Math.abs(deltaX)) * 180 / Math.PI;
            const hipDeviation = Math.abs(
                deltaX * (shoulder.y - hip.y) - (shoulder.x - hip.x) * deltaY
            ) / bodyLength;
            if (bodyLineAngle > t.maxBodyLineAngle || hipDeviation > bodyLength * t.maxHipDeviation) {
                continue;
            }

            if (this.lastValidAt != null) {
                const delta = now - this.lastValidAt;
                if (delta > 0 && delta <= t.maxFrameGapMs) {
                    this.elapsedMs += delta;
                }
            }
            this.lastValidAt = now;
            this.isCorrect = true;
            this.feedback = "Plank posture looks aligned. Keep holding; timer counts only while posture stays aligned.";
            return this.result(true);
        }

        this.pause();
        this.feedback = !hasVisibleBody
            ? "Body landmarks are not reliably visible. Turn side-on and fit your full body in frame."
            : !hasVisibleSupport
                ? "Keep an arm and hand visible so the plank position can be tracked."
                : !hasStableSupport
                    ? "Keep your arm support stable and visible while holding the plank."
                : "Form is outside the plank alignment range. Adjust your body; the timer is paused.";
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
