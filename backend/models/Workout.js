const mongoose = require("mongoose");

const workoutSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
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

        duration: {
            type: Number,
            min: 1,
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
    },
    {
        timestamps: true
    }
);

workoutSchema.index({ user: 1, date: -1, createdAt: -1, _id: -1 });
workoutSchema.index({ user: 1, createdAt: 1 });

module.exports = mongoose.model(
    "Workout",
    workoutSchema
);
