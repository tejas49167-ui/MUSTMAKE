const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../models/User");
const Workout = require("../models/Workout");
const Competition = require("../models/Competition");
const workoutController = require("../controllers/workout.controller");
const profileController = require("../controllers/profile.controller");
const competitionController = require("../controllers/competition.controller");

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

function installStubs(t, methods) {
    const models = { User, Workout, Competition };
    const originals = Object.entries(methods).map(([name, modelMethods]) => ({
        model: models[name],
        methods: Object.fromEntries(
            Object.keys(modelMethods).map(method => [method, models[name][method]])
        )
    }));
    const originalReadyState = mongoose.connection.readyState;
    const originalMongoUri = process.env.MONGO_URI;
    process.env.MONGO_URI = "mongodb://127.0.0.1:27017/mustmake-authorization-test";
    mongoose.connection.readyState = 1;
    for (const [name, modelMethods] of Object.entries(methods)) {
        Object.assign(models[name], modelMethods);
    }

    t.after(() => {
        for (const { model, methods: originalMethods } of originals) {
            Object.assign(model, originalMethods);
        }
        mongoose.connection.readyState = originalReadyState;
        if (originalMongoUri === undefined) delete process.env.MONGO_URI;
        else process.env.MONGO_URI = originalMongoUri;
    });
}

test("workout deletion is scoped to the authenticated owner", async t => {
    let deleteFilter;
    const workoutId = new mongoose.Types.ObjectId().toString();
    installStubs(t, {
        Workout: {
            findOneAndDelete: async filter => {
                deleteFilter = filter;
                return null;
            }
        }
    });
    const response = responseStub();

    await workoutController.deleteWorkout({
        userId: "owner-id",
        params: { id: workoutId }
    }, response);

    assert.deepEqual(deleteFilter, {
        _id: workoutId,
        user: "owner-id"
    });
    assert.equal(response.statusCode, 404);
});

test("profile updates ignore body-supplied identity and sensitive fields", async t => {
    const user = {
        _id: "authenticated-user",
        name: "Original",
        email: "original@example.test",
        passwordHash: "unchanged-hash",
        age: null,
        height: null,
        weight: null,
        socials: {},
        async save() {}
    };
    const queriedIds = [];
    installStubs(t, {
        User: {
            findById(id) {
                queriedIds.push(String(id));
                return { select: async () => user };
            }
        }
    });
    const response = responseStub();

    await profileController.updateProfile({
        userId: "authenticated-user",
        body: {
            name: "Updated",
            user: "attacker-user",
            email: "attacker@example.test",
            passwordHash: "attacker-hash",
            googleId: "attacker-google-id"
        }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(queriedIds, ["authenticated-user", "authenticated-user"]);
    assert.equal(user.name, "Updated");
    assert.equal(user.email, "original@example.test");
    assert.equal(user.passwordHash, "unchanged-hash");
});

test("competition creation and removal are scoped to the authenticated owner", async t => {
    const competitorId = new mongoose.Types.ObjectId().toString();
    let createdRecord;
    let removalFilter;
    installStubs(t, {
        User: {
            findById: async id => id === competitorId ? { _id: competitorId } : null
        },
        Competition: {
            findOne: async () => null,
            create: async record => {
                createdRecord = record;
                return record;
            },
            findOneAndDelete: async filter => {
                removalFilter = filter;
                return null;
            }
        }
    });

    const addResponse = responseStub();
    await competitionController.addCompetitor({
        userId: "authenticated-owner",
        body: { competitorId }
    }, addResponse);
    assert.equal(addResponse.statusCode, 201);
    assert.deepEqual(createdRecord, {
        owner: "authenticated-owner",
        competitor: competitorId
    });

    const removeResponse = responseStub();
    await competitionController.removeCompetitor({
        userId: "authenticated-owner",
        params: { userId: competitorId }
    }, removeResponse);
    assert.equal(removeResponse.statusCode, 404);
    assert.deepEqual(removalFilter, {
        owner: "authenticated-owner",
        competitor: competitorId
    });
});
