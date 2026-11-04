
(function () {
    "use strict";

    const privateCachePrefixes = [
        "mustmake_today_workouts",
        "mustmake_streak",
        "mustmake_profile",
        "mustmake_competition_"
    ];

    window.clearPrivateCaches = function () {
        try {
            Object.keys(sessionStorage).forEach(key => {
                if (privateCachePrefixes.some(prefix => key.startsWith(prefix))) {
                    sessionStorage.removeItem(key);
                }
            });
        } catch (error) {
            console.warn("Could not clear private session caches.", error);
        }
    };

    function getUserId(user) {
        const id = user?._id ?? user?.id;
        return id == null ? null : String(id);
    }

    window.addEventListener("storage", event => {
        if (event.key !== "user") return;

        const parseUser = value => {
            try {
                return JSON.parse(value || "null");
            } catch {
                return null;
            }
        };

        const previousUser = parseUser(event.oldValue);
        const nextUser = parseUser(event.newValue);
        if (
            getUserId(previousUser) !== getUserId(nextUser) ||
            previousUser?.name !== nextUser?.name
        ) {
            window.clearPrivateCaches();
        }
    });

    window.saveAuthenticatedSession = function (user) {
        let previousUserId;
        try {
            const previousUser = JSON.parse(localStorage.getItem("user") || "null");
            previousUserId = getUserId(previousUser);
        } catch {
            // A malformed previous identity cannot safely be treated as the same account.
        }

        const nextUserId = getUserId(user);
        if (!previousUserId || !nextUserId || previousUserId !== nextUserId) {
            window.clearPrivateCaches();
        }

        localStorage.removeItem("token");
        localStorage.setItem("user", JSON.stringify(user));
    };

    function getCurrentPage() {
        const path = window.location.pathname
            .replace(/\.html$/, "")
            .replace(/\/+$/, "") || "/";

        const legacyRoutes = {
            "/pages/index": "/today",
            "/pages/exercises": "/exercises",
            "/pages/competition": "/competition",
            "/pages/profile": "/profile",
            "/pages/login": "/login",
            "/pages/signup": "/signup",
            "/pages/doit": "/doit"
        };

        return legacyRoutes[path] || path;
    }

    function normalizeRoute(href) {
        const path = href.replace(/\.html$/, "").replace(/\/+$/, "") || "/";

        const aliases = {
            "/pages/index": "/today",
            "/pages/competition": "/competition"
        };

        return aliases[path] || path;
    }

    function isRouteActive(href, currentPage) {
        const target = normalizeRoute(href);

        return currentPage === target ||
            (target === "/today" &&
                (currentPage === "/doit" || currentPage.startsWith("/exercises/")));
    }

    function navLink(href, label, currentPage) {
        const active = isRouteActive(href, currentPage);

        return `<a href="${href}"${active ? ' class="active" aria-current="page"' : ""}>${label}</a>`;
    }

    function bottomNavLink(href, label, icon, currentPage) {
        const active = isRouteActive(href, currentPage);

        return `
            <a class="bottom-nav-item${active ? " active" : ""}"
               href="${href}"
               aria-label="${label}"
               title="${label}"
               ${active ? 'aria-current="page"' : ""}>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    ${icon}
                </svg>
            </a>
        `;
    }

    function getAuthenticationState() {
        try {
            return Boolean(JSON.parse(localStorage.getItem("user") || "null"));
        } catch {
            return false;
        }
    }

    function initNavbar() {
        const container = document.getElementById("navbar");
        if (!container) return;

        const currentPage = getCurrentPage();
        const isAuthenticated = getAuthenticationState();
        const isLoginPage = currentPage === "/login";

        const menuButtonHTML = `
                <button class="mobile-menu-toggle"
                    type="button"
                    aria-label="Open navigation menu"
                    aria-expanded="false"
                    aria-controls="mobileNavigation">
                    <span></span>
                    <span></span>
                    <span></span>
                </button>
            `;

        const guestActionsHTML = isAuthenticated
            ? ""
            : `
                <nav class="guest-actions" aria-label="Account">
                    ${navLink("/login", "Login", currentPage)}
                    ${currentPage === "/"
                        ? '<a class="guest-signup-button" href="/signup">Get started</a>'
                        : navLink("/signup", "Sign up", currentPage)}
                </nav>
            `;

        // Desktop navigation: always displayed at the top-right on large screens.
        const desktopNavigationHTML = isAuthenticated
            ? `
                <nav class="desktop-navigation" aria-label="Desktop navigation">
                    ${navLink("/today", "Exercises", currentPage)}
                    ${navLink("/competition", "Community", currentPage)}
                    ${navLink("/profile", "Profile", currentPage)}
                    <button class="desktop-nav-more mobile-menu-toggle"
                        type="button"
                        aria-label="Open navigation menu"
                        title="More options"
                        aria-expanded="false"
                        aria-controls="mobileNavigation">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="5" cy="12" r="1.5"/>
                            <circle cx="12" cy="12" r="1.5"/>
                            <circle cx="19" cy="12" r="1.5"/>
                        </svg>
                    </button>
                </nav>
            `
            : "";

        // Slide-out navigation: used on mobile only.
        const navigationLinksHTML = isAuthenticated
            ? `
                ${navLink("/edit-profile", "Edit details", currentPage)}
                ${navLink("/settings", "Settings", currentPage)}
                ${navLink("/about", "About", currentPage)}
                <a href="mailto:tejas49167@gmail.com?subject=Bug%20Report" target="_blank" rel="noopener noreferrer">Report Bug</a>
                <a href="mailto:tejas49167@gmail.com?subject=Suggestion" target="_blank" rel="noopener noreferrer">Suggestions</a>

                <button class="mobile-nav-logout"
                    type="button"
                    data-auth-logout>
                    Logout
                </button>
            `
            : `
                ${navLink("/exercises", "Exercises", currentPage)}
                ${navLink("/settings", "Settings", currentPage)}
                ${navLink("/about", "About us", currentPage)}
                ${navLink("/login", "Login", currentPage)}
                ${navLink("/signup", "Sign up", currentPage)}
            `;

        const navigationHTML = `
                <div class="mobile-nav-backdrop" data-mobile-nav-close hidden></div>

                <aside id="mobileNavigation"
                    class="mobile-nav-panel"
                    aria-label="Main navigation"
                    aria-hidden="true"
                    hidden>

                    <div class="mobile-nav-heading">
                        <a class="mobile-nav-brand" href="/today">MUSTMAKE</a>

                        <button class="mobile-nav-close"
                            type="button"
                            aria-label="Close navigation menu"
                            data-mobile-nav-close>
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="m6 6 12 12M18 6 6 18"/>
                            </svg>
                        </button>
                    </div>

                    <nav class="mobile-nav-links" aria-label="Navigation links">
                        ${navigationLinksHTML}
                    </nav>
                </aside>
            `;

        // Mobile bottom navigation: icons only.
        const bottomNavigationHTML = isAuthenticated
            ? `
                <nav class="bottom-navigation" aria-label="Main navigation">
                    ${bottomNavLink(
                        "/today",
                        "Exercises",
                        '<path d="M7 7v10M17 7v10M4 9v6M20 9v6M7 12h10"/>',
                        currentPage
                    )}

                    ${bottomNavLink(
                        "/competition",
                        "Community",
                        '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20zM15 15a4.5 4.5 0 0 1 5.5 4.5"/>',
                        currentPage
                    )}

                    ${bottomNavLink(
                        "/profile",
                        "Profile",
                        '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-1.5a7 7 0 0 1 14 0V21z"/>',
                        currentPage
                    )}

                    <button class="bottom-nav-item bottom-nav-more mobile-menu-toggle"
                        type="button"
                        aria-label="Open more navigation options"
                        title="More options"
                        aria-expanded="false"
                        aria-controls="mobileNavigation">

                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="5" cy="12" r="1.5"/>
                            <circle cx="12" cy="12" r="1.5"/>
                            <circle cx="19" cy="12" r="1.5"/>
                        </svg>
                    </button>

                </nav>
            `
            : "";

        const navbarHTML = `
            <header class="topbar">
                <div class="topbar-start">
                    ${menuButtonHTML}

                    <a class="logo"
                        href="${isAuthenticated ? "/today" : "/"}"
                        aria-label="MUSTMAKE home">
                        MUSTMAKE
                    </a>
                </div>

                ${desktopNavigationHTML}
                ${guestActionsHTML}
            </header>

            ${navigationHTML}
            ${bottomNavigationHTML}
        `;

        container.innerHTML = navbarHTML;

        const prefetchableRoutes = new Set([
            "/today",
            "/doit",
            "/exercises",
            "/history",
            "/competition"
        ]);
        const routeAliases = {
            "/pages/index": "/today",
            "/pages/exercises": "/exercises",
            "/pages/history": "/history",
            "/pages/competition": "/competition"
        };
        const currentPath = window.location.pathname
            .replace(/\.html$/, "")
            .replace(/\/+$/, "") || "/";
        const currentRoute = routeAliases[currentPath] || currentPath;
        const prefetchedRoutes = new Set();
        const prefetchPage = link => {
            const url = new URL(link.href, window.location.href);
            if (
                url.origin !== window.location.origin ||
                url.search ||
                url.hash ||
                link.target && link.target !== "_self" ||
                link.hasAttribute("download")
            ) {
                return;
            }

            const path = url.pathname.replace(/\.html$/, "").replace(/\/+$/, "") || "/";
            const route = routeAliases[path] || path;

            if (
                !prefetchableRoutes.has(route) ||
                route === currentRoute ||
                prefetchedRoutes.has(route) ||
                navigator.connection?.saveData ||
                navigator.connection?.effectiveType === "slow-2g" ||
                navigator.connection?.effectiveType === "2g"
            ) {
                return;
            }

            prefetchedRoutes.add(route);
            const prefetchLink = document.createElement("link");
            prefetchLink.rel = "prefetch";
            prefetchLink.href = url.origin + route;
            document.head.appendChild(prefetchLink);
        };

        const prefetchFromInteraction = event => {
            if (event.type === "pointerover" && event.pointerType !== "mouse") return;
            if (event.type === "pointerdown" && event.pointerType !== "touch") return;

            const target = event.target;
            if (!(target instanceof Element)) return;
            const link = target.closest("a[href]");
            if (link && container.contains(link)) prefetchPage(link);
        };

        container.addEventListener("pointerover", prefetchFromInteraction);
        container.addEventListener("pointerdown", prefetchFromInteraction);

        document.body.classList.toggle(
            "has-bottom-navigation",
            isAuthenticated
        );

        const menuButtons = Array.from(
            container.querySelectorAll(".mobile-menu-toggle")
        );

        const menuPanel = container.querySelector("#mobileNavigation");
        const backdrop = container.querySelector(".mobile-nav-backdrop");
        const closeButton = container.querySelector(".mobile-nav-close");

        let lastMenuFocus = null;
        let closeTimer = null;
        let openFrame = null;
        let touchStart = null;
        const mobileNavigationQuery = window.matchMedia("(max-width: 800px)");
        const swipeThreshold = 56;
        const verticalSwipeRatio = 1.25;

        function isSwipeExcluded(target) {
            return target instanceof Element && Boolean(
                target.closest("a, button, input, select, textarea, video, audio, form, [contenteditable='true']")
            );
        }

        function closeMobileMenu() {
            if (!menuPanel || menuPanel.hidden) return;

            if (closeTimer !== null) {
                window.clearTimeout(closeTimer);
                closeTimer = null;
            }
            if (openFrame !== null) {
                window.cancelAnimationFrame(openFrame);
                openFrame = null;
            }

            menuButtons.forEach(button => {
                button.setAttribute("aria-expanded", "false");
                button.setAttribute(
                    "aria-label",
                    button.classList.contains("bottom-nav-more")
                        ? "Open more navigation options"
                        : "Open navigation menu"
                );
            });

            menuPanel.setAttribute("aria-hidden", "true");
            menuPanel.classList.remove("is-open");
            backdrop?.classList.remove("is-visible");
            document.body.classList.remove("mobile-nav-open");
            document.documentElement.classList.remove("mobile-nav-open");

            closeTimer = window.setTimeout(() => {
                menuPanel.hidden = true;
                if (backdrop) backdrop.hidden = true;
                closeTimer = null;
            }, 200);

            lastMenuFocus?.focus();
            lastMenuFocus = null;
        }

        function openMobileMenu(trigger = null) {
            if (!menuPanel) return;

            if (closeTimer !== null) {
                window.clearTimeout(closeTimer);
                closeTimer = null;
            }

            lastMenuFocus = trigger;

            menuPanel.hidden = false;
            if (backdrop) backdrop.hidden = false;

            openFrame = window.requestAnimationFrame(() => {
                openFrame = null;
                if (menuPanel.hidden) return;
                menuPanel.classList.add("is-open");
                backdrop?.classList.add("is-visible");
                menuPanel.setAttribute("aria-hidden", "false");
            });

            menuButtons.forEach(button => {
                button.setAttribute("aria-expanded", "true");
                button.setAttribute("aria-label", "Close navigation menu");
            });

            document.body.classList.add("mobile-nav-open");
            document.documentElement.classList.add("mobile-nav-open");
            if (trigger) closeButton?.focus();
        }

        menuButtons.forEach(button => {
            button.addEventListener("click", () => {
                if (button.getAttribute("aria-expanded") === "true") {
                    closeMobileMenu();
                } else {
                    openMobileMenu(button);
                }
            });
        });

        container.querySelectorAll("[data-mobile-nav-close]").forEach(element => {
            element.addEventListener("click", closeMobileMenu);
        });

        document.addEventListener("touchstart", event => {
            if (!mobileNavigationQuery.matches || event.touches.length !== 1) {
                touchStart = null;
                return;
            }

            const touch = event.touches[0];
            const menuIsOpen = Boolean(menuPanel && !menuPanel.hidden);

            if (isSwipeExcluded(event.target)) {
                touchStart = null;
                return;
            }

            if (menuIsOpen) {
                if (!menuPanel.contains(event.target)) {
                    touchStart = null;
                    return;
                }
            }

            touchStart = {
                x: touch.clientX,
                y: touch.clientY,
                menuIsOpen
            };
        }, { passive: true });

        document.addEventListener("touchmove", event => {
            if (
                !mobileNavigationQuery.matches ||
                !touchStart ||
                event.touches.length !== 1
            ) {
                return;
            }

            const touch = event.touches[0];
            const deltaX = touch.clientX - touchStart.x;
            const deltaY = touch.clientY - touchStart.y;
            const isHorizontalSwipe =
                Math.abs(deltaX) >= 10 &&
                Math.abs(deltaX) > Math.abs(deltaY) * verticalSwipeRatio;

            if (isHorizontalSwipe && event.cancelable) {
                event.preventDefault();
            }
        }, { passive: false });

        document.addEventListener("touchend", event => {
            if (!mobileNavigationQuery.matches || !touchStart || event.changedTouches.length !== 1) {
                touchStart = null;
                return;
            }

            const touch = event.changedTouches[0];
            const deltaX = touch.clientX - touchStart.x;
            const deltaY = touch.clientY - touchStart.y;
            const isHorizontalSwipe =
                Math.abs(deltaX) >= swipeThreshold &&
                Math.abs(deltaX) > Math.abs(deltaY) * verticalSwipeRatio;

            if (isHorizontalSwipe) {
                if (touchStart.menuIsOpen && deltaX < 0) {
                    closeMobileMenu();
                } else if (!touchStart.menuIsOpen && deltaX > 0) {
                    openMobileMenu();
                }
            }

            touchStart = null;
        }, { passive: true });

        document.addEventListener("touchcancel", () => {
            touchStart = null;
        }, { passive: true });

        menuPanel?.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", closeMobileMenu);
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                closeMobileMenu();
            }
        });

        container.querySelectorAll("[data-auth-logout], #logoutButton").forEach(button => {
            button.addEventListener("click", () => {
                window.clearPrivateCaches();
                localStorage.removeItem("user");
                window.fetch(`${window.backend_url}/api/auth/logout`, {
                    method: "POST"
                }).catch(error => {
                    console.warn("Could not end the server session.", error);
                }).finally(() => {
                    window.location.replace("/");
                });
            });
        });

    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initNavbar, { once: true });
    } else {
        initNavbar();
    }
})();
