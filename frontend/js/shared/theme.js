(() => {
    const THEME_STORAGE_KEY = "just-do-it-theme";
    const root = document.documentElement;

    function readSavedTheme() {
        try {
            return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
        } catch {
            return "light";
        }
    }

    function syncToggle() {
        const toggle = document.getElementById("themeToggle");
        if (!toggle) return;

        const isDark = root.dataset.theme === "dark";
        toggle.setAttribute("aria-pressed", String(isDark));
        toggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    }

    function setTheme(theme) {
        root.dataset.theme = theme === "dark" ? "dark" : "light";
        syncToggle();
    }

    function toggleTheme() {
        const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
        setTheme(nextTheme);

        try {
            localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        } catch {
            // Keep the current-page toggle usable when storage is unavailable.
        }
    }

    root.dataset.theme = readSavedTheme();
    window.JustDoItTheme = { setTheme, syncToggle, toggleTheme };

    document.addEventListener("click", event => {
        const toggle = event.target instanceof Element ? event.target.closest("#themeToggle") : null;
        if (toggle) toggleTheme();
    });
})();
