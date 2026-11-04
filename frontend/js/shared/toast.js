(() => {
    "use strict";

    const DEFAULT_DURATION = 3600;
    const PENDING_TOAST_KEY = "mustmake_pending_toast";
    const PENDING_FINISH_SOUND_KEY = "mustmake_pending_finish_sound";
    const PENDING_DISCARD_SOUND_KEY = "mustmake_pending_discard_sound";
    const PENDING_WORKOUT_CELEBRATION_KEY = "mustmake_pending_workout_celebration";
    const EXERCISE_SOUND_KEY_PREFIX = "mustmake_exercise_sound:";
    const finishSound = new Audio();
    const discardSound = new Audio();
    finishSound.preload = "none";
    discardSound.preload = "none";
    finishSound.src = "/assets/finishsession.mp3";
    discardSound.src = "/assets/discardsession.mp3";
    function getExerciseSoundPreference() {
        try {
            let user = null;
            try {
                user = JSON.parse(localStorage.getItem("user") || "null");
            } catch {
                // Use the separate guest preference when account data is unavailable.
            }
            const identity = user?._id ?? user?.id ?? user?.email ?? user?.username;
            const userKey = identity == null
                ? "guest"
                : String(identity).trim().toLowerCase();
            return localStorage.getItem(
                `${EXERCISE_SOUND_KEY_PREFIX}${encodeURIComponent(userKey)}`
            ) !== "false";
        } catch {
            return true;
        }
    }

    function playPendingSound(key, sound, label) {
        try {
            if (sessionStorage.getItem(key) !== "true") return;
            sessionStorage.removeItem(key);
        } catch (error) {
            console.warn(`Could not read the pending ${label} sound.`, error);
            return;
        }

        if (!getExerciseSoundPreference()) return;

        sound.currentTime = 0;
        sound.play().catch(error => {
            if (error?.name !== "NotAllowedError") {
                console.warn(`Could not play the ${label} sound.`, error);
                return;
            }

            const resumeOnInteraction = () => {
                document.removeEventListener("pointerdown", resumeOnInteraction);
                document.removeEventListener("keydown", resumeOnInteraction);
                if (!getExerciseSoundPreference()) return;
                sound.play().catch(playError => {
                    console.warn(`Could not play the ${label} sound.`, playError);
                });
            };
            document.addEventListener("pointerdown", resumeOnInteraction, { once: true });
            document.addEventListener("keydown", resumeOnInteraction, { once: true });
        });
    }

    function getToastRoot() {
        let root = document.querySelector(".toast-viewport");
        if (!root) {
            root = document.createElement("div");
            root.className = "toast-viewport";
            root.setAttribute("role", "region");
            root.setAttribute("aria-label", "Notifications");
            document.body.appendChild(root);
        }
        return root;
    }

    function normalizeType(type) {
        return ["success", "error", "warning", "info", "loading"].includes(type)
            ? type
            : "info";
    }

    function showToast(message, options = {}) {
        if (!document.body || message == null || String(message).trim() === "") {
            return null;
        }

        const root = getToastRoot();
        if (root.children.length >= 4) {
            const dismissibleToast = Array.from(root.children)
                .find(toast => toast.dataset.type !== "loading");
            dismissibleToast?.dismissToast?.();
        }

        const toast = document.createElement("article");
        toast.className = "mustmake-toast";

        const body = document.createElement("div");
        body.className = "toast-body";

        const text = document.createElement("p");
        text.className = "toast-message";

        const actions = document.createElement("div");
        actions.className = "toast-actions";

        const close = document.createElement("button");
        close.className = "toast-close";
        close.type = "button";
        close.setAttribute("aria-label", "Dismiss notification");
        close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

        body.append(text, actions);
        toast.append(body, close);
        root.appendChild(toast);

        let timer = null;
        let dismissed = false;
        let type = "info";

        const dismiss = () => {
            if (dismissed) return;
            dismissed = true;
            window.clearTimeout(timer);
            toast.classList.add("is-leaving");
            window.setTimeout(() => toast.remove(), 220);
        };

        const renderActions = nextActions => {
            actions.replaceChildren();
            const list = Array.isArray(nextActions)
                ? nextActions
                : nextActions
                    ? [nextActions]
                    : [];

            list.forEach(action => {
                if (!action || !action.label) return;
                const element = action.href
                    ? document.createElement("a")
                    : document.createElement("button");
                element.className = "toast-action";
                element.textContent = String(action.label);
                if (action.href) {
                    element.href = action.href;
                } else {
                    element.type = "button";
                    element.addEventListener("click", () => action.onClick?.());
                }
                actions.appendChild(element);
            });
        };

        const update = (nextMessage, nextOptions = {}) => {
            if (dismissed || !toast.isConnected) return handle;

            window.clearTimeout(timer);
            type = normalizeType(nextOptions.type || type);
            toast.dataset.type = type;
            toast.setAttribute("role", type === "error" ? "alert" : "status");
            text.textContent = String(nextMessage ?? "");
            renderActions(nextOptions.actions || nextOptions.action);

            const duration = type === "loading"
                ? 0
                : Math.min(4000, Math.max(3000, Number(nextOptions.duration) || DEFAULT_DURATION));
            if (duration > 0) timer = window.setTimeout(dismiss, duration);
            return handle;
        };

        const handle = { element: toast, dismiss, update };
        toast.dismissToast = dismiss;
        close.addEventListener("click", dismiss);
        update(message, options);
        return handle;
    }

    function queueToast(message, type = "success") {
        try {
            sessionStorage.setItem(PENDING_TOAST_KEY, JSON.stringify({
                message: String(message),
                type: normalizeType(type),
                createdAt: Date.now()
            }));
        } catch (error) {
            console.warn("Could not queue a notification for the next page.", error);
        }
    }

    function queueWorkoutCelebration() {
        try {
            sessionStorage.setItem(PENDING_WORKOUT_CELEBRATION_KEY, JSON.stringify({
                createdAt: Date.now()
            }));
        } catch (error) {
            console.warn("Could not queue the workout celebration.", error);
        }
    }

    function queueWorkoutCompletion(soundEnabled = getExerciseSoundPreference()) {
        queueWorkoutCelebration();
        if (!soundEnabled) return;

        try {
            sessionStorage.setItem(PENDING_FINISH_SOUND_KEY, "true");
        } catch (error) {
            console.warn("Could not queue the session finish sound.", error);
        }
    }

    function showWorkoutCelebration() {
        if (
            !document.body ||
            window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        ) {
            return;
        }

        const canvas = document.createElement("canvas");
        canvas.className = "workout-celebration";
        canvas.setAttribute("aria-hidden", "true");

        const context = canvas.getContext("2d");
        if (!context) return;

        const scale = Math.min(window.devicePixelRatio || 1, 2);
        const width = window.innerWidth;
        const height = window.innerHeight;
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        context.scale(scale, scale);
        document.body.appendChild(canvas);

        const colors = ["#ff4d6d", "#ffd166", "#06d6a0", "#4cc9f0", "#a78bfa", "#f97316"];
        const particles = Array.from({ length: 110 }, () => {
            const angle = Math.random() * Math.PI * 2;
            const speed = 2.5 + Math.random() * 7;
            return {
                x: width / 2 + (Math.random() - 0.5) * 44,
                y: height * 0.36 + (Math.random() - 0.5) * 36,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 4 + Math.random() * 6,
                rotation: Math.random() * Math.PI,
                rotationSpeed: (Math.random() - 0.5) * 0.18,
                color: colors[Math.floor(Math.random() * colors.length)]
            };
        });

        const duration = 3800;
        let startedAt;
        const animate = timestamp => {
            startedAt ??= timestamp;
            const progress = Math.min((timestamp - startedAt) / duration, 1);
            context.clearRect(0, 0, width, height);
            context.globalAlpha = Math.min(1, (1 - progress) * 4);

            particles.forEach(particle => {
                particle.x += particle.vx;
                particle.y += particle.vy;
                particle.vx *= 0.992;
                particle.vy = particle.vy * 0.992 + 0.14;
                particle.rotation += particle.rotationSpeed;

                context.save();
                context.translate(particle.x, particle.y);
                context.rotate(particle.rotation);
                context.fillStyle = particle.color;
                context.fillRect(
                    -particle.size / 2,
                    -particle.size / 2,
                    particle.size,
                    particle.size * 0.65
                );
                context.restore();
            });

            if (progress < 1) {
                window.requestAnimationFrame(animate);
            } else {
                canvas.remove();
            }
        };

        window.requestAnimationFrame(animate);
    }

    function showQueuedWorkoutCelebration() {
        let pending;
        try {
            pending = JSON.parse(
                sessionStorage.getItem(PENDING_WORKOUT_CELEBRATION_KEY) || "null"
            );
            sessionStorage.removeItem(PENDING_WORKOUT_CELEBRATION_KEY);
        } catch (error) {
            console.warn("Could not read the pending workout celebration.", error);
            return;
        }

        if (
            window.location.pathname === "/today" &&
            Number.isFinite(pending?.createdAt) &&
            Date.now() - pending.createdAt < 30000
        ) {
            showWorkoutCelebration();
        }
    }

    function showQueuedToast() {
        playPendingSound(PENDING_FINISH_SOUND_KEY, finishSound, "session finish");
        playPendingSound(PENDING_DISCARD_SOUND_KEY, discardSound, "session discard");
        showQueuedWorkoutCelebration();
        try {
            const pending = JSON.parse(sessionStorage.getItem(PENDING_TOAST_KEY) || "null");
            sessionStorage.removeItem(PENDING_TOAST_KEY);
            if (
                pending &&
                typeof pending.message === "string" &&
                Date.now() - pending.createdAt < 30000
            ) {
                showToast(pending.message, { type: pending.type });
            }
        } catch (error) {
            console.warn("Could not read the queued notification.", error);
        }
    }

    window.showToast = showToast;
    window.queueToast = queueToast;
    window.queueWorkoutCelebration = queueWorkoutCelebration;
    window.queueWorkoutCompletion = queueWorkoutCompletion;
    window.MUSTMAKE = window.MUSTMAKE || {};
    window.MUSTMAKE.toast = showToast;
    window.MUSTMAKE.queueWorkoutCelebration = queueWorkoutCelebration;
    window.MUSTMAKE.queueWorkoutCompletion = queueWorkoutCompletion;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", showQueuedToast, { once: true });
    } else {
        showQueuedToast();
    }
})();
