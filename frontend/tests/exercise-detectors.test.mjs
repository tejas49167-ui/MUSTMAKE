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
    const shoulderDrop = Math.max(0, 180 - angle) / 90 * 0.032;
    const armPoints = (shoulderX, shoulderY, wristX, wristY) => {
        const dx = wristX - shoulderX;
        const dy = wristY - shoulderY;
        const length = Math.hypot(dx, dy);
        const height = length / (2 * Math.tan(angle * Math.PI / 360));
        return {
            shoulder: { x: shoulderX, y: shoulderY },
            elbow: {
                x: (shoulderX + wristX) / 2 - dy / length * height,
                y: (shoulderY + wristY) / 2 + dx / length * height
            },
            wrist: { x: wristX, y: wristY }
        };
    };
    const leftArm = armPoints(0.25, 0.45 + shoulderDrop, 0.65, 0.5);
    const rightArm = armPoints(0.25, 0.5 + shoulderDrop, 0.65, 0.55);
    const points = {
        11: leftArm.shoulder,
        13: leftArm.elbow,
        15: leftArm.wrist,
        12: rightArm.shoulder,
        14: rightArm.elbow,
        16: rightArm.wrist,
        23: { x: 0.55, y: 0.51 },
        24: { x: 0.55, y: 0.56 },
        27: { x: 0.85, y: 0.52 },
        28: { x: 0.85, y: 0.57 }
    };
    return setPoints(landmarks, points);
}

