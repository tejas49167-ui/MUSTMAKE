const APP_TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Kolkata";

function getDateString(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: APP_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(date);

    const values = {};

    parts.forEach(part => {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    });

    return `${values.year}-${values.month}-${values.day}`;
}

function previousDateString(dateString) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().split("T")[0];
}

function calculateStreak(workouts) {
    if (!workouts || workouts.length === 0) {
        return 0;
    }

    const dates = new Set(
        workouts
            .map(workout => String(workout.date || "").slice(0, 10))
            .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
    );

    let streak = 0;
    let currentDate = getDateString();

    // Keep yesterday's streak alive until the current app-local day ends.
    if (!dates.has(currentDate)) {
        currentDate = previousDateString(currentDate);
    }

    while (true) {
        if (!dates.has(currentDate)) {
            break;
        }

        streak++;
        currentDate = previousDateString(currentDate);
    }

    return streak;
}

module.exports = {
    getDateString,
    previousDateString,
    calculateStreak
};
