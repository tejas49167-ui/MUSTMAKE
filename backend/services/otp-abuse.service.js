const crypto = require("crypto");
const OTPThrottle = require("../models/OTPThrottle");

const OTP_SEND_EMAIL_LIMIT = 10;
const OTP_SEND_IP_LIMIT = 100;
const OTP_SEND_WINDOW_MS = 30 * 60 * 1000;
const OTP_VERIFY_EMAIL_LIMIT = 10;
const OTP_VERIFY_IP_LIMIT = 60;
const OTP_VERIFY_WINDOW_MS = 15 * 60 * 1000;
const THROTTLE_TTL_MS = 24 * 60 * 60 * 1000;
let indexInitialization;

function hashKey(scope, value) {
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error("OTP_SECRET or JWT_SECRET is missing.");

    return crypto
        .createHmac("sha256", secret)
        .update(`${scope}:${value}`)
        .digest("hex");
}

function createCounterPipeline(now, windowMs) {
    const windowExpired = {
        $or: [
            { $eq: [{ $ifNull: ["$windowStartedAt", null] }, null] },
            { $lte: ["$windowStartedAt", new Date(now.getTime() - windowMs)] }
        ]
    };

    return [
        { $set: { _resetWindow: windowExpired } },
        {
            $set: {
                count: {
                    $cond: [
                        "$_resetWindow",
                        1,
                        { $add: [{ $ifNull: ["$count", 0] }, 1] }
                    ]
                },
                windowStartedAt: {
                    $cond: ["$_resetWindow", now, "$windowStartedAt"]
                },
                expiresAt: new Date(now.getTime() + THROTTLE_TTL_MS)
            }
        },
        { $unset: "_resetWindow" }
    ];
}

async function increment(keyHash, windowMs, now = new Date()) {
    const update = createCounterPipeline(now, windowMs);
    try {
        return await OTPThrottle.findOneAndUpdate(
            { keyHash },
            update,
            {
                returnDocument: "after",
                upsert: true,
                setDefaultsOnInsert: false,
                updatePipeline: true
            }
        ).lean();
    } catch (error) {
        if (error.code !== 11000) throw error;

        return OTPThrottle.findOneAndUpdate(
            { keyHash },
            update,
            {
                returnDocument: "after",
                upsert: false,
                updatePipeline: true
            }
        ).lean();
    }
}

async function allowRequest(scope, value, limit, windowMs, now) {
    if (!indexInitialization) {
        indexInitialization = OTPThrottle.init().catch(error => {
            indexInitialization = null;
            throw error;
        });
    }
    await indexInitialization;
    const keyHash = hashKey(scope, value);
    const result = await increment(keyHash, windowMs, now);
    return result.count <= limit;
}

async function allowOtpSend(email, ip, now = new Date()) {
    const emailAllowed = await allowRequest(
        "otp-send-email",
        email,
        OTP_SEND_EMAIL_LIMIT,
        OTP_SEND_WINDOW_MS,
        now
    );
    const ipAllowed = await allowRequest(
        "otp-send-ip",
        ip,
        OTP_SEND_IP_LIMIT,
        OTP_SEND_WINDOW_MS,
        now
    );
    return emailAllowed && ipAllowed;
}

async function allowOtpVerification(email, ip, now = new Date()) {
    const emailAllowed = await allowRequest(
        "otp-verify-email",
        email,
        OTP_VERIFY_EMAIL_LIMIT,
        OTP_VERIFY_WINDOW_MS,
        now
    );
    const ipAllowed = await allowRequest(
        "otp-verify-ip",
        ip,
        OTP_VERIFY_IP_LIMIT,
        OTP_VERIFY_WINDOW_MS,
        now
    );
    return emailAllowed && ipAllowed;
}

module.exports = {
    OTP_SEND_EMAIL_LIMIT,
    OTP_SEND_IP_LIMIT,
    OTP_VERIFY_EMAIL_LIMIT,
    OTP_VERIFY_IP_LIMIT,
    OTP_SEND_WINDOW_MS,
    OTP_VERIFY_WINDOW_MS,
    createCounterPipeline,
    hashKey,
    allowRequest,
    allowOtpSend,
    allowOtpVerification
};
