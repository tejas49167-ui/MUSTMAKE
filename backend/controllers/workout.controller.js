const mongoose = require("mongoose");
const Workout = require("../models/Workout");
const connectDB = require("../config/database");
const { getDateString } = require("../utils/date");
const { isPlainObject, parseWorkoutNumber } = require("../utils/validation");
const { createWorkoutRecord } = require("../services/workout.service");
const { getWorkoutHistoryPage } = require("../services/workout-history.service");
const { getWorkoutStreak } = require("../services/workout-streak.service");
const exercises = require("../config/exercises.json");
const { logFailure } = require("../utils/safe-log");

const exercisesByName = new Map(exercises.map(exercise => [exercise.name, exercise]));

const addWorkout = async (req, res) => {
    try {
        if (!isPlainObject(req.body)) {
            return res.status(400).json({ message: "Workout data must be an object." });
        }

        const { exercise, reps, sets, weight, amount, duration } = req.body;
        const config = exercisesByName.get(exercise);
        const manualType = config?.manualType;

        if (typeof exercise !== "string" || !manualType) {
            return res.status(400).json({ message: "Select a supported exercise." });
        }

        const workoutValues = {
            reps: null,
            sets: null,
            weight: null,
            amount: null,
            duration: null,
            unit: null
        };

        if (manualType === "sets-reps" || manualType === "weighted-sets-reps") {
            const parsedReps = parseWorkoutNumber(reps, {
                integer: true,
                min: 1,
                max: 150
            });
            const parsedSets = parseWorkoutNumber(sets, {
                integer: true,
                min: 1,
                max: 10
            });
            if (!parsedReps.valid || !parsedSets.valid ||
                !Number.isSafeInteger(parsedReps.value * parsedSets.value)) {
                return res.status(400).json({
                    message: "Reps must be 1–150 and sets must be 1–10."
                });
            }

            workoutValues.reps = parsedReps.value;
            workoutValues.sets = parsedSets.value;

            if (manualType === "weighted-sets-reps") {
                const weightField = config.fields?.find(field => field.name === "weight");
                const minWeight = weightField?.min ?? 0;
                const maxWeight = weightField?.max ?? 60;
                const weightStep = weightField?.step ?? 0.5;
                const parsedWeight = parseWorkoutNumber(weight, {
                    min: minWeight,
                    max: maxWeight
                });

                if (
                    !parsedWeight.valid ||
                    !Number.isInteger((parsedWeight.value - minWeight) / weightStep)
                ) {
                    return res.status(400).json({
                        message: `Weight must be between ${minWeight} and ${maxWeight} kg in ${weightStep} kg increments.`
                    });
                }
                workoutValues.weight = parsedWeight.value;
            }
        } else if (manualType === "duration") {
            const durationField = config.fields?.find(field => field.name === "duration");
            const minDuration = durationField?.min ?? 1;
            const maxDuration = durationField?.max ?? 900;
            const parsedDuration = parseWorkoutNumber(duration, {
                integer: true,
                min: minDuration,
                max: maxDuration
            });

            if (!parsedDuration.valid) {
                return res.status(400).json({
                    message: `Duration must be between ${minDuration} and ${maxDuration} seconds.`
                });
            }
            workoutValues.duration = parsedDuration.value;
        } else if (manualType === "distance-duration") {
            const parsedDistance = parseWorkoutNumber(amount, { min: 0, max: 50 });
            const parsedDuration = duration == null || duration === ""
                ? { valid: true, value: null }
                : parseWorkoutNumber(duration, { integer: true, min: 1 });

            if (!parsedDistance.valid || !parsedDuration.valid) {
                return res.status(400).json({
                    message: "Distance must be 50 km or less, with a valid duration."
                });
            }
            workoutValues.amount = parsedDistance.value;
            workoutValues.duration = parsedDuration.value;
            workoutValues.unit = "km";
        } else if (manualType === "jumps-duration") {
            const parsedJumps = parseWorkoutNumber(amount, { integer: true, min: 1 });
            const parsedDuration = duration == null || duration === ""
                ? { valid: true, value: null }
                : parseWorkoutNumber(duration, { integer: true, min: 1 });

            if (!parsedJumps.valid || !parsedDuration.valid) {
                return res.status(400).json({
                    message: "Enter a positive jump count and a valid duration."
                });
            }
            workoutValues.amount = parsedJumps.value;
            workoutValues.duration = parsedDuration.value;
            workoutValues.unit = "jumps";
        } else {
            return res.status(400).json({
                message: "This exercise does not support manual entry yet."
            });
        }

        await connectDB();
        const workout = await createWorkoutRecord({
            user: req.userId,
            exercise,
            ...workoutValues,
            date: getDateString()
        });

        return res.status(201).json(workout);
    } catch (error) {
        logFailure("Save workout failed.", error);
        return res.status(500).json({ message: "Could not save workout." });
    }
};

const getTodayWorkouts = async (req, res) => {
    try {
        await connectDB();
        const workouts = await Workout.find({
            user: req.userId,
            date: getDateString()
        }).sort({ createdAt: -1 });

        return res.json(workouts);
    } catch (error) {
        logFailure("Load today's workouts failed.", error);
        return res.status(500).json({ message: "Could not load workouts." });
    }
};

const getStreak = async (req, res) => {
    try {
        await connectDB();
        const streak = await getWorkoutStreak(req.userId, getDateString());
        return res.json({ streak });
    } catch (error) {
        logFailure("Load streak failed.", error);
        return res.status(500).json({ message: "Could not load streak." });
    }
};

const getWorkoutHistory = async (req, res) => {
    try {
        await connectDB();
        const page = await getWorkoutHistoryPage(req.userId, req.query);
        if (page.invalidCursor) {
            return res.status(400).json({ message: "Invalid workout history cursor." });
        }

        return res.json({
            workouts: page.workouts,
            nextCursor: page.nextCursor
        });
    } catch (error) {
        logFailure("Load workout history failed.", error);
        return res.status(500).json({ message: "Could not load history." });
    }
};

const deleteWorkout = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ message: "Invalid workout ID." });
        }

        await connectDB();
        const workout = await Workout.findOneAndDelete({
            _id: req.params.id,
            user: req.userId
        });

        if (!workout) {
            return res.status(404).json({ message: "Workout not found." });
        }

        return res.json({ success: true });
    } catch (error) {
        logFailure("Delete workout failed.", error);
        return res.status(500).json({ message: "Could not delete workout." });
    }
};

module.exports = {
    addWorkout,
    getTodayWorkouts,
    getStreak,
    getWorkoutHistory,
    deleteWorkout
};
