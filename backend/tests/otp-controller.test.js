const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../models/User");
const OTP = require("../models/OTP");
const OTPGuard = require("../models/OTPGuard");
const OTPThrottle = require("../models/OTPThrottle");
const PendingSignup = require("../models/PendingSignup");
const otpAbuseService = require("../services/otp-abuse.service");
const authService = require("../services/auth.service");
const emailService = require("../services/email.service");

const originalSendOTPEmail = emailService.sendOTPEmail;
const sentEmails = [];
let emailFailure = false;
emailService.sendOTPEmail = async (email, otp, purpose) => {
    sentEmails.push({ email, otp, purpose });
    if (emailFailure) {
        throw new Error(`SMTP rejected ${email}; code was ${otp}.`);
    }
};
const authController = require("../controllers/auth.controller");
emailService.sendOTPEmail = originalSendOTPEmail;
const profileController = require("../controllers/profile.controller");

function responseStub() {
    return {
        statusCode: 200,
        body: null,
        cookies: [],
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        set() {
            return this;
        },
        cookie(...args) {
            this.cookies.push(args);
            return this;
        },
        clearCookie() {
            return this;
        }
    };
}

function installControllerStubs(t, overrides = {}) {
    const models = {
        User,
        OTP,
        OTPGuard,
        OTPThrottle,
        PendingSignup
    };
    const originals = Object.entries(models).map(([name, model]) => ({
        model,
        methods: Object.fromEntries(
            Object.keys(overrides[name] || {}).map(method => [method, model[method]])
        )
    }));
    const originalReadyState = mongoose.connection.readyState;
    const originalMongoUri = process.env.MONGO_URI;
    const originalJwtSecret = process.env.JWT_SECRET;
    const originalOtpSecret = process.env.OTP_SECRET;
    const originalSendLimit = otpAbuseService.allowOtpSend;
    const originalVerifyLimit = otpAbuseService.allowOtpVerification;
    const previousEmails = sentEmails.splice(0);

    process.env.MONGO_URI = "mongodb://127.0.0.1:27017/mustmake-security-test";
    process.env.JWT_SECRET = "otp-controller-test-jwt-secret";
    process.env.OTP_SECRET = "otp-controller-test-otp-secret";
    mongoose.connection.readyState = 1;
    otpAbuseService.allowOtpSend = async () => true;
    otpAbuseService.allowOtpVerification = async () => true;
    for (const [name, methods] of Object.entries(overrides)) {
        Object.assign(models[name], methods);
    }

    t.after(() => {
        for (const { model, methods } of originals) Object.assign(model, methods);
        mongoose.connection.readyState = originalReadyState;
        if (originalMongoUri === undefined) delete process.env.MONGO_URI;
        else process.env.MONGO_URI = originalMongoUri;
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
        if (originalOtpSecret === undefined) delete process.env.OTP_SECRET;
        else process.env.OTP_SECRET = originalOtpSecret;
        otpAbuseService.allowOtpSend = originalSendLimit;
        otpAbuseService.allowOtpVerification = originalVerifyLimit;
        sentEmails.splice(0, sentEmails.length, ...previousEmails);
    });
}

test("signup OTP requests notify users when the email is already registered", async t => {
    const issuedRecords = [];
    installControllerStubs(t, {
        OTP: {
            init: async () => OTP,
            findOne: async () => null,
            deleteMany: async () => ({ deletedCount: 0 }),
            create: async record => {
                const created = { _id: `otp-${issuedRecords.length}`, ...record };
                issuedRecords.push(created);
                return created;
            },
            deleteOne: async () => ({ deletedCount: 1 })
        },
        OTPGuard: {
            init: async () => OTPGuard,
            findOne: async () => null,
            findOneAndUpdate: async () => ({})
        },
        User: {
            findOne: async query => {
                if (query.email === "registered@example.test") {
                    return { _id: "registered-user" };
                }
                if (query.username === "taken_name") {
                    return { _id: "username-owner" };
                }
                return null;
            }
        }
    });

    const newAddress = responseStub();
    await authController.sendOtp({
        body: {
            email: "new@example.test",
            purpose: "signup",
            username: "new_person",
            password: "a-secure-test-password"
        },
        ip: "203.0.113.10"
    }, newAddress);

    const registeredAddress = responseStub();
    await authController.sendOtp({
        body: {
            email: "registered@example.test",
            purpose: "signup",
            username: "registered_person",
            password: "a-secure-test-password"
        },
        ip: "203.0.113.10"
    }, registeredAddress);

    const takenUsername = responseStub();
    await authController.sendOtp({
        body: {
            email: "another@example.test",
            purpose: "signup",
            username: "taken_name",
            password: "a-secure-test-password"
        },
        ip: "203.0.113.10"
    }, takenUsername);

    assert.equal(newAddress.statusCode, 202);
    assert.equal(registeredAddress.statusCode, 409);
    assert.match(registeredAddress.body.message, /already exists.*log in/i);
    assert.equal(takenUsername.statusCode, 409);
    assert.match(takenUsername.body.message, /username is already taken/i);
    assert.equal(typeof newAddress.body.challengeToken, "string");
    assert.equal(registeredAddress.body.challengeToken, undefined);
    assert.equal(takenUsername.body.challengeToken, undefined);
    assert.equal(issuedRecords.length, 1);
    assert.equal(sentEmails.length, 1);
    assert.equal(issuedRecords[0].challengeHash, authService.hashOTP(newAddress.body.challengeToken));
});

