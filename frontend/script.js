const API_URL = "http://localhost:4000";


// ==========================================
// GENERAL HELPERS
// ==========================================

function formatDate(dateString) {

    const date = new Date(dateString + "T00:00:00");

    return date.toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    });
}


function getToday() {

    const now = new Date();

    const year = now.getFullYear();

    const month =
        String(now.getMonth() + 1).padStart(2, "0");

    const day =
        String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}


function workoutDetails(workout) {

    if (
        workout.exercise === "Push-ups" ||
        workout.exercise === "Pull-ups" ||
        workout.exercise === "Squats"
    ) {

        const total =
            workout.reps * workout.sets;

        return `${workout.reps} reps × ${workout.sets} sets = ${total} reps`;
    }


    if (workout.exercise === "Dumbbell") {

        const total =
            workout.reps * workout.sets;

        return `${workout.weight} kg each hand · ${workout.reps} reps × ${workout.sets} sets = ${total} reps`;
    }


    if (workout.exercise === "Skipping Rope") {

        return `${workout.amount} jumps`;
    }


    if (
        workout.exercise === "Running" ||
        workout.exercise === "Walking"
    ) {

        return `${workout.amount} km`;
    }


    return "";
}


// ==========================================
// HOME PAGE
// ==========================================

async function loadToday() {

    const tejasContainer =
        document.getElementById("tejasWorkouts");

    const pakireshContainer =
        document.getElementById("pakireshWorkouts");

    if (!tejasContainer || !pakireshContainer) {
        return;
    }


    document.getElementById("todayDate").textContent =
        formatDate(getToday());


    try {

        const response =
            await fetch(`${API_URL}/api/workouts/today`);

        if (!response.ok) {
            throw new Error("Failed to load workouts");
        }

        const workouts =
            await response.json();


        const tejas =
            workouts.filter(
                workout => workout.person === "Tejas"
            );

        const pakiresh =
            workouts.filter(
                workout => workout.person === "Pakiresh"
            );


        displayTodayWorkouts(
            tejasContainer,
            tejas
        );

        displayTodayWorkouts(
            pakireshContainer,
            pakiresh
        );


        loadStreaks();

    } catch (error) {

        console.error(error);

        tejasContainer.textContent =
            "Could not load workouts.";

        pakireshContainer.textContent =
            "Could not load workouts.";
    }
}


function displayTodayWorkouts(container, workouts) {

    if (workouts.length === 0) {

        container.innerHTML =
            `<p class="no-workout">
                No workout recorded yet.
            </p>`;

        return;
    }


    container.innerHTML = "";


    workouts.forEach(workout => {

        const item =
            document.createElement("div");

        item.className = "workout-item";

        item.innerHTML = `
            <div class="workout-name">
                ${workout.exercise}
            </div>

            <div class="workout-details">
                ${workoutDetails(workout)}
            </div>
        `;

        container.appendChild(item);

    });
}


// ==========================================
// STREAKS
// ==========================================

async function loadStreaks() {

    const tejasElement =
        document.getElementById("tejasStreak");

    const pakireshElement =
        document.getElementById("pakireshStreak");


    if (!tejasElement || !pakireshElement) {
        return;
    }


    try {

        const response =
            await fetch(
                `${API_URL}/api/workouts/history`
            );

        const workouts =
            await response.json();


        tejasElement.textContent =
            calculateStreak(
                workouts,
                "Tejas"
            );


        pakireshElement.textContent =
            calculateStreak(
                workouts,
                "Pakiresh"
            );

    } catch (error) {

        console.error(
            "Streak error:",
            error
        );

    }
}


function calculateStreak(workouts, person) {

    const dates = new Set(

        workouts
            .filter(
                workout =>
                    workout.person === person
            )
            .map(
                workout =>
                    workout.date
            )

    );


    let streak = 0;

    let date = new Date();


    while (true) {

        const year =
            date.getFullYear();

        const month =
            String(
                date.getMonth() + 1
            ).padStart(2, "0");

        const day =
            String(
                date.getDate()
            ).padStart(2, "0");


        const dateString =
            `${year}-${month}-${day}`;


        if (!dates.has(dateString)) {
            break;
        }


        streak++;

        date.setDate(
            date.getDate() - 1
        );
    }


    return streak;
}


