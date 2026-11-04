const test = require("node:test");
const assert = require("node:assert/strict");
const { logFailure } = require("../utils/safe-log");

test("safe error logging omits messages that could contain credentials or personal data", t => {
    const originalLog = console.error;
    const calls = [];
    console.error = (...args) => calls.push(args);
    t.after(() => {
        console.error = originalLog;
    });

    logFailure("Authentication failed.", new Error(
        "failed for person@example.test using token secret-value"
    ));

    assert.deepEqual(calls, [
        ["Authentication failed.", { name: "Error" }]
    ]);
});