test("signup details cannot be replaced while an issued OTP is in its resend cooldown", async t => {
    const now = new Date();
    const signupDraft = {
        username: "original_user",
        passwordHash: "existing-bcrypt-hash"
    };
    let saved = false;
    let sendLimitChecks = 0;
    installControllerStubs(t, {
        OTP: {
            init: async () => OTP,
            findOne: async () => ({
                expiresAt: new Date(now.getTime() + 60_000),
                createdAt: now,
                signupData: signupDraft,
                async save() {
                    saved = true;
                }
            })
        },
        OTPGuard: {
            init: async () => OTPGuard,
            findOne: async () => ({ lastSentAt: now, failedAttempts: 0 })
        }
    });
    otpAbuseService.allowOtpSend = async () => {
        sendLimitChecks += 1;
        return true;
    };

    const response = responseStub();
    await authController.sendOtp({
        body: {
            email: "victim@example.test",
            purpose: "signup",
            username: "attacker_user",
            password: "attacker-controlled-password"
        },
        ip: "203.0.113.11"
    }, response);

    assert.equal(response.statusCode, 202);
    assert.equal(saved, false);
    assert.equal(sendLimitChecks, 0);
    assert.deepEqual(signupDraft, {
        username: "original_user",
        passwordHash: "existing-bcrypt-hash"
    });
});

test("concurrent OTP send requests cannot both claim the email resend slot", async t => {
    let claimed = false;
    let created = 0;
    installControllerStubs(t, {
        OTP: {
            init: async () => OTP,
            findOne: async () => null,
            deleteMany: async () => ({ deletedCount: 0 }),
            create: async record => {
                created += 1;
                return { _id: "otp-race", ...record };
            },
            deleteOne: async () => ({ deletedCount: 1 })
        },
        OTPGuard: {
            init: async () => OTPGuard,
            findOne: async () => null,
            findOneAndUpdate: async () => {
                if (claimed) {
                    const error = new Error("duplicate claim");
                    error.code = 11000;
                    throw error;
                }
                claimed = true;
                return {};
            }
        },
        User: {
            findOne: async query => query.email ? null : null
        }
    });

    const makeRequest = () => {
        const response = responseStub();
        return authController.sendOtp({
            body: {
                email: "racing@example.test",
                purpose: "signup",
                username: "racing_user",
                password: "secure-racing-password"
            },
            ip: "203.0.113.14"
        }, response).then(() => response);
    };

    const responses = await Promise.all([makeRequest(), makeRequest()]);
    assert.deepEqual(responses.map(response => response.statusCode).sort(), [202, 429]);
    assert.equal(created, 1);
    assert.equal(sentEmails.length, 1);
});

test("email delivery failures fail closed without logging address or OTP", async t => {
    let deleted = 0;
    let cooldownReleased;
    installControllerStubs(t, {
        OTP: {
            init: async () => OTP,
            findOne: async () => null,
            deleteMany: async () => ({ deletedCount: 0 }),
            create: async record => ({ _id: "otp-mail-failure", ...record }),
            deleteOne: async () => {
                deleted += 1;
                return { deletedCount: 1 };
            }
        },
        OTPGuard: {
            init: async () => OTPGuard,
            findOne: async () => null,
            findOneAndUpdate: async () => ({}),
            updateOne: async (...args) => {
                cooldownReleased = args;
                return { modifiedCount: 1 };
            }
        },
        User: {
            findOne: async () => null
        }
    });
    emailFailure = true;
    t.after(() => {
        emailFailure = false;
    });
    const originalLog = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);
    t.after(() => {
        console.error = originalLog;
    });

    const response = responseStub();
    await authController.sendOtp({
        body: {
            email: "private@example.test",
            purpose: "signup",
            username: "private_user",
            password: "private-password"
        },
        ip: "203.0.113.15"
    }, response);

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
        message: "Could not process the code request."
    });
    assert.equal(deleted, 1);
    assert.deepEqual(cooldownReleased?.[0], {
        email: "private@example.test",
        purpose: "signup",
        lastSentAt: cooldownReleased?.[0].lastSentAt
    });
    assert.ok(cooldownReleased?.[0].lastSentAt instanceof Date);
    assert.deepEqual(cooldownReleased?.[1], { $unset: { lastSentAt: 1 } });
    assert.equal(JSON.stringify(logged).includes("private@example.test"), false);
    assert.equal(JSON.stringify(logged).includes(sentEmails[0].otp), false);
});

