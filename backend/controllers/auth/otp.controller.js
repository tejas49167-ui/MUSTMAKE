const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../../models/User");
const OTP = require("../../models/OTP");
const OTPGuard = require("../../models/OTPGuard");
const connectDB = require("../../config/database");
const {
    OTP_EXPIRY_MINUTES,
    OTP_MAX_ATTEMPTS,
    OTP_RESEND_COOLDOWN_MS,
    OTP_ATTEMPT_WINDOW_MS,
    generateOTP,
    generateOTPChallenge,
    hashOTP,
    createAuthSession
} = require("../../services/auth.service");
const { sendOTPEmail } = require("../../services/email.service");
const otpAbuseService = require("../../services/otp-abuse.service");
const { savePendingSignup } = require("../../services/pending-signup.service");
const {
    clearPendingSignupCookie,
    setSessionCookie
} = require("../../utils/auth-cookie");
const { parseOtpIdentity, parseSignupCredentials } = require("../../schemas/auth.schemas");
const { logFailure } = require("../../utils/safe-log");

function isOtpLocked(guard, now = new Date()) {
    return Boolean(
        guard &&
        guard.failedAttempts >= OTP_MAX_ATTEMPTS &&
        guard.attemptWindowStartedAt &&
        guard.attemptWindowStartedAt.getTime() > now.getTime() - OTP_ATTEMPT_WINDOW_MS
    );
}

async function claimOtpSend(email, purpose, now) {
    try {
        return await OTPGuard.findOneAndUpdate(
            {
                email,
                purpose,
                $and: [
                    {
                        $or: [
                            { lastSentAt: { $exists: false } },
                            { lastSentAt: { $lte: new Date(now.getTime() - OTP_RESEND_COOLDOWN_MS) } }
                        ]
                    },
                    {
                        $or: [
                            { attemptWindowStartedAt: { $exists: false } },
                            { attemptWindowStartedAt: { $lte: new Date(now.getTime() - OTP_ATTEMPT_WINDOW_MS) } },
                            { failedAttempts: { $lt: OTP_MAX_ATTEMPTS } }
                        ]
                    }
                ]
            },
            {
                $set: { lastSentAt: now },
                $setOnInsert: { email, purpose }
            },
            { returnDocument: "after", upsert: true }
        );
    } catch (error) {
        if (error.code === 11000) {
            return null;
        }

        throw error;
    }
}

async function incrementOtpFailures(email, purpose, now) {
    const activeWindow = {
        email,
        purpose,
        attemptWindowStartedAt: {
            $gt: new Date(now.getTime() - OTP_ATTEMPT_WINDOW_MS)
        }
    };

    const incremented = await OTPGuard.findOneAndUpdate(
        activeWindow,
        { $inc: { failedAttempts: 1 } },
        { returnDocument: "after" }
    );

    if (incremented) {
        return incremented;
    }

    try {
        return await OTPGuard.findOneAndUpdate(
            {
                email,
                purpose,
                $or: [
                    { attemptWindowStartedAt: { $exists: false } },
                    { attemptWindowStartedAt: { $lte: new Date(now.getTime() - OTP_ATTEMPT_WINDOW_MS) } }
                ]
            },
            {
                $set: {
                    failedAttempts: 1,
                    attemptWindowStartedAt: now
                },
                $setOnInsert: { email, purpose }
            },
            { returnDocument: "after", upsert: true }
        );
    } catch (error) {
        if (error.code !== 11000) {
            throw error;
        }

        const retried = await OTPGuard.findOneAndUpdate(
            activeWindow,
            { $inc: { failedAttempts: 1 } },
            { returnDocument: "after" }
        );

        if (!retried) {
            throw error;
        }

        return retried;
    }
}

