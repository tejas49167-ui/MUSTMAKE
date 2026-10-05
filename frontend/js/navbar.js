function getCurrentPage() {
    const path = window.location.pathname;
    return path.substring(path.lastIndexOf("/") + 1) || "index.html";
}

function navLink(href, label, currentPage) {
    const activeClass = currentPage === href ? ' class="active"' : "";
    return `<a href="${href}"${activeClass}>${label}</a>`;
}

const currentPage = getCurrentPage();

const navbarHTML = `
<header class="topbar">
    <div class="logo">JUST DO IT</div>
    <nav>
        ${navLink("index.html", "Today", currentPage)}
        ${navLink("competition.html", "Others", currentPage)}
        ${navLink("profile.html", "Profile", currentPage)}
    </nav>
    <div class="topbar-actions">
        <button
            class="theme-toggle"
            id="themeToggle"
            type="button"
            aria-label="Switch to dark mode"
            aria-pressed="false"
        >
            <span class="theme-toggle-track" aria-hidden="true">
                <span class="theme-toggle-thumb">
                    <svg class="theme-sun" viewBox="0 0 24 24" focusable="false">
                        <circle cx="12" cy="12" r="3.5"></circle>
                        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"></path>
                    </svg>
                    <svg class="theme-moon" viewBox="0 0 24 24" focusable="false">
                        <path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z"></path>
                    </svg>
                </span>
            </span>
        </button>
    </div>
</header>
`;

document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("navbar");

    if (container) {
        container.innerHTML = navbarHTML;
    }

    window.JustDoItTheme?.syncToggle();

    const logoutBtn = document.getElementById("logoutButton");

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            window.location.href = "login.html";
        });
    }
});
