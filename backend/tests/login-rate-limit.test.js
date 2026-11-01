const test = require("node:test");
const assert = require("node:assert/strict");
const LoginRateLimit = require("../models/LoginRateLimit");
const rateLimit = require("../services/login-rate-limit.service");

const RESTRICTION_MS = 5 * 60 * 1000;
const IP_WINDOW_MS = 5 * 60 * 1000;
const DOCUMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function queryResult(value) {
    return {
        lean: async () => value
    };
}

test("login limits are device-scoped, IP-aggregated, and expire server-side", async t => {
    const original = {
        init: LoginRateLimit.init,
        findOne: LoginRateLimit.findOne,
        findOneAndUpdate: LoginRateLimit.findOneAndUpdate,
        updateOne: LoginRateLimit.updateOne,
        jwtSecret: process.env.JWT_SECRET,
        nodeEnv: process.env.NODE_ENV
    };
    const records = new Map();
    process.env.JWT_SECRET = "test-only-rate-limit-secret";
    process.env.NODE_ENV = "production";

    LoginRateLimit.init = async () => {};
    LoginRateLimit.findOne = filter => {
        const record = records.get(`${filter.scope}:${filter.keyHash}`);
        const cutoff = filter.restrictedUntil.$gt;
        return {
            select: () => ({
                lean: async () => record?.restrictedUntil > cutoff
                    ? { restrictedUntil: record.restrictedUntil }
                    : null
            })
        };
    };
    LoginRateLimit.findOneAndUpdate = (filter, pipeline, options) => {
        assert.equal(options.updatePipeline, true);
        const recordKey = `${filter.scope}:${filter.keyHash}`;
        const record = records.get(recordKey);
        const now = new Date(
            pipeline[1].$set.expiresAt.getTime() - DOCUMENT_TTL_MS
        );
        const isDeviceReservation = Boolean(filter.$or);
        const isAlreadyRestricted = record?.restrictedUntil > now;

        if (isDeviceReservation && isAlreadyRestricted) {
            if (options.upsert) {
                const error = new Error("duplicate limiter key");
                error.code = 11000;
                throw error;
            }
            return queryResult(null);
        }

        const resetWindow = !record ||
            (record.restrictedUntil && record.restrictedUntil <= now) ||
            (filter.scope === "ip" &&
                now.getTime() - record.windowStartedAt.getTime() >= IP_WINDOW_MS);
        const failedAttempts = resetWindow ? 1 : record.failedAttempts + 1;
        const lockAttempt = filter.scope === "device" ? 7 : 100;
        const updated = {
            scope: filter.scope,
            keyHash: filter.keyHash,
            failedAttempts,
            windowStartedAt: resetWindow ? now : record.windowStartedAt,
            restrictedUntil: resetWindow
                ? null
                : failedAttempts >= lockAttempt
                    ? new Date(now.getTime() + RESTRICTION_MS)
                    : record.restrictedUntil,
            expiresAt: new Date(now.getTime() + DOCUMENT_TTL_MS)
        };
        records.set(recordKey, updated);
        return queryResult({ ...updated });
    };
    LoginRateLimit.updateOne = async (filter, update) => {
        const record = records.get(`${filter.scope}:${filter.keyHash}`);
        if (record) {
            record.failedAttempts = update.$set.failedAttempts;
            delete record.windowStartedAt;
            delete record.restrictedUntil;
        }
    };

    t.after(() => {
        LoginRateLimit.init = original.init;
        LoginRateLimit.findOne = original.findOne;
        LoginRateLimit.findOneAndUpdate = original.findOneAndUpdate;
        LoginRateLimit.updateOne = original.updateOne;
        if (original.jwtSecret === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = original.jwtSecret;
        }
        if (original.nodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = original.nodeEnv;
        }
    });

    const issueDevice = ip => {
        const responseCookies = [];
        const req = {
            headers: {},
            ip,
            socket: { remoteAddress: ip }
        };
        const res = {
            cookie: (...args) => responseCookies.push(args)
        };
        const keys = rateLimit.getRateLimitKeys(req, res);
        const [name, value, options] = responseCookies[0];
        assert.equal(name, "mm_login_device");
        assert.equal(options.httpOnly, true);
        assert.equal(options.secure, true);
        assert.equal(options.sameSite, "none");
        assert.equal(options.path, "/");

        return {
            keys,
            cookieHeader: `${name}=${value}`,
            req,
            res
        };
    };

    const firstDevice = issueDevice("203.0.113.8");
    const sameDevice = rateLimit.getRateLimitKeys(
        {
            headers: { cookie: firstDevice.cookieHeader },
            ip: "203.0.113.8",
            socket: { remoteAddress: "203.0.113.8" }
        },
        { cookie() { assert.fail("A valid device cookie should be reused."); } }
    );
    const secondDevice = issueDevice("203.0.113.8");
    assert.deepEqual(sameDevice, firstDevice.keys);
    assert.notEqual(secondDevice.keys.device, firstDevice.keys.device);
    assert.equal(secondDevice.keys.ip, firstDevice.keys.ip);
    const switchedUsername = rateLimit.getRateLimitKeys(
        {
            headers: { cookie: firstDevice.cookieHeader },
            ip: "203.0.113.8",
            socket: { remoteAddress: "203.0.113.8" },
            body: { login: "another-account" }
        },
        { cookie() { assert.fail("A valid device cookie should be reused."); } }
    );
    assert.deepEqual(switchedUsername, firstDevice.keys);

    const start = new Date("2026-11-01T10:00:00.000Z");
    const sequentialDevice = "sequential-device";
    for (let attempt = 1; attempt <= 6; attempt += 1) {
        const result = await rateLimit.reserveDeviceAttempt(sequentialDevice, start);
        assert.equal(result.failedAttempts, attempt);
        assert.equal(result.restrictedUntil, null);
    }

    const seventh = await rateLimit.reserveDeviceAttempt(sequentialDevice, start);
    assert.equal(seventh.restrictedUntil.getTime(), start.getTime() + RESTRICTION_MS);
    assert.equal(
        await rateLimit.reserveDeviceAttempt(sequentialDevice, start),
        null
    );
    assert.equal(
        (await rateLimit.getRestriction(
            { device: sequentialDevice, ip: "unused-ip" },
            start
        )).restricted,
        true
    );

    assert.equal(
        (await rateLimit.getRestriction(
            { device: sequentialDevice, ip: "unused-ip" },
            new Date(start.getTime() + RESTRICTION_MS)
        )).restricted,
        false
    );

    const refreshedDevice = issueDevice("203.0.113.9");
    for (let attempt = 0; attempt < 7; attempt += 1) {
        await rateLimit.reserveDeviceAttempt(refreshedDevice.keys.device, start);
    }
    const reloadedKeys = rateLimit.getRateLimitKeys(
        {
            headers: { cookie: refreshedDevice.cookieHeader },
            ip: "203.0.113.9",
            socket: { remoteAddress: "203.0.113.9" }
        },
        { cookie() { assert.fail("A valid device cookie should be reused."); } }
    );
    assert.equal(
        (await rateLimit.getRestriction(reloadedKeys, start)).restricted,
        true
    );
    assert.equal(
        (await rateLimit.getRestriction(
            reloadedKeys,
            new Date(start.getTime() + RESTRICTION_MS)
        )).restricted,
        false
    );

    const afterExpiry = await rateLimit.reserveDeviceAttempt(
        sequentialDevice,
        new Date(start.getTime() + RESTRICTION_MS)
    );
    assert.equal(afterExpiry.failedAttempts, 1);
    await rateLimit.resetDeviceFailures(sequentialDevice);
    const afterSuccessfulAuth = await rateLimit.reserveDeviceAttempt(
        sequentialDevice,
        new Date(start.getTime() + RESTRICTION_MS + 1)
    );
    assert.equal(afterSuccessfulAuth.failedAttempts, 1);

    const concurrentDevice = "concurrent-device";
    const concurrentResults = await Promise.all(
        Array.from({ length: 20 }, () =>
            rateLimit.reserveDeviceAttempt(concurrentDevice, start)
        )
    );
    assert.equal(
        concurrentResults.filter(result => result && !result.restrictedUntil).length,
        6
    );
    assert.equal(
        concurrentResults.filter(result => result?.restrictedUntil).length,
        1
    );
    assert.equal(concurrentResults.filter(result => result === null).length, 13);

    const sharedIp = "shared-ip-hash";
    for (let failure = 1; failure < 100; failure += 1) {
        const result = await rateLimit.recordIpFailure(sharedIp, start);
        assert.equal(result.restrictedUntil, null);
    }
    const sharedIpLock = await rateLimit.recordIpFailure(sharedIp, start);
    assert.equal(
        sharedIpLock.restrictedUntil.getTime(),
        start.getTime() + RESTRICTION_MS
    );
    assert.equal(
        (await rateLimit.getRestriction(
            { device: "different-device", ip: sharedIp },
            start
        )).restricted,
        true
    );

    const expiredIp = await rateLimit.recordIpFailure(
        sharedIp,
        new Date(start.getTime() + RESTRICTION_MS)
    );
    assert.equal(expiredIp.failedAttempts, 1);
    assert.equal(expiredIp.restrictedUntil, null);
});
