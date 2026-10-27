import test from "node:test";
import assert from "node:assert/strict";
import {
    ExerciseArmDetector,
    JumpingJackDetector,
    PlankTimerDetector,
    PushUpDetector,
    SkippingRopeDetector,
    SquatDetector,
    createExerciseDetector
} from "../js/features/exercises/exercise-detectors.mjs";

function pose() {
    return Array.from({ length: 33 }, () => ({
        x: 0.5,
        y: 0.5,
        visibility: 0.95
    }));
}

function setPoints(landmarks, points) {
    for (const [index, point] of Object.entries(points)) {
        landmarks[index] = { ...point, visibility: 0.95 };
    }
    return landmarks;
}

function scalePose(landmarks, scale) {
    return landmarks.map(point => ({
        ...point,
        x: 0.5 + (point.x - 0.5) * scale,
        y: 0.5 + (point.y - 0.5) * scale
    }));
}

function squatPose(angle) {
    const landmarks = pose();
    const hip = angle === 180
        ? { x: 0.5, y: 0.35 }
        : angle === 90
            ? { x: 0.7, y: 0.55 }
            : { x: 0.65, y: 0.397 };
    return setPoints(landmarks, {
        23: hip,
        25: { x: 0.5, y: 0.55 },
        27: { x: 0.5, y: 0.75 }
    });
}

function pushUpPose(angle) {
    const landmarks = pose();
    const wristRotation = (180 - angle) * Math.PI / 180;
    const points = {
        11: { x: 0.25, y: 0.5 },
        13: { x: 0.45, y: 0.5 },
        15: {
            x: 0.45 + 0.2 * Math.cos(wristRotation),
            y: 0.5 + 0.2 * Math.sin(wristRotation)
        },
        23: { x: 0.55, y: 0.51 },
        27: { x: 0.85, y: 0.52 }
    };
    return setPoints(landmarks, points);
}

function frontFacingPushUpPose(angle) {
    const landmarks = pose();
    const wristRotation = (180 - angle) * Math.PI / 180;
    return setPoints(landmarks, {
        11: { x: 0.4, y: 0.22 },
        13: { x: 0.4, y: 0.42 },
        15: {
            x: 0.4 + 0.2 * Math.sin(wristRotation),
            y: 0.42 + 0.2 * Math.cos(wristRotation)
        },
        23: { x: 0.45, y: 0.52 },
        27: { x: 0.48, y: 0.88 },
        12: { x: 0.6, y: 0.22 },
        14: { x: 0.6, y: 0.42 },
        16: {
            x: 0.6 - 0.2 * Math.sin(wristRotation),
            y: 0.42 + 0.2 * Math.cos(wristRotation)
        },
        24: { x: 0.55, y: 0.52 },
        28: { x: 0.52, y: 0.88 }
    });
}

function plankPose(hipY = 0.5) {
    const landmarks = pose();
    return setPoints(landmarks, {
        11: { x: 0.2, y: 0.5 },
        13: { x: 0.3, y: 0.55 },
        15: { x: 0.4, y: 0.55 },
        23: { x: 0.5, y: hipY },
        27: { x: 0.8, y: 0.5 },
        12: { x: 0.2, y: 0.5 },
        14: { x: 0.3, y: 0.55 },
        16: { x: 0.4, y: 0.55 },
        24: { x: 0.5, y: hipY },
        28: { x: 0.8, y: 0.5 }
    });
}

