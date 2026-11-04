const mongoose = require("mongoose");

const pendingSignupSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },
        username: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },
        passwordHash: {
            type: String,
            default: null
        },
        googleId: {
            type: String,
            default: null
        },
        profilePicture: {
            type: String,
            default: null
        },
        authProvider: {
            type: String,
            enum: ["password", "google"],
            default: "password",
            required: true
        },
        tokenHash: {
            type: String,
            required: true,
            unique: true
        },
        expiresAt: {
            type: Date,
            required: true,
            index: { expires: 0 }
        }
    },
    { timestamps: true }
);

pendingSignupSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model("PendingSignup", pendingSignupSchema);
