const test = require("node:test");
const assert = require("node:assert/strict");
const exercises = require("../config/exercises.json");
const { addWorkout } = require("../controllers/workout.controller");

test("plank duration limit is six minutes in the exercise configuration", () => {
    const plank = exercises.find(exercise => exercise.slug === "plank");
    const durationField = plank.fields.find(field => field.name === "duration");

    assert.equal(durationField.max, 360);
});

test("workout API rejects plank durations above six minutes", async () => {
    const response = {
        statusCode: null,
        body: null,
        status(statusCode) {
            this.statusCode = statusCode;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };

    await addWorkout({
        body: {
            exercise: "Plank",
            duration: 361
        }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.message, "Duration must be between 1 and 360 seconds.");
});
