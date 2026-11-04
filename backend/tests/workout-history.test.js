const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Workout = require("../models/Workout");
const { getWorkoutHistoryPage } = require("../services/workout-history.service");

test("workout history caps large requests and returns a bounded cursor page", async t => {
    const originalFind = Workout.find;
    t.after(() => {
        Workout.find = originalFind;
    });

    const user = new mongoose.Types.ObjectId();
    const records = Array.from({ length: 1001 }, (_, index) => ({
        _id: new mongoose.Types.ObjectId(),
        createdAt: new Date(Date.UTC(2026, 10, 4, 12, 0, 0) - index),
        date: "2026-11-04",
        exercise: `Exercise ${index}`,
        reps: 10,
        sets: 2,
        weight: null,
        amount: null,
        duration: null,
        unit: null
    }));
    let queryFilter;
    let queryLimit;

    Workout.find = filter => {
        queryFilter = filter;
        const query = {
            select(fields) {
                assert.equal(
                    fields,
                    "exercise reps sets weight amount duration unit date createdAt"
                );
                return this;
            },
            sort(order) {
                assert.deepEqual(order, { date: -1, createdAt: -1, _id: -1 });
                return this;
            },
            limit(value) {
                queryLimit = value;
                return this;
            },
            lean() {
                return Promise.resolve(records.slice(0, queryLimit));
            }
        };
        return query;
    };

    const page = await getWorkoutHistoryPage(user, { limit: "1000" });

    assert.deepEqual(queryFilter, { user });
    assert.equal(queryLimit, 51);
    assert.equal(page.workouts.length, 50);
    assert.ok(page.nextCursor);
    assert.equal(page.workouts[0].exercise, "Exercise 0");
    assert.equal(Object.hasOwn(page.workouts[0], "_id"), false);
    assert.equal(Object.hasOwn(page.workouts[0], "createdAt"), false);
});
