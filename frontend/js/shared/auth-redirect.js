function getPendingWorkoutPath() {
    try {
        const pendingWorkout = JSON.parse(
            sessionStorage.getItem("mustmake_pending_workout") || "null"
        );
        if (typeof pendingWorkout?.slug === "string" &&
            /^[a-z0-9-]+$/.test(pendingWorkout.slug) &&
            ["manual", "ai"].includes(pendingWorkout.mode) &&
            pendingWorkout.payload &&
            typeof pendingWorkout.payload === "object") {
            return `/exercises/${encodeURIComponent(pendingWorkout.slug)}`;
        }
    } catch (error) {
        console.warn("Could not read the pending workout after sign-in.", error);
    }

    return null;
}

window.redirectAfterAuthentication = function () {
    window.location.replace(getPendingWorkoutPath() || "/today");
};

window.redirectAfterFirstDetails = function () {
    window.location.replace(getPendingWorkoutPath() || "/today");
};
