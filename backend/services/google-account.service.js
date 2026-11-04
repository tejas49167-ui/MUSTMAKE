const crypto = require("crypto");
const User = require("../models/User");

function getVerifiedEmail(profile) {
    const email = profile?._json?.email;
    if (
        profile?._json?.email_verified !== true ||
        typeof email !== "string" ||
        !email.trim()
    ) {
        return null;
    }

    return email.trim().toLowerCase();
}

function getBaseUsername(email) {
    return email.split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 24) || "user";
}

async function getAccountForVerifiedGoogleProfile(profile) {
    const email = getVerifiedEmail(profile);
    if (!email || typeof profile.id !== "string" || !profile.id) {
        throw new Error("Google account email is not verified.");
    }
    await User.init();

    const googleUser = await User.findOne({ googleId: profile.id })
        .select("+ageReferenceYear");
    if (googleUser) return googleUser;

    const emailUser = await User.findOne({ email }).select("+ageReferenceYear");
    if (emailUser) {
        if (emailUser.passwordHash) {
            throw new Error("This email is already registered. Sign in with your password.");
        }

        const linkedUser = await User.findOneAndUpdate(
            {
                _id: emailUser._id,
                passwordHash: null,
                $or: [{ googleId: null }, { googleId: { $exists: false } }]
            },
            {
                $set: {
                    googleId: profile.id,
                    ...(profile.photos?.[0]?.value && !emailUser.profilePicture
                        ? { profilePicture: profile.photos[0].value }
                        : {})
                }
            },
            { returnDocument: "after", runValidators: true }
        ).select("+ageReferenceYear");

        if (linkedUser) return linkedUser;

        const racedGoogleUser = await User.findOne({ googleId: profile.id })
            .select("+ageReferenceYear");
        if (racedGoogleUser) return racedGoogleUser;

        throw new Error("Google account could not be linked safely.");
    }

    const baseUsername = getBaseUsername(email);
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const suffix = crypto.randomBytes(3).toString("hex");
        const username = `${baseUsername.slice(0, 30 - suffix.length)}${suffix}`;
        const usernameUser = await User.findOne({ username });
        if (!usernameUser) {
            return {
                pendingSignup: true,
                email,
                username,
                googleId: profile.id,
                profilePicture: profile.photos?.[0]?.value || null
            };
        }
    }

    throw new Error("Google account could not be created safely.");
}

module.exports = {
    getVerifiedEmail,
    getAccountForVerifiedGoogleProfile
};
