const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../models/User");
const controller = require("../controllers/email-preferences.controller");

function responseStub() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

function stubUserModel(t, user) {
    const originalFindById = User.findById;
    const originalFindByIdAndUpdate = User.findByIdAndUpdate;
    const originalReadyState = mongoose.connection.readyState;
    const originalMongoUri = process.env.MONGO_URI;
    let savedPreferences = null;

    mongoose.connection.readyState = 1;
    process.env.MONGO_URI = "mongodb://127.0.0.1:27017/mustmake-email-preferences-test";
    User.findById = () => ({ select: async () => user });
    User.findByIdAndUpdate = (id, update, options) => {
        assert.equal(id, "user-1");
        assert.equal(options.runValidators, true);
        savedPreferences = { ...user.emailPreferences };
        for (const [path, value] of Object.entries(update.$set)) {
            const preferenceKey = path.replace("emailPreferences.", "");
            savedPreferences[preferenceKey] = value;
        }
        return {
            select: async () => ({
                ...user,
                emailPreferences: savedPreferences
            })
        };
    };

    t.after(() => {
        User.findById = originalFindById;
        User.findByIdAndUpdate = originalFindByIdAndUpdate;
        mongoose.connection.readyState = originalReadyState;
        if (originalMongoUri === undefined) delete process.env.MONGO_URI;
        else process.env.MONGO_URI = originalMongoUri;
    });

    return { getSavedPreferences: () => savedPreferences };
}

test("new users are opted out of optional email notifications by default", () => {
    const user = new User({
        name: "Athlete",
        email: "athlete@example.test"
    });

    assert.equal(user.emailPreferences.enabled, false);
    assert.equal(user.emailPreferences.dailyExerciseReminder, false);
    assert.equal(user.emailPreferences.productUpdates, false);
});

test("email preference update persists IANA timezone and next due instant", async t => {
    const user = {
        _id: "user-1",
        emailVerifiedAt: new Date(),
        emailPreferences: {
            enabled: false,
            dailyExerciseReminder: false,
            productUpdates: false,
            reminderTime: "09:00",
            timeZone: "Asia/Kolkata",
            nextReminderAt: null
        }
    };
    const model = stubUserModel(t, user);
    const response = responseStub();

    await controller.updatePreferences({
        userId: "user-1",
        body: {
            enabled: true,
            dailyExerciseReminder: true,
            productUpdates: true,
            reminderTime: "08:15",
            timeZone: "America/New_York"
        }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.preferences.emailVerified, true);
    assert.equal(model.getSavedPreferences().timeZone, "America/New_York");
    assert.equal(model.getSavedPreferences().reminderTime, "08:15");
    assert.ok(model.getSavedPreferences().nextReminderAt instanceof Date);
    assert.ok(model.getSavedPreferences().nextReminderAt > new Date());
});

test("disabled master notifications clear the indexed next reminder", async t => {
    const user = {
        _id: "user-1",
        emailVerifiedAt: null,
        emailPreferences: {
            enabled: true,
            dailyExerciseReminder: true,
            productUpdates: true,
            reminderTime: "09:00",
            timeZone: "Asia/Kolkata",
            nextReminderAt: new Date(Date.now() - 60_000)
        }
    };
    const model = stubUserModel(t, user);
    const response = responseStub();

    await controller.updatePreferences({
        userId: "user-1",
        body: { enabled: false }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(model.getSavedPreferences().enabled, false);
    assert.equal(model.getSavedPreferences().dailyExerciseReminder, true);
    assert.equal(model.getSavedPreferences().nextReminderAt, null);
});

test("invalid timezones and reminder times are rejected without persistence", async t => {
    const user = {
        _id: "user-1",
        emailVerifiedAt: null,
        emailPreferences: {}
    };
    const model = stubUserModel(t, user);

    for (const body of [
        { timeZone: "Mars/Olympus" },
        { reminderTime: "25:90" }
    ]) {
        const response = responseStub();
        await controller.updatePreferences({ userId: "user-1", body }, response);
        assert.equal(response.statusCode, 400);
        assert.equal(model.getSavedPreferences(), null);
    }
});