const sendOtp = async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        await connectDB();
        await Promise.all([OTP.init(), OTPGuard.init()]);
        const identity = parseOtpIdentity(
            req.body,
            "Email and OTP purpose are required."
        );
        if (!identity.valid) {
            return res.status(identity.status).json({ message: identity.message });
        }
        const { body, email: cleanEmail, purpose } = identity;

        if (purpose === "signup" && await User.findOne({ email: cleanEmail })) {
            return res.status(409).json({
                message: "User already exists. Please log in."
            });
        }

        const existingUser = purpose === "login"
            ? await User.findOne({ email: cleanEmail })
            : null;
        if (purpose === "login" && !existingUser) {
            return res.status(404).json({
                message: "User does not exist. Please sign up."
            });
        }

        const now = new Date();
        const ip = req.ip || req.socket?.remoteAddress || "unknown";
        const previousOTP = await OTP.findOne({ email: cleanEmail, purpose });
        const guard = await OTPGuard.findOne({ email: cleanEmail, purpose });
        if (isOtpLocked(guard, now)) {
            return res.status(429).json({
                message: "Too many incorrect code attempts. Please try again later."
            });
        }

        const cooldownStartedAt = guard?.lastSentAt || previousOTP?.createdAt;
        if (
            cooldownStartedAt &&
            cooldownStartedAt.getTime() > now.getTime() - OTP_RESEND_COOLDOWN_MS
        ) {
            return res.status(202).json({
                success: true,
                codeAlreadySent: true,
                sentAt: cooldownStartedAt.getTime(),
                message: "A code was sent recently. Use the most recent code."
            });
        }

        let signupData = null;
        const hasSignupFields =
            typeof body.username === "string" || typeof body.password === "string";

        if (purpose === "signup") {
            if (hasSignupFields) {
                const credentials = parseSignupCredentials(body);
                if (!credentials.valid) {
                    return res.status(credentials.status).json({
                        message: credentials.message
                    });
                }

                signupData = {
                    username: credentials.username,
                    passwordHash: await bcrypt.hash(credentials.password, 12)
                };
            } else if (
                previousOTP?.expiresAt > now &&
                previousOTP.signupData?.passwordHash
            ) {
                signupData = previousOTP.signupData.toObject
                    ? previousOTP.signupData.toObject()
                    : previousOTP.signupData;
            } else {
                return res.status(400).json({
                    message: "Signup details expired. Please enter your details again."
                });
            }
        }

        let usernameExists = false;
        if (purpose === "signup") {
            usernameExists = Boolean(await User.findOne({ username: signupData.username }));
        }

        if (usernameExists) {
            return res.status(409).json({
                message: "That username is already taken. Please choose another one."
            });
        }

        const challengeToken = generateOTPChallenge();
        const allowed = await otpAbuseService.allowOtpSend(cleanEmail, ip, now);
        if (!allowed) {
            return res.status(429).json({
                message: "Too many code requests. Please try again later."
            });
        }

        const sendClaim = await claimOtpSend(cleanEmail, purpose, now);
        if (!sendClaim) {
            return res.status(429).json({
                message: "Too many code requests. Please wait before trying again."
            });
        }

        const otp = generateOTP();
        const otpHash = hashOTP(otp);
        const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
        await OTP.deleteMany({ email: cleanEmail, purpose });

        const otpRecord = await OTP.create({
            email: cleanEmail,
            otpHash,
            challengeHash: hashOTP(challengeToken),
            purpose,
            expiresAt,
            ...(signupData ? { signupData } : {})
        });

        try {
            await sendOTPEmail(cleanEmail, otp, purpose);
        } catch (error) {
            await Promise.all([
                OTP.deleteOne({ _id: otpRecord._id, otpHash }),
                OTPGuard.updateOne(
                    { email: cleanEmail, purpose, lastSentAt: now },
                    { $unset: { lastSentAt: 1 } }
                )
            ]);
            throw error;
        }

        return res.status(202).json({
            success: true,
            challengeToken,
            sentAt: now.getTime(),
            message: "Verification code sent."
        });
    } catch (error) {
        logFailure("Send OTP failed.", error);
        return res.status(500).json({ message: "Could not process the code request." });
    }
};

