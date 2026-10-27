const mongoose = require("mongoose");
const Workout = require("../models/Workout");
const connectDB = require("../config/database");
const { getDateString, previousDateString } = require("../utils/date");
const { isPlainObject, parseWorkoutNumber } = require("../utils/validation");
const { createWorkoutRecord } = require("../services/workout.service");
const { getWorkoutHistoryPage } = require("../services/workout-history.service");
const exercises = require("../config/exercises.json");

const exercisesByName = new Map(exercises.map(exercise => [exercise.name, exercise]));

const addWorkout = async (req, res) => {
    try {
        if (!isPlainObject(req.body)) {
            return res.status(400).json({ message: "Workout data must be an object." });
        }

        const { exercise, reps, sets, weight, amount, duration } = req.body;
        const config = exercisesByName.get(exercise);
        const manualType = exercise === "Dumbbell"
            ? "weighted-sets-reps"
            : config?.manualType;

        if (typeof exercise !== "string" || !manualType) {
            return res.status(400).json({ message: "Select a supported exercise." });
        }

        let workoutValues = {
            reps: null,
            sets: null,
            weight: null,
            amount: null,
            duration: null,
            unit: null
        };

        if (manualType === "sets-reps" || manualType === "weighted-sets-reps") {
            const parsedReps = parseWorkoutNumber(reps, { integer: true, min: 1, max: 150 });
            const parsedSets = parseWorkoutNumber(sets, { integer: true, min: 1, max: 10 });
            if (!parsedReps.valid || !parsedSets.valid ||
                !Number.isSafeInteger(parsedReps.value * parsedSets.value)) {
                return res.status(400).json({ message: "Reps must be 1–150 and sets must be 1–10." });
            }

            workoutValues.reps = parsedReps.value;
            workoutValues.sets = parsedSets.value;

            if (manualType === "weighted-sets-reps") {
                const parsedWeight = parseWorkoutNumber(weight, { min: 0 });
                if (!parsedWeight.valid) {
                    return res.status(400).json({ message: "Enter a valid weight." });
                }
                workoutValues.weight = parsedWeight.value;
            }
        } else if (manualType === "duration") {
            const parsedDuration = parseWorkoutNumber(duration, { integer: true, min: 1, max: 900 });
            if (!parsedDuration.valid) {
                return res.status(400).json({ message: "Duration must be between 1 and 900 seconds." });
            }
            workoutValues.duration = parsedDuration.value;
        } else if (manualType === "distance-duration") {
            const parsedDistance = parseWorkoutNumber(amount, { min: 0, max: 50 });
            const parsedDuration = duration == null || duration === ""
                ? { valid: true, value: null }
                : parseWorkoutNumber(duration, { integer: true, min: 1 });
            if (!parsedDistance.valid || !parsedDuration.valid) {
                return res.status(400).json({ message: "Distance must be 50 km or less, with a valid duration." });
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
                return res.status(400).json({ message: "Enter a positive jump count and a valid duration." });
            }
            workoutValues.amount = parsedJumps.value;
            workoutValues.duration = parsedDuration.value;
            workoutValues.unit = "jumps";
        } else {
            return res.status(400).json({ message: "This exercise does not support manual entry yet." });
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
        console.error("Save workout error:", error);
        return res.status(500).json({ message: "Could not save workout." });
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

            const today = getDateString();
            const yesterday = previousDateString(today);
            const [result] = await Workout.aggregate([
                {
                    $match: {
                        user: new mongoose.Types.ObjectId(req.userId),
                        date: {
                            $lte: `${today}\uffff`,
                            $regex: /^\d{4}-\d{2}-\d{2}/
                        }
                    }
                },
                { $group: { _id: { $substrBytes: ["$date", 0, 10] } } },
                {
                    $set: {
                        dateValue: {
                            $dateFromString: {
                                dateString: "$_id",
                                format: "%Y-%m-%d",
                                onError: null
                            }
                        }
                    }
                },
                { $match: { dateValue: { $ne: null } } },
                { $sort: { dateValue: -1 } },
                {
                    $setWindowFields: {
                        sortBy: { dateValue: -1 },
                        output: {
                            newerDate: {
                                $shift: {
                                    output: "$dateValue",
                                    by: -1,
                                    default: null
                                }
                            }
                        }
                    }
                },
                {
                    $set: {
                        hasGap: {
                            $cond: [
                                { $eq: ["$newerDate", null] },
                                0,
                                {
                                    $cond: [
                                        {
                                            $eq: [
                                                {
                                                    $dateDiff: {
                                                        startDate: "$dateValue",
                                                        endDate: "$newerDate",
                                                        unit: "day"
                                                    }
                                                },
                                                1
                                            ]
                                        },
                                        0,
                                        1
                                    ]
                                }
                            ]
                        }
                    }
                },
                {
                    $setWindowFields: {
                        sortBy: { dateValue: -1 },
                        output: {
                            cumulativeGaps: {
                                $sum: "$hasGap",
                                window: { documents: ["unbounded", "current"] }
                            }
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        streak: {
                            $sum: {
                                $cond: [{ $eq: ["$cumulativeGaps", 0] }, 1, 0]
                            }
                        },
                        hasActiveDay: {
                            $max: {
                                $cond: [{ $in: ["$_id", [today, yesterday]] }, 1, 0]
                            }
                        }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        streak: {
                            $cond: ["$hasActiveDay", "$streak", 0]
                        }
                    }
                }
            ]);


            res.json({
                streak: result?.streak || 0
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

            const page = await getWorkoutHistoryPage(req.userId, req.query);
            if (page.invalidCursor) {
                return res.status(400).json({ message: "Invalid workout history cursor." });
            }

            res.json({ workouts: page.workouts, nextCursor: page.nextCursor });


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
