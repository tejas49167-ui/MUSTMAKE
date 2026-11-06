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

test("enabling reminders schedules them for 6 PM India time", async t => {
    const user = {
        _id: "user-1",
        emailVerifiedAt: new Date(),
        emailPreferences: {
            enabled: false,
            dailyExerciseReminder: false,
            nextReminderAt: null
        }
    };
    const model = stubUserModel(t, user);
    const response = responseStub();

    await controller.updatePreferences({
        userId: "user-1",
        body: {
            enabled: true,
            dailyExerciseReminder: true
        }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.preferences.emailVerified, true);
    assert.ok(model.getSavedPreferences().nextReminderAt instanceof Date);
    assert.ok(model.getSavedPreferences().nextReminderAt > new Date());
    assert.equal(
        new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).format(model.getSavedPreferences().nextReminderAt),
        "18:00"
    );
});

test("disabled master notifications clear the indexed next reminder", async t => {
    const user = {
        _id: "user-1",
        emailVerifiedAt: null,
        emailPreferences: {
            enabled: true,
            dailyExerciseReminder: true,
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

test("unsupported reminder scheduling fields are rejected without persistence", async t => {
    const user = {
        _id: "user-1",
        emailVerifiedAt: null,
        emailPreferences: {}
    };
    const model = stubUserModel(t, user);

    const response = responseStub();
    await controller.updatePreferences({
        userId: "user-1",
        body: { reminderTime: "21:00" }
    }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(model.getSavedPreferences(), null);
});
