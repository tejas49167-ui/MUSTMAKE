const mongoose = require("mongoose");

const otpGuardSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },

        purpose: {
            type: String,
            enum: ["login", "signup"],
            required: true
        },

        lastSentAt: {
            type: Date
        },

        failedAttempts: {
            type: Number,
            default: 0
        },

        attemptWindowStartedAt: {
            type: Date
        }
    },
    {
        timestamps: true
    }
);

otpGuardSchema.index({ email: 1, purpose: 1 }, { unique: true });
otpGuardSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("OTPGuard", otpGuardSchema);