function armExercisePose(slug, angle) {
    const landmarks = pose();
    for (const side of [
        { shoulder: 11, elbow: 13, wrist: 15, hip: 23, direction: 1 },
        { shoulder: 12, elbow: 14, wrist: 16, hip: 24, direction: -1 }
    ]) {
        const shoulder = { x: 0.5 + side.direction * 0.045, y: 0.32 };
        const hip = { x: shoulder.x, y: 0.62 };
        let elbow;
        let wrist;
        if (slug === "lateral-raises") {
            const radians = angle * Math.PI / 180;
            elbow = {
                x: shoulder.x + side.direction * 0.2 * Math.sin(radians),
                y: shoulder.y + 0.2 * Math.cos(radians)
            };
            wrist = {
                x: elbow.x + side.direction * 0.18 * Math.sin(radians),
                y: elbow.y + 0.18 * Math.cos(radians)
            };
        } else {
            elbow = { x: shoulder.x, y: 0.52 };
            const radians = angle * Math.PI / 180;
            wrist = {
                x: elbow.x + side.direction * 0.2 * Math.sin(radians),
                y: elbow.y - 0.2 * Math.cos(radians)
            };
        }
        landmarks[side.shoulder] = { ...shoulder, visibility: 0.95 };
        landmarks[side.elbow] = { ...elbow, visibility: 0.95 };
        landmarks[side.wrist] = { ...wrist, visibility: 0.95 };
        landmarks[side.hip] = { ...hip, visibility: 0.95 };
    }
    return landmarks;
}

function hideArmSide(landmarks, side) {
    const indexes = side === "left" ? [11, 13, 15, 23] : [12, 14, 16, 24];
    for (const index of indexes) landmarks[index].visibility = 0.1;
    return landmarks;
}

function jumpingJackPose(open) {
    const landmarks = pose();
    const points = {
        11: { x: 0.42, y: 0.5 }, 12: { x: 0.58, y: 0.5 },
        15: { x: 0.18, y: open ? 0.12 : 0.55 },
        16: { x: 0.82, y: open ? 0.12 : 0.55 },
        23: { x: 0.46, y: 0.62 }, 24: { x: 0.54, y: 0.62 },
        27: { x: open ? 0.25 : 0.499, y: 0.9 },
        28: { x: open ? 0.75 : 0.501, y: 0.9 }
    };
    return setPoints(landmarks, points);
}

function skippingRopePose(jumping) {
    const landmarks = pose();
    const hipY = jumping ? 0.49 : 0.55;
    return setPoints(landmarks, {
        11: { x: 0.45, y: hipY - 0.2 }, 12: { x: 0.55, y: hipY - 0.2 },
        23: { x: 0.46, y: hipY }, 24: { x: 0.54, y: hipY },
        25: { x: 0.46, y: hipY + 0.13 }, 26: { x: 0.54, y: hipY + 0.13 },
        27: { x: 0.46, y: hipY + 0.26 }, 28: { x: 0.54, y: hipY + 0.26 }
    });
}

function feed(detector, landmarks, start, frames = 8) {
    let result;
    for (let frame = 0; frame < frames; frame += 1) {
        result = detector.update(landmarks, start + frame * 100);
    }
    return result;
}

test("squat detector counts one full cycle and does not count a partial squat", () => {
    const detector = new SquatDetector();
    feed(detector, squatPose(180), 0);
    feed(detector, squatPose(140), 800);
    assert.equal(detector.count, 0);
    feed(detector, squatPose(180), 1600);
    assert.equal(detector.count, 0);

    feed(detector, squatPose(140), 2400);
    feed(detector, squatPose(90), 3200);
    assert.equal(detector.count, 0);
    feed(detector, squatPose(140), 4000);
    feed(detector, squatPose(180), 4800);
    assert.equal(detector.count, 1);
    feed(detector, squatPose(180), 5600);
    assert.equal(detector.count, 1);
});

test("tracking loss resets squat calibration without producing phantom repetitions", () => {
    const detector = new SquatDetector();
    feed(detector, squatPose(180), 0);
    feed(detector, squatPose(140), 800);
    feed(detector, squatPose(90), 1600);
    detector.update(pose().map(() => ({ x: 0.5, y: 0.5, visibility: 0.1 })), 2400);
    assert.equal(detector.count, 0);
    feed(detector, squatPose(180), 2500);
    assert.equal(detector.count, 0);
});

test("squat count survives a monitoring pause while movement calibration resets", () => {
    const detector = new SquatDetector();
    feed(detector, squatPose(180), 0);
    feed(detector, squatPose(140), 800);
    feed(detector, squatPose(90), 1600);
    feed(detector, squatPose(140), 2400);
    feed(detector, squatPose(180), 3200);
    assert.equal(detector.count, 1);

    detector.resetMovement();
    feed(detector, squatPose(180), 4100);
    feed(detector, squatPose(140), 4900);
    feed(detector, squatPose(90), 5700);
    feed(detector, squatPose(140), 6500);
    feed(detector, squatPose(180), 7300);
    assert.equal(detector.count, 2);
});

