(function () {
    const body = document.body;
    const slug = body.dataset.exerciseSlug;
    if (!slug) return;

    document.title = "Exercise | MUSTMAKE";
    body.innerHTML = `
        <div id="navbar"></div>
        <main class="container exercise-detail-container">
            <section id="exerciseDetail" aria-live="polite">
                <p class="no-workout">...</p>
            </section>
        </main>
    `;

    function loadScripts(sources) {
        const loads = sources.map(src => new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.async = false;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Could not load ${src}.`));
            document.body.appendChild(script);
        }));
        return Promise.all(loads);
    }

    async function startExercisePage() {
        const scripts = [
            "/js/shared/toast.js",
            "/js/shared/navbar.js",
            "/js/shared/workout-presentation.js",
            "/js/shared/exercise-catalog.js",
            "/js/features/exercises/exercise-detail.js"
        ];

        try {
            await loadScripts(scripts);
        } catch (error) {
            console.error("Exercise page initialization failed:", error);
            const root = document.getElementById("exerciseDetail");
            if (root) {
                root.textContent = "This exercise page could not be loaded. Refresh to try again.";
            }
        }
    }

    void startExercisePage();
})();
