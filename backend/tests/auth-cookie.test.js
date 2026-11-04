const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
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
        headers: {},
        set(name, value) {
            this.headers[name] = value;
            return this;
        },
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

function stubUserLookup(t, resultOrError) {
    const originalReadyState = mongoose.connection.readyState;
    const originalMongoUri = process.env.MONGO_URI;
    const originalConnect = mongoose.connect;
    const originalExists = User.exists;

    process.env.MONGO_URI = "mongodb://127.0.0.1:27017/mustmake-test";
    mongoose.connection.readyState = 1;
    mongoose.connect = async () => mongoose;
    User.exists = async () => {
        if (resultOrError instanceof Error) throw resultOrError;
        return resultOrError;
    };

    t.after(() => {
        mongoose.connection.readyState = originalReadyState;
        mongoose.connect = originalConnect;
        User.exists = originalExists;
        if (originalMongoUri === undefined) delete process.env.MONGO_URI;
        else process.env.MONGO_URI = originalMongoUri;
    });
}

test("session cookie supports cross-site production API calls securely", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
        assert.deepEqual(getSessionCookieOptions(), {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
    } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
    }
});

test("authentication accepts the HttpOnly session cookie, not bearer tokens", async t => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-only-cookie-auth-secret";
    const userId = new mongoose.Types.ObjectId().toString();
    stubUserLookup(t, { _id: userId });

    try {
        const token = jwt.sign({ userId }, process.env.JWT_SECRET);
        const req = {
            headers: {
                cookie: `other=value; ${SESSION_COOKIE_NAME}=${token}`
            }
        };
        const res = responseStub();
        let nextCalled = false;

        await auth(req, res, () => {
            nextCalled = true;
        });

        assert.equal(nextCalled, true);
        assert.equal(req.userId, userId);

        const bearerRes = responseStub();
        await auth(
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

test("authentication rejects deleted-user sessions and clears their cookie", async t => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-only-cookie-auth-secret";
    stubUserLookup(t, null);

    try {
        const token = jwt.sign(
            { userId: new mongoose.Types.ObjectId().toString() },
            process.env.JWT_SECRET
        );
        const res = responseStub();
        let nextCalled = false;

        await auth(
            { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
            res,
            () => {
                nextCalled = true;
            }
        );

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.clearedCookie, true);
    } finally {
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
});

test("authentication forwards database failures instead of expiring valid sessions", async t => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-only-cookie-auth-secret";
    const databaseError = new Error("database unavailable");
    stubUserLookup(t, databaseError);

    try {
        const token = jwt.sign(
            { userId: new mongoose.Types.ObjectId().toString() },
            process.env.JWT_SECRET
        );
        const res = responseStub();
        let forwardedError;

        await auth(
            { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
            res,
            error => {
                forwardedError = error;
            }
        );

        assert.equal(forwardedError, databaseError);
        assert.equal(res.clearedCookie, false);
    } finally {
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
});

test("authentication clears expired session cookies", async () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-only-cookie-auth-secret";

    try {
        const token = jwt.sign(
            { userId: new mongoose.Types.ObjectId().toString() },
            process.env.JWT_SECRET,
            { expiresIn: -1 }
        );
        const res = responseStub();
        let nextCalled = false;

        await auth(
            { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
            res,
            () => {
                nextCalled = true;
            }
        );

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.clearedCookie, true);
    } finally {
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
});

test("authentication rejects invalid signatures and non-HS256 algorithms", async () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-only-cookie-auth-secret";

    try {
        const invalidSignature = jwt.sign(
            { userId: new mongoose.Types.ObjectId().toString() },
            "different-test-secret"
        );
        const unsupportedAlgorithm = jwt.sign(
            { userId: new mongoose.Types.ObjectId().toString() },
            process.env.JWT_SECRET,
            { algorithm: "HS384" }
        );

        for (const token of [invalidSignature, unsupportedAlgorithm]) {
            const res = responseStub();
            let nextCalled = false;
            await auth(
                { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
                res,
                () => {
                    nextCalled = true;
                }
            );
            assert.equal(nextCalled, false);
            assert.equal(res.statusCode, 401);
            assert.equal(res.clearedCookie, true);
        }
    } finally {
        if (previousSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = previousSecret;
    }
});

test("authentication rejects validly signed tokens without an object user ID", async () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "test-only-cookie-auth-secret";

    try {
        const token = jwt.sign("invalid-user-payload", process.env.JWT_SECRET);
        const res = responseStub();
        let nextCalled = false;

        await auth(
            { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } },
            res,
            () => {
                nextCalled = true;
            }
        );

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.clearedCookie, true);
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

test("unsafe requests reject a missing origin", () => {
    const res = responseStub();
    let nextCalled = false;

    csrfOrigin({
        method: "DELETE",
        get: () => null
    }, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
});

test("unsafe requests accept the bare production frontend origin", () => {
    let nextCalled = false;

    csrfOrigin({
        method: "POST",
        get: header => header === "Origin" ? "https://mustmake.site" : null
    }, responseStub(), () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
});

test("unsafe requests accept the www frontend alias", () => {
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
