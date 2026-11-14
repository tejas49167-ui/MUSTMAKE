const crypto = require("crypto");
const PendingSignup = require("../models/PendingSignup");
const { hashOTP } = require("./auth.service");
const { setPendingSignupCookie } = require("../utils/auth-cookie");

async function savePendingSignup(data, res) {
    await PendingSignup.init();
    const pendingToken = crypto.randomBytes(32).toString("base64url");
    await PendingSignup.findOneAndUpdate(
        { email: data.email },
        {
            $set: {
                username: data.username,
                passwordHash: data.passwordHash || null,
                googleId: data.googleId || null,
                profilePicture: data.profilePicture || null,
                authProvider: data.authProvider,
                tokenHash: hashOTP(pendingToken),
                expiresAt: new Date(Date.now() + 30 * 60 * 1000)
            }
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    setPendingSignupCookie(res, pendingToken);
}

module.exports = { savePendingSignup };
