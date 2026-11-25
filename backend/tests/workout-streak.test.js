const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/User");
const Workout = require("../models/Workout");
const mongoose = require("mongoose");
const {
    getWorkoutStreak,
    recordWorkoutStreak,
    recalculateUserStreak
} = require("../services/workout-streak.service");
const { getDateString, previousDateString } = require("../utils/date");

// Set readyState after models are compiled so connectDB() passes in unit tests
mongoose.connection.readyState = 1;
if (!process.env.MONGO_URI) {
    process.env.MONGO_URI = "mongodb://127.0.0.1:27017/test-workout-streak";
}

test("User model defines streak and lastWorkoutDate with proper defaults", () => {
    const user = new User({
        name: "Test Athlete",
        email: "athlete@test.com"
    });

    assert.equal(user.streak, 0);
    assert.equal(user.lastWorkoutDate, null);
});

test("workout creation for today updates streak and lastWorkoutDate in O(1)", async () => {
    const today = "2026-11-25";
    const yesterday = "2026-11-24";
    const older = "2026-11-20";

    // Case 1: First workout ever (lastWorkoutDate is null) -> reset to 1
    {
        let updatedFields = null;
        const fakeUserModel = {
            findById() {
                return {
                    select: () => ({ streak: 0, lastWorkoutDate: null })
                };
            },
            async updateOne(filter, update) {
                updatedFields = update.$set;
            }
        };

        const result = await recordWorkoutStreak("user-1", today, {
            userModel: fakeUserModel,
            today
        });

        assert.equal(result.streak, 1);
        assert.equal(result.lastWorkoutDate, today);
        assert.deepEqual(updatedFields, { streak: 1, lastWorkoutDate: today });
    }

    // Case 2: Workout when lastWorkoutDate was yesterday -> increment streak
    {
        let updatedFields = null;
        const fakeUserModel = {
            findById() {
                return {
                    select: () => ({ streak: 4, lastWorkoutDate: yesterday })
                };
            },
            async updateOne(filter, update) {
                updatedFields = update.$set;
            }
        };

        const result = await recordWorkoutStreak("user-1", today, {
            userModel: fakeUserModel,
            today
        });

        assert.equal(result.streak, 5);
        assert.equal(result.lastWorkoutDate, today);
        assert.deepEqual(updatedFields, { streak: 5, lastWorkoutDate: today });
    }

    // Case 3: Second workout today (lastWorkoutDate is already today) -> keep streak
    {
        let updatedFields = null;
        const fakeUserModel = {
            findById() {
                return {
                    select: () => ({ streak: 5, lastWorkoutDate: today })
                };
            },
            async updateOne(filter, update) {
                updatedFields = update.$set;
            }
        };

        const result = await recordWorkoutStreak("user-1", today, {
            userModel: fakeUserModel,
            today
        });

        assert.equal(result.streak, 5);
        assert.equal(result.lastWorkoutDate, today);
        assert.deepEqual(updatedFields, { streak: 5, lastWorkoutDate: today });
    }

    // Case 4: Broken streak (lastWorkoutDate older than yesterday) -> reset to 1
    {
        let updatedFields = null;
        const fakeUserModel = {
            findById() {
                return {
                    select: () => ({ streak: 10, lastWorkoutDate: older })
                };
            },
            async updateOne(filter, update) {
                updatedFields = update.$set;
            }
        };

        const result = await recordWorkoutStreak("user-1", today, {
            userModel: fakeUserModel,
            today
        });

        assert.equal(result.streak, 1);
        assert.equal(result.lastWorkoutDate, today);
        assert.deepEqual(updatedFields, { streak: 1, lastWorkoutDate: today });
    }
});

test("backdated workout creation and workout deletion recalculate streak accurately and update User", async () => {
    const today = "2026-11-25";
    let updatedUser = null;

    const fakeUserModel = {
        async updateOne(filter, update) {
            updatedUser = update.$set;
        }
    };

    const fakeWorkoutModel = {
        async distinct(field, query) {
            // Suppose user has workouts on 2026-11-23, 2026-11-24, 2026-11-25
            return ["2026-11-23", "2026-11-24", "2026-11-25"];
        }
    };

    const result = await recalculateUserStreak("user-1", today, {
        userModel: fakeUserModel,
        workoutModel: fakeWorkoutModel
    });

    assert.equal(result.streak, 3);
    assert.equal(result.lastWorkoutDate, "2026-11-25");
    assert.deepEqual(updatedUser, { streak: 3, lastWorkoutDate: "2026-11-25" });

    // After deleting today's workout:
    fakeWorkoutModel.distinct = async () => ["2026-11-23", "2026-11-24"];
    const afterDelete = await recalculateUserStreak("user-1", today, {
        userModel: fakeUserModel,
        workoutModel: fakeWorkoutModel
    });

    assert.equal(afterDelete.streak, 2);
    assert.equal(afterDelete.lastWorkoutDate, "2026-11-24");
    assert.deepEqual(updatedUser, { streak: 2, lastWorkoutDate: "2026-11-24" });

    // After deleting all workouts:
    fakeWorkoutModel.distinct = async () => [];
    const afterDeleteAll = await recalculateUserStreak("user-1", today, {
        userModel: fakeUserModel,
        workoutModel: fakeWorkoutModel
    });

    assert.equal(afterDeleteAll.streak, 0);
    assert.equal(afterDeleteAll.lastWorkoutDate, null);
    assert.deepEqual(updatedUser, { streak: 0, lastWorkoutDate: null });
});