test("push-up detector counts a completed cycle once and rejects an incomplete movement", () => {
    const detector = new PushUpDetector();
    feed(detector, pushUpPose(180), 0);
    feed(detector, pushUpPose(130), 800);
    feed(detector, pushUpPose(180), 1600);
    assert.equal(detector.count, 0);

    feed(detector, pushUpPose(130), 2400);
    feed(detector, pushUpPose(90), 3200);
    feed(detector, pushUpPose(130), 4000);
    feed(detector, pushUpPose(180), 4800);
    assert.equal(detector.count, 1);
    feed(detector, pushUpPose(180), 5600);
    assert.equal(detector.count, 1);
});

test("push-up detector counts a full cycle when facing the camera", () => {
    const detector = new PushUpDetector();
    let time = 0;
    for (const angle of [180, 130, 90, 130, 180, 180]) {
        feed(detector, frontFacingPushUpPose(angle), time, 6);
        time += 600;
    }
    assert.equal(detector.count, 1);
});

test("push-up detector pauses when the body landmarks are unreliable", () => {
    const detector = new PushUpDetector();
    feed(detector, pushUpPose(180), 0);
    feed(detector, pushUpPose(130), 800);
    feed(detector, pushUpPose(90), 1600);
    const unreliable = pushUpPose(180);
    unreliable[13].visibility = 0.1;
    detector.update(unreliable, 2400);
    assert.equal(detector.count, 0);
    assert.match(detector.feedback, /not reliably visible/);
});

test("both detectors count a faster full cycle without counting a hold twice", () => {
    const squat = new SquatDetector();
    let time = 0;
    for (const angle of [180, 140, 90, 140, 180, 180]) {
        feed(squat, squatPose(angle), time, 4);
        time += 400;
    }
    assert.equal(squat.count, 1);

    const pushUp = new PushUpDetector();
    time = 0;
    for (const angle of [180, 130, 90, 130, 180, 180]) {
        feed(pushUp, pushUpPose(angle), time, 4);
        time += 400;
    }
    assert.equal(pushUp.count, 1);
});

test("plank timer accrues only while posture is aligned and visible", () => {
    const detector = new PlankTimerDetector();
    detector.update(plankPose(), 0);
    detector.update(plankPose(), 110);
    assert.equal(detector.elapsedMs, 110);

    const badForm = detector.update(plankPose(0.68), 220);
    assert.equal(badForm.isCorrect, false);
    assert.equal(detector.elapsedMs, 110);

    detector.update(plankPose(), 330);
    detector.update(plankPose(), 440);
    assert.equal(detector.elapsedMs, 220);

    const lost = detector.update(null, 550);
    assert.equal(lost.isCorrect, false);
    detector.update(plankPose(), 660);
    assert.equal(detector.elapsedMs, 220);
    detector.update(plankPose(), 770);
    assert.equal(detector.elapsedMs, 330);
});

test("plank timer rejects front-on poses and unreliable arm support", () => {
    const detector = new PlankTimerDetector();
    const frontOn = plankPose();
    for (const index of [11, 12, 23, 24, 27, 28]) frontOn[index].x = 0.5;
    assert.equal(detector.update(frontOn, 0).isCorrect, false);

    const missingArms = plankPose();
    for (const index of [13, 14, 15, 16]) missingArms[index].visibility = 0.1;
    assert.equal(detector.update(missingArms, 100).isCorrect, false);
    assert.equal(detector.elapsedMs, 0);
});

