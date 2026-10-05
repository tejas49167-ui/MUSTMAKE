const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true
        },

        otpHash: {
            type: String,
            required: true
        },

        purpose: {
            type: String,
            enum: ["login", "signup"],
            required: true
        },

        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 }
        },

        attempts: {
            type: Number,
            default: 0
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("OTP", otpSchema);