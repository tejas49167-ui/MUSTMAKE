import test from "node:test";
import assert from "node:assert/strict";
import { createWorkoutReview } from "../js/features/exercises/workout-review.js";

function createElement() {
    const listeners = new Map();
    return {
        addEventListener: (type, callback) => listeners.set(type, callback),
        emit: (type, event = {}) => listeners.get(type)?.(event),
        focus() {
            this.focused = true;
        },
        setAttribute(name, value) {
            this[name] = value;
        }
    };
}

test("workout review opens on finish and validates the reviewed count", () => {
    let lifecycle = "running";
    let review;
    const summary = Object.assign(createElement(), {
        open: false,
        showModal() {
            this.open = true;
        },
        close() {
            this.open = false;
        }
    });
    const correction = Object.assign(createElement(), {
        value: "",
        disabled: false
    });
    const correctionError = { textContent: "" };
    const finishButton = createElement();
    const saveButton = createElement();
    const discardButton = createElement();

    review = createWorkoutReview({
        exercise: { name: "Squats" },
        isPlank: false,
        isJumpCount: false,
        maxPlankDuration: 360,
        minWeight: 0,
        maxWeight: 60,
        weightStep: 0.5,
        initialValue: 4,
        elements: {
            finishButton,
            summary,
            correction,
            correctionError,
            weightInput: null,
            signInPrompt: null,
            signInPromptMessage: null,
            saveButton,
            discardButton
        },
        signal: new AbortController().signal,
        getLifecycle: () => lifecycle,
        getSessionValues: () => ({
            rawCount: 6,
            elapsedMs: 12000,
            sessionStarted: true,
            soundEnabled: false
        }),
        isDisposed: () => false,
        isPreviewTransitioning: () => false,
        endSession() {},
        onResetSession() {},
        onStatus(state) {
            lifecycle = state;
            review.setStatus(state);
        },
        setFeedback() {}
    });

    finishButton.emit("click");

    assert.equal(lifecycle, "finished");
    assert.equal(summary.open, true);
    assert.equal(correction.value, "6");
    assert.equal(correction.focused, true);

    correction.value = "0";
    assert.equal(review.validate(), null);
    assert.equal(correctionError.textContent, "Cannot be zero.");
    assert.equal(correction["aria-invalid"], "true");

    correction.value = "12";
    assert.equal(review.validate(), 12);
    assert.equal(correctionError.textContent, "");
    assert.equal(correction["aria-invalid"], "false");
});
