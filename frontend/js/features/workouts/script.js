const APP_TIME_ZONE = "Asia/Kolkata";

function hasSignedInUser() {
    try {
        return Boolean(JSON.parse(localStorage.getItem("user") || "null"));
    } catch {
        return false;
    }
}

function readSessionCache(key) {
    if (!key) return null;
    try {
        return JSON.parse(sessionStorage.getItem(key) || "null");
    } catch (error) {
        console.warn(`Could not read cached ${key}.`, error);
        return null;
    }
}

function writeSessionCache(key, value) {
    if (!key) return;
    try {
        sessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Could not cache ${key}.`, error);
    }
}

function getCurrentUser() {
    const user = localStorage.getItem("user");
    if (!user) return null;
    try {
        return JSON.parse(user);
    } catch {
        localStorage.removeItem("user");
        return null;
    }
}

function getUserId(user) {
    const id = user?._id ?? user?.id;
    return id == null ? null : String(id);
}

function logout(redirectToLogin = true) {
    window.clearPrivateCaches();
    localStorage.removeItem("user");
    if (redirectToLogin) {
        window.location.href = "/login";
    } else {
        window.location.reload();
    }
}

function formatDate(dateString) {
    const date = new Date(dateString + "T00:00:00");
    if (Number.isNaN(date.getTime())) return String(dateString || "");
    return date.toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });
}

function getToday() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: APP_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const values = {};
    parts.forEach(part => {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    });

    return `${values.year}-${values.month}-${values.day}`;
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function workoutDetails(workout) {
    const duration = Number(workout.duration);
    const durationText = Number.isFinite(duration) && duration > 0
        ? formatWorkoutDuration(duration)
        : "";

    if (workout.reps != null && workout.sets != null) {
        const reps = Number(workout.reps);
        const sets = Number(workout.sets);
        const total = reps * sets;
        const weight = workout.weight != null ? `${workout.weight} kg each hand · ` : "";
        return `${weight}${reps} reps × ${sets} sets = ${total} reps`;
    }

    if (workout.amount != null) {
        const amountText = `${workout.amount}${workout.unit ? ` ${workout.unit}` : ""}`;
        return durationText ? `${amountText} · ${durationText}` : amountText;
    }

    return durationText;
}

function formatWorkoutDuration(seconds) {
    const wholeSeconds = Math.round(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const remainingSeconds = wholeSeconds % 60;
    if (!minutes) return `${remainingSeconds} sec`;
    return remainingSeconds ? `${minutes} min ${remainingSeconds} sec` : `${minutes} min`;
}

async function loadToday() {
    const userContainer = document.getElementById("userWorkouts");
    const personalDashboard = document.getElementById("personalDashboard");
    const guestCta = document.getElementById("guestCta");
    if (!personalDashboard || !userContainer) return;

    const user = getCurrentUser();
    if (!user || !hasSignedInUser()) {
        window.location.replace("/");
        return;
    }
    const userId = getUserId(user);
    const cacheSuffix = userId ? `_${encodeURIComponent(userId)}` : null;

    personalDashboard.hidden = false;
    if (guestCta) guestCta.hidden = true;

    const dateElement = document.getElementById("todayDate");
    const nameElement = document.getElementById("userName");
    if (dateElement) dateElement.textContent = formatDate(getToday());
    if (nameElement) {
        const greeting =  "Hello" ;
        nameElement.textContent = `${greeting}, ${user.name || "athlete"}`;
    }

    const cachedWorkouts = readSessionCache(
        cacheSuffix ? `mustmake_today_workouts${cacheSuffix}` : null
    );
    if (Array.isArray(cachedWorkouts)) {
        displayTodayWorkouts(userContainer, cachedWorkouts);
    }
    const cachedStreak = readSessionCache(
        cacheSuffix ? `mustmake_streak${cacheSuffix}` : null
    );
    const streakElement = document.getElementById("userStreak");
    if (streakElement && Number.isFinite(cachedStreak)) {
        streakElement.textContent = cachedStreak;
    }

    const streakPromise = loadStreaks(
        cacheSuffix ? `mustmake_streak${cacheSuffix}` : null
    );
    try {
        const todayPromise = fetch(`${window.API_URL}/api/workouts/today`);

        const [response] = await Promise.all([todayPromise, streakPromise]);
        if (response.status === 401) {
            logout();
            return;
        }
        if (!response.ok) throw new Error("Failed to load workouts");

        const responseData = await response.json();
        const workouts = Array.isArray(responseData) ? responseData : [];
        writeSessionCache(
            cacheSuffix ? `mustmake_today_workouts${cacheSuffix}` : null,
            workouts
        );
        displayTodayWorkouts(userContainer, workouts);
    } catch (error) {
        console.error("Today's workouts error:", error);
        if (!Array.isArray(cachedWorkouts)) {
            userContainer.replaceChildren();
            window.showToast("Your workout data could not be loaded.", {
                type: "error",
                action: { label: "Browse exercises", href: "/doit" }
            });
        } else {
            window.showToast("Could not refresh your workout data. Showing saved data.", { type: "warning" });
        }
    }
}

function displayTodayWorkouts(container, workouts) {
    const safeWorkouts = Array.isArray(workouts) ? workouts : [];
    if (safeWorkouts.length === 0) {
        container.innerHTML = `<p class="no-workout">Another day , please grow </p>`;
        return;
    }

    container.innerHTML = "";
    safeWorkouts.forEach(workout => {
        const item = document.createElement("div");
        item.className = "workout-item";
        item.innerHTML = `
            <div class="workout-name">${escapeHTML(workout.exercise)}</div>
            <div class="workout-details">${escapeHTML(workoutDetails(workout))}</div>
        `;
        container.appendChild(item);
    });
}

async function loadStreaks(cacheKey) {
    const streakElement = document.getElementById("userStreak");
    if (!streakElement) return;

    try {
        const response = await fetch(`${window.API_URL}/api/workouts/streaks`);

        if (response.status === 401) {
            logout();
            return;
        }

        if (!response.ok) {
            throw new Error("Could not load streak");
        }

        const data = await response.json();
        const streak = Number(data.streak) || 0;
        writeSessionCache(cacheKey, streak);
        streakElement.textContent = streak;
    } catch (error) {
        console.error("Streak error:", error);
    }
}

const historyWorkouts = [];
let historyCursor = null;
let historyLoading = false;

function renderHistory(historyContainer) {
    historyContainer.replaceChildren();

    if (historyWorkouts.length === 0) {
        historyContainer.innerHTML = `<p class="no-workout">No workouts recorded yet.</p>`;
        return;
    }

    const grouped = new Map();
    historyWorkouts.forEach(workout => {
        const date = String(workout.date || "");
        if (!grouped.has(date)) grouped.set(date, []);
        grouped.get(date).push(workout);
    });

    [...grouped.keys()].forEach(date => {
        const day = document.createElement("div");
        day.className = "history-day";

        let html = `<div class="history-date">${escapeHTML(formatDate(date))}</div>`;

        grouped.get(date).forEach(workout => {
            html += `
                <div class="history-workout">
                <div class="workout-name">${escapeHTML(workout.exercise)}</div>
                    <div class="workout-details">${escapeHTML(workoutDetails(workout))}</div>
                </div>
            `;
        });

        day.innerHTML = html;
        historyContainer.appendChild(day);
    });

    if (historyCursor) {
        const loadMoreButton = document.createElement("button");
        loadMoreButton.type = "button";
        loadMoreButton.className = "main-button history-load-more";
        loadMoreButton.textContent = "Load older workouts";
        loadMoreButton.addEventListener("click", () => loadHistory(historyCursor));
        historyContainer.appendChild(loadMoreButton);
    }
}

async function loadHistory(cursor = null) {
    const historyContainer = document.getElementById("history");
    if (!historyContainer || historyLoading) return;

    if (!hasSignedInUser()) {
        window.location.href = "/login";
        return;
    }

    historyLoading = true;
    const loadToast = cursor
        ? window.showToast("Loading older workouts…", { type: "loading" })
        : null;
    const query = new URLSearchParams({ limit: "25" });
    if (cursor) query.set("cursor", cursor);

    try {
        const response = await fetch(`${window.API_URL}/api/workouts/history?${query}`);

        if (response.status === 401) {
            loadToast?.dismiss();
            logout();
            return;
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || `Could not load history (HTTP ${response.status}).`);
        }

        // Support the previous backend response while frontend/backend deploys
        // are rolling out independently.
        const page = Array.isArray(data)
            ? { workouts: data, nextCursor: null }
            : data;
        if (!Array.isArray(page.workouts)) {
            throw new Error("History response was invalid. Please update the backend and try again.");
        }

        historyWorkouts.push(...page.workouts);
        historyCursor = page.nextCursor || null;
        renderHistory(historyContainer);
        loadToast?.dismiss();
    } catch (error) {
        console.error(error);
        if (historyWorkouts.length === 0) {
            historyContainer.replaceChildren();
            if (loadToast?.element.isConnected) {
                loadToast.update(error.message || "Could not load workout history.", { type: "error" });
            } else {
                window.showToast(error.message || "Could not load workout history.", { type: "error" });
            }
        } else {
            if (loadToast?.element.isConnected) {
                loadToast.update(error.message || "Could not load older workouts.", { type: "error" });
            } else {
                window.showToast(error.message || "Could not load older workouts.", { type: "error" });
            }
        }
    } finally {
        historyLoading = false;
    }
}

if (document.getElementById("personalDashboard")) loadToday();
if (document.getElementById("history")) loadHistory();
