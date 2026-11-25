const mongoose = require("mongoose");
const User = require("../models/User");
const Workout = require("../models/Workout");
const Competition = require("../models/Competition");
const OTP = require("../models/OTP");
const OTPGuard = require("../models/OTPGuard");
const PendingSignup = require("../models/PendingSignup");
const EmailNotificationLog = require("../models/EmailNotificationLog");
const connectDB = require("../config/database");
const cloudinary = require("../config/cloudinary");
const { hashOTP, createAuthSession } = require("../services/auth.service");
const {
    PENDING_SIGNUP_COOKIE_NAME,
    setSessionCookie,
    clearSessionCookie,
    clearPendingSignupCookie
} = require("../utils/auth-cookie");
const { getCookieValue } = require("../utils/cookie");
const {
    isPlainObject
} = require("../utils/validation");
const { getDateString } = require("../utils/date");
const { logFailure } = require("../utils/safe-log");

function extractCloudinaryPublicId(url) {
    if (typeof url !== "string") return null;
    const match = url.match(/\/image\/upload\/(?:v\d+\/)?([^\.\?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
}

const getUploadSignature = async (req, res) => {
    try {
        if (!req.userId) {
            return res.status(401).json({ message: "Authentication required." });
        }
        const timestamp = Math.round(Date.now() / 1000);
        const folder = "just-do-it/profile-pictures";
        const public_id = `user_${req.userId}`;
        const config = cloudinary.config();

        if (!config.api_key || !config.api_secret || !config.cloud_name) {
            return res.status(500).json({ message: "Cloudinary is not configured." });
        }

        const paramsToSign = {
            folder,
            overwrite: true,
            public_id,
            timestamp
        };

        const signature = cloudinary.utils.api_sign_request(
            paramsToSign,
            config.api_secret
        );

        return res.json({
            signature,
            timestamp,
            apiKey: config.api_key,
            cloudName: config.cloud_name,
            folder,
            public_id,
            publicId: public_id,
            overwrite: true
        });
    } catch (error) {
        logFailure("Generate upload signature failed.", error);
        return res.status(500).json({ message: "Could not generate upload signature." });
    }
};

const getProfile = async (req, res) => {
    try {
        await connectDB();

        const user = await User.findById(req.userId)
            .select("-passwordHash +ageReferenceYear");

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        res.json({ success: true, user });
    } catch (error) {
        logFailure("Get profile failed.", error);
        res.status(500).json({ message: "Could not load profile." });
    }
};

function normalizeProfileFields(body, requireName) {
    if (!isPlainObject(body)) {
        return { error: { status: 400, message: "Profile data must be an object." } };
    }

    const { name, age, height, weight, profilePicture, socials } = body;
    if (requireName && name === undefined) {
        return { error: { status: 400, message: "Name is required." } };
    }

    let normalizedName;
    if (name !== undefined) {
        if (typeof name !== "string" || !name.trim() || name.trim().length > 100) {
            return { error: { status: 400, message: "Please enter a name between 1 and 100 characters." } };
        }
        normalizedName = name.trim();
    }

    let normalizedAge;
    if (age !== undefined) {
        if (age === null || age === "") {
            normalizedAge = null;
        } else if (
            (typeof age !== "number" && typeof age !== "string") ||
            (typeof age === "string" && age.trim() === "")
        ) {
            return { error: { status: 400, message: "Age must be a whole number between 0 and 120." } };
        } else {
            const numericAge = Number(age);
            if (!Number.isInteger(numericAge) || numericAge < 0 || numericAge > 120) {
                return { error: { status: 400, message: "Age must be a whole number between 0 and 120." } };
            }
            normalizedAge = numericAge;
        }
    }

    function profileMetric(value, min, max) {
        if (value === "" || value === null) return { valid: true, value: null };
        if (typeof value !== "number" && typeof value !== "string") {
            return { valid: false, value: null };
        }
        const number = Number(value);
        return {
            valid: Number.isFinite(number) && number >= min && number <= max,
            value: number
        };
    }

    const normalizedHeight = height === undefined ? null : profileMetric(height, 50, 300);
    const normalizedWeight = weight === undefined ? null : profileMetric(weight, 20, 500);
    if (normalizedHeight && !normalizedHeight.valid) {
        return { error: { status: 400, message: "Height must be between 50 and 300 cm." } };
    }
    if (normalizedWeight && !normalizedWeight.valid) {
        return { error: { status: 400, message: "Weight must be between 20 and 500 kg." } };
    }

    let normalizedSocials;
    if (socials !== undefined) {
        if (!Array.isArray(socials) && !isPlainObject(socials)) {
            return { error: { status: 400, message: "Social links must be a list of URLs." } };
        }

        const links = (Array.isArray(socials) ? socials : Object.values(socials))
            .filter(value => value !== undefined && value !== null && value !== "");
        if (links.length > 10) {
            return { error: { status: 400, message: "You can add up to 10 social links." } };
        }

        normalizedSocials = [];
        for (const value of links) {
            if (typeof value !== "string" || value.trim().length > 500) {
                return { error: { status: 400, message: "Social links must be valid HTTP or HTTPS URLs." } };
            }
            try {
                const url = new URL(value.trim());
                if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
                    throw new Error("Unsupported URL protocol.");
                }
                normalizedSocials.push(url.href);
            } catch {
                return { error: { status: 400, message: "Social links must be valid HTTP or HTTPS URLs." } };
            }
        }
    }

    return {
        values: {
            name: normalizedName,
            age: normalizedAge,
            height: normalizedHeight,
            weight: normalizedWeight,
            profilePicture,
            socials: normalizedSocials,
            hasSocials: socials !== undefined
        }
    };
}

function isCloudinarySecureUrl(url) {
    if (typeof url !== "string") return false;
    const config = cloudinary.config();
    const cloudName = config.cloud_name;
    const pattern = cloudName
        ? new RegExp(`^https://res\\.cloudinary\\.com/${cloudName}/image/upload/.+`, "i")
        : /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/.+/i;
    return pattern.test(url);
}

async function resolveProfilePicture(profilePicture, user) {
    if (profilePicture === undefined) return { value: undefined };
    if (!profilePicture) return { value: null };

    if (isCloudinarySecureUrl(profilePicture)) {
        return { value: profilePicture };
    }

    return { error: { status: 400, message: "Invalid profile photo." } };
}

function applyNormalizedProfile(user, values, profilePictureUrl) {
    const { name, age, height, weight, profilePicture, socials, hasSocials } = values;
    if (name !== undefined) user.name = name;
    if (age !== undefined) {
        user.age = age;
        user.ageReferenceYear = age === null
            ? null
            : Number(getDateString().slice(0, 4));
    }
    if (height) user.height = height.value;
    if (weight) user.weight = weight.value;
    if (profilePicture !== undefined) user.profilePicture = profilePictureUrl;
    if (hasSocials) user.socials = socials;
}

async function applyProfileData(user, body, requireName) {
    const normalized = normalizeProfileFields(body, requireName);
    if (normalized.error) return normalized.error;

    const picture = await resolveProfilePicture(normalized.values.profilePicture, user);
    if (picture.error) return picture.error;

    applyNormalizedProfile(user, normalized.values, picture.value);
    return null;
}

function sendProfileValidationError(res, error) {
    return res.status(error.status).json({ message: error.message });
}

const saveProfile = async (req, res, requireName = false) => {
    try {
        await connectDB();
        const user = await User.findById(req.userId).select("+ageReferenceYear");
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        const validationError = await applyProfileData(user, req.body, requireName);
        if (validationError) {
            return sendProfileValidationError(res, validationError);
        }

        await user.save();
        const updatedUser = await User.findById(req.userId)
            .select("-passwordHash +ageReferenceYear");
        return res.json({ success: true, user: updatedUser });
    } catch (error) {
        logFailure("Update profile failed.", error);
        return res.status(500).json({ message: "Could not update profile." });
    }
};

const completeSignup = async (req, res) => {
    try {
        await connectDB();
        if (!isPlainObject(req.body)) {
            return res.status(400).json({ message: "Profile data must be an object." });
        }
        if (req.body.legalConsent !== true) {
            return res.status(400).json({ message: "Please agree to the Privacy Policy and Terms & Conditions." });
        }

        const pendingToken = getCookieValue(
            req.headers.cookie,
            PENDING_SIGNUP_COOKIE_NAME
        );
        if (!pendingToken) {
            return res.status(401).json({ message: "Signup verification expired. Please verify your email again." });
        }

        const pendingSignup = await PendingSignup.findOne({
            tokenHash: hashOTP(pendingToken),
            expiresAt: { $gt: new Date() }
        });
        if (!pendingSignup) {
            clearPendingSignupCookie(res);
            return res.status(401).json({ message: "Signup verification expired. Please verify your email again." });
        }

        const existingUser = await User.findOne({ email: pendingSignup.email });
        if (existingUser) {
            await PendingSignup.deleteOne({ _id: pendingSignup._id });
            clearPendingSignupCookie(res);
            return res.status(409).json({
                message: "This email already has an account. Please log in instead."
            });
        }

        const existingUsername = await User.findOne({
            username: pendingSignup.username
        });
        if (existingUsername) {
            return res.status(409).json({
                message: "That username is already taken. Please restart signup with another username."
            });
        }

        const user = new User({
            name: req.body.name,
            username: pendingSignup.username,
            email: pendingSignup.email,
            passwordHash: pendingSignup.passwordHash,
            googleId: pendingSignup.googleId,
            profilePicture: pendingSignup.profilePicture,
            emailVerifiedAt: new Date(),
            legalConsentAt: new Date()
        });
        const validationError = await applyProfileData(user, req.body, true);
        if (validationError) {
            return sendProfileValidationError(res, validationError);
        }

        await user.save();
        await PendingSignup.deleteOne({ _id: pendingSignup._id });
        const session = createAuthSession(user);
        setSessionCookie(res, session.token);
        clearPendingSignupCookie(res);
        res.set("Cache-Control", "no-store");
        return res.json({ success: true, user: session.user });
    } catch (error) {
        if (error.code === 11000) {
            const duplicateFields = Object.keys(error.keyPattern || error.keyValue || {});
            if (duplicateFields.includes("email")) {
                return res.status(409).json({
                    message: "This email already has an account. Please log in instead."
                });
            }
            if (duplicateFields.includes("username")) {
                return res.status(409).json({
                    message: "That username is already taken. Please restart signup with another username."
                });
            }
            return res.status(409).json({
                message: "An account already exists. Please log in or restart signup with different details."
            });
        }
        logFailure("Complete signup failed.", error);
        return res.status(500).json({ message: "Could not create your account." });
    }
};

const updateProfile = (req, res) => saveProfile(req, res);
const completeFirstDetails = (req, res) => saveProfile(req, res, true);

const updatePrivacy = async (req, res) => {
    if (!isPlainObject(req.body) || typeof req.body.isPrivate !== "boolean") {
        return res.status(400).json({ message: "Privacy setting must be true or false." });
    }
    try {
        await connectDB();
        const user = await User.findByIdAndUpdate(
            req.userId,
            { $set: { isPrivate: req.body.isPrivate } },
            { returnDocument: "after", runValidators: true }
        ).select("isPrivate");
        if (!user) return res.status(404).json({ message: "User not found." });
        return res.json({ success: true, isPrivate: user.isPrivate });
    } catch (error) {
        logFailure("Update privacy setting failed.", error);
        return res.status(500).json({ message: "Could not update privacy setting." });
    }
};

const deleteAccount = async (req, res) => {
    let session;
    try {
        await connectDB();

        session = await mongoose.startSession();
        let user = null;
        await session.withTransaction(async () => {
            user = await User.findById(req.userId)
                .select("email profilePicture")
                .session(session);
            if (!user) return;

            await Workout.deleteMany({ user: req.userId }, { session });
            await Competition.deleteMany({
                $or: [
                    { owner: req.userId },
                    { competitor: req.userId }
                ]
            }, { session });
            await OTP.deleteMany({ email: user.email }, { session });
            await OTPGuard.deleteMany({ email: user.email }, { session });
            await EmailNotificationLog.deleteMany({ user: req.userId }, { session });
            await User.deleteOne({ _id: req.userId }, { session });
        });

        if (!user) {
            return res.status(404).json({ message: "Account not found." });
        }

        if (user.profilePicture && user.profilePicture.includes("res.cloudinary.com")) {
            try {
                const publicId = extractCloudinaryPublicId(user.profilePicture);
                const targetPublicId = (publicId && publicId.startsWith("just-do-it/profile-pictures/"))
                    ? publicId
                    : `just-do-it/profile-pictures/user_${req.userId}`;
                await cloudinary.uploader.destroy(
                    targetPublicId,
                    { resource_type: "image" }
                );
                if (targetPublicId !== `just-do-it/profile-pictures/user_${req.userId}`) {
                    await cloudinary.uploader.destroy(
                        `just-do-it/profile-pictures/user_${req.userId}`,
                        { resource_type: "image" }
                    ).catch(() => {});
                }
            } catch (error) {
                logFailure("Could not remove deleted account's profile photo.", error);
            }
        }

        clearSessionCookie(res);
        return res.json({ success: true });
    } catch (error) {
        logFailure("Delete account failed.", error);
        return res.status(500).json({ message: "Could not delete your account." });
    } finally {
        await session?.endSession();
    }
};

module.exports = {
    getProfile,
    getUploadSignature,
    updateProfile,
    completeFirstDetails,
    completeSignup,
    updatePrivacy,
    deleteAccount
};
