import { formatTime, roundedDuration } from "./ai-monitor-feedback.js";

const MAX_REPETITIONS = 10000;

function reviewedValueFor(exercise, workout) {
    if (exercise.slug === "plank") return Number(workout.duration);
    if (exercise.slug === "skipping-rope") return Number(workout.amount);
    return Number(workout.reps);
}

export function restoreMonitorSession({
    exercise,
    snapshot,
    pendingWorkout,
    detector,
    review,
    elements,
    onStatus,
    setFeedback,
    onSessionStateChange
}) {
    const isPlank = exercise.slug === "plank";
    let rawCount = Math.max(0, Math.min(MAX_REPETITIONS, Number(snapshot?.rawCount) || 0));
    let elapsedMs = Math.max(0, Number(snapshot?.elapsedMs) || 0);
    let sessionStarted = Boolean(snapshot?.sessionStarted || snapshot?.finished);

    if (snapshot?.finished) {
        elapsedMs = Math.max(0, Number(snapshot.elapsedMs) || 0);
        rawCount = Math.max(0, Math.min(MAX_REPETITIONS, Number(snapshot.rawCount) || 0));

        if (elements.countOutput) elements.countOutput.textContent = String(rawCount);
        if (elements.timeOutput) {
            elements.timeOutput.textContent = formatTime(roundedDuration(elapsedMs));
        }

        review.setReviewedValue(snapshot.reviewedCount ?? (
            isPlank ? roundedDuration(elapsedMs) : rawCount
        ));

        if (snapshot.saved) {
            onStatus("saved", "Workout saved.");
        } else {
            setFeedback(isPlank ? "Review your time." : "Review your count.");
            onStatus("finished", "Session finished.");
        }
    } else if (pendingWorkout) {
        const reviewedValue = reviewedValueFor(exercise, pendingWorkout);

        if (isPlank) {
            elapsedMs = reviewedValue * 1000;
            detector.reset(elapsedMs);
            if (elements.timeOutput) elements.timeOutput.textContent = formatTime(reviewedValue);
        } else {
            rawCount = reviewedValue;
            detector.reset(rawCount);
            if (elements.countOutput) elements.countOutput.textContent = String(rawCount);
        }

        review.setReviewedValue(reviewedValue);
        if (elements.weightInput && Number.isFinite(Number(pendingWorkout.weight))) {
            elements.weightInput.value = String(pendingWorkout.weight);
        }

        sessionStarted = true;
        onSessionStateChange?.(true);
        window.showToast("You're signed in. Review your workout and save it again.", {
            type: "info"
        });
        onStatus("finished", "Workout ready to save.");
    } else if (snapshot) {
        onStatus("ready", "Monitoring paused");
        setFeedback("Count saved.");
    } else {
        onStatus("idle", "Ready");
    }

    return { rawCount, elapsedMs, sessionStarted };
}
