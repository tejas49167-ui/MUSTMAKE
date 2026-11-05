const mongoose = require("mongoose");

const emailNotificationLogSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        notificationType: {
            type: String,
            enum: ["daily-exercise-reminder"],
            required: true
        },
        localDate: {
            type: String,
            required: true,
            match: /^\d{4}-\d{2}-\d{2}$/
        },
        status: {
            type: String,
            enum: ["pending", "sending", "sent", "failed", "skipped"],
            default: "pending",
            required: true
        },
        resendMessageId: {
            type: String,
            default: null
        },
        attemptCount: {
            type: Number,
            min: 0,
            default: 0
        },
        leaseToken: {
            type: String,
            default: null
        },
        leaseExpiresAt: {
            type: Date,
            default: null
        },
        nextAttemptAt: {
            type: Date,
            default: null
        },
        lastAttemptAt: {
            type: Date,
            default: null
        },
        deliveredAt: {
            type: Date,
            default: null
        },
        lastError: {
            type: String,
            default: null,
            maxlength: 300
        }
    },
    { timestamps: true }
);

emailNotificationLogSchema.index(
    { user: 1, notificationType: 1, localDate: 1 },
    { unique: true }
);

module.exports = mongoose.model("EmailNotificationLog", emailNotificationLogSchema);
