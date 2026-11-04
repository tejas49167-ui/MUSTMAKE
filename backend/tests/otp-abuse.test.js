const test = require("node:test");
const assert = require("node:assert/strict");
const OTPThrottle = require("../models/OTPThrottle");
const {
    OTP_SEND_EMAIL_LIMIT,
    OTP_SEND_IP_LIMIT,
    OTP_SEND_WINDOW_MS,
    OTP_VERIFY_EMAIL_LIMIT,
    OTP_VERIFY_IP_LIMIT,
    createCounterPipeline,
    hashKey,
    allowOtpSend,
    allowOtpVerification
} = require("../services/otp-abuse.service");

test("OTP sends are limited to ten requests per email within thirty minutes", () => {
    assert.equal(OTP_SEND_EMAIL_LIMIT, 10);
    assert.equal(OTP_SEND_WINDOW_MS, 30 * 60 * 1000);
});

test("OTP throttles use keyed hashes and enforce concurrent persistent limits", async t => {
    const previousSecret = process.env.OTP_SECRET;
    process.env.OTP_SECRET = "otp-throttle-test-secret";
    const originalInit = OTPThrottle.init;
    const originalFindOneAndUpdate = OTPThrottle.findOneAndUpdate;
    const counts = new Map();
    OTPThrottle.init = async () => OTPThrottle;
    OTPThrottle.findOneAndUpdate = (filter, update) => ({
        async lean() {
            const count = (counts.get(filter.keyHash) || 0) + 1;
            counts.set(filter.keyHash, count);
            return { count };
        }
    });

    t.after(() => {
        OTPThrottle.init = originalInit;
        OTPThrottle.findOneAndUpdate = originalFindOneAndUpdate;
        if (previousSecret === undefined) delete process.env.OTP_SECRET;
        else process.env.OTP_SECRET = previousSecret;
    });

    const sendResults = await Promise.all(
        Array.from({ length: OTP_SEND_EMAIL_LIMIT + 4 }, () =>
            allowOtpSend("person@example.test", "203.0.113.42")
        )
    );
    assert.equal(sendResults.filter(Boolean).length, OTP_SEND_EMAIL_LIMIT);
    assert.ok(counts.has(hashKey("otp-send-email", "person@example.test")));
    assert.ok(counts.has(hashKey("otp-send-ip", "203.0.113.42")));
    assert.equal([...counts.keys()].includes("person@example.test"), false);

    const verifyResults = await Promise.all(
        Array.from({ length: OTP_VERIFY_EMAIL_LIMIT + 2 }, () =>
            allowOtpVerification("person@example.test", "203.0.113.42")
        )
    );
    assert.equal(verifyResults.filter(Boolean).length, OTP_VERIFY_EMAIL_LIMIT);

    const ipSendResults = await Promise.all(
        Array.from({ length: OTP_SEND_IP_LIMIT + 2 }, (_, index) =>
            allowOtpSend(`user-${index}@example.test`, "198.51.100.8")
        )
    );
    assert.equal(ipSendResults.filter(Boolean).length, OTP_SEND_IP_LIMIT);

    const ipVerifyResults = await Promise.all(
        Array.from({ length: OTP_VERIFY_IP_LIMIT + 2 }, (_, index) =>
            allowOtpVerification(`verify-${index}@example.test`, "198.51.100.9")
        )
    );
    assert.equal(ipVerifyResults.filter(Boolean).length, OTP_VERIFY_IP_LIMIT);
});

test("OTP throttle windows reset atomically and retain bounded TTL", () => {
    const now = new Date("2026-11-04T12:00:00.000Z");
    const windowMs = 15 * 60 * 1000;
    const pipeline = createCounterPipeline(now, windowMs);

    assert.deepEqual(pipeline[0].$set._resetWindow.$or[1].$lte[1], new Date(
        now.getTime() - windowMs
    ));
    assert.deepEqual(pipeline[1].$set.count.$cond[1], 1);
    assert.deepEqual(pipeline[1].$set.windowStartedAt.$cond[1], now);
    assert.deepEqual(pipeline[1].$set.expiresAt, new Date(
        now.getTime() + 24 * 60 * 60 * 1000
    ));
});
