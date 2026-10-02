const API_URL = "https://justdoitbackend.vercel.app/";

const profileRoot = document.getElementById("publicProfile");
const profileToken = localStorage.getItem("token");
const profileId = new URLSearchParams(window.location.search).get("id");

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function formatWorkoutDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
        ? escapeHtml(value)
        : escapeHtml(date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }));
}

function workoutDetails(workout) {
    if (workout.reps != null && workout.sets != null) {
        const volume = Number(workout.reps) * Number(workout.sets);
        const weight = workout.weight != null ? ` · ${escapeHtml(workout.weight)} kg` : "";
        return `${escapeHtml(workout.reps)} reps × ${escapeHtml(workout.sets)} sets = ${escapeHtml(volume)} reps${weight}`;
    }
    if (workout.amount != null) {
        return `${escapeHtml(workout.amount)}${workout.unit ? ` ${escapeHtml(workout.unit)}` : ""}`;
    }
    return "Workout details not recorded";
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

function calculateAge(dateOfBirth) {
    const match = String(dateOfBirth || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const birthDate = new Date(Date.UTC(year, month - 1, day));
    if (
        birthDate.getUTCFullYear() !== year ||
        birthDate.getUTCMonth() !== month - 1 ||
        birthDate.getUTCDate() !== day
    ) return null;

    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date()).reduce((parts, part) => {
        if (part.type !== "literal") parts[part.type] = Number(part.value);
        return parts;
    }, {});

    let age = today.year - year;
    if (today.month < month || (today.month === month && today.day < day)) age--;
    return age >= 0 ? age : null;
}

function displayProfile({ user, workoutHistory = [] }) {
    const photo = safeImageUrl(user.profilePicture) || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || "User")}&background=181818&color=ffffff`;
    const age = calculateAge(user.dateOfBirth);
    const socials = Object.entries(user.socials || {})
        .map(([key, value]) => {
            const href = safeSocialUrl(value);
            return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(key)}</a>` : "";
        })
        .filter(Boolean)
        .join("");
    const history = workoutHistory.length
        ? workoutHistory.map(workout => `
            <article class="public-workout">
                <div><strong>${escapeHtml(workout.exercise)}</strong><time>${formatWorkoutDate(workout.date)}</time></div>
                <p>${workoutDetails(workout)}</p>
            </article>
        `).join("")
        : '<p class="no-workout">No workouts recorded yet.</p>';

    profileRoot.innerHTML = `
        <header class="public-profile-header">
            <img class="public-profile-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(user.name || "User")}">
            <h2>${escapeHtml(user.name || "User")}</h2>
            <p class="profile-username">${user.username ? `@${escapeHtml(user.username)}` : ""}</p>
        </header>
        <div class="profile-details">
            <div class="profile-detail"><span>Age</span><strong>${age == null ? "Not set" : `${age} years`}</strong></div>
            <div class="profile-detail"><span>Height</span><strong>${user.height ? `${escapeHtml(user.height)} cm` : "Not set"}</strong></div>
            <div class="profile-detail"><span>Weight</span><strong>${user.weight ? `${escapeHtml(user.weight)} kg` : "Not set"}</strong></div>
        </div>
        ${socials ? `<section class="profile-socials"><h3>Socials</h3>${socials}</section>` : ""}
        <section class="public-workout-history">
            <h2>Workout history</h2>
            <div class="public-workout-list">${history}</div>
        </section>
    `;
}

async function loadPublicProfile() {
    if (!profileToken) {
        window.location.href = "login.html";
        return;
    }
    if (!profileId) {
        profileRoot.textContent = "Invalid profile.";
        return;
    }

    try {
        const response = await fetch(`${API_URL}/api/users/${encodeURIComponent(profileId)}`, {
            headers: { Authorization: `Bearer ${profileToken}` }
        });
        if (response.status === 401) {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            window.location.href = "login.html";
            return;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Could not load profile.");
        displayProfile(data);
    } catch (error) {
        console.error("Public profile error:", error);
        profileRoot.textContent = error.message || "Could not load profile.";
    }
}

loadPublicProfile();
