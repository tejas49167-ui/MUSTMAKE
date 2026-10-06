function getToken() {
    return localStorage.getItem("token");
}

function authHeaders() {
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${getToken()}`
    };
}

function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "login.html";
}

const usernameSearch = document.getElementById("usernameSearch");
const searchResults = document.getElementById("searchResults");
const competitionList = document.getElementById("competitionList");
const searchControl = document.getElementById("peopleSearch");
const searchToggle = document.getElementById("searchToggle");
const searchOverlay = document.getElementById("peopleSearchOverlay");
const searchClose = document.getElementById("searchClose");

function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}

let searchTimer = null;

function openPeopleSearch() {
    searchControl.classList.add("is-open");
    searchToggle.setAttribute("aria-expanded", "true");
    searchOverlay.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => usernameSearch.focus());
}

function closePeopleSearch() {
    searchControl.classList.remove("is-open");
    searchToggle.setAttribute("aria-expanded", "false");
    searchOverlay.setAttribute("aria-hidden", "true");
    usernameSearch.value = "";
    usernameSearch.blur();
    clearTimeout(searchTimer);
    searchResults.innerHTML = "";
}

searchToggle.addEventListener("click", () => {
    if (searchControl.classList.contains("is-open")) {
        closePeopleSearch();
    } else {
        openPeopleSearch();
    }
});

searchClose.addEventListener("click", closePeopleSearch);

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && searchControl.classList.contains("is-open")) {
        closePeopleSearch();
        searchToggle.focus();
    }
});

document.addEventListener("click", event => {
    if (
        searchControl.classList.contains("is-open") &&
        !searchControl.contains(event.target) &&
        !searchResults.contains(event.target)
    ) {
        closePeopleSearch();
    }
});

usernameSearch.addEventListener("input", () => {
    const username = usernameSearch.value.trim();
    clearTimeout(searchTimer);

    if (!username) {
        searchResults.innerHTML = "";
        return;
    }

    searchResults.innerHTML = `<p class="search-status">just a min..</p>`;

    searchTimer = setTimeout(() => {
        searchUsers(username);
    }, 300);
});

async function searchUsers(username) {
    try {
        const response = await fetch(
            `${window.API_URL}/api/users/search?q=${encodeURIComponent(username)}`,
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

        if (currentSearch !== username) return;

        displaySearchResults(users);
    } catch (error) {
        console.error("Competition search error:", error);
        searchResults.innerHTML = `<p class="search-status">Could not search users.</p>`;
    }
}

function displaySearchResults(users) {
    if (!users || users.length === 0) {
        searchResults.innerHTML = `<p class="search-status">No users found.</p>`;
        return;
    }

    searchResults.innerHTML = users.map(user => {
        const name = escapeHTML(user.name);
        const username = escapeHTML(user.username);

        return `
            <div class="competition-result">
                <a class="competition-user competition-user-link" href="user-profile.html?id=${encodeURIComponent(user._id)}">
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
    button.textContent = "Adding...";

    try {
        const response = await fetch(`${window.API_URL}/api/competition/add`, {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ competitorId })
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();

        if (!response.ok) {
            button.disabled = false;
            button.textContent = "Add";
            alert(data.message || "Could not add competitor.");
            return;
        }

        button.textContent = "Added";
        await loadCompetition();
    } catch (error) {
        console.error("Add competitor error:", error);
        button.disabled = false;
        button.textContent = "Add";
        alert("Could not connect to server.");
    }
}

async function removeCompetitor(competitorId, button) {
    button.disabled = true;
    

    try {
        const response = await fetch(`${window.API_URL}/api/competition/${encodeURIComponent(competitorId)}`, {
            method: "DELETE",
            headers: authHeaders()
        });

        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();

        if (!response.ok) {
            button.disabled = false;
            button.textContent = "−";
            alert(data.message || "Could not remove competitor.");
            return;
        }

        searchResults.querySelectorAll(".add-competitor-button").forEach(addButton => {
            if (addButton.dataset.userId === competitorId) {
                addButton.textContent = "+";
            }
        });

        await loadCompetition();
    } catch (error) {
        console.error("Remove competitor error:", error);
        button.disabled = false;
        button.textContent = "−";
        alert("Could not connect to server.");
    }
}

async function loadCompetition() {
    try {
        const response = await fetch(`${window.API_URL}/api/competition`, {
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

        if (competitions.length === 0) {
            competitionList.innerHTML = `<p class="no-workout">No competitors added yet.</p>`;
            return;
        }

        competitionList.innerHTML = "";

        for (const competitor of competitions) {

            const card = document.createElement("div");
            card.className = "competition-card";

            const safeName = escapeHTML(competitor.name);
            const safeUsername = escapeHTML(competitor.username);
            const photo = competitor.profilePicture
                ? `<img src="${escapeHTML(competitor.profilePicture)}" alt="" class="competition-avatar">`
                : `<div class="competition-avatar placeholder">${safeName.charAt(0).toUpperCase()}</div>`;
            const todayWorkouts = competitor.todayWorkouts || [];
            const workoutsMarkup = todayWorkouts.length
                ? todayWorkouts.map(workout => {
                    const details = workoutDetails(workout);
                    return `<p class="recent-workouts"><strong>${escapeHTML(workout.exercise)}</strong>${details ? ` · ${escapeHTML(details)}` : ""}</p>`;
                }).join("")
                : '<p class="recent-workouts">No workouts recorded today.</p>';

            card.innerHTML = `
                <div class="competition-card-header">
                    <a class="competition-card-profile competition-user-link" href="user-profile.html?id=${encodeURIComponent(competitor.id)}">
                        ${photo}
                        <div>
                            <h3>${safeName}</h3>
                            <p>@${safeUsername}</p>
                        </div>
                    </a>
                    <button type="button" class="main-button remove-competitor-button" data-user-id="${encodeURIComponent(competitor.id)}" aria-label="Remove competitor" title="Remove competitor">−</button>
                </div>
                <h4>Today's workouts</h4>
                <div class="today-workouts">${workoutsMarkup}</div>
            `;

            card.querySelector(".remove-competitor-button").addEventListener("click", event => {
                removeCompetitor(event.currentTarget.dataset.userId, event.currentTarget);
            });

            competitionList.appendChild(card);
        }
    } catch (error) {
        console.error("Load competition error:", error);
        competitionList.innerHTML = `<p class="no-workout">Could not load competition.</p>`;
    }
}

function workoutDetails(workout) {
    if (workout.reps != null && workout.sets != null) {
        const weight = workout.weight != null ? ` · ${workout.weight} kg` : "";
        return `${workout.reps} reps × ${workout.sets} sets${weight}`;
    }
    if (workout.amount != null) {
        return `${workout.amount}${workout.unit ? ` ${workout.unit}` : ""}`;
    }
    return "";
}

if (!getToken()) {
    window.location.href = "login.html";
} else {
    loadCompetition();
}
