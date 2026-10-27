window.redirectAfterAuthentication = function (user) {
    try {
        const pendingWorkout = JSON.parse(
            sessionStorage.getItem("mustmake_pending_workout") || "null"
        );
        if (typeof pendingWorkout?.slug === "string" &&
            /^[a-z0-9-]+$/.test(pendingWorkout.slug) &&
            ["manual", "ai"].includes(pendingWorkout.mode) &&
            pendingWorkout.payload &&
            typeof pendingWorkout.payload === "object") {
            window.location.replace(`/exercises/${encodeURIComponent(pendingWorkout.slug)}`);
            return;
        }
    } catch (error) {
        console.warn("Could not read the pending workout after sign-in.", error);
    }

    const destination = user?.age !== null && user?.age !== undefined
        ? "/today"
        : "/first-details";

    window.location.replace(destination);
};
