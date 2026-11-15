export function isValidWorkoutWeight(weight, min, max, step) {
    return Number.isFinite(weight) &&
        weight >= min &&
        weight <= max &&
        Number.isInteger((weight - min) / step);
}

export function buildReviewedWorkoutPayload({
    exerciseName,
    isPlank,
    isJumpCount,
    reviewedValue,
    weight
}) {
    if (isPlank) {
        return { exercise: exerciseName, duration: reviewedValue };
    }
    if (isJumpCount) {
        return { exercise: exerciseName, amount: reviewedValue, unit: "jumps" };
    }

    return {
        exercise: exerciseName,
        reps: reviewedValue,
        sets: 1,
        ...(weight === null ? {} : { weight })
    };
}

function responseConfirmsReviewedWorkout(data, {
    exerciseName,
    isPlank,
    isJumpCount,
    reviewedValue,
    weight,
    hasWeight
}) {
    if (!data || typeof data !== "object" || data.exercise !== exerciseName) {
        return false;
    }

    const confirmedValue = isPlank
        ? Number(data.duration) === reviewedValue
        : isJumpCount
            ? Number(data.amount) === reviewedValue && data.unit === "jumps"
            : Number(data.reps) === reviewedValue && Number(data.sets) === 1;

    return confirmedValue && (!hasWeight || Number(data.weight) === weight);
}

export async function saveReviewedWorkout({
    payload,
    exerciseName,
    isPlank,
    isJumpCount,
    reviewedValue,
    weight,
    hasWeight
}) {
    const response = await fetch(`${window.backend_url}/api/workouts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (response.status === 401) return { status: 401 };

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
            data?.message || `Could not save this workout (HTTP ${response.status}).`
        );
    }

    if (!responseConfirmsReviewedWorkout(data, {
        exerciseName,
        isPlank,
        isJumpCount,
        reviewedValue,
        weight,
        hasWeight
    })) {
        throw new Error(
            "The server response did not confirm this workout. Your reviewed session is still available."
        );
    }

    return { status: response.status, data };
}