test("getWorkoutStreak reads from User and returns 0 if lastWorkoutDate is older than yesterday", async () => {
    const today = "2026-11-25";
    const yesterday = "2026-11-24";
    const older = "2026-11-23";

    // Case 1: lastWorkoutDate is today
    {
        const fakeUserModel = {
            findById() {
                return {
                    select: () => ({ streak: 7, lastWorkoutDate: today })
                };
            }
        };
        const streak = await getWorkoutStreak("user-1", today, fakeUserModel);
        assert.equal(streak, 7);
    }

    // Case 2: lastWorkoutDate is yesterday (streak alive)
    {
        const fakeUserModel = {
            findById() {
                return {
                    select: () => ({ streak: 7, lastWorkoutDate: yesterday })
                };
            }
        };
        const streak = await getWorkoutStreak("user-1", today, fakeUserModel);
        assert.equal(streak, 7);
    }

    // Case 3: lastWorkoutDate is older than yesterday -> streak expired, return 0
    {
        const fakeUserModel = {
            findById() {
                return {
                    select: () => ({ streak: 7, lastWorkoutDate: older })
                };
            }
        };
        const streak = await getWorkoutStreak("user-1", today, fakeUserModel);
        assert.equal(streak, 0);
    }

    // Case 4: user not found or has null lastWorkoutDate -> return 0
    {
        const fakeUserModel = {
            findById() {
                return {
                    select: () => null
                };
            }
        };
        const streak = await getWorkoutStreak("user-1", today, fakeUserModel);
        assert.equal(streak, 0);
    }
});

test("backfillUserStreaks calculates and writes streaks and lastWorkoutDate for all users", async () => {
    const { backfillUserStreaks } = require("../scripts/backfill-user-streaks");
    const today = "2026-11-25";

    const mockUsers = [
        { _id: "user-1" },
        { _id: "user-2" }
    ];

    let bulkWrittenOps = [];
    const mockUserCollection = {
        bulkWrite: async ops => {
            bulkWrittenOps.push(...ops);
        }
    };

    const mockWorkoutModel = {
        distinct: async (field, query) => {
            if (query.user === "user-1") {
                return ["2026-11-24", "2026-11-25"];
            }
            return [];
        }
    };

    const result = await backfillUserStreaks({
        skipConnect: true,
        users: mockUsers,
        userCollection: mockUserCollection,
        workoutModel: mockWorkoutModel,
        today
    });

    assert.equal(result.updatedCount, 2);
    assert.equal(bulkWrittenOps.length, 2);

    assert.deepEqual(bulkWrittenOps[0], {
        updateOne: {
            filter: { _id: "user-1" },
            update: {
                $set: {
                    streak: 2,
                    lastWorkoutDate: "2026-11-25"
                }
            }
        }
    });

    assert.deepEqual(bulkWrittenOps[1], {
        updateOne: {
            filter: { _id: "user-2" },
            update: {
                $set: {
                    streak: 0,
                    lastWorkoutDate: null
                }
            }
        }
    });
});

test("getDashboard returns today's workouts and cached streak in a single response", async t => {
    const { getDashboard } = require("../controllers/workout.controller");
    const Workout = require("../models/Workout");

    const originalFind = Workout.find;
    const originalUserFindById = User.findById;

    const mockWorkouts = [
        { _id: "workout-1", exercise: "Squats", reps: 20, sets: 3, date: getDateString() }
    ];

    Workout.find = query => {
        assert.equal(query.user, "user-1");
        assert.equal(query.date, getDateString());
        return {
            sort: () => ({
                lean: async () => mockWorkouts
            })
        };
    };

    User.findById = id => {
        assert.equal(id, "user-1");
        return {
            select: () => ({
                lean: async () => ({
                    streak: 5,
                    lastWorkoutDate: getDateString()
                })
            })
        };
    };

    t.after(() => {
        Workout.find = originalFind;
        User.findById = originalUserFindById;
    });

    const response = {
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

    await getDashboard({ userId: "user-1" }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.workouts, mockWorkouts);
    assert.equal(response.body.streak, 5);
});

