const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../models/User");
const Workout = require("../models/Workout");
const Competition = require("../models/Competition");
const OTP = require("../models/OTP");
const OTPGuard = require("../models/OTPGuard");
const { deleteAccount } = require("../controllers/profile.controller");

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

function stubAccountDeletion(t, { failAt = null, accountExists = true } = {}) {
    const models = [User, Workout, Competition, OTP, OTPGuard];
    const originalMethods = models.map(model => ({
        model,
        methods: {
            findById: model.findById,
            deleteOne: model.deleteOne,
            deleteMany: model.deleteMany
        }
    }));
    const originalStartSession = mongoose.startSession;
    const originalConnect = mongoose.connect;
    const originalReadyState = mongoose.connection.readyState;
    const originalMongoUri = process.env.MONGO_URI;
    const calls = [];
    const session = {
        async withTransaction(callback) {
            try {
                await callback();
                this.committed = true;
            } catch (error) {
                this.aborted = true;
                throw error;
            }
        },
        async endSession() {
            this.ended = true;
        }
    };
    const account = {
        email: "athlete@example.test",
        profilePicture: null
    };
    const deleteMany = modelName => async (filter, options) => {
        calls.push({ modelName, filter, options });
        if (failAt === modelName) throw new Error(`delete failure: ${modelName}`);
        return { deletedCount: 1 };
    };

    mongoose.connection.readyState = 1;
    process.env.MONGO_URI = "mongodb://127.0.0.1:27017/mustmake-test";
    mongoose.connect = async () => mongoose;
    mongoose.startSession = async () => session;
    User.findById = () => ({
        select(fields) {
            assert.equal(fields, "email profilePicture");
            return this;
        },
        session(value) {
            assert.equal(value, session);
            return Promise.resolve(accountExists ? account : null);
        }
    });
    Workout.deleteMany = deleteMany("Workout");
    Competition.deleteMany = deleteMany("Competition");
    OTP.deleteMany = deleteMany("OTP");
    OTPGuard.deleteMany = deleteMany("OTPGuard");
    User.deleteOne = async (filter, options) => {
        calls.push({ modelName: "User", filter, options });
        if (failAt === "User") throw new Error("delete failure: User");
        return { deletedCount: 1 };
    };

    t.after(() => {
        originalMethods.forEach(({ model, methods }) => {
            Object.assign(model, methods);
        });
        mongoose.startSession = originalStartSession;
        mongoose.connect = originalConnect;
        mongoose.connection.readyState = originalReadyState;
        if (originalMongoUri === undefined) delete process.env.MONGO_URI;
        else process.env.MONGO_URI = originalMongoUri;
    });

    return { calls, session };
}

test("account deletion transaction removes owned records, relationships and OTP state", async t => {
    const { calls, session } = stubAccountDeletion(t);
    const res = responseStub();

    await deleteAccount({ userId: "user-1" }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: true });
    assert.equal(session.committed, true);
    assert.equal(session.ended, true);
    assert.deepEqual(calls.map(call => call.modelName), [
        "Workout",
        "Competition",
        "OTP",
        "OTPGuard",
        "User"
    ]);
    assert.ok(calls.every(call => call.options.session === session));
    assert.deepEqual(calls[0].filter, { user: "user-1" });
    assert.deepEqual(calls[2].filter, { email: "athlete@example.test" });
    assert.deepEqual(calls[3].filter, { email: "athlete@example.test" });
    assert.deepEqual(calls[4].filter, { _id: "user-1" });
});

test("account deletion aborts on dependent-data failure and leaves the account record untouched", async t => {
    const { calls, session } = stubAccountDeletion(t, { failAt: "OTPGuard" });
    const res = responseStub();

    await deleteAccount({ userId: "user-1" }, res);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { message: "Could not delete your account." });
    assert.equal(session.committed, undefined);
    assert.equal(session.aborted, true);
    assert.equal(session.ended, true);
    assert.equal(calls.some(call => call.modelName === "User"), false);
});

test("account deletion returns 404 without deleting records for an unknown account", async t => {
    const { calls, session } = stubAccountDeletion(t, { accountExists: false });
    const res = responseStub();

    await deleteAccount({ userId: "missing-user" }, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { message: "Account not found." });
    assert.equal(session.committed, true);
    assert.equal(session.ended, true);
    assert.equal(calls.length, 0);
});
