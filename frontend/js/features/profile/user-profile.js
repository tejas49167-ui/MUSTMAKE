const profileRoot = document.getElementById("publicProfile");
const {
    escapeHTML,
    formatDate,
    formatWorkoutDetails
} = window.MUSTMAKE.presentation;
const profileToken = (() => {
    try {
        return Boolean(JSON.parse(localStorage.getItem("user") || "null"));
    } catch {
        return false;
    }
})();
const profileId = new URLSearchParams(window.location.search).get("id");
const publicPhotoDialog = document.getElementById("publicPhotoDialog");
const publicPhotoPreview = document.getElementById("publicPhotoPreview");
const publicPhotoPreviewHistoryKey = "mustmakePublicPhotoPreview";
let publicHistoryCursor = null;
let publicHistoryLoading = false;
const publicHistoryDays = new Map();
let publicHistoryLoadMoreButton = null;

function formatWorkoutDate(value) {
    return formatDate(value, { day: "numeric", month: "short", year: "numeric" });
}

function safeSocialUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

function safeImageUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

function publicWorkoutMarkup(workout) {
    return `
        <div class="history-workout">
            <div class="workout-name">${escapeHTML(workout.exercise)}</div>
            <div class="workout-details">${escapeHTML(formatWorkoutDetails(workout))}</div>
        </div>
    `;
}

function appendPublicWorkouts(list, workouts) {
    if (!workouts.length) return;

    if (publicHistoryDays.size === 0) {
        list.querySelector(".no-workout")?.remove();
    }
    publicHistoryLoadMoreButton?.remove();
    publicHistoryLoadMoreButton = null;

    const newDays = document.createDocumentFragment();
    workouts.forEach(workout => {
        const date = String(workout.date || "");
        let day = publicHistoryDays.get(date);
        if (!day) {
            day = document.createElement("div");
            day.className = "history-day";
            day.dataset.date = date;

            const heading = document.createElement("div");
            heading.className = "history-date";
            heading.textContent = formatWorkoutDate(date);
            day.appendChild(heading);
            publicHistoryDays.set(date, day);
            newDays.appendChild(day);
        }

        day.insertAdjacentHTML("beforeend", publicWorkoutMarkup(workout));
    });

    list.appendChild(newDays);
}

function setPublicHistoryCursor(list, cursor) {
    publicHistoryCursor = cursor;
    publicHistoryLoadMoreButton?.remove();
    publicHistoryLoadMoreButton = null;
    if (!publicHistoryCursor) return;

    publicHistoryLoadMoreButton = document.createElement("button");
    publicHistoryLoadMoreButton.type = "button";
    publicHistoryLoadMoreButton.className = "main-button history-load-more";
    publicHistoryLoadMoreButton.textContent = "Load older workouts";
    publicHistoryLoadMoreButton.addEventListener("click", loadMorePublicHistory);
    list.appendChild(publicHistoryLoadMoreButton);
}

async function loadMorePublicHistory(event) {
    if (publicHistoryLoading || !publicHistoryCursor) return;

    const button = event.currentTarget;
    publicHistoryLoading = true;
    button.disabled = true;
    const loadToast = window.showToast("Loading older workouts…", { type: "loading" });

    try {
        const query = new URLSearchParams({
            cursor: publicHistoryCursor,
            limit: "25"
        });
        const response = await fetch(
            `${window.backend_url}/api/users/${encodeURIComponent(profileId)}?${query}`
        );

        if (response.status === 401) {
            loadToast?.dismiss();
            window.clearPrivateCaches();
            localStorage.removeItem("user");
            window.location.href = "/login";
            return;
        }

        const data = await response.json();
        if (!response.ok || !Array.isArray(data.workoutHistory)) {
            throw new Error(data.message || "Could not load older workouts.");
        }

        const list = profileRoot.querySelector(".public-workout-list");
        appendPublicWorkouts(list, data.workoutHistory);
        setPublicHistoryCursor(list, data.workoutHistoryNextCursor);
        loadToast?.dismiss();
    } catch (error) {
        console.error("Public workout history error:", error);
        button.disabled = false;
        button.textContent = "Load older workouts";
        loadToast?.update(error.message || "Could not load older workouts.", { type: "error" });
    } finally {
        publicHistoryLoading = false;
    }
}

