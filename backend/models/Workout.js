const mongoose = require("mongoose");

const workoutSchema = new mongoose.Schema({

    person: {
        type: String,
        required: true
    },

    exercise: {
        type: String,
        required: true
    },

    reps: {
        type: Number,
        default: null
    },

    sets: {
        type: Number,
        default: null
    },

    weight: {
        type: Number,
        default: null
    },

    amount: {
        type: Number,
        default: null
    },

    unit: {
        type: String,
        default: null
    },

    date: {
        type: String,
        required: true
    }

});

module.exports = mongoose.model(
    "Workout",
    workoutSchema
);