test("exercise-specific arm detectors count a full range cycle for each movement", () => {
    const cases = [
        ["pull-ups", [170, 135, 75, 115, 170]],
        ["biceps-curls", [170, 140, 60, 85, 170]],
        ["triceps-extension", [50, 80, 165, 140, 50]],
        ["shoulder-press", [90, 110, 170, 150, 90]],
        ["lateral-raises", [10, 35, 120, 95, 10]]
    ];
    for (const [slug, sequence] of cases) {
        const detector = new ExerciseArmDetector(slug);
        let time = 0;
        for (const angle of [...sequence, sequence[0]]) {
            feed(detector, armExercisePose(slug, angle), time, 7);
            time += 700;
        }
        assert.equal(detector.count, 1, `${slug} should count one complete movement`);
    }
});

test("arm detectors count movements that pass over the active angle band", () => {
    const cases = [
        ["pull-ups", 170, 70],
        ["biceps-curls", 170, 60],
        ["triceps-extension", 50, 165],
        ["shoulder-press", 90, 175],
        ["lateral-raises", 10, 125]
    ];
    for (const [slug, start, bottom] of cases) {
        const detector = new ExerciseArmDetector(slug);
        let time = 0;
        for (const angle of [start, bottom, start, start]) {
            feed(detector, armExercisePose(slug, angle), time, 7);
            time += 700;
        }
        assert.equal(detector.count, 1, `${slug} should count a fast full movement`);
    }
});

test("arm detectors track either side independently and count alternating reps", () => {
    const detector = new ExerciseArmDetector("biceps-curls");
    let time = 0;
    for (const side of ["left", "right"]) {
        for (const angle of [170, 60, 170, 170]) {
            feed(detector, hideArmSide(armExercisePose("biceps-curls", angle), side), time, 7);
            time += 700;
        }
    }
    assert.equal(detector.count, 2);
});

test("jumping jack detector requires an open and returned closed position", () => {
    const detector = new JumpingJackDetector();
    let time = 0;
    for (const open of [false, true, false, false]) {
        feed(detector, jumpingJackPose(open), time, 6);
        time += 600;
    }
    assert.equal(detector.count, 1);

    const incomplete = new JumpingJackDetector();
    time = 0;
    for (const open of [false, true, true]) {
        feed(incomplete, jumpingJackPose(open), time, 6);
        time += 600;
    }
    assert.equal(incomplete.count, 0);
});

test("jumping jack detector remains reliable when the person appears smaller in frame", () => {
    const detector = new JumpingJackDetector();
    let time = 0;
    for (const open of [false, true, false, false]) {
        feed(detector, scalePose(jumpingJackPose(open), 0.35), time, 6);
        time += 600;
    }
    assert.equal(detector.count, 1);
});

test("jumping jack detector rejects a narrow stance as the open position", () => {
    const detector = new JumpingJackDetector();
    feed(detector, jumpingJackPose(false), 0, 6);

    const narrowOpen = jumpingJackPose(true);
    narrowOpen[27].x = 0.465;
    narrowOpen[28].x = 0.535;
    feed(detector, narrowOpen, 600, 6);
    feed(detector, jumpingJackPose(false), 1200, 6);

    assert.equal(detector.count, 0);
});

test("skipping rope detector requires a visible jump and landing cycle", () => {
    const detector = new SkippingRopeDetector();
    let time = 0;
    for (const jumping of [false, true, false, false]) {
        feed(detector, skippingRopePose(jumping), time, 6);
        time += 600;
    }
    assert.equal(detector.count, 1);
});

test("skipping rope detector detects jumps when the person appears smaller in frame", () => {
    const detector = new SkippingRopeDetector();
    let time = 0;
    for (const jumping of [false, true, false, false]) {
        feed(detector, scalePose(skippingRopePose(jumping), 0.3), time, 6);
        time += 600;
    }
    assert.equal(detector.count, 1);
});

test("detector selection covers each AI exercise and excludes running and walking", () => {
    const aiSlugs = [
        "push-ups", "pull-ups", "squats", "plank", "jumping-jacks",
        "skipping-rope", "biceps-curls", "shoulder-press",
        "lateral-raises", "triceps-extension"
    ];
    for (const slug of aiSlugs) {
        assert.ok(createExerciseDetector(slug), `${slug} should have a detector`);
    }
    assert.equal(createExerciseDetector("running"), null);
    assert.equal(createExerciseDetector("walking"), null);
});
