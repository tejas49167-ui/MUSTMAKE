import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const callbackSource = await readFile(
    new URL("../js/features/auth/google-callback.js", import.meta.url),
    "utf8"
);
const authMechanicsSource = await readFile(
    new URL("../js/shared/auth-mechanics.js", import.meta.url),
    "utf8"
);
const requireAuthSource = await readFile(
    new URL("../js/core/require-auth.js", import.meta.url),
    "utf8"
);
const redirectAuthenticatedSource = await readFile(
    new URL("../js/core/redirect-authenticated.js", import.meta.url),
    "utf8"
);

function makeStorage() {
    const values = new Map();
    return {
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        }
    };
}

function runCallback(fetch) {
    const sessionStorage = makeStorage();
    const redirects = [];
    const savedUsers = [];
    const toastUpdates = [];
    const document = { documentElement: { dataset: {} } };
    const window = {
        backend_url: "",
        location: {
            search: "",
            replace: path => redirects.push(path)
        },
        MUSTMAKE: {},
        fetch,
        showToast: () => ({
            update: (...args) => toastUpdates.push(args)
        }),
        saveAuthenticatedSession: user => savedUsers.push(user)
    };
    const context = vm.createContext({
        window,
        document,
        sessionStorage,
        URLSearchParams,
        console: { warn() {}, error() {} }
    });

    vm.runInContext(callbackSource, context);
    return { window, document, sessionStorage, redirects, savedUsers, toastUpdates };
}

function response(status, payload) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => payload
    };
}

test("Google callback verifies the cookie session before redirecting directly to today", async () => {
    let resolveFetch;
    let request;
    const flow = runCallback((url, options) => {
        request = { url, options };
        return new Promise(resolve => {
            resolveFetch = resolve;
        });
    });

    assert.equal(flow.window.MUSTMAKE.authState, "pending");
    assert.equal(flow.document.documentElement.dataset.authState, "pending");
    assert.equal(flow.sessionStorage.getItem("mustmake_google_auth_pending"), "true");
    assert.deepEqual(flow.redirects, []);
    assert.equal(request.url, "/api/auth/session");
    assert.equal(request.options.credentials, "include");
    assert.equal(request.options.cache, "no-store");

    const user = { _id: "user-123", name: "Google User" };
    resolveFetch(response(200, { user }));
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(flow.savedUsers, [user]);
    assert.deepEqual(flow.redirects, ["/today"]);
    assert.equal(flow.window.MUSTMAKE.authState, "authenticated");
    assert.equal(flow.sessionStorage.getItem("mustmake_google_auth_pending"), null);
});

test("Google callback returns to login only after the backend confirms no session", async () => {
    const flow = runCallback(async () => response(401, {
        message: "Authentication required."
    }));

    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(flow.savedUsers, []);
    assert.deepEqual(flow.redirects, ["/login?googleAuth=failed"]);
    assert.equal(flow.window.MUSTMAKE.authState, "unauthenticated");
    assert.equal(flow.sessionStorage.getItem("mustmake_google_auth_pending"), null);
});

test("Google callback keeps its pending screen after a temporary verification error", async () => {
    const flow = runCallback(async () => response(503, {
        message: "Session service unavailable."
    }));

    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(flow.savedUsers, []);
    assert.deepEqual(flow.redirects, []);
    assert.equal(flow.window.MUSTMAKE.authState, "pending");
    assert.equal(flow.sessionStorage.getItem("mustmake_google_auth_pending"), "true");
    assert.equal(flow.toastUpdates[0][0], "Could not verify Google sign-in. Please try again.");
});

test("Google OAuth starts in the current tab and route guards preserve pending verification", () => {
    const sessionStorage = makeStorage();
    const redirects = [];
    const window = {
        sessionStorage,
        location: { replace: path => redirects.push(path) }
    };
    vm.runInNewContext(authMechanicsSource, { window, console });

    window.authMechanics.navigateToGoogleAuth("https://mustmakebackend.vercel.app/api/auth/google");

    assert.equal(sessionStorage.getItem("mustmake_google_auth_pending"), "true");
    assert.deepEqual(redirects, ["https://mustmakebackend.vercel.app/api/auth/google"]);

    const guardWindow = { location: { replace: path => redirects.push(path) } };
    vm.runInNewContext(requireAuthSource, {
        window: guardWindow,
        localStorage: makeStorage(),
        sessionStorage,
        JSON
    });

    assert.deepEqual(redirects, [
        "https://mustmakebackend.vercel.app/api/auth/google",
        "/google-callback"
    ]);

    const publicGuardWindow = { location: { replace: path => redirects.push(path) } };
    vm.runInNewContext(redirectAuthenticatedSource, {
        window: publicGuardWindow,
        localStorage: makeStorage(),
        sessionStorage,
        JSON
    });

    assert.deepEqual(redirects, [
        "https://mustmakebackend.vercel.app/api/auth/google",
        "/google-callback",
        "/google-callback"
    ]);
});
