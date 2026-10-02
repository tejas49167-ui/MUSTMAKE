const mongoose = require("mongoose");

const competitionSchema = new mongoose.Schema(
    {
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        competitor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    {
        timestamps: true
    }
);

// Prevent adding the same competitor twice
competitionSchema.index(
    {
        owner: 1,
        competitor: 1
    },
    {
        unique: true
    }
);

module.exports =
    mongoose.model(
        "Competition",
        competitionSchema
    );