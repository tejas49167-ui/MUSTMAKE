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
    <div class="logo">JUST beat IT</div>
    <nav>
        ${navLink("index.html", "Today", currentPage)}
        
        ${navLink("competition.html", "Others", currentPage)}
        ${navLink("profile.html", "Profile", currentPage)}
    </nav>
</header>
`;

document.addEventListener("DOMContentLoaded", () => {
    const container = document.getElementById("navbar");

    if (container) {
        container.innerHTML = navbarHTML;
    }

    const logoutBtn = document.getElementById("logoutButton");

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            window.location.href = "login.html";
        });
    }
});
