const APP_TIME_ZONE = "Asia/Kolkata";

function getToken() {
    return localStorage.getItem("token");
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

function saveAuth(token, user) {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
}

function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "login.html";
}

function authHeaders() {
    const token = getToken();
    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    };
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

function getPreviousDate(dateString) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().split("T")[0];
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
    if (
        workout.exercise === "Push-ups" ||
        workout.exercise === "Pull-ups" ||
        workout.exercise === "Squats"
    ) {
        const total = workout.reps * workout.sets;
        return `${workout.reps} reps × ${workout.sets} sets = ${total} reps`;
    }

    if (workout.exercise === "Dumbbell") {
        const total = workout.reps * workout.sets;
        return `${workout.weight} kg each hand · ${workout.reps} reps × ${workout.sets} sets = ${total} reps`;
    }

    if (workout.exercise === "Skipping Rope") {
        return `${workout.amount} jumps`;
    }

    if (workout.exercise === "Running" || workout.exercise === "Walking") {
        return `${workout.amount} km`;
    }

    return "";
}

async function loadToday() {
    const userContainer = document.getElementById("userWorkouts");
    if (!userContainer) return;

    const user = getCurrentUser();
    if (!user) {
        window.location.href = "login.html";
        return;
    }

    document.getElementById("todayDate").textContent = formatDate(getToday());
    document.getElementById("userName").textContent = `Hello ${user.name}`;

    try {
        const response = await fetch(`${window.API_URL}/api/workouts/today`, {
            headers: {
                "Authorization": `Bearer ${getToken()}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        if (!response.ok) {
            throw new Error("Failed to load workouts");
        }

        const workouts = await response.json();
        displayTodayWorkouts(userContainer, workouts);
        loadStreaks();
    } catch (error) {
        console.error(error);
        userContainer.textContent = "Could not load workouts.";
    }
}

function displayTodayWorkouts(container, workouts) {
    if (workouts.length === 0) {
        container.innerHTML = `<p class="no-workout">No workout recorded yet.</p>`;
        return;
    }

    container.innerHTML = "";

    workouts.forEach(workout => {
        const item = document.createElement("div");
        item.className = "workout-item";
        item.innerHTML = `
            <div class="workout-name">${escapeHTML(workout.exercise)}</div>
            <div class="workout-details">${escapeHTML(workoutDetails(workout))}</div>
        `;
        container.appendChild(item);
    });
}

async function loadStreaks() {
    const streakElement = document.getElementById("userStreak");
    if (!streakElement) return;

    try {
        const response = await fetch(`${window.API_URL}/api/workouts/streaks`, {
            headers: {
                "Authorization": `Bearer ${getToken()}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        if (!response.ok) {
            throw new Error("Could not load streak");
        }

        const data = await response.json();
        streakElement.textContent = data.streak || 0;
    } catch (error) {
        console.error("Streak error:", error);
    }
}

const exerciseSelect = document.getElementById("exercise");
const exerciseFields = document.getElementById("exerciseFields");
const totalDisplay = document.getElementById("totalDisplay");

if (exerciseSelect) {
    exerciseSelect.addEventListener("change", updateExerciseFields);
}

function updateExerciseFields() {
    const exercise = exerciseSelect.value;
    exerciseFields.innerHTML = "";
    totalDisplay.style.display = "none";

    if (!exercise) return;

    if (exercise === "Push-ups" || exercise === "Pull-ups" || exercise === "Squats") {
        exerciseFields.innerHTML = `
            <div class="dynamic-grid">
                <div class="field">
                    <label>Reps</label>
                    <input type="number" id="reps" min="1" placeholder="Example: 20" required>
                </div>
                <div class="field">
                    <label>Sets</label>
                    <input type="number" id="sets" min="1" placeholder="Example: 3" required>
                </div>
            </div>
        `;
        addTotalListeners();
        return;
    }

    if (exercise === "Dumbbell") {
        exerciseFields.innerHTML = `
            <div class="field">
                <label>Weight per hand (kg)</label>
                <input type="number" id="weight" min="0" step="0.5" placeholder="Example: 5" required>
            </div>
            <div class="dynamic-grid">
                <div class="field">
                    <label>Reps</label>
                    <input type="number" id="reps" min="1" placeholder="Example: 15" required>
                </div>
                <div class="field">
                    <label>Sets</label>
                    <input type="number" id="sets" min="1" placeholder="Example: 3" required>
                </div>
            </div>
        `;
        addTotalListeners();
        return;
    }

    if (exercise === "Skipping Rope") {
        exerciseFields.innerHTML = `
            <div class="field">
                <label>Number of jumps</label>
                <input type="number" id="amount" min="1" placeholder="Example: 100" required>
            </div>
        `;
        return;
    }

    if (exercise === "Running" || exercise === "Walking") {
        exerciseFields.innerHTML = `
            <div class="field">
                <label>Distance (km)</label>
                <input type="number" id="amount" min="0" step="0.01" placeholder="Example: 5" required>
            </div>
        `;
    }
}

function addTotalListeners() {
    const reps = document.getElementById("reps");
    const sets = document.getElementById("sets");
    if (!reps || !sets) return;

    function updateTotal() {
        const repsValue = Number(reps.value);
        const setsValue = Number(sets.value);

        if (repsValue > 0 && setsValue > 0) {
            totalDisplay.style.display = "block";
            totalDisplay.textContent = `Total: ${repsValue * setsValue} reps`;
        } else {
            totalDisplay.style.display = "none";
        }
    }

    reps.addEventListener("input", updateTotal);
    sets.addEventListener("input", updateTotal);
}

const workoutForm = document.getElementById("workoutForm");
if (workoutForm) {
    workoutForm.addEventListener("submit", saveWorkout);
}

async function saveWorkout(event) {
    event.preventDefault();

    const message = document.getElementById("formMessage");
    const exercise = document.getElementById("exercise").value;

    if (!exercise) {
        message.textContent = "Select an exercise.";
        return;
    }

    let reps = null;
    let sets = null;
    let weight = null;
    let amount = null;
    let unit = null;

    if (exercise === "Push-ups" || exercise === "Pull-ups" || exercise === "Squats") {
        reps = Number(document.getElementById("reps").value);
        sets = Number(document.getElementById("sets").value);
    }

    if (exercise === "Dumbbell") {
        weight = Number(document.getElementById("weight").value);
        reps = Number(document.getElementById("reps").value);
        sets = Number(document.getElementById("sets").value);
    }

    if (exercise === "Skipping Rope") {
        amount = Number(document.getElementById("amount").value);
        unit = "jumps";
    }

    if (exercise === "Running" || exercise === "Walking") {
        amount = Number(document.getElementById("amount").value);
        unit = "km";
    }

    message.textContent = "Saving...";

    try {
        const token = localStorage.getItem("token");
        if (!token) {
            message.textContent = "Please login first.";
            window.location.href = "login.html";
            return;
        }

        const response = await fetch(`${window.API_URL}/api/workouts`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                exercise,
                reps,
                sets,
                weight,
                amount,
                unit
            })
        });

        const data = await response.json();

        if (!response.ok) {
            message.textContent = data.message || "Could not save workout.";
            return;
        }

        message.textContent = "Workout saved successfully!";
        document.getElementById("workoutForm").reset();
        document.getElementById("exerciseFields").innerHTML = "";

        const totalDisplayEl = document.getElementById("totalDisplay");
        if (totalDisplayEl) {
            totalDisplayEl.style.display = "none";
            totalDisplayEl.textContent = "";
        }
    } catch (error) {
        console.error("Save workout error:", error);
        message.textContent = "Could not connect to server.";
    }
}

async function loadHistory() {
    const historyContainer = document.getElementById("history");
    if (!historyContainer) return;

    if (!getToken()) {
        window.location.href = "login.html";
        return;
    }

    try {
        const response = await fetch(`${window.API_URL}/api/workouts/history`, {
            headers: {
                "Authorization": `Bearer ${getToken()}`
            }
        });

        if (response.status === 401) {
            logout();
            return;
        }

        if (!response.ok) {
            throw new Error("Could not load history");
        }

        const workouts = await response.json();

        if (workouts.length === 0) {
            historyContainer.innerHTML = `<p class="no-workout">No workouts recorded yet.</p>`;
            return;
        }

        const grouped = new Map();
        workouts.forEach(workout => {
            const date = String(workout.date || "");
            if (!grouped.has(date)) grouped.set(date, []);
            grouped.get(date).push(workout);
        });

        historyContainer.innerHTML = "";

        [...grouped.keys()].sort().reverse().forEach(date => {
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
    } catch (error) {
        console.error(error);
        historyContainer.innerHTML = `<p class="no-workout">Could not load history.</p>`;
    }
}

loadToday();
loadHistory();
