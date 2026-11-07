const mongoose = require("mongoose");
const User = require("../models/User");
const connectDB = require("../config/database");
const { getNextReminderAt } = require("../utils/email-reminder-time");

const MIGRATION_VERSION = 1;

async function enableEmailRemindersForExistingUsers(userCollection = User.collection, now = new Date()) {
    return userCollection.updateMany(
        { emailReminderDefaultsMigrationVersion: { $ne: MIGRATION_VERSION } },
        {
            $set: {
                "emailPreferences.enabled": true,
                "emailPreferences.dailyExerciseReminder": true,
                "emailPreferences.nextReminderAt": getNextReminderAt(
                    now,
                    "18:00",
                    "Asia/Kolkata"
                ),
                emailReminderDefaultsMigrationVersion: MIGRATION_VERSION
            }
        }
    );
}

async function runMigration() {
    try {
        await connectDB();
        const result = await enableEmailRemindersForExistingUsers();
        console.log(`Enabled default workout reminders for ${result.modifiedCount} existing users.`);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    runMigration().catch(error => {
        console.error("Could not enable default workout reminders for existing users.", error);
        process.exitCode = 1;
    });
}

module.exports = { enableEmailRemindersForExistingUsers };
