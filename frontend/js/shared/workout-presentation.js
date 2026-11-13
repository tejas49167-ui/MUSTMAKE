(function () {
    "use strict";

    const APP_TIME_ZONE = window.MUSTMAKE.config.APP_TIME_ZONE;

    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);
    }

    function formatWorkoutDuration(seconds) {
        const wholeSeconds = Math.round(seconds);
        const minutes = Math.floor(wholeSeconds / 60);
        const remainingSeconds = wholeSeconds % 60;
        if (!minutes) return `${remainingSeconds} sec`;
        return remainingSeconds
            ? `${minutes} min ${remainingSeconds} sec`
            : `${minutes} min`;
    }

    function formatWorkoutDetails(workout) {
        const duration = Number(workout.duration);
        const durationText = Number.isFinite(duration) && duration > 0
            ? formatWorkoutDuration(duration)
            : "";

        if (workout.reps != null && workout.sets != null) {
            const reps = Number(workout.reps);
            const sets = Number(workout.sets);
            const weight = workout.weight != null
                ? `${workout.weight} kg each hand · `
                : "";
            return `${weight}${reps} reps × ${sets} sets = ${reps * sets} reps`;
        }

        if (workout.amount != null) {
            const amount = `${workout.amount}${workout.unit ? ` ${workout.unit}` : ""}`;
            return durationText ? `${amount} · ${durationText}` : amount;
        }

        return durationText;
    }

    function formatDate(dateString, options = {}) {
        const date = new Date(`${dateString}T12:00:00Z`);
        if (Number.isNaN(date.getTime())) return String(dateString || "");
        return date.toLocaleDateString("en-IN", {
            timeZone: APP_TIME_ZONE,
            ...options
        });
    }

    function getTodayDateString() {
        const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: APP_TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(new Date());
        const values = {};
        parts.forEach(part => {
            if (part.type !== "literal") values[part.type] = part.value;
        });
        return `${values.year}-${values.month}-${values.day}`;
    }

    window.MUSTMAKE = window.MUSTMAKE || {};
    window.MUSTMAKE.presentation = Object.freeze({
        escapeHTML,
        formatWorkoutDuration,
        formatWorkoutDetails,
        formatDate,
        getTodayDateString
    });
})();
