const mongoose = require("mongoose");

const loginRateLimitSchema = new mongoose.Schema(
    {
        scope: {
            type: String,
            enum: ["device", "ip"],
            required: true
        },
        keyHash: {
            type: String,
            required: true
        },
        failedAttempts: {
            type: Number,
            default: 0
        },
        windowStartedAt: {
            type: Date
        },
        restrictedUntil: {
            type: Date
        },
        expiresAt: {
            type: Date,
            required: true
        }
    },
    { timestamps: true }
);

loginRateLimitSchema.index({ scope: 1, keyHash: 1 }, { unique: true });
loginRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("LoginRateLimit", loginRateLimitSchema);