// ==========================================
// ADD WORKOUT PAGE
// ==========================================

const exerciseSelect =
    document.getElementById("exercise");

const exerciseFields =
    document.getElementById("exerciseFields");

const totalDisplay =
    document.getElementById("totalDisplay");


if (exerciseSelect) {

    exerciseSelect.addEventListener(
        "change",
        updateExerciseFields
    );
}


function updateExerciseFields() {

    const exercise =
        exerciseSelect.value;


    exerciseFields.innerHTML = "";

    totalDisplay.style.display =
        "none";


    if (!exercise) {
        return;
    }


    if (
        exercise === "Push-ups" ||
        exercise === "Pull-ups" ||
        exercise === "Squats"
    ) {

        exerciseFields.innerHTML = `

            <div class="dynamic-grid">

                <div class="field">

                    <label>
                        Reps
                    </label>

                    <input
                        type="number"
                        id="reps"
                        min="1"
                        placeholder="Example: 20"
                        required
                    >

                </div>


                <div class="field">

                    <label>
                        Sets
                    </label>

                    <input
                        type="number"
                        id="sets"
                        min="1"
                        placeholder="Example: 3"
                        required
                    >

                </div>

            </div>

        `;


        addTotalListeners();

        return;
    }


    if (exercise === "Dumbbell") {

        exerciseFields.innerHTML = `

            <div class="field">

                <label>
                    Weight per hand (kg)
                </label>

                <input
                    type="number"
                    id="weight"
                    min="0"
                    step="0.5"
                    placeholder="Example: 5"
                    required
                >

            </div>


            <div class="dynamic-grid">

                <div class="field">

                    <label>
                        Reps
                    </label>

                    <input
                        type="number"
                        id="reps"
                        min="1"
                        placeholder="Example: 15"
                        required
                    >

                </div>


                <div class="field">

                    <label>
                        Sets
                    </label>

                    <input
                        type="number"
                        id="sets"
                        min="1"
                        placeholder="Example: 3"
                        required
                    >

                </div>

            </div>

        `;


        addTotalListeners();

        return;
    }


    if (exercise === "Skipping Rope") {

        exerciseFields.innerHTML = `

            <div class="field">

                <label>
                    Number of jumps
                </label>

                <input
                    type="number"
                    id="amount"
                    min="1"
                    placeholder="Example: 100"
                    required
                >

            </div>

        `;

        return;
    }


    if (
        exercise === "Running" ||
        exercise === "Walking"
    ) {

        exerciseFields.innerHTML = `

            <div class="field">

                <label>
                    Distance (km)
                </label>

                <input
                    type="number"
                    id="amount"
                    min="0"
                    step="0.01"
                    placeholder="Example: 5"
                    required
                >

            </div>

        `;

        return;
    }
}


function addTotalListeners() {

    const reps =
        document.getElementById("reps");

    const sets =
        document.getElementById("sets");


    if (!reps || !sets) {
        return;
    }


    function updateTotal() {

        const repsValue =
            Number(reps.value);

        const setsValue =
            Number(sets.value);


        if (
            repsValue > 0 &&
            setsValue > 0
        ) {

            totalDisplay.style.display =
                "block";

            totalDisplay.textContent =
                `Total: ${repsValue * setsValue} reps`;

        } else {

            totalDisplay.style.display =
                "none";
        }
    }


    reps.addEventListener(
        "input",
        updateTotal
    );

    sets.addEventListener(
        "input",
        updateTotal
    );
}


// ==========================================
// SAVE WORKOUT
// ==========================================

const workoutForm =
    document.getElementById("workoutForm");


if (workoutForm) {

    workoutForm.addEventListener(
        "submit",
        saveWorkout
    );
}


