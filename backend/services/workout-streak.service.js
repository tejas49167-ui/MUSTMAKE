const Workout = require("../models/Workout");
const { calculateStreak } = require("../utils/date");

async function getWorkoutStreak(userId, today, workoutModel = Workout) {
    const workoutDates = await workoutModel.distinct("date", {
        user: userId,
        date: {
            $lte: `${today}\uffff`,
            $regex: /^\d{4}-\d{2}-\d{2}/
        }
    });

    return calculateStreak(workoutDates, today);
}

module.exports = { getWorkoutStreak };
