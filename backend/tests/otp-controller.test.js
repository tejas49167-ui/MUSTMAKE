const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../models/User");
const OTP = require("../models/OTP");
const OTPGuard = require("../models/OTPGuard");
const OTPThrottle = require("../models/OTPThrottle");
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
        OTPThrottle
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

test("signup OTP requests do not enumerate registered emails", async t => {
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

    assert.equal(newAddress.statusCode, 202);
    assert.equal(registeredAddress.statusCode, 202);
    assert.deepEqual(Object.keys(newAddress.body).sort(), Object.keys(registeredAddress.body).sort());
    assert.equal(newAddress.body.message, registeredAddress.body.message);
    assert.equal(typeof newAddress.body.challengeToken, "string");
    assert.equal(typeof registeredAddress.body.challengeToken, "string");
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
            findOneAndUpdate: async () => ({})
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