async function saveWorkout(event) {

    event.preventDefault();


    const message =
        document.getElementById("formMessage");


    const person =
        document.getElementById("person").value;

    const secretCode =
        document.getElementById("secretCode").value;

    const exercise =
        document.getElementById("exercise").value;


    if (!person) {

        message.textContent =
            "Select a person.";

        return;
    }


    if (!secretCode) {

        message.textContent =
            "Enter the secret code.";

        return;
    }


    if (!exercise) {

        message.textContent =
            "Select an exercise.";

        return;
    }


    let reps = null;
    let sets = null;
    let weight = null;
    let amount = null;
    let unit = null;


    if (
        exercise === "Push-ups" ||
        exercise === "Pull-ups" ||
        exercise === "Squats"
    ) {

        reps =
            Number(
                document.getElementById("reps").value
            );

        sets =
            Number(
                document.getElementById("sets").value
            );
    }


    if (exercise === "Dumbbell") {

        weight =
            Number(
                document.getElementById("weight").value
            );

        reps =
            Number(
                document.getElementById("reps").value
            );

        sets =
            Number(
                document.getElementById("sets").value
            );
    }


    if (exercise === "Skipping Rope") {

        amount =
            Number(
                document.getElementById("amount").value
            );

        unit = "jumps";
    }


    if (
        exercise === "Running" ||
        exercise === "Walking"
    ) {

        amount =
            Number(
                document.getElementById("amount").value
            );

        unit = "km";
    }


    message.textContent =
        "Saving...";


    try {

        const response =
            await fetch(
                `${API_URL}/api/workouts`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        person,
                        secretCode,
                        exercise,
                        reps,
                        sets,
                        weight,
                        amount,
                        unit
                    })
                }
            );


        const data =
            await response.json();


        if (!response.ok) {

            message.textContent =
                data.message ||
                "Could not save workout.";

            return;
        }


        message.textContent =
            "Workout saved successfully.";


        workoutForm.reset();

        exerciseFields.innerHTML = "";

        totalDisplay.style.display =
            "none";


        setTimeout(() => {

            window.location.href =
                "index.html";

        }, 700);


    } catch (error) {

        console.error(error);

        message.textContent =
            "Could not connect to server.";
    }
}


// ==========================================
// HISTORY PAGE
// ==========================================

async function loadHistory() {

    const historyContainer =
        document.getElementById("history");


    if (!historyContainer) {
        return;
    }


    try {

        const response =
            await fetch(
                `${API_URL}/api/workouts/history`
            );


        if (!response.ok) {
            throw new Error(
                "Could not load history"
            );
        }


        const workouts =
            await response.json();


        if (workouts.length === 0) {

            historyContainer.innerHTML = `
                <p class="no-workout">
                    No workouts recorded yet.
                </p>
            `;

            return;
        }


        const grouped = {};


        workouts.forEach(workout => {

            if (!grouped[workout.date]) {
                grouped[workout.date] = [];
            }

            grouped[workout.date].push(
                workout
            );

        });


        historyContainer.innerHTML = "";


        Object.keys(grouped)
            .sort()
            .reverse()
            .forEach(date => {

                const day =
                    document.createElement("div");

                day.className =
                    "history-day";


                let html = `
                    <div class="history-date">
                        ${formatDate(date)}
                    </div>
                `;


                ["Tejas", "Pakiresh"]
                    .forEach(person => {

                        const personWorkouts =
                            grouped[date].filter(
                                workout =>
                                    workout.person === person
                            );


                        if (
                            personWorkouts.length === 0
                        ) {
                            return;
                        }


                        html += `
                            <div class="history-person">

                                <h3>
                                    ${person}
                                </h3>
                        `;


                        personWorkouts.forEach(
                            workout => {

                                html += `
                                    <div class="history-workout">

                                        <div class="workout-name">
                                            ${workout.exercise}
                                        </div>

                                        <div class="workout-details">
                                            ${workoutDetails(workout)}
                                        </div>

                                    </div>
                                `;

                            }
                        );


                        html += `
                            </div>
                        `;

                    });


                day.innerHTML = html;

                historyContainer.appendChild(day);

            });


    } catch (error) {

        console.error(error);

        historyContainer.innerHTML =
            `<p class="no-workout">
                Could not load history.
            </p>`;
    }
}


// ==========================================
// PAGE DETECTION
// ==========================================

loadToday();

loadHistory();