test("OTP verification is single-use even when two valid requests race", async t => {
    const token = "test-challenge-token";
    const code = "123456";
    const user = {
        _id: "0123456789abcdef01234567",
        name: "Test User",
        username: "test_user",
        email: "person@example.test",
        profilePicture: null,
        age: null
    };
    let otpRecord;
    let consumed = false;
    installControllerStubs(t, {
        OTP: {
            init: async () => OTP,
            findOne: async () => otpRecord,
            findOneAndDelete: async () => {
                if (consumed) return null;
                consumed = true;
                return otpRecord;
            }
        },
        OTPGuard: {
            init: async () => OTPGuard,
            findOne: async () => null,
            updateOne: async () => ({ modifiedCount: 1 })
        },
        User: {
            findOne: () => ({ select: async () => user })
        }
    });
    otpRecord = {
        _id: "otp-single-use",
        email: user.email,
        purpose: "login",
        otpHash: authService.hashOTP(code),
        challengeHash: authService.hashOTP(token),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0
    };

    const requests = Array.from({ length: 2 }, async () => {
        const response = responseStub();
        await authController.verifyOtp({
            body: {
                email: user.email,
                otp: code,
                challengeToken: token,
                purpose: "login"
            },
            ip: "203.0.113.12"
        }, response);
        return response;
    });
    const responses = await Promise.all(requests);

    assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 401]);
});

test("signup OTP verification defers account creation until profile completion", async t => {
    const token = "signup-challenge-token";
    const code = "123456";
    const signupRecord = {
        _id: "otp-pending-signup",
        email: "new@example.test",
        purpose: "signup",
        signupData: {
            username: "new_user",
            passwordHash: "bcrypt-hash"
        },
        otpHash: "",
        challengeHash: "",
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0
    };
    let pendingSignupUpdate;
    let createdUser = false;
    installControllerStubs(t, {
        OTP: {
            init: async () => OTP,
            findOne: async () => signupRecord,
            findOneAndDelete: async () => signupRecord
        },
        OTPGuard: {
            init: async () => OTPGuard,
            findOne: async () => null,
            updateOne: async () => ({ modifiedCount: 1 })
        },
        PendingSignup: {
            init: async () => PendingSignup,
            findOneAndUpdate: async (...args) => {
                pendingSignupUpdate = args;
                return {};
            }
        },
        User: {
            findOne: async () => null,
            create: async () => {
                createdUser = true;
                throw new Error("User must not be created during OTP verification.");
            }
        }
    });
    signupRecord.otpHash = authService.hashOTP(code);
    signupRecord.challengeHash = authService.hashOTP(token);

    const response = responseStub();
    await authController.verifyOtp({
        body: {
            email: signupRecord.email,
            otp: code,
            challengeToken: token,
            purpose: "signup"
        },
        ip: "203.0.113.16"
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.pendingSignup, true);
    assert.equal(createdUser, false);
    assert.equal(response.cookies[0][0], "mustmake_pending_signup");
    assert.notEqual(response.cookies[0][0], "mustmake_session");
    assert.equal(pendingSignupUpdate[0].email, signupRecord.email);
    assert.equal(pendingSignupUpdate[1].$set.username, "new_user");
    assert.equal(pendingSignupUpdate[1].$set.passwordHash, "bcrypt-hash");
});

test("signup OTP verification cannot create a pending signup for an existing account", async t => {
    const token = "existing-account-challenge";
    const code = "123456";
    const signupRecord = {
        _id: "otp-existing-account",
        email: "existing@example.test",
        purpose: "signup",
        signupData: { username: "existing_user", passwordHash: "bcrypt-hash" },
        otpHash: "",
        challengeHash: "",
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0
    };
    let otpDeleted = false;
    let pendingSignupCreated = false;
    installControllerStubs(t, {
        OTP: {
            init: async () => OTP,
            findOne: async () => signupRecord,
            deleteOne: async () => {
                otpDeleted = true;
                return { deletedCount: 1 };
            }
        },
        OTPGuard: {
            init: async () => OTPGuard,
            findOne: async () => null
        },
        PendingSignup: {
            init: async () => PendingSignup,
            findOneAndUpdate: async () => {
                pendingSignupCreated = true;
            }
        },
        User: { findOne: async () => ({ _id: "existing-user" }) }
    });
    signupRecord.otpHash = authService.hashOTP(code);
    signupRecord.challengeHash = authService.hashOTP(token);

    const response = responseStub();
    await authController.verifyOtp({
        body: {
            email: signupRecord.email,
            otp: code,
            challengeToken: token,
            purpose: "signup"
        },
        ip: "203.0.113.17"
    }, response);

    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /already exists/i);
    assert.equal(otpDeleted, true);
    assert.equal(pendingSignupCreated, false);
});

