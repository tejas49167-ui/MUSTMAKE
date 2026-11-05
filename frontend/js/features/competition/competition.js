const { escapeHTML, formatWorkoutDetails } = window.MUSTMAKE.presentation;

function hasSignedInUser() {
    try {
        return Boolean(JSON.parse(localStorage.getItem("user") || "null"));
    } catch {
        return false;
    }
}

function authHeaders() {
    return { "Content-Type": "application/json" };
}

function logout() {
    window.clearPrivateCaches();
    localStorage.removeItem("user");
    window.location.href = "/login";
}

const usernameSearch = document.getElementById("usernameSearch");
const searchResults = document.getElementById("searchResults");
const competitionList = document.getElementById("competitionList");
const searchControl = document.getElementById("peopleSearch");
const searchToggle = document.getElementById("searchToggle");
const competitionCacheKey = getCompetitionCacheKey();

function getCompetitionCacheKey() {
    try {
        const user = JSON.parse(localStorage.getItem("user") || "null");
        const userId = user?._id || user?.id || user?.username;
        return userId ? `mustmake_competition_${encodeURIComponent(userId)}` : null;
    } catch (error) {
        console.warn("Could not determine the current user for competition cache.", error);
        return null;
    }
}

function readCompetitionCache() {
    if (!competitionCacheKey) return null;

    try {
        const cached = JSON.parse(sessionStorage.getItem(competitionCacheKey) || "null");
        return Array.isArray(cached) ? cached : null;
    } catch (error) {
        console.warn("Could not read cached competition data.", error);
        return null;
    }
}

function writeCompetitionCache(competitions) {
    if (!competitionCacheKey) return;

    try {
        sessionStorage.setItem(competitionCacheKey, JSON.stringify(competitions));
    } catch (error) {
        console.warn("Could not cache competition data.", error);
    }
}

function getCompetitorId(competitor) {
    return String(competitor.id ?? competitor._id ?? "");
}

const addedCompetitorIds = new Set(
    (readCompetitionCache() || [])
        .map(getCompetitorId)
        .filter(Boolean)
);

let searchTimer = null;
let searchGeneration = 0;
let searchToast = null;

searchControl.classList.add("is-open");
searchToggle.addEventListener("click", () => usernameSearch.focus());

usernameSearch.addEventListener("input", () => {
    const username = usernameSearch.value.trim();
    clearTimeout(searchTimer);

    if (!username) {
        searchGeneration += 1;
        searchToast?.dismiss();
        searchToast = null;
        searchResults.replaceChildren();
        return;
    }

    searchGeneration += 1;
    searchToast?.dismiss();
    searchToast = null;
    searchResults.replaceChildren();

    searchTimer = setTimeout(() => {
        searchUsers(username);
    }, 300);
});

async function searchUsers(username) {
    const generation = ++searchGeneration;
    if (
        searchToast?.element.isConnected &&
        !searchToast.element.classList.contains("is-leaving")
    ) {
        searchToast.update("Searching users…", { type: "loading" });
    } else {
        searchToast = window.showToast("Searching users…", { type: "loading" });
    }

    try {
        const response = await fetch(
            `${window.backend_url}/api/users/search?q=${encodeURIComponent(username)}`,
            { headers: authHeaders() }
        );

        if (response.status === 401) {
            logout();
            return;
        }

        if (!response.ok) {
            throw new Error("Search failed.");
        }

        const users = await response.json();
        const currentSearch = usernameSearch.value.trim();

        if (generation !== searchGeneration || currentSearch !== username) return;

        searchToast?.dismiss();
        searchToast = null;
        displaySearchResults(users);
    } catch (error) {
        console.error("Competition search error:", error);
        if (generation !== searchGeneration || usernameSearch.value.trim() !== username) return;
        searchResults.replaceChildren();
        searchToast?.update("Could not search users.", { type: "error" });
        searchToast = null;
    }
}

function displaySearchResults(users) {
    const availableUsers = (users || []).filter(user =>
        !addedCompetitorIds.has(String(user._id))
    );

    if (availableUsers.length === 0) {
        searchResults.innerHTML = `<p class="search-status">Tell them to use mustmake</p>`;
        return;
    }

    searchResults.innerHTML = availableUsers.map(user => {
        const name = escapeHTML(user.name);
        const username = escapeHTML(user.username);

        return `
            <div class="competition-result">
                <a class="competition-user competition-user-link" href="/user-profile?id=${encodeURIComponent(user._id)}">
                    ${
                        user.profilePicture
                            ? `<img src="${escapeHTML(user.profilePicture)}" alt="" class="competition-avatar">`
                            : `<div class="competition-avatar placeholder">${name.charAt(0).toUpperCase()}</div>`
                    }
                    <div class="competition-user-info">
                        <strong>${name}</strong>
                        <span>@${username}</span>
                    </div>
                </a>
                <button class="main-button add-competitor-button" data-user-id="${user._id}">+</button>
            </div>
        `;
    }).join("");

    searchResults.querySelectorAll(".add-competitor-button").forEach(button => {
        button.addEventListener("click", () => {
            addCompetitor(button.dataset.userId, button);
        });
    });
}

