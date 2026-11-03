const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");
const csrfOrigin = require("../middleware/csrf-origin");
const {
    SESSION_COOKIE_NAME,
    getSessionCookieOptions
} = require("../utils/auth-cookie");

function responseStub() {
    return {
        statusCode: null,
        body: null,
        clearedCookie: false,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        clearCookie() {
            this.clearedCookie = true;
        }
    };
}

test("session cookie is HttpOnly, SameSite=Lax, and Secure in production", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
        assert.deepEqual(getSessionCookieOptions(), {
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
    } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
    }
});

test("authentication accepts the HttpOnly session cookie, not bearer tokens", () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-only-cookie-auth-secret";

    try {
        const token = jwt.sign({ userId: "user-123" }, process.env.JWT_SECRET);
        const req = {
            headers: {
                cookie: `other=value; ${SESSION_COOKIE_NAME}=${token}`
            }
        };
        const res = responseStub();
        let nextCalled = false;

        auth(req, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true);
        assert.equal(req.userId, "user-123");

        const bearerRes = responseStub();
        auth(
            { headers: { authorization: `Bearer ${token}` } },
            bearerRes,
            () => assert.fail("Bearer token must not authenticate")
        );
        assert.equal(bearerRes.statusCode, 401);
    } finally {
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
});

test("unsafe requests require an allowed frontend origin", () => {
    const res = responseStub();
    let nextCalled = false;

    csrfOrigin({
        method: "POST",
        get: header => header === "Origin" ? "https://attacker.example" : null
    }, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
});

test("unsafe requests accept the configured production frontend origin", () => {
    let nextCalled = false;

    csrfOrigin({
        method: "POST",
        get: header => header === "Origin" ? "https://www.mustmake.site" : null
    }, responseStub(), () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
});

test("unsafe requests continue accepting the legacy Vercel frontend origin", () => {
    let nextCalled = false;

    csrfOrigin({
        method: "POST",
        get: header => header === "Origin" ? "https://mustmake.vercel.app" : null
    }, responseStub(), () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
});

test("safe requests do not require a frontend origin", () => {
    let nextCalled = false;

    csrfOrigin({
        method: "GET",
        get: () => null
    }, responseStub(), () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
});