function frontFacingPushUpPose(angle) {
    const landmarks = pose();
    const elbowOffset = angle >= 180
        ? 0
        : 0.2 / Math.tan(angle * Math.PI / 360);
    return setPoints(landmarks, {
        11: { x: 0.4, y: 0.22 },
        13: { x: 0.4 + elbowOffset, y: 0.42 },
        15: { x: 0.4, y: 0.62 },
        23: { x: 0.45, y: 0.52 },
        27: { x: 0.48, y: 0.67 },
        12: { x: 0.6, y: 0.22 },
        14: { x: 0.6 - elbowOffset, y: 0.42 },
        16: { x: 0.6, y: 0.62 },
        24: { x: 0.55, y: 0.52 },
        28: { x: 0.52, y: 0.67 }
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

function frontFacingPlankPose() {
    const landmarks = pose();
    return setPoints(landmarks, {
        11: { x: 0.4, y: 0.2 }, 13: { x: 0.44, y: 0.32 }, 15: { x: 0.48, y: 0.44 },
        23: { x: 0.45, y: 0.52 }, 27: { x: 0.48, y: 0.88 },
        12: { x: 0.6, y: 0.2 }, 14: { x: 0.56, y: 0.32 }, 16: { x: 0.52, y: 0.44 },
        24: { x: 0.55, y: 0.52 }, 28: { x: 0.52, y: 0.88 }
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

test("push-up detector tracks the rep phase without visible ground-support landmarks", () => {
    const detector = new PushUpDetector();
    let time = 0;
    for (const angle of [180, 130, 90, 130, 180, 180]) {
        const landmarks = frontFacingPushUpPose(angle);
        for (const index of [23, 24, 25, 26, 27, 28]) {
            landmarks[index].visibility = 0.1;
        }
        feed(detector, landmarks, time, 6);
        time += 600;
    }

    assert.equal(detector.count, 1);
});

test("push-up detector does not require hand-to-ground alignment", () => {
    const detector = new PushUpDetector();
    let time = 0;
    for (const angle of [180, 130, 90, 130, 180, 180]) {
        const landmarks = frontFacingPushUpPose(angle);
        for (const index of [11, 13, 15, 12, 14, 16]) {
            landmarks[index].y -= 0.2;
        }
        feed(detector, landmarks, time, 6);
        time += 600;
    }

    assert.equal(detector.count, 1);
});

test("push-up detector avoids averaging conflicting arm angles", () => {
    const detector = new PushUpDetector();
    const straight = frontFacingPushUpPose(180);
    const bent = frontFacingPushUpPose(90);
    for (const index of [12, 14, 16]) {
        straight[index] = { ...bent[index], visibility: 0.82 };
    }

    assert.equal(detector.update(straight, 0).angle, 180);
});

test("push-up detector uses 3D elbow flexion alongside 2D shoulder drop", () => {
    const detector = new PushUpDetector();
    const depthPose = (bent) => {
        const landmarks = frontFacingPushUpPose(180);
        if (bent) {
            for (const [elbow, offset] of [[13, 0.1], [14, -0.1]]) {
                landmarks[elbow].x += offset;
                landmarks[elbow].z = 0.16;
            }
        }
        for (const index of [11, 12, 15, 16]) landmarks[index].z = 0;
        return landmarks;
    };

    feed(detector, depthPose(false), 0);
    feed(detector, depthPose(true), 800);
    feed(detector, depthPose(false), 1600);
    assert.equal(detector.count, 1);
});

test("push-up detector ignores depth-only elbow bends without shoulder drop", () => {
    const detector = new PushUpDetector();
    const poseWithDepthBend = bent => {
        const landmarks = frontFacingPushUpPose(180);
        for (const index of [11, 12, 15, 16]) landmarks[index].z = 0;
        if (bent) {
            landmarks[13].z = 0.16;
            landmarks[14].z = 0.16;
        }
        return landmarks;
    };

    feed(detector, poseWithDepthBend(false), 0);
    feed(detector, poseWithDepthBend(true), 800);
    feed(detector, poseWithDepthBend(false), 1600);
    assert.equal(detector.count, 0);
});

test("push-up detector accepts knee support when feet are cropped", () => {
    const detector = new PushUpDetector();
    let time = 0;
    for (const angle of [180, 130, 90, 130, 180, 180]) {
        const landmarks = frontFacingPushUpPose(angle);
        for (const index of [23, 24, 27, 28]) {
            landmarks[index].visibility = 0.1;
        }
        landmarks[25] = { x: 0.4, y: 0.62, visibility: 0.95 };
        landmarks[26] = { x: 0.6, y: 0.62, visibility: 0.95 };
        feed(detector, landmarks, time, 6);
        time += 600;
    }

    assert.equal(detector.count, 1);
});

test("push-up detector counts with only one visible arm", () => {
    const detector = new PushUpDetector();
    let time = 0;
    for (const angle of [180, 130, 90, 130, 180, 180]) {
        const landmarks = frontFacingPushUpPose(angle);
        landmarks[16].visibility = 0.1;
        feed(detector, landmarks, time, 6);
        time += 600;
    }

    assert.equal(detector.count, 1);
});

test("push-up detector tracks using the visible arm when the other arm is unreliable", () => {
    const detector = new PushUpDetector();
    feed(detector, pushUpPose(180), 0);
    feed(detector, pushUpPose(130), 800);
    feed(detector, pushUpPose(90), 1600);
    const unreliable = pushUpPose(180);
    unreliable[13].visibility = 0.1;
    detector.update(unreliable, 2400);
    assert.equal(detector.count, 0);
    assert.notEqual(detector.state, "unknown");
});

test("push-up detector retains its phase through brief elbow occlusion only", () => {
    const detector = new PushUpDetector();
    feed(detector, pushUpPose(180), 0);
    feed(detector, pushUpPose(90), 800);
    const lost = pose().map(() => ({ x: 0.5, y: 0.5, visibility: 0.1 }));

    detector.update(lost, 1600);
    assert.equal(detector.state, "bottom");
    detector.update(lost, 2100);
    assert.equal(detector.state, "unknown");
    feed(detector, pushUpPose(180), 2200);
    assert.equal(detector.count, 0);
});

test("push-up detector counts immediately at lockout without recounting a hold", () => {
    const detector = new PushUpDetector();
    detector.update(pushUpPose(180), 0);
    detector.update(pushUpPose(180), 120);
    assert.equal(detector.state, "starting");

    detector.update(pushUpPose(90), 130);
    assert.equal(detector.state, "bottom");

    detector.update(pushUpPose(180), 170);
    assert.equal(detector.count, 1);
    detector.update(pushUpPose(180), 205);
    assert.equal(detector.count, 1);
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

test("plank timer rejects diagonally misaligned body posture", () => {
    const detector = new PlankTimerDetector();
    const diagonalPose = plankPose();
    const radians = 68 * Math.PI / 180;
    for (const landmark of diagonalPose) {
        const x = landmark.x - 0.5;
        const y = landmark.y - 0.5;
        landmark.x = 0.5 + x * Math.cos(radians) - y * Math.sin(radians);
        landmark.y = 0.5 + x * Math.sin(radians) + y * Math.cos(radians);
    }

    assert.equal(detector.update(diagonalPose, 0).isCorrect, false);
    assert.equal(detector.elapsedMs, 0);
});

test("plank timer works when the user faces the camera head-on", () => {
    const detector = new PlankTimerDetector();
    const frontalPose = frontFacingPlankPose();

    assert.equal(detector.update(frontalPose, 0).isCorrect, true);
    assert.equal(detector.update(frontalPose, 110).isCorrect, true);
    assert.equal(detector.elapsedMs, 110);
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

test("arm detectors count a smaller-range movement with moderately visible landmarks", () => {
    const detector = new ExerciseArmDetector("biceps-curls");
    const sequence = [150, 130, 90, 130, 150, 150];
    let time = 0;
    for (const angle of sequence) {
        const landmarks = armExercisePose("biceps-curls", angle);
        for (const index of [11, 13, 15, 23, 12, 14, 16, 24]) {
            landmarks[index].visibility = 0.5;
        }
        feed(detector, landmarks, time, 7);
        time += 700;
    }

    assert.equal(detector.count, 1);
});

test("curls, triceps extensions, and shoulder presses use forgiving hand-and-arm tracking", () => {
    const cases = [
        ["biceps-curls", [140, 120, 95, 120, 140, 140]],
        ["triceps-extension", [75, 110, 155, 125, 75, 75]],
        ["shoulder-press", [100, 125, 155, 115, 100, 100]]
    ];

    for (const [slug, sequence] of cases) {
        const detector = new ExerciseArmDetector(slug);
        let time = 0;
        for (const angle of sequence) {
            const landmarks = armExercisePose(slug, angle);
            for (const index of [11, 12, 13, 14, 15, 16]) {
                landmarks[index].visibility = 0.4;
            }
            for (const index of [23, 24]) landmarks[index].visibility = 0.1;
            feed(detector, landmarks, time, 6);
            time += 600;
        }

        assert.equal(detector.count, 1, `${slug} should count with wrist/arm visibility only`);
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

test("jumping jack detector rejects a movement that never opens the arms or stance", () => {
    const detector = new JumpingJackDetector();
    feed(detector, jumpingJackPose(false), 0, 6);

    const narrowOpen = jumpingJackPose(true);
    narrowOpen[27].x = 0.465;
    narrowOpen[28].x = 0.535;
    narrowOpen[15].y = 0.55;
    narrowOpen[16].y = 0.55;
    feed(detector, narrowOpen, 600, 6);
    feed(detector, jumpingJackPose(false), 1200, 6);

    assert.equal(detector.count, 0);
});

test("jumping jack detector counts a completed partial-range movement", () => {
    const detector = new JumpingJackDetector();
    const armsOnly = jumpingJackPose(true);
    armsOnly[27].x = 0.465;
    armsOnly[28].x = 0.535;

    feed(detector, jumpingJackPose(false), 0, 6);
    feed(detector, armsOnly, 600, 6);
    feed(detector, jumpingJackPose(false), 1200, 6);

    assert.equal(detector.count, 1);
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

test("skipping rope detector counts a small hop and landing", () => {
    const detector = new SkippingRopeDetector();
    const smallHop = skippingRopePose(false);
    smallHop[23].y -= 0.01;
    smallHop[24].y -= 0.01;

    feed(detector, skippingRopePose(false), 0, 6);
    feed(detector, smallHop, 600, 6);
    feed(detector, skippingRopePose(false), 1200, 6);

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
