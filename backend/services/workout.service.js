const Workout = require("../models/Workout");

function createWorkoutRecord(workoutData) {
    return Workout.create(workoutData);
}

module.exports = { createWorkoutRecord };
