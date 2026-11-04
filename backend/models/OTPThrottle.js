const mongoose = require("mongoose");

const otpThrottleSchema = new mongoose.Schema(
    {
        keyHash: {
            type: String,
            required: true,
            unique: true
        },
        count: {
            type: Number,
            required: true,
            default: 0
        },
        windowStartedAt: {
            type: Date,
            required: true
        },
        expiresAt: {
            type: Date,
            required: true
        }
    },
    { timestamps: true }
);

otpThrottleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("OTPThrottle", otpThrottleSchema);
