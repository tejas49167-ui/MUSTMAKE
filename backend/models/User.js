const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },

        username: {
            type: String,
            unique: true,
            sparse: true,
            lowercase: true,
            trim: true
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        passwordHash: {
            type: String,
            default: null
        },

        googleId: {
            type: String,
            unique: true,
            sparse: true
        },

        profilePicture: {
            type: String,
            default: null
        },

        dateOfBirth: {
            type: Date,
            default: null
        },

        height: {
            type: Number,
            default: null
        },

        weight: {
            type: Number,
            default: null
        },

        socials: {
            instagram: {
                type: String,
                default: null
            },

            youtube: {
                type: String,
                default: null
            },

            github: {
                type: String,
                default: null
            },

            x: {
                type: String,
                default: null
            }
        }
    },
    {
        timestamps: true
    }
);

module.exports =
    mongoose.model("User", userSchema);