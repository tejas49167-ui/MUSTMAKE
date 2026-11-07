const test = require("node:test");
const assert = require("node:assert/strict");
const { enableEmailRemindersForExistingUsers } =
    require("../scripts/enable-email-reminders");

test("existing users are enabled once and scheduled for 6 PM India time", async () => {
    let update;
    const now = new Date("2026-03-08T12:35:00.000Z");
    const collection = {
        async updateMany(filter, changes) {
            update = { filter, changes };
            return { modifiedCount: 1 };
        }
    };

    await enableEmailRemindersForExistingUsers(collection, now);

    assert.deepEqual(update.filter, {
        emailReminderDefaultsMigrationVersion: { $ne: 1 }
    });
    assert.equal(update.changes.$set["emailPreferences.enabled"], true);
    assert.equal(update.changes.$set["emailPreferences.dailyExerciseReminder"], true);
    assert.equal(update.changes.$set.emailReminderDefaultsMigrationVersion, 1);
    assert.equal(
        new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).format(update.changes.$set["emailPreferences.nextReminderAt"]),
        "18:00"
    );
});
