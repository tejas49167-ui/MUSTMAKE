const mongoose = require("mongoose");
const Workout = require("../models/Workout");
const connectDB = require("../config/database");
const { getDateString, calculateStreak } = require("../utils/date");
const { isPlainObject, parseWorkoutNumber } = require("../utils/validation");
const { createWorkoutRecord } = require("../services/workout.service");

const addWorkout = async (req, res) => {

        try {

            await connectDB();


            if (!isPlainObject(req.body)) {
                return res.status(400).json({ message: "Workout data must be an object." });
            }

            const { exercise, reps, sets, weight, amount } = req.body;
            const supportedExercises = new Set([
                "Push-ups", "Pull-ups", "Dumbbell", "Squats",
                "Skipping Rope", "Running", "Walking"
            ]);

            if (typeof exercise !== "string" || !supportedExercises.has(exercise)) {
                return res.status(400).json({ message: "Select a supported exercise." });
            }

            let workoutValues = { reps: null, sets: null, weight: null, amount: null, unit: null };
            if (["Push-ups", "Pull-ups", "Squats"].includes(exercise)) {
                const parsedReps = parseWorkoutNumber(reps, { integer: true, min: 1 });
                const parsedSets = parseWorkoutNumber(sets, { integer: true, min: 1 });
                if (!parsedReps.valid || !parsedSets.valid || !Number.isSafeInteger(parsedReps.value * parsedSets.value)) {
                    return res.status(400).json({ message: "Reps and sets must be positive whole numbers." });
                }
                workoutValues = { ...workoutValues, reps: parsedReps.value, sets: parsedSets.value };
            } else if (exercise === "Dumbbell") {
                const parsedWeight = parseWorkoutNumber(weight, { min: 0 });
                const parsedReps = parseWorkoutNumber(reps, { integer: true, min: 1 });
                const parsedSets = parseWorkoutNumber(sets, { integer: true, min: 1 });
                if (!parsedWeight.valid || !parsedReps.valid || !parsedSets.valid || !Number.isSafeInteger(parsedReps.value * parsedSets.value)) {
                    return res.status(400).json({ message: "Enter a valid weight, reps and sets." });
                }
                workoutValues = {
                    ...workoutValues,
                    weight: parsedWeight.value,
                    reps: parsedReps.value,
                    sets: parsedSets.value
                };
            } else {
                const parsedAmount = parseWorkoutNumber(amount, {
                    integer: exercise === "Skipping Rope",
                    min: exercise === "Skipping Rope" ? 1 : 0
                });
                if (!parsedAmount.valid) {
                    return res.status(400).json({ message: "Enter a valid workout amount." });
                }
                workoutValues = {
                    ...workoutValues,
                    amount: parsedAmount.value,
                    unit: exercise === "Skipping Rope" ? "jumps" : "km"
                };
            }


            const date =
                getDateString();


            const workout =
                await createWorkoutRecord({

                    // IMPORTANT:
                    // The logged-in user's ID comes
                    // from the JWT authentication.
                    user:
                        req.userId,

                    exercise,

                    ...workoutValues,

                    date
                });


            res.status(201).json(
                workout
            );


        } catch (error) {

            console.error(
                "Save workout error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not save workout."
            });
        }
    };

const getTodayWorkouts = async (req, res) => {

        try {

            await connectDB();


            const today =
                getDateString();


            const workouts =
                await Workout.find({

                    user:
                        req.userId,

                    date:
                        today

                }).sort({
                    createdAt:
                        -1
                });


            res.json(
                workouts
            );


        } catch (error) {

            console.error(
                "Load today's workouts error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not load workouts."
            });
        }
    };

const getStreak = async (req, res) => {

        try {

            await connectDB();


            const workouts =
                await Workout.find(

                    {
                        user:
                            req.userId
                    },

                    {
                        date:
                            1
                    }
                );


            const streak =
                calculateStreak(
                    workouts
                );


            res.json({
                streak
            });


        } catch (error) {

            console.error(
                "Load streak error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not load streak."
            });
        }
    };

const getWorkoutHistory = async (req, res) => {

        try {

            await connectDB();


            const workouts =
                await Workout.find({

                    user:
                        req.userId

                }).sort({

                    date:
                        -1,

                    createdAt:
                        -1
                });


            res.json(
                workouts
            );


        } catch (error) {

            console.error(
                "Load history error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not load history."
            });
        }
    };

const deleteWorkout = async (req, res) => {

        try {

            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(400).json({ message: "Invalid workout ID." });
            }

            await connectDB();


            const workout =
                await Workout.findOneAndDelete({

                    _id:
                        req.params.id,

                    // IMPORTANT:
                    // A user can delete only
                    // their own workout.
                    user:
                        req.userId
                });


            if (!workout) {

                return res.status(404).json({
                    message:
                        "Workout not found."
                });
            }


            res.json({
                success: true
            });


        } catch (error) {

            console.error(
                "Delete workout error:",
                error
            );


            res.status(500).json({
                message:
                    "Could not delete workout."
            });
        }
    };

module.exports = {
    addWorkout,
    getTodayWorkouts,
    getStreak,
    getWorkoutHistory,
    deleteWorkout
};
