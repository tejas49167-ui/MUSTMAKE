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

/* ==========================================================================
   1. PURE CRYPTO & REQUEST HELPERS
   ========================================================================== */

function getClientIp(req) {
    return req.ip || req.socket?.remoteAddress || "unknown";
}

function verifyHashesTimingSafe(cleanOTP, challengeToken, otpRecord) {
    const submittedOtpHash = Buffer.from(hashOTP(cleanOTP), "hex");
    const storedOtpHash = Buffer.from(otpRecord.otpHash, "hex");
    const submittedChallengeHash = Buffer.from(hashOTP(challengeToken), "hex");
    const storedChallengeHash = Buffer.from(otpRecord.challengeHash || "", "hex");

    const otpMatches =
        submittedOtpHash.length === storedOtpHash.length &&
        crypto.timingSafeEqual(submittedOtpHash, storedOtpHash);

    const challengeMatches =
        submittedChallengeHash.length === storedChallengeHash.length &&
        storedChallengeHash.length > 0 &&
        crypto.timingSafeEqual(submittedChallengeHash, storedChallengeHash);

    return { otpMatches, challengeMatches };
}

async function resolveSignupData(body, previousOTP, now) {
    const hasSignupFields =
        typeof body.username === "string" || typeof body.password === "string";

    if (hasSignupFields) {
        const credentials = parseSignupCredentials(body);
        if (!credentials.valid) {
            return { error: { status: credentials.status, message: credentials.message } };
        }
        return {
            signupData: {
                username: credentials.username,
                passwordHash: await bcrypt.hash(credentials.password, 12)
            }
        };
    }

    if (previousOTP?.expiresAt > now && previousOTP.signupData?.passwordHash) {
        const signupData = previousOTP.signupData.toObject
            ? previousOTP.signupData.toObject()
            : previousOTP.signupData;
        return { signupData };
    }

    return {
        error: {
            status: 400,
            message: "Signup details expired. Please enter your details again."
        }
    };
}

/* ==========================================================================
   2. OTP GUARD & RATE-LIMIT STATE MACHINE
   ========================================================================== */

function isOtpLocked(guard, now = new Date()) {
    return Boolean(
        guard &&
        guard.failedAttempts >= OTP_MAX_ATTEMPTS &&
        guard.attemptWindowStartedAt &&
        guard.attemptWindowStartedAt.getTime() > now.getTime() - OTP_ATTEMPT_WINDOW_MS
    );
}

function isWithinCooldown(guard, previousOTP, now = new Date()) {
    const cooldownStartedAt = guard?.lastSentAt || previousOTP?.createdAt;
    if (
        cooldownStartedAt &&
        cooldownStartedAt.getTime() > now.getTime() - OTP_RESEND_COOLDOWN_MS
    ) {
        return cooldownStartedAt.getTime();
    }
    return null;
}

async function claimOtpSend(email, purpose, now = new Date()) {
    try {
        return await OTPGuard.findOneAndUpdate(
            buildSendClaimFilter(email, purpose, now),
            {
                $set: { lastSentAt: now },
                $setOnInsert: { email, purpose }
            },
            { returnDocument: "after", upsert: true }
        );
    } catch (error) {
        if (error.code === 11000) return null;
        throw error;
    }
}