const verifyOtp = async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        await connectDB();
        await Promise.all([OTP.init(), OTPGuard.init()]);
        const identity = parseOtpIdentity(
            req.body,
            "Email, OTP and purpose are required."
        );
        if (!identity.valid) {
            return res.status(identity.status).json({ message: identity.message });
        }
        const { body, email: cleanEmail, purpose } = identity;
        const { otp } = body;

        const now = new Date();
        const ip = req.ip || req.socket?.remoteAddress || "unknown";
        const allowed = await otpAbuseService.allowOtpVerification(cleanEmail, ip, now);
        if (!allowed) {
            return res.status(429).json({
                message: "Too many code attempts. Request a new code later."
            });
        }

        const cleanOTP = typeof otp === "string" ? otp.trim() : "";
        const challengeToken = typeof body.challengeToken === "string"
            ? body.challengeToken
            : "";
        if (!/^\d{6}$/.test(cleanOTP)) {
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        const guard = await OTPGuard.findOne({ email: cleanEmail, purpose });
        if (isOtpLocked(guard, now)) {
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        const otpRecord = await OTP.findOne({ email: cleanEmail, purpose });
        if (!otpRecord || otpRecord.expiresAt <= now) {
            if (otpRecord) {
                await OTP.deleteOne({ _id: otpRecord._id, expiresAt: { $lte: now } });
            }
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        if (
            otpRecord.attempts >= OTP_MAX_ATTEMPTS ||
            (purpose === "signup" && !otpRecord.signupData?.passwordHash)
        ) {
            await OTP.deleteOne({ _id: otpRecord._id });
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        const submittedOtpHash = Buffer.from(hashOTP(cleanOTP), "hex");
        const storedOtpHash = Buffer.from(otpRecord.otpHash, "hex");
        const submittedChallengeHash = Buffer.from(hashOTP(challengeToken), "hex");
        const storedChallengeHash = Buffer.from(otpRecord.challengeHash || "", "hex");
        const otpMatches = submittedOtpHash.length === storedOtpHash.length &&
            crypto.timingSafeEqual(submittedOtpHash, storedOtpHash);
        const challengeMatches = submittedChallengeHash.length === storedChallengeHash.length &&
            storedChallengeHash.length > 0 &&
            crypto.timingSafeEqual(submittedChallengeHash, storedChallengeHash);

        if (otpMatches && challengeMatches && purpose === "signup") {
            const existingUser = await User.findOne({ email: cleanEmail });
            if (existingUser) {
                await OTP.deleteOne({ _id: otpRecord._id });
                return res.status(409).json({
                    message: "An account with this email already exists. Please log in."
                });
            }
        }

        if (!otpMatches || !challengeMatches) {
            const updatedRecord = await OTP.findOneAndUpdate(
                {
                    _id: otpRecord._id,
                    attempts: { $lt: OTP_MAX_ATTEMPTS },
                    expiresAt: { $gt: new Date() }
                },
                { $inc: { attempts: 1 } },
                { returnDocument: "after" }
            );

            if (!updatedRecord) {
                return res.status(401).json({ message: "Invalid or expired code." });
            }

            const updatedGuard = await incrementOtpFailures(
                cleanEmail,
                purpose,
                new Date()
            );
            if (
                updatedRecord.attempts >= OTP_MAX_ATTEMPTS ||
                updatedGuard.failedAttempts >= OTP_MAX_ATTEMPTS
            ) {
                await OTP.deleteMany({ email: cleanEmail, purpose });
                return res.status(401).json({ message: "Invalid or expired code." });
            }

            return res.status(401).json({ message: "Invalid or expired code." });
        }

        const consumedOTP = await OTP.findOneAndDelete({
            _id: otpRecord._id,
            otpHash: otpRecord.otpHash,
            challengeHash: otpRecord.challengeHash,
            expiresAt: { $gt: new Date() },
            attempts: { $lt: OTP_MAX_ATTEMPTS }
        });
        if (!consumedOTP) {
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        await OTPGuard.updateOne(
            { email: cleanEmail, purpose },
            {
                $set: { failedAttempts: 0 },
                $unset: { attemptWindowStartedAt: 1 }
            }
        );

        if (purpose === "signup") {
            try {
                await savePendingSignup({
                    email: cleanEmail,
                    username: consumedOTP.signupData.username,
                    passwordHash: consumedOTP.signupData.passwordHash,
                    authProvider: "password"
                }, res);
                return res.json({
                    success: true,
                    pendingSignup: true,
                    message: "Email verified. Complete your details to create your account."
                });
            } catch (error) {
                if (error.code === 11000) {
                    return res.status(409).json({
                        message: "Signup could not be completed. Please restart signup."
                    });
                }
                throw error;
            }
        }

        const user = await User.findOne({ email: cleanEmail })
            .select("+ageReferenceYear +sessionVersion");
        if (!user) {
            return res.status(401).json({ message: "Invalid or expired code." });
        }

        if (!user.emailVerifiedAt) {
            user.emailVerifiedAt = new Date();
            if (typeof user.save === "function") await user.save();
        }

        const session = createAuthSession(user);
        res.set("Cache-Control", "no-store");
        clearPendingSignupCookie(res);
        setSessionCookie(res, session.token);
        return res.json({
            success: true,
            user: session.user
        });
    } catch (error) {
        logFailure("Verify OTP failed.", error);
        return res.status(500).json({ message: "Could not verify the code." });
    }
};

module.exports = { sendOtp, verifyOtp };
