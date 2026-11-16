import {
    buildReviewedWorkoutPayload,
    isValidWorkoutWeight,
    saveReviewedWorkout
} from "./workout-save-flow.js";

const MAX_REVIEWED_VALUE = 150;

function correctionErrorMessage(parsed, minimum, maximum, isPlank, isJumpCount) {
    if (parsed < minimum) return "Cannot be zero.";
    if (parsed > maximum) {
        return isPlank
            ? `1–${maximum} sec.`
            : "Don't lie, enter truth.";
    }
    return `${minimum}–${maximum}${isPlank ? " sec" : isJumpCount ? " jumps" : " reps"}.`;
}

export function createWorkoutReview({
    exercise,
    isPlank,
    isJumpCount,
    maxPlankDuration,
    minWeight,
    maxWeight,
    weightStep,
    initialValue,
    elements,
    signal,
    getLifecycle,
    getSessionValues,
    isDisposed,
    isPreviewTransitioning,
    endSession,
    onResetSession,
    onSessionStateChange,
    onStatus,
    setFeedback,
    onSignInRequired,
    onWorkoutSaved
}) {
    const {
        finishButton,
        summary,
        correction,
        correctionError,
        weightInput,
        signInPrompt,
        signInPromptMessage,
        saveButton,
        discardButton
    } = elements;
    let saveInFlight = false;
    let discardInProgress = false;

    correction.value = String(initialValue);

    function setStatus(state) {
        saveButton.disabled =
            !["finished", "saving"].includes(state) ||
            saveInFlight;
        discardButton.disabled = state !== "finished";
        correction.disabled = state === "saving" || state === "saved";

        if (state === "finished" || state === "saving") {
            if (!summary.open) {
                summary.showModal();
                correction.focus({ preventScroll: true });
            }
        } else if (summary.open) {
            summary.close();
        }
    }

    function finish() {
        if (
            !["ready", "running"].includes(getLifecycle()) &&
            !(getLifecycle() === "error" && getSessionValues().sessionStarted)
        ) {
            return;
        }

        endSession();
        const { rawCount, elapsedMs } = getSessionValues();
        correction.value = String(isPlank
            ? Math.max(0, Math.floor(elapsedMs / 1000))
            : rawCount);
        correctionError.textContent = "";

        setFeedback(
            isPlank
                ? "Review your time."
                : "Review your count."
        );

        onStatus("finished", "Session finished.");

        const revealReview = () => {
            if (isDisposed() || getLifecycle() !== "finished") return;
            correction.focus({ preventScroll: true });
        };

        if (isPreviewTransitioning()) {
            window.setTimeout(revealReview, 380);
        } else {
            revealReview();
        }
    }

    function close() {
        if (summary.open) summary.close();
    }

    function discard() {
        if (discardInProgress || !["finished", "saved"].includes(getLifecycle())) {
            return;
        }

        if (!window.confirm("Discard this session? It will not be saved.")) {
            return;
        }
        discardInProgress = true;
        onResetSession();
        close();
        correction.value = "0";
        correctionError.textContent = "";

        onWorkoutSaved?.();
        if (getSessionValues().soundEnabled) {
            try {
                sessionStorage.setItem("mustmake_pending_discard_sound", "true");
            } catch (error) {
                console.warn("Could not queue the session discard sound.", error);
            }
        }
        window.location.replace("/today");
    }

    function validate() {
        const value = correction.value.trim();
        const parsed = Number(value);
        const minimum = 1;
        const maximum = isPlank ? maxPlankDuration : MAX_REVIEWED_VALUE;

        const valid =
            value !== "" &&
            Number.isSafeInteger(parsed) &&
            parsed >= minimum &&
            parsed <= maximum;

        correctionError.textContent = valid
            ? ""
            : correctionErrorMessage(parsed, minimum, maximum, isPlank, isJumpCount);

        correction.setAttribute(
            "aria-invalid",
            String(!valid)
        );

        return valid ? parsed : null;
    }

    async function save() {
        if (getLifecycle() !== "finished" || saveInFlight) return;

        const reviewedValue = validate();
        if (reviewedValue == null) return;

        const weight = weightInput
            ? Number(weightInput.value)
            : null;

        if (
            weightInput &&
            !isValidWorkoutWeight(weight, minWeight, maxWeight, weightStep)
        ) {
            weightInput.setCustomValidity(
                `Enter a weight from ${minWeight} to ${maxWeight} kg in ${weightStep} kg increments.`
            );

            weightInput.reportValidity();
            return;
        }

        weightInput?.setCustomValidity("");

        const payload = buildReviewedWorkoutPayload({
            exerciseName: exercise.name,
            isPlank,
            isJumpCount,
            reviewedValue,
            weight: weightInput ? weight : null
        });

        const isSignedIn = Boolean(localStorage.getItem("user"));

        if (!isSignedIn) {
            if (!onSignInRequired?.(payload)) {
                if (signInPromptMessage) {
                    signInPromptMessage.textContent =
                        "Could not preserve this workout. Please try again before signing in.";
                }
                if (signInPrompt) signInPrompt.hidden = false;
                return;
            }

            if (signInPromptMessage) {
                signInPromptMessage.textContent =
                    "Sign in to save this reviewed workout.";
            }
            if (signInPrompt) signInPrompt.hidden = false;
            return;
        }

        if (signInPrompt) signInPrompt.hidden = true;
        saveInFlight = true;

        onStatus("saving", "Saving reviewed workout…");
        const saveToast = window.showToast("Saving your reviewed workout…", { type: "loading" });

        try {
            const saveResult = await saveReviewedWorkout({
                payload,
                exerciseName: exercise.name,
                isPlank,
                isJumpCount,
                reviewedValue,
                weight,
                hasWeight: Boolean(weightInput)
            });

            if (saveResult.status === 401) {
                window.clearPrivateCaches?.();
                localStorage.removeItem("user");

                if (!onSignInRequired?.(payload)) {
                    saveToast?.update(
                        "Your sign-in expired, and this workout could not be preserved. Retry before signing in.",
                        { type: "error" }
                    );

                    onStatus("finished", "Sign-in required to save.");
                    return;
                }

                saveToast?.update(
                    "Your sign-in expired. Sign in again; this reviewed session has not been discarded.",
                    { type: "warning", action: { label: "Sign in", href: "/login" } }
                );

                onStatus("finished", "Sign-in required to save.");
                return;
            }

            window.clearPrivateCaches?.();
            onWorkoutSaved?.();
            onSessionStateChange?.(false);
            window.queueWorkoutCompletion?.(getSessionValues().soundEnabled);
            window.location.replace("/today");
        } catch (error) {
            console.error("AI workout save error:", error);

            saveToast?.update(
                error.message || "Could not connect to the server. Your reviewed session is still available to retry.",
                { type: "error" }
            );

            onStatus("finished", "Save failed. Review is preserved; retry when ready.");
        } finally {
            saveInFlight = false;

            if (
                getLifecycle() === "finished" ||
                getLifecycle() === "saved"
            ) {
                saveButton.disabled = getLifecycle() === "saved";
            }
        }
    }

    finishButton.addEventListener("click", finish, { signal });
    summary.addEventListener(
        "cancel",
        event => event.preventDefault(),
        { signal }
    );
    saveButton.addEventListener("click", save, { signal });
    discardButton.addEventListener("click", discard, { signal });
    correction.addEventListener("input", validate, { signal });

    return {
        dispose: close,
        getReviewedValue: () => correction.value,
        setReviewedValue: value => {
            correction.value = String(value);
        },
        setStatus,
        validate
    };
}