function displayProfile({ user, workoutHistory = [], workoutHistoryNextCursor = null }) {
    publicHistoryDays.clear();
    publicHistoryLoadMoreButton = null;
    const photo = safeImageUrl(user.profilePicture) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || "User")}&background=181818&color=ffffff`;
    const age = Number.isInteger(user.age) ? user.age : null;
    const hasHeight = user.height !== null && user.height !== undefined &&
        String(user.height).trim() !== "";
    const hasWeight = user.weight !== null && user.weight !== undefined &&
        String(user.weight).trim() !== "";
    const profileDetails = [
        age !== null
            ? `<div class="profile-detail"><strong>${escapeHTML(age)}</strong><span>years old</span></div>`
            : "",
        hasHeight
            ? `<div class="profile-detail"><strong>${escapeHTML(user.height)}</strong><span>cm tall</span></div>`
            : "",
        hasWeight
            ? `<div class="profile-detail"><strong>${escapeHTML(user.weight)}</strong><span>kg</span></div>`
            : ""
    ].filter(Boolean).join("");
    const socialLinks = Array.isArray(user.socials)
        ? user.socials
        : Object.values(user.socials || {});
    const socials = socialLinks
        .map(value => {
            const href = safeSocialUrl(value);
            return href ? `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(href)}</a>` : "";
        })
        .filter(Boolean)
        .join("");
    const history = workoutHistory.length
        ? ""
        : '<p class="no-workout">No workouts recorded yet.</p>';

    profileRoot.innerHTML = `
        <header class="public-profile-header">
            <button type="button" class="public-profile-photo-button" aria-label="View profile photo">
                <img class="public-profile-photo" src="${escapeHTML(photo)}" alt="${escapeHTML(user.name || "User")}">
            </button>
            <h2>${escapeHTML(user.name || "User")}</h2>
            <p class="profile-username">${user.username ? `@${escapeHTML(user.username)}` : ""}</p>
        </header>
        ${profileDetails ? `<p id="publicProfileIs">is</p><div class="profile-details">${profileDetails}</div>` : ""}
        ${socials ? `<section class="profile-socials"><h3>Socials</h3>${socials}</section>` : ""}
        <section class="public-workout-history">
            <div class="public-workout-list">${history}</div>
        </section>
    `;

    appendPublicWorkouts(
        profileRoot.querySelector(".public-workout-list"),
        workoutHistory
    );
    setPublicHistoryCursor(
        profileRoot.querySelector(".public-workout-list"),
        workoutHistoryNextCursor
    );

    profileRoot.querySelector(".public-profile-photo-button").addEventListener("click", event => {
        window.history.pushState({ ...window.history.state, [publicPhotoPreviewHistoryKey]: true }, "", location.href);
        publicPhotoPreview.src = event.currentTarget.querySelector("img").src;
        publicPhotoDialog.hidden = false;
        publicPhotoPreview.focus();
    });
}

function closePublicPhotoDialog() {
    publicPhotoDialog.hidden = true;
    profileRoot.querySelector(".public-profile-photo-button")?.focus();
    if (window.history.state?.[publicPhotoPreviewHistoryKey]) {
        window.history.back();
    }
}

window.addEventListener("popstate", () => {
    if (!publicPhotoDialog.hidden) {
        closePublicPhotoDialog();
    }
});

publicPhotoDialog.addEventListener("click", event => {
    if (event.target === publicPhotoDialog) {
        closePublicPhotoDialog();
    }
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !publicPhotoDialog.hidden) {
        closePublicPhotoDialog();
    }
});

async function loadPublicProfile() {
    if (!profileToken) {
        window.location.href = "/login";
        return;
    }
    if (!profileId) {
        window.showToast("This profile could not be found.", { type: "error" });
        return;
    }

    try {
        const response = await fetch(`${window.backend_url}/api/users/${encodeURIComponent(profileId)}`);
        if (response.status === 401) {
            window.clearPrivateCaches();
            localStorage.removeItem("user");
            window.location.href = "/login";
            return;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Could not load profile.");
        displayProfile(data);
    } catch (error) {
        console.error("Public profile error:", error);
        profileRoot.replaceChildren();
    }
}

loadPublicProfile();
