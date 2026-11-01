const crypto = require("crypto");
const LoginRateLimit = require("../models/LoginRateLimit");

const DEVICE_COOKIE_NAME = "mm_login_device";
const DEVICE_LOCK_ATTEMPT = 7;
const IP_WINDOW_MS = 5 * 60 * 1000;
const IP_LOCK_ATTEMPT = 100;
const RESTRICTION_MS = 5 * 60 * 1000;
const DOCUMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function getCookieValue(req, name) {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;

    for (const cookie of cookieHeader.split(";")) {
        const separator = cookie.indexOf("=");
        if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;

        return cookie.slice(separator + 1).trim();
    }

    return null;
}

function getDeviceId(req, res) {
    const existingId = getCookieValue(req, DEVICE_COOKIE_NAME);
    if (existingId && DEVICE_ID_PATTERN.test(existingId)) {
        return existingId;
    }

    const deviceId = crypto.randomBytes(32).toString("base64url");
    const secure = process.env.NODE_ENV === "production";

    res.cookie(DEVICE_COOKIE_NAME, deviceId, {
        httpOnly: true,
        secure,
        sameSite: secure ? "none" : "lax",
        path: "/",
        maxAge: 365 * 24 * 60 * 60 * 1000
    });

    return deviceId;
}

function hashKey(scope, value) {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is missing.");
    }

    return crypto
        .createHmac("sha256", process.env.JWT_SECRET)
        .update(`${scope}:${value}`)
        .digest("hex");
}

function getRateLimitKeys(req, res) {
    const deviceId = getDeviceId(req, res);
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown";

    return {
        device: hashKey("device", deviceId),
        ip: hashKey("ip", ipAddress)
    };
}

async function ensureIndexes() {
    await LoginRateLimit.init();
}

async function getActiveRestriction(scope, keyHash, now = new Date()) {
    return LoginRateLimit.findOne({
        scope,
        keyHash,
        restrictedUntil: { $gt: now }
    }).select("restrictedUntil").lean();
}

async function getRestriction(keys, now = new Date()) {
    const [deviceRestriction, ipRestriction] = await Promise.all([
        getActiveRestriction("device", keys.device, now),
        getActiveRestriction("ip", keys.ip, now)
    ]);

    const restrictedUntil = [
        deviceRestriction?.restrictedUntil,
        ipRestriction?.restrictedUntil
    ]
        .filter(Boolean)
        .reduce((latest, value) => value > latest ? value : latest, null);

    return restrictedUntil
        ? {
            restricted: true,
            retryAfterMs: Math.max(0, restrictedUntil.getTime() - now.getTime())
        }
        : { restricted: false, retryAfterMs: 0 };
}

function unlockedQuery(scope, keyHash, now) {
    return {
        scope,
        keyHash,
        $or: [
            { restrictedUntil: { $exists: false } },
            { restrictedUntil: null },
            { restrictedUntil: { $lte: now } }
        ]
    };
}

function incrementPipeline(now, windowMs, lockAttempt) {
    const restrictionExpired = {
        $and: [
            { $ne: [{ $ifNull: ["$restrictedUntil", null] }, null] },
            { $lte: ["$restrictedUntil", now] }
        ]
    };
    const windowExpired = {
        $or: [
            restrictionExpired,
            {
                $and: [
                    {
                        $or: [
                            { $eq: [{ $ifNull: ["$restrictedUntil", null] }, null] },
                            { $lte: ["$restrictedUntil", now] }
                        ]
                    },
                    {
                        $or: [
                            { $eq: [{ $ifNull: ["$windowStartedAt", null] }, null] },
                            ...(windowMs
                                ? [{ $lte: ["$windowStartedAt", new Date(now.getTime() - windowMs)] }]
                                : [])
                        ]
                    }
                ]
            }
        ]
    };
    const nextAttemptCount = {
        $cond: [
            "$_resetWindow",
            1,
            { $add: [{ $ifNull: ["$failedAttempts", 0] }, 1] }
        ]
    };

    return [
        { $set: { _resetWindow: windowExpired } },
        {
            $set: {
                failedAttempts: nextAttemptCount,
                windowStartedAt: {
                    $cond: ["$_resetWindow", now, "$windowStartedAt"]
                },
                restrictedUntil: {
                    $cond: [
                        "$_resetWindow",
                        null,
                        {
                            $cond: [
                                { $gte: [nextAttemptCount, lockAttempt] },
                                new Date(now.getTime() + RESTRICTION_MS),
                                { $ifNull: ["$restrictedUntil", null] }
                            ]
                        }
                    ]
                },
                expiresAt: new Date(now.getTime() + DOCUMENT_TTL_MS)
            }
        },
        { $unset: "_resetWindow" }
    ];
}

async function incrementCounter(scope, keyHash, now, options) {
    const { windowMs, lockAttempt, onlyWhenUnlocked = false } = options;
    const query = onlyWhenUnlocked
        ? unlockedQuery(scope, keyHash, now)
        : { scope, keyHash };

    try {
        return await LoginRateLimit.findOneAndUpdate(
            query,
            incrementPipeline(now, windowMs, lockAttempt),
            {
                returnDocument: "after",
                upsert: true,
                setDefaultsOnInsert: false,
                updatePipeline: true
            }
        ).lean();
    } catch (error) {
        if (error.code !== 11000) throw error;

        return LoginRateLimit.findOneAndUpdate(
            query,
            incrementPipeline(now, windowMs, lockAttempt),
            { returnDocument: "after", upsert: false, updatePipeline: true }
        ).lean();
    }
}

async function reserveDeviceAttempt(deviceKey, now = new Date()) {
    return incrementCounter("device", deviceKey, now, {
        windowMs: null,
        lockAttempt: DEVICE_LOCK_ATTEMPT,
        onlyWhenUnlocked: true
    });
}

async function recordIpFailure(ipKey, now = new Date()) {
    return incrementCounter("ip", ipKey, now, {
        windowMs: IP_WINDOW_MS,
        lockAttempt: IP_LOCK_ATTEMPT
    });
}

async function resetDeviceFailures(deviceKey) {
    await LoginRateLimit.updateOne(
        { scope: "device", keyHash: deviceKey },
        {
            $set: { failedAttempts: 0 },
            $unset: { windowStartedAt: 1, restrictedUntil: 1 }
        }
    );
}

module.exports = {
    ensureIndexes,
    getRateLimitKeys,
    getRestriction,
    reserveDeviceAttempt,
    recordIpFailure,
    resetDeviceFailures
};
