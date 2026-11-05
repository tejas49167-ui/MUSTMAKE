const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const {
    sendOTPEmail,
    sendExerciseReminderEmail,
    getEmailProvider
} = require("../services/email.service");

const EMAIL_ENV_KEYS = [
    "EMAIL_PROVIDER",
    "RESEND_API_KEY",
    "EMAIL_FROM",
    "GMAIL_USER",
    "GMAIL_APP_PASSWORD"
];

function saveEmailEnvironment() {
    return Object.fromEntries(
        EMAIL_ENV_KEYS.map(key => [key, process.env[key]])
    );
}

function restoreEmailEnvironment(original) {
    for (const [key, value] of Object.entries(original)) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
}

function setEmailEnvironment(values) {
    for (const key of EMAIL_ENV_KEYS) delete process.env[key];
    Object.assign(process.env, values);
}

test("Resend is selected by default when configured and sends the OTP", async t => {
    const originalEnvironment = saveEmailEnvironment();
    const originalFetch = global.fetch;
    const originalLog = console.error;
    const requests = [];
    setEmailEnvironment({
        RESEND_API_KEY: "test-resend-key",
        EMAIL_FROM: "MUSTMAKE <otp@example.com>"
    });
    global.fetch = async (...args) => {
        requests.push(args);
        return { ok: true, status: 200 };
    };

    t.after(() => {
        restoreEmailEnvironment(originalEnvironment);
        global.fetch = originalFetch;
        console.error = originalLog;
    });

    assert.equal(getEmailProvider(), "resend");
    await sendOTPEmail("person@example.com", "123456", "signup");

    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], "https://api.resend.com/emails");
    assert.equal(requests[0][1].headers.Authorization, "Bearer test-resend-key");
    const sentMessage = JSON.parse(requests[0][1].body);
    assert.deepEqual(
        { ...sentMessage, html: undefined },
        {
            from: "MUSTMAKE <otp@example.com>",
            to: "person@example.com",
            subject: "Your MUSTMAKE verification code",
            html: undefined
        }
    );
    assert.match(sentMessage.html, /123456/);
});

test("explicit Gmail selection preserves Nodemailer delivery", async t => {
    const originalEnvironment = saveEmailEnvironment();
    const originalCreateTransport = nodemailer.createTransport;
    let sentMessage;
    setEmailEnvironment({
        EMAIL_PROVIDER: "gmail",
        RESEND_API_KEY: "unused-resend-key",
        GMAIL_USER: "sender@example.com",
        GMAIL_APP_PASSWORD: "test-app-password"
    });
    nodemailer.createTransport = options => {
        assert.deepEqual(options, {
            service: "gmail",
            auth: {
                user: "sender@example.com",
                pass: "test-app-password"
            }
        });
        return {
            sendMail: async message => {
                sentMessage = message;
            }
        };
    };

    t.after(() => {
        restoreEmailEnvironment(originalEnvironment);
        nodemailer.createTransport = originalCreateTransport;
    });

    assert.equal(getEmailProvider(), "gmail");
    await sendOTPEmail("person@example.com", "654321", "login");
    assert.equal(sentMessage.from, "sender@example.com");
    assert.equal(sentMessage.to, "person@example.com");
    assert.match(sentMessage.html, /654321/);
});

test("Gmail delivery failures are logged without exposing credentials", async t => {
    const originalEnvironment = saveEmailEnvironment();
    const originalCreateTransport = nodemailer.createTransport;
    const originalLog = console.error;
    const logged = [];
    setEmailEnvironment({
        EMAIL_PROVIDER: "gmail",
        GMAIL_USER: "sender@example.com",
        GMAIL_APP_PASSWORD: "secret-gmail-password"
    });
    nodemailer.createTransport = () => ({
        sendMail: async () => {
            const error = new Error("SMTP authentication failed.");
            error.code = "EAUTH";
            throw error;
        }
    });
    console.error = (...args) => logged.push(args);

    t.after(() => {
        restoreEmailEnvironment(originalEnvironment);
        nodemailer.createTransport = originalCreateTransport;
        console.error = originalLog;
    });

    await assert.rejects(
        sendOTPEmail("person@example.com", "123456", "login"),
        error => {
            assert.equal(error.message, "Gmail email delivery failed.");
            assert.doesNotMatch(error.message, /secret-gmail-password|person@example\.com|123456/);
            return true;
        }
    );
    assert.deepEqual(logged, [
        ["[email] Gmail delivery failed.", { code: "EAUTH", name: "Error" }]
    ]);
});

test("Gmail remains the fallback when Resend is not configured", t => {
    const originalEnvironment = saveEmailEnvironment();
    setEmailEnvironment({ GMAIL_USER: "sender@example.com" });
    t.after(() => restoreEmailEnvironment(originalEnvironment));

    assert.equal(getEmailProvider(), "gmail");
});

test("invalid provider configuration is rejected", t => {
    const originalEnvironment = saveEmailEnvironment();
    setEmailEnvironment({ EMAIL_PROVIDER: "unknown" });
    t.after(() => restoreEmailEnvironment(originalEnvironment));

    assert.throws(() => getEmailProvider(), /EMAIL_PROVIDER must be either resend or gmail/);
});

test("Resend delivery errors do not include credentials or email content", async t => {
    const originalEnvironment = saveEmailEnvironment();
    const originalFetch = global.fetch;
    const originalLog = console.error;
    const logged = [];
    setEmailEnvironment({
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "secret-test-key",
        EMAIL_FROM: "MUSTMAKE <otp@example.com>"
    });
    global.fetch = async () => ({ ok: false, status: 422 });
    console.error = (...args) => logged.push(args);

    t.after(() => {
        restoreEmailEnvironment(originalEnvironment);
        global.fetch = originalFetch;
        console.error = originalLog;
    });

    await assert.rejects(
        sendOTPEmail("person@example.com", "123456", "login"),
        error => {
            assert.equal(error.message, "Resend email delivery failed (HTTP 422).");
            assert.doesNotMatch(error.message, /secret-test-key|person@example\.com|123456/);
            return true;
        }
    );
    assert.deepEqual(logged, [
        ["[email] Resend rejected the email.", { status: 422 }]
    ]);
});

test("exercise reminder uses Resend and returns its message ID", async t => {
    const originalEnvironment = saveEmailEnvironment();
    const originalFetch = global.fetch;
    const requests = [];
    setEmailEnvironment({
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "test-resend-key",
        EMAIL_FROM: "MUSTMAKE <reminders@example.com>"
    });
    global.fetch = async (...args) => {
        requests.push(args);
        return {
            ok: true,
            status: 200,
            json: async () => ({ id: "resend-message-1" })
        };
    };

    t.after(() => {
        restoreEmailEnvironment(originalEnvironment);
        global.fetch = originalFetch;
    });

    const result = await sendExerciseReminderEmail(
        "person@example.com",
        "<Athlete>",
        "2026-03-08",
        "daily-exercise-reminder:user:2026-03-08"
    );

    assert.deepEqual(result, { messageId: "resend-message-1" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], "https://api.resend.com/emails");
    assert.equal(requests[0][1].headers.Authorization, "Bearer test-resend-key");
    assert.equal(
        requests[0][1].headers["Idempotency-Key"],
        "daily-exercise-reminder:user:2026-03-08"
    );
    const message = JSON.parse(requests[0][1].body);
    assert.equal(message.to, "person@example.com");
    assert.equal(message.subject, "A little reminder to move today");
    assert.match(message.html, /&lt;Athlete&gt;/);
    assert.match(message.html, /2026-03-08/);
});
