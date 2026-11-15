const SHARED_EXERCISE_FEEDBACK = new Set([
    "Can't see u.",
    "Get set.",
    "Nice rep."
]);

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;

    return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function roundedDuration(milliseconds) {
    return Math.max(0, Math.floor(milliseconds / 1000));
}

export function createMonitorFeedback({ feedback, timeOutput, detector, isPlank }) {
    let lastAnimationAt = -Infinity;

    function setFeedback(message) {
        const nextMessage = String(message ?? "");
        if (feedback.textContent === nextMessage) return;

        feedback.textContent = nextMessage;
        feedback.dataset.tone = nextMessage === "Get set."
            ? "setup"
            : /^(Nice rep|Nice jump|Strong form|Great|Perfect)\b/i.test(nextMessage)
                ? "positive"
                : "negative";

        const now = performance.now();
        if (now - lastAnimationAt < 350) return;

        lastAnimationAt = now;
        feedback.classList.remove("is-animating");
        void feedback.offsetWidth;
        feedback.classList.add("is-animating");
    }

    function setExerciseFeedback(message) {
        if (message === "Nice jump.") {
            setFeedback("Nice rep.");
            return;
        }

        if (message?.startsWith("Can't see ") || SHARED_EXERCISE_FEEDBACK.has(message)) {
            setFeedback(message);
            return;
        }

        if (feedback.textContent.startsWith("Can't see ")) {
            setFeedback("Get set.");
        }
    }

    function updateClock() {
        if (!isPlank || !timeOutput) return;
        timeOutput.textContent = formatTime(roundedDuration(detector.elapsedMs));
    }

    return { setFeedback, setExerciseFeedback, updateClock };
}

export { formatTime, roundedDuration };
