const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

function generateOTP() {
    return crypto.randomInt(100000, 1000000).toString();
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

    const token = jwt.sign(
        { userId: user._id.toString() },
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
            dateOfBirth: user.dateOfBirth
        }
    };
}

module.exports = {
    OTP_EXPIRY_MINUTES,
    OTP_MAX_ATTEMPTS,
    generateOTP,
    hashOTP,
    createAuthSession
};
