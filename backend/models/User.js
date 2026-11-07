const mongoose = require("mongoose");
const { getDateString } = require("../utils/date");
const { getNextReminderAt } = require("../utils/email-reminder-time");

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

        legalConsentAt: {
            type: Date,
            default: null
        },

        emailVerifiedAt: {
            type: Date,
            default: null
        },

        emailPreferences: {
            enabled: {
                type: Boolean,
                default: true
            },
            dailyExerciseReminder: {
                type: Boolean,
                default: true
            },
            productUpdates: {
                type: Boolean,
                default: false
            },
            reminderTime: {
                type: String,
                default: "09:00"
            },
            timeZone: {
                type: String,
                default: "Asia/Kolkata"
            },
            nextReminderAt: {
                type: Date,
                default: () => getNextReminderAt(new Date(), "18:00", "Asia/Kolkata")
            }
        },

        emailReminderDefaultsMigrationVersion: {
            type: Number,
            default: null,
            select: false
        },

        googleId: {
            type: String
        },

        profilePicture: {
            type: String,
            default: null
        },

        age: {
            type: Number,
            min: 0,
            max: 120,
            default: null,
            get(value) {
                if (value === null || value === undefined) return value;

                const referenceYear = this.get("ageReferenceYear");
                if (!Number.isInteger(referenceYear)) return value;

                const currentYear = Number(getDateString().slice(0, 4));
                return value + currentYear - referenceYear;
            }
        },

        ageReferenceYear: {
            type: Number,
            default: null,
            select: false
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
            type: mongoose.Schema.Types.Mixed,
            default: () => ({})
        }
    },
    {
        timestamps: true,
        toJSON: { getters: true },
        toObject: { getters: true }
    }
);

userSchema.index(
    { googleId: 1 },
    {
        unique: true,
        partialFilterExpression: { googleId: { $type: "string" } }
    }
);

userSchema.index(
    { "emailPreferences.nextReminderAt": 1 },
    {
        partialFilterExpression: {
            "emailPreferences.enabled": true,
            "emailPreferences.dailyExerciseReminder": true
        }
    }
);

module.exports =
    mongoose.model("User", userSchema);
