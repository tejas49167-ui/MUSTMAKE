const test = require("node:test");
const assert = require("node:assert/strict");
const GoogleOAuthState = require("../models/GoogleOAuthState");
const {
    STATE_COOKIE_NAME,
    stateCookieOptions,
    beginGoogleOAuth,
    validateGoogleOAuthState
} = require("../middleware/google-oauth-state");

function responseStub() {
    return {
        statusCode: null,
        body: null,
        cookies: {},
        clearedCookies: [],
        headers: {},
        set(name, value) {
            this.headers[name] = value;
            return this;
        },
        cookie(name, value, options) {
            this.cookies[name] = { value, options };
            return this;
        },
        clearCookie(name, options) {
            this.clearedCookies.push({ name, options });
            return this;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        }
    };
}

function stubStateStore(t) {
    const originalInit = GoogleOAuthState.init;
    const originalCreate = GoogleOAuthState.create;
    const originalFindOneAndDelete = GoogleOAuthState.findOneAndDelete;
    const states = new Map();

    GoogleOAuthState.init = async () => GoogleOAuthState;
    GoogleOAuthState.create = async record => {
        states.set(record.stateHash, record);
        return record;
    };
    GoogleOAuthState.findOneAndDelete = async query => {
        const state = states.get(query.stateHash);
        if (!state || state.expiresAt <= query.expiresAt.$gt) return null;
        states.delete(query.stateHash);
        return state;
    };

    t.after(() => {
        GoogleOAuthState.init = originalInit;
        GoogleOAuthState.create = originalCreate;
        GoogleOAuthState.findOneAndDelete = originalFindOneAndDelete;
    });

    return states;
}

test("Google OAuth state is random, short-lived, HTTP-only and bound to the callback", async t => {
    const previousNodeEnv = process.env.NODE_ENV;
    t.after(() => {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
    });
    process.env.NODE_ENV = "production";
    stubStateStore(t);
    const req = { headers: {} };
    const res = responseStub();
    let nextCalled = false;

    await beginGoogleOAuth(req, res, () => {
        nextCalled = true;
    });

    const issued = res.cookies[STATE_COOKIE_NAME];
    assert.equal(nextCalled, true);
    assert.match(issued.value, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(issued.options, stateCookieOptions());
    assert.equal(issued.options.httpOnly, true);
    assert.equal(issued.options.secure, true);
    assert.equal(issued.options.sameSite, "lax");
    assert.equal(issued.options.path, "/api/auth/google/callback");
    assert.equal(issued.options.maxAge, 5 * 60 * 1000);
    assert.equal(req.googleOAuthState, issued.value);

});

test("Google OAuth callback rejects mismatched state and clears the state cookie", async t => {
    stubStateStore(t);
    const res = responseStub();
    let nextCalled = false;

    await validateGoogleOAuthState({
        headers: { cookie: `${STATE_COOKIE_NAME}=a`.repeat(1) },
        query: { state: "b".repeat(43) }
    }, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.clearedCookies[0].name, STATE_COOKIE_NAME);
});

test("Google OAuth state is consumed once and replay is rejected", async t => {
    stubStateStore(t);
    const startResponse = responseStub();
    const startRequest = { headers: {} };
    await beginGoogleOAuth(startRequest, startResponse, () => {});

    const state = startResponse.cookies[STATE_COOKIE_NAME].value;
    const callbackRequest = {
        headers: { cookie: `${STATE_COOKIE_NAME}=${state}` },
        query: { state }
    };
    const firstResponse = responseStub();
    let firstNextCalled = false;
    await validateGoogleOAuthState(callbackRequest, firstResponse, () => {
        firstNextCalled = true;
    });

    const replayResponse = responseStub();
    let replayNextCalled = false;
    await validateGoogleOAuthState(callbackRequest, replayResponse, () => {
        replayNextCalled = true;
    });

    assert.equal(firstNextCalled, true);
    assert.equal(replayNextCalled, false);
    assert.equal(replayResponse.statusCode, 400);
});
