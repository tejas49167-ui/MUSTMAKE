const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 7;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_ATTEMPT_WINDOW_MS = OTP_EXPIRY_MINUTES * 60 * 1000;

function generateOTP() {
    return crypto.randomInt(100000, 1000000).toString();
}

function generateOTPChallenge() {
    return crypto.randomBytes(32).toString("base64url");
}

function hashOTP(otp) {
    const secret = process.env.OTP_SECRET || process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("OTP_SECRET or JWT_SECRET is missing.");
    }

    return crypto
        .createHmac("sha256", secret)
        .update(otp)
        .digest("hex");
}

function createAuthSession(user) {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is missing.");
    }

    const sessionVersion = Number.isSafeInteger(user.sessionVersion) && user.sessionVersion >= 0
        ? user.sessionVersion
        : 0;
    const token = jwt.sign(
        { userId: user._id.toString(), sessionVersion },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

    return {
        token,
        user: {
            id: user._id,
            name: user.name,
            username: user.username,
            email: user.email,
            profilePicture: user.profilePicture,
            age: user.age
        }
    };
}

module.exports = {
    OTP_EXPIRY_MINUTES,
    OTP_MAX_ATTEMPTS,
    OTP_RESEND_COOLDOWN_MS,
    OTP_ATTEMPT_WINDOW_MS,
    generateOTP,
    generateOTPChallenge,
    hashOTP,
    createAuthSession
};