async function addCompetitor(competitorId, button) {
    button.disabled = true;
    button.textContent = "...";
    const notification = window.showToast("Adding competitor…", { type: "loading" });

    try {
        const response = await fetch(`${window.backend_url}/api/competition/add`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ competitorId })
        });

        if (response.status === 401) {
            notification?.dismiss();
            logout();
            return;
        }

        const data = await response.json();

        if (!response.ok) {
            button.disabled = false;
            button.textContent = "Add";
            notification?.update(data.message || "Could not add competitor.", { type: "error" });
            return;
        }

        addedCompetitorIds.add(String(competitorId));
        await loadCompetition({ renderCache: false });
        if (usernameSearch.value.trim()) {
            searchUsers(usernameSearch.value.trim());
        }
        notification?.update("Competitor added.", { type: "success" });
    } catch (error) {
        console.error("Add competitor error:", error);
        button.disabled = false;
        button.textContent = "Add";
        notification?.update("Could not connect to server.", { type: "error" });
    }
}

async function removeCompetitor(competitorId, button) {
    button.disabled = true;
    button.textContent = "...";
    const notification = window.showToast("Removing competitor…", { type: "loading" });

    try {
        const response = await fetch(`${window.backend_url}/api/competition/${encodeURIComponent(competitorId)}`, {
            method: "DELETE",
            headers: authHeaders()
        });

        if (response.status === 401) {
            notification?.dismiss();
            logout();
            return;
        }

        const data = await response.json();

        if (!response.ok) {
            button.disabled = false;
            button.textContent = "−";
            notification?.update(data.message || "Could not remove competitor.", { type: "error" });
            return;
        }

        addedCompetitorIds.delete(String(competitorId));
        searchResults.querySelectorAll(".add-competitor-button").forEach(addButton => {
            if (addButton.dataset.userId === competitorId) {
                addButton.textContent = "+";
            }
        });

        await loadCompetition({ renderCache: false });
        if (usernameSearch.value.trim()) {
            searchUsers(usernameSearch.value.trim());
        }
        notification?.update("Competitor removed.", { type: "success" });
    } catch (error) {
        console.error("Remove competitor error:", error);
        button.disabled = false;
        button.textContent = "−";
        notification?.update("Could not connect to server.", { type: "error" });
    }
}

async function loadCompetition({ renderCache = true } = {}) {
    const cachedCompetition = renderCache ? readCompetitionCache() : null;
    if (cachedCompetition) renderCompetition(cachedCompetition);

    try {
        const response = await fetch(`${window.backend_url}/api/competition`, {
            headers: authHeaders()
        });

        if (response.status === 401) {
            logout();
            return;
        }

        if (!response.ok) {
            throw new Error("Could not load competition.");
        }

        const competitions = await response.json();
        addedCompetitorIds.clear();
        competitions.forEach(competitor => {
            const competitorId = getCompetitorId(competitor);
            if (competitorId) addedCompetitorIds.add(competitorId);
        });
        writeCompetitionCache(competitions);
        renderCompetition(competitions);
    } catch (error) {
        console.error("Load competition error:", error);
        if (!cachedCompetition) {
            competitionList.replaceChildren();
            window.showToast(error.message || "Could not load competition.", { type: "error" });
        } else {
            window.showToast("Could not refresh the competition list. Showing saved data.", { type: "warning" });
        }
    }
}

function renderCompetition(competitions) {
    if (competitions.length === 0) {
        competitionList.innerHTML = `<p class="no-workout">It's you vs you </p>`;
        return;
    }

    competitionList.innerHTML = "";

    for (const competitor of competitions) {

        const card = document.createElement("div");
        card.className = "competition-card";

        const safeName = escapeHTML(competitor.name);
        const photo = competitor.profilePicture
            ? `<img src="${escapeHTML(competitor.profilePicture)}" alt="" class="competition-avatar">`
            : `<div class="competition-avatar placeholder">${safeName.charAt(0).toUpperCase()}</div>`;
        const todayWorkouts = competitor.todayWorkouts || [];
        const workoutsMarkup = todayWorkouts.length
            ? todayWorkouts.map(workout => {
                const details = formatWorkoutDetails(workout);
                return `<p class="recent-workouts"><strong>${escapeHTML(workout.exercise)}</strong>${details ? ` · ${escapeHTML(details)}` : ""}</p>`;
            }).join("")
            : '<p class="recent-workouts">No workouts recorded today.</p>';

        card.innerHTML = `
            <div class="competition-card-header">
                <a class="competition-card-profile competition-user-link" href="/user-profile?id=${encodeURIComponent(competitor.id)}">
                    ${photo}
                    <div class="competition-user-info">
                        <h3>${safeName}</h3>
                    </div>
                </a>
                <button type="button" class="main-button remove-competitor-button" data-user-id="${encodeURIComponent(competitor.id)}" aria-label="Remove competitor" title="Remove competitor">−</button>
            </div>
            <div class="today-workouts">${workoutsMarkup}</div>
        `;

        card.querySelector(".remove-competitor-button").addEventListener("click", event => {
            removeCompetitor(event.currentTarget.dataset.userId, event.currentTarget);
        });

        competitionList.appendChild(card);
    }
}

if (!hasSignedInUser()) {
    window.location.href = "/login";
} else {
    loadCompetition();
}
