const User = require("../models/User");
const connectDB = require("../config/database");
const { isPlainObject } = require("../utils/validation");
const { getNextReminderAt } = require("../utils/email-reminder-time");
const { logFailure } = require("../utils/safe-log");

const BOOLEAN_PREFERENCES = ["enabled", "dailyExerciseReminder"];

function serializePreferences(user) {
    const preferences = user.emailPreferences || {};
    return {
        enabled: preferences.enabled === true,
        dailyExerciseReminder: preferences.dailyExerciseReminder === true,
        emailVerified: Boolean(user.emailVerifiedAt)
    };
}

async function getPreferences(req, res) {
    try {
        await connectDB();
        const user = await User.findById(req.userId)
            .select("emailVerifiedAt emailPreferences");
        if (!user) return res.status(404).json({ message: "User not found." });

        return res.json({
            success: true,
            preferences: serializePreferences(user)
        });
    } catch (error) {
        logFailure("Load email preferences failed.", error);
        return res.status(500).json({ message: "Could not load email preferences." });
    }
}

async function updatePreferences(req, res) {
    if (!isPlainObject(req.body)) {
        return res.status(400).json({ message: "Email preferences must be an object." });
    }

    const allowedKeys = new Set(BOOLEAN_PREFERENCES);
    if (Object.keys(req.body).some(key => !allowedKeys.has(key))) {
        return res.status(400).json({ message: "Email preferences contain an unsupported field." });
    }

    for (const key of BOOLEAN_PREFERENCES) {
        if (req.body[key] !== undefined && typeof req.body[key] !== "boolean") {
            return res.status(400).json({ message: `${key} must be a boolean.` });
        }
    }
    try {
        await connectDB();
        const user = await User.findById(req.userId)
            .select("emailVerifiedAt emailPreferences");
        if (!user) return res.status(404).json({ message: "User not found." });

        const current = user.emailPreferences || {};
        const updated = {
            enabled: req.body.enabled ?? current.enabled ?? false,
            dailyExerciseReminder: req.body.dailyExerciseReminder ??
                current.dailyExerciseReminder ?? false
        };
        const isReminderEnabled = updated.enabled && updated.dailyExerciseReminder;
        const nextReminderAt = isReminderEnabled
            ? getNextReminderAt(new Date(), "18:00", "Asia/Kolkata")
            : null;
        const fieldsToSave = {};
        for (const [key, value] of Object.entries(req.body)) {
            fieldsToSave[`emailPreferences.${key}`] = value;
        }
        fieldsToSave["emailPreferences.nextReminderAt"] = nextReminderAt;

        const savedUser = await User.findByIdAndUpdate(
            req.userId,
            { $set: fieldsToSave },
            { new: true, runValidators: true }
        ).select("emailVerifiedAt emailPreferences");
        if (!savedUser) return res.status(404).json({ message: "User not found." });

        return res.json({
            success: true,
            preferences: serializePreferences(savedUser)
        });
    } catch (error) {
        logFailure("Update email preferences failed.", error);
        return res.status(500).json({ message: "Could not save email preferences." });
    }
}

module.exports = { getPreferences, updatePreferences };
