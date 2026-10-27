(() => {
    "use strict";

    const EXERCISE_CACHE_KEY = "mustmake_exercises_v2";
    const LEGACY_EXERCISE_CACHE_KEY = "mustmake_exercises";
    const grid = document.getElementById("exerciseGrid");
    if (!grid) return;

    const escapeHTML = value =>
        String(value ?? "").replace(/[&<>"']/g, character => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[character]);

    function cacheExercises(exercises) {
        try {
            sessionStorage.setItem(EXERCISE_CACHE_KEY, JSON.stringify(exercises));
            sessionStorage.removeItem(LEGACY_EXERCISE_CACHE_KEY);
        } catch (error) {
            console.warn("Could not cache the exercise catalog.", error);
        }
    }

    function renderMedia(exercise) {
        const media = exercise.media;
        if (!media) return "";

        if (media.type === "image") {
            return `<img class="exercise-media" src="${escapeHTML(media.src)}" alt="${escapeHTML(exercise.name)} demonstration" loading="lazy">`;
        }

        return `
            <video class="exercise-media exercise-demo" muted loop playsinline preload="none" aria-label="${escapeHTML(exercise.name)} demonstration">
                <source src="${escapeHTML(media.src)}" type="video/mp4">
            </video>
        `;
    }

    function observeVideos() {
        const videos = grid.querySelectorAll(".exercise-demo");

        if (typeof IntersectionObserver !== "function") {
            videos.forEach(video => {
                video.muted = true;
                video.loop = true;
                video.play().catch(() => {});
            });
            return;
        }

        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                const video = entry.target;

                if (entry.isIntersecting) {
                    video.play().catch(() => {});
                } else {
                    video.pause();
                }
            });
        }, { threshold: 0.4 });

        videos.forEach(video => observer.observe(video));
    }

    function renderExercise(exercise) {
        return `
            <article class="exercise-card">
                <a class="exercise-card-link" href="/exercises/${encodeURIComponent(exercise.slug)}" aria-label="Open ${escapeHTML(exercise.name)} workout">
                    <div class="exercise-card-media">
                        ${renderMedia(exercise)}
                    </div>
                    <div class="exercise-card-content">
                        <h3>${escapeHTML(exercise.name)}</h3>
                    </div>
                </a>
            </article>
        `;
    }

    async function loadExercises() {
        let cachedExercises;
        try {
            cachedExercises = JSON.parse(sessionStorage.getItem(EXERCISE_CACHE_KEY) || "null");
            if (!Array.isArray(cachedExercises)) {
                sessionStorage.removeItem(LEGACY_EXERCISE_CACHE_KEY);
                sessionStorage.removeItem(EXERCISE_CACHE_KEY);
            }
        } catch (error) {
            console.warn("Could not read the cached exercise catalog.", error);
        }
        if (Array.isArray(cachedExercises)) return cachedExercises;

        let catalogError;
        try {
            const response = await fetch("/data/exercises.json");
            if (!response.ok) throw new Error(`Exercise catalog returned ${response.status}.`);
            const exercises = await response.json();
            if (!Array.isArray(exercises)) throw new Error("Exercise catalog returned invalid data.");
            cacheExercises(exercises);
            return exercises;
        } catch (error) {
            catalogError = error;
        }

        try {
            const response = await fetch(`${window.API_URL}/api/exercises`);
            if (!response.ok) throw new Error(`Exercise API returned ${response.status}.`);
            const exercises = await response.json();
            if (!Array.isArray(exercises)) throw new Error("Exercise API returned an invalid catalog.");
            cacheExercises(exercises);
            return exercises;
        } catch (apiError) {
            console.error("Exercise catalog fallback failed:", catalogError);
            throw apiError;
        }
    }

    async function render() {
        try {
            const exercises = await loadExercises();

            grid.innerHTML = `
                <div class="exercise-list exercise-grid">
                    ${exercises.map(renderExercise).join("")}
                </div>
            `;

            observeVideos();
        } catch (error) {
            console.error("Exercise library error:", error);
            grid.innerHTML = '<p class="no-workout">The exercise library could not be loaded.</p>';
        }
    }

    render();
})();