test("first-details Continue creates the account only after required consent", async t => {
    const pendingSignup = {
        _id: "pending-signup",
        email: "new@example.test",
        username: "new_user",
        passwordHash: "bcrypt-hash"
    };
    const originalSave = User.prototype.save;
    let savedUser = null;
    installControllerStubs(t, {
        PendingSignup: {
            findOne: async () => pendingSignup,
            deleteOne: async () => ({ deletedCount: 1 })
        },
        User: { findOne: async () => null }
    });
    User.prototype.save = async function () {
        savedUser = this;
        return this;
    };
    t.after(() => {
        User.prototype.save = originalSave;
    });

    const response = responseStub();
    await profileController.completeSignup({
        body: {
            name: "New Person",
            legalConsent: true
        },
        headers: {
            cookie: "mustmake_pending_signup=verified-token"
        }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(savedUser.name, "New Person");
    assert.equal(savedUser.email, pendingSignup.email);
    assert.equal(savedUser.legalConsentAt instanceof Date, true);
    assert.equal(response.cookies[0][0], "mustmake_session");
});

test("first-details Continue rejects an email that already has an account", async t => {
    const pendingSignup = {
        _id: "pending-existing-signup",
        email: "existing@example.test",
        username: "existing_user",
        passwordHash: "bcrypt-hash"
    };
    const originalSave = User.prototype.save;
    let savedUser = false;
    let pendingDeleted = false;
    installControllerStubs(t, {
        PendingSignup: {
            findOne: async () => pendingSignup,
            deleteOne: async () => {
                pendingDeleted = true;
                return { deletedCount: 1 };
            }
        },
        User: { findOne: async () => ({ _id: "existing-user" }) }
    });
    User.prototype.save = async function () {
        savedUser = true;
        return this;
    };
    t.after(() => {
        User.prototype.save = originalSave;
    });

    const response = responseStub();
    await profileController.completeSignup({
        body: {
            name: "Existing Person",
            legalConsent: true
        },
        headers: {
            cookie: "mustmake_pending_signup=verified-token"
        }
    }, response);

    assert.equal(response.statusCode, 409);
    assert.match(response.body.message, /already exists/i);
    assert.equal(savedUser, false);
    assert.equal(pendingDeleted, true);
});

test("OTP expires and the fifth wrong code locks and consumes the challenge", async t => {
    const code = "123456";
    const token = "bound-challenge";
    let otpRecord;
    const guard = { failedAttempts: 0, attemptWindowStartedAt: null };
    let deleted = false;
    installControllerStubs(t, {
        OTP: {
            init: async () => OTP,
            findOne: async () => deleted ? null : otpRecord,
            findOneAndUpdate: async () => {
                if (otpRecord.attempts >= 5) return null;
                otpRecord.attempts += 1;
                return { ...otpRecord };
            },
            deleteOne: async () => ({ deletedCount: 1 }),
            deleteMany: async () => {
                deleted = true;
                return { deletedCount: 1 };
            }
        },
        OTPGuard: {
            init: async () => OTPGuard,
            findOne: async () => guard.failedAttempts
                ? guard
                : null,
            findOneAndUpdate: async (query, update, options) => {
                if (query.attemptWindowStartedAt?.$gt) {
                    if (!guard.attemptWindowStartedAt) return null;
                    guard.failedAttempts += 1;
                } else if (options?.upsert) {
                    guard.failedAttempts = 1;
                    guard.attemptWindowStartedAt = update.$set.attemptWindowStartedAt;
                } else {
                    return null;
                }
                return { ...guard };
            }
        }
    });
    otpRecord = {
        _id: "otp-attempts",
        email: "person@example.test",
        purpose: "login",
        otpHash: authService.hashOTP(code),
        challengeHash: authService.hashOTP(token),
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0
    };

    otpRecord.expiresAt = new Date(Date.now() - 1000);
    const expired = responseStub();
    await authController.verifyOtp({
        body: {
            email: "person@example.test",
            otp: code,
            challengeToken: token,
            purpose: "login"
        },
        ip: "203.0.113.13"
    }, expired);
    assert.equal(expired.statusCode, 401);
    otpRecord.expiresAt = new Date(Date.now() + 60_000);

    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = responseStub();
        await authController.verifyOtp({
            body: {
                email: "person@example.test",
                otp: "000000",
                challengeToken: token,
                purpose: "login"
            },
            ip: "203.0.113.13"
        }, response);
        statuses.push(response.statusCode);
    }

    assert.deepEqual(statuses, [401, 401, 401, 401, 401]);
    assert.equal(deleted, true);
});