async function incrementOtpFailures(email, purpose, now = new Date()) {
    const activeWindow = buildActiveAttemptWindowFilter(email, purpose, now);

    const incremented = await OTPGuard.findOneAndUpdate(
        activeWindow,
        { $inc: { failedAttempts: 1 } },
        { returnDocument: "after" }
    );

    if (incremented) return incremented;

    try {
        return await OTPGuard.findOneAndUpdate(
            buildExpiredAttemptWindowFilter(email, purpose, now),
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
        if (error.code !== 11000) throw error;

        const retried = await OTPGuard.findOneAndUpdate(
            activeWindow,
            { $inc: { failedAttempts: 1 } },
            { returnDocument: "after" }
        );

        if (!retried) throw error;
        return retried;
    }
}

function buildSendClaimFilter(email, purpose, now) {
    const resendCutoff = new Date(now.getTime() - OTP_RESEND_COOLDOWN_MS);
    const attemptCutoff = new Date(now.getTime() - OTP_ATTEMPT_WINDOW_MS);

    return {
        email,
        purpose,
        $and: [
            {
                $or: [
                    { lastSentAt: { $exists: false } },
                    { lastSentAt: { $lte: resendCutoff } }
                ]
            },
            {
                $or: [
                    { attemptWindowStartedAt: { $exists: false } },
                    { attemptWindowStartedAt: { $lte: attemptCutoff } },
                    { failedAttempts: { $lt: OTP_MAX_ATTEMPTS } }
                ]
            }
        ]
    };
}

function buildActiveAttemptWindowFilter(email, purpose, now) {
    return {
        email,
        purpose,
        attemptWindowStartedAt: {
            $gt: new Date(now.getTime() - OTP_ATTEMPT_WINDOW_MS)
        }
    };
}

function buildExpiredAttemptWindowFilter(email, purpose, now) {
    return {
        email,
        purpose,
        $or: [
            { attemptWindowStartedAt: { $exists: false } },
            { attemptWindowStartedAt: { $lte: new Date(now.getTime() - OTP_ATTEMPT_WINDOW_MS) } }
        ]
    };
}

async function resetOtpGuard(email, purpose) {
    return OTPGuard.updateOne(
        { email, purpose },
        {
            $set: { failedAttempts: 0 },
            $unset: { attemptWindowStartedAt: 1 }
        }
    );
}

/* ==========================================================================
   3. DATABASE & EMAIL ORCHESTRATION
   ========================================================================== */

async function createAndDispatchOtp({ email, purpose, signupData, now }) {
    const challengeToken = generateOTPChallenge();
    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await OTP.deleteMany({ email, purpose });

    const otpRecord = await OTP.create({
        email,
        otpHash,
        challengeHash: hashOTP(challengeToken),
        purpose,
        expiresAt,
        ...(signupData ? { signupData } : {})
    });

    try {
        await sendOTPEmail(email, otp, purpose);
    } catch (error) {
        await Promise.all([
            OTP.deleteOne({ _id: otpRecord._id, otpHash }),
            OTPGuard.updateOne(
                { email, purpose, lastSentAt: now },
                { $unset: { lastSentAt: 1 } }
            )
        ]);
        throw error;
    }

    return challengeToken;
}

async function recordFailedVerification(otpRecord, email, purpose, now = new Date()) {
    const updatedRecord = await OTP.findOneAndUpdate(
        {
            _id: otpRecord._id,
            attempts: { $lt: OTP_MAX_ATTEMPTS },
            expiresAt: { $gt: now }
        },
        { $inc: { attempts: 1 } },
        { returnDocument: "after" }
    );

    if (!updatedRecord) return;

    const updatedGuard = await incrementOtpFailures(email, purpose, now);
    if (
        updatedRecord.attempts >= OTP_MAX_ATTEMPTS ||
        updatedGuard.failedAttempts >= OTP_MAX_ATTEMPTS
    ) {
        await OTP.deleteMany({ email, purpose });
    }
}

async function finalizeLoginSession(email, res) {
    const user = await User.findOne({ email }).select("+ageReferenceYear +sessionVersion");
    if (!user) return null;

    if (!user.emailVerifiedAt) {
        user.emailVerifiedAt = new Date();
        if (typeof user.save === "function") await user.save();
    }

    const session = createAuthSession(user);
    res.set("Cache-Control", "no-store");
    clearPendingSignupCookie(res);
    setSessionCookie(res, session.token);

    return session.user;
}

/* ==========================================================================
   4. EXPRESS ROUTE CONTROLLERS
   ========================================================================== */

const sendOtp = async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
        await connectDB();
        await Promise.all([OTP.init(), OTPGuard.init()]);

        const identity = parseOtpIdentity(req.body, "Email and OTP purpose are required.");
        if (!identity.valid) {
            return res.status(identity.status).json({ message: identity.message });
        }
        const { body, email: cleanEmail, purpose } = identity;

        if (purpose === "signup" && await User.findOne({ email: cleanEmail })) {
            return res.status(409).json({ message: "User already exists. Please log in." });
        }
        if (purpose === "login" && !(await User.findOne({ email: cleanEmail }))) {
            return res.status(404).json({ message: "User does not exist. Please sign up." });
        }

        const now = new Date();
        const ip = getClientIp(req);
        const previousOTP = await OTP.findOne({ email: cleanEmail, purpose });
        const guard = await OTPGuard.findOne({ email: cleanEmail, purpose });

        if (isOtpLocked(guard, now)) {
            return res.status(429).json({
                message: "Too many incorrect code attempts. Please try again later."
            });
        }

        const recentSentAt = isWithinCooldown(guard, previousOTP, now);
        if (recentSentAt) {
            return res.status(202).json({
                success: true,
                codeAlreadySent: true,
                sentAt: recentSentAt,
                message: "A code was sent recently. Use the most recent code."
            });
        }

        let signupData = null;
        if (purpose === "signup") {
            const resolved = await resolveSignupData(body, previousOTP, now);
            if (resolved.error) {
                return res.status(resolved.error.status).json({ message: resolved.error.message });
            }
            signupData = resolved.signupData;

            if (await User.findOne({ username: signupData.username })) {
                return res.status(409).json({
                    message: "That username is already taken. Please choose another one."
                });
            }
        }

        if (!(await otpAbuseService.allowOtpSend(cleanEmail, ip, now))) {
            return res.status(429).json({
                message: "Too many code requests. Please try again later."
            });
        }

        if (!(await claimOtpSend(cleanEmail, purpose, now))) {
            return res.status(429).json({
                message: "Too many code requests. Please wait before trying again."
            });
        }

        const challengeToken = await createAndDispatchOtp({
            email: cleanEmail,
            purpose,
            signupData,
            now
        });

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
    const invalidResponse = () => res.status(401).json({ message: "Invalid or expired code." });

    try {
        await connectDB();
        await Promise.all([OTP.init(), OTPGuard.init()]);

        const identity = parseOtpIdentity(req.body, "Email, OTP and purpose are required.");
        if (!identity.valid) {
            return res.status(identity.status).json({ message: identity.message });
        }
        const { body, email: cleanEmail, purpose } = identity;

        const now = new Date();
        const ip = getClientIp(req);
        if (!(await otpAbuseService.allowOtpVerification(cleanEmail, ip, now))) {
            return res.status(429).json({
                message: "Too many code attempts. Request a new code later."
            });
        }

        const cleanOTP = typeof body.otp === "string" ? body.otp.trim() : "";
        const challengeToken = typeof body.challengeToken === "string" ? body.challengeToken : "";
        if (!/^\d{6}$/.test(cleanOTP)) return invalidResponse();

        const guard = await OTPGuard.findOne({ email: cleanEmail, purpose });
        if (isOtpLocked(guard, now)) return invalidResponse();

        const otpRecord = await OTP.findOne({ email: cleanEmail, purpose });

        if (!otpRecord || otpRecord.expiresAt <= now) {
            if (otpRecord) await OTP.deleteOne({ _id: otpRecord._id, expiresAt: { $lte: now } });
            return invalidResponse();
        }

        if (
            otpRecord.attempts >= OTP_MAX_ATTEMPTS ||
            (purpose === "signup" && !otpRecord.signupData?.passwordHash)
        ) {
            await OTP.deleteOne({ _id: otpRecord._id });
            return invalidResponse();
        }

        const { otpMatches, challengeMatches } = verifyHashesTimingSafe(
            cleanOTP,
            challengeToken,
            otpRecord
        );

        if (otpMatches && challengeMatches && purpose === "signup") {
            if (await User.findOne({ email: cleanEmail })) {
                await OTP.deleteOne({ _id: otpRecord._id });
                return res.status(409).json({
                    message: "An account with this email already exists. Please log in."
                });
            }
        }

        if (!otpMatches || !challengeMatches) {
            await recordFailedVerification(otpRecord, cleanEmail, purpose, new Date());
            return invalidResponse();
        }

        const consumedOTP = await OTP.findOneAndDelete({
            _id: otpRecord._id,
            otpHash: otpRecord.otpHash,
            challengeHash: otpRecord.challengeHash,
            expiresAt: { $gt: new Date() },
            attempts: { $lt: OTP_MAX_ATTEMPTS }
        });
        if (!consumedOTP) return invalidResponse();

        await resetOtpGuard(cleanEmail, purpose);

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

        const sessionUser = await finalizeLoginSession(cleanEmail, res);
        if (!sessionUser) return invalidResponse();

        return res.json({ success: true, user: sessionUser });
    } catch (error) {
        logFailure("Verify OTP failed.", error);
        return res.status(500).json({ message: "Could not verify the code." });
    }
};

module.exports = {
    sendOtp,
    verifyOtp,
    // Exported for unit testing individual responsibilities without Express mocks
    _helpers: {
        verifyHashesTimingSafe,
        resolveSignupData,
        isOtpLocked,
        isWithinCooldown,
        claimOtpSend,
        incrementOtpFailures,
        resetOtpGuard,
        createAndDispatchOtp,
        recordFailedVerification,
        finalizeLoginSession
    }
};
