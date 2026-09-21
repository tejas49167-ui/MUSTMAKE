const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const Workout = require("./models/Workout");

const app = express();

app.use(cors());
app.use(express.json());


/* =========================
   MONGODB
========================= */

let mongoConnection = null;

async function connectDB() {

    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is missing.");
    }

    if (mongoose.connection.readyState === 1) {
        return;
    }

    if (!mongoConnection) {

        mongoConnection = mongoose
            .connect(process.env.MONGO_URI, {
                serverSelectionTimeoutMS: 10000
            })
            .catch((error) => {

                mongoConnection = null;

                throw error;

            });
    }

    await mongoConnection;
}

async function requireDB(req, res, next) {

    try {

        await connectDB();

        next();

    } catch (error) {

        console.error(
            "MongoDB connection error:",
            error.message
        );

        res.status(503).json({
            message:
                "Database is waking up. Please try again."
        });

    }
}

app.use("/api", requireDB);


/* =========================
   DATE HELPERS
========================= */

const APP_TIME_ZONE =
    process.env.APP_TIME_ZONE || "Asia/Kolkata";

function getDateString(date = new Date()) {

    const parts =
        new Intl.DateTimeFormat("en-GB", {
            timeZone: APP_TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(date);

    const values = {};

    parts.forEach(part => {

        if (part.type !== "literal") {
            values[part.type] = part.value;
        }

    });

    return `${values.year}-${values.month}-${values.day}`;
}

function previousDateString(dateString) {

    const date =
        new Date(`${dateString}T00:00:00.000Z`);

    date.setUTCDate(
        date.getUTCDate() - 1
    );

    return date
        .toISOString()
        .split("T")[0];
}

function calculateStreak(workouts, person) {

    const dates =
        new Set(
            workouts
                .filter(workout =>
                    workout.person === person
                )
                .map(workout => workout.date)
        );

    let streak = 0;

    let dateString =
        getDateString();

    while (dates.has(dateString)) {

        streak++;

        dateString =
            previousDateString(dateString);

    }

    return streak;
}


/* =========================
   FIXED PEOPLE
========================= */

const people = [
    {
        name: "Tejas",
        secretCode: "A*"
    },
    {
        name: "Pakiresh",
        secretCode: "A,"
    }
];


/* =========================
   GET PEOPLE
========================= */

app.get("/api/people", (req, res) => {

    res.json(
        people.map(person => ({
            name: person.name
        }))
    );

});


/* =========================
   VERIFY SECRET CODE
========================= */

app.post("/api/verify", (req, res) => {

    const {
        person,
        secretCode
    } = req.body;


    const user = people.find(
        p => p.name === person
    );


    if (!user) {

        return res.status(400).json({
            success: false,
            message: "Person not found."
        });

    }


    if (user.secretCode !== secretCode) {

        return res.status(401).json({
            success: false,
            message: "Incorrect secret code."
        });

    }


    res.json({
        success: true
    });

});


/* =========================
   ADD WORKOUT
========================= */

app.post("/api/workouts", async (req, res) => {

    try {

        const {
            person,
            secretCode,
            exercise,
            reps,
            sets,
            weight,
            amount,
            unit
        } = req.body;


        /* Verify person */

        const user = people.find(
            p =>
                p.name === person &&
                p.secretCode === secretCode
        );


        if (!user) {

            return res.status(401).json({
                message:
                    "Incorrect secret code."
            });

        }


        const today =
            getDateString();


        const workout =
            await Workout.create({

                person,

                exercise,

                reps: reps || null,

                sets: sets || null,

                weight: weight || null,

                amount: amount || null,

                unit: unit || null,

                date: today

            });


        res.json(workout);

    }

    catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Could not save workout."
        });

    }

});


/* =========================
   TODAY'S WORKOUTS
========================= */

app.get(
    "/api/workouts/today",
    async (req, res) => {

        try {

            const today =
                getDateString();


            const workouts =
                await Workout.find({
                    date: today
                });


            res.json(workouts);

        }

        catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not load workouts."
            });

        }

    }
);


/* =========================
   STREAKS
========================= */

app.get(
    "/api/workouts/streaks",
    async (req, res) => {

        try {

            const workouts =
                await Workout.find(
                    {},
                    {
                        person: 1,
                        date: 1
                    }
                );


            res.json({
                Tejas: calculateStreak(
                    workouts,
                    "Tejas"
                ),
                Pakiresh: calculateStreak(
                    workouts,
                    "Pakiresh"
                )
            });

        }

        catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not load streaks."
            });

        }

    }
);


/* =========================
   HISTORY
========================= */

app.get(
    "/api/workouts/history",
    async (req, res) => {

        try {

            const workouts =
                await Workout.find()
                    .sort({
                        date: -1
                    });


            res.json(workouts);

        }

        catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not load history."
            });

        }

    }
);


/* =========================
   DELETE WORKOUT
========================= */

app.delete(
    "/api/workouts/:id",
    async (req, res) => {

        try {

            await Workout.findByIdAndDelete(
                req.params.id
            );


            res.json({
                success: true
            });

        }

        catch (error) {

            console.error(error);

            res.status(500).json({
                message:
                    "Could not delete workout."
            });

        }

    }
);


/* =========================
   SERVER
========================= */

const PORT =
    process.env.PORT || 4000;


app.listen(
    PORT,
    () => {

        console.log(
            `Server running at http://localhost:${PORT}`
        );

    }
);
