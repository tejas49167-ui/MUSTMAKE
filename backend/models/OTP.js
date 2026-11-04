const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },

        otpHash: {
            type: String,
            required: true
        },

        challengeHash: {
            type: String,
            required: true
        },

        purpose: {
            type: String,
            enum: ["login", "signup"],
            required: true
        },

        signupData: {
            name: { type: String, trim: true },
            username: { type: String, lowercase: true, trim: true },
            passwordHash: { type: String }
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

otpSchema.index({ email: 1, purpose: 1 });

module.exports = mongoose.model("OTP", otpSchema);
