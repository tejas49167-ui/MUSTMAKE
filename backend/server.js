const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const Workout = require("./models/Workout");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/env-test", (req, res) => {
    res.json({
        mongoUriExists: !!process.env.MONGO_URI,
        mongoUriLength: process.env.MONGO_URI
            ? process.env.MONGO_URI.length
            : 0
    });
});
/* =========================
   MONGODB
========================= */

mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
        console.log("MongoDB connected");
    })
    .catch((error) => {
        console.error(
            "MongoDB connection error:",
            error.message
        );
    });


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
            new Date()
                .toISOString()
                .split("T")[0];


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
                new Date()
                    .toISOString()
                    .split("T")[0];


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