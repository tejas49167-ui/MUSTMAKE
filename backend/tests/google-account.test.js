const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/User");
const {
    getVerifiedEmail,
    getAccountForVerifiedGoogleProfile
} = require("../services/google-account.service");

const profile = (overrides = {}) => ({
    id: "google-account-1",
    displayName: "Example User",
    _json: {
        email: "person@example.test",
        email_verified: true
    },
    photos: [],
    ...overrides
});

function installUserStubs(t, stubs) {
    const originals = Object.fromEntries(
        Object.keys(stubs).map(name => [name, User[name]])
    );
    Object.assign(User, stubs);
    t.after(() => Object.assign(User, originals));
}

function selected(value) {
    return { select: async () => value };
}

test("Google linking requires Google's verified-email claim", async () => {
    assert.equal(getVerifiedEmail(profile({
        _json: { email: "person@example.test", email_verified: false }
    })), null);
    await assert.rejects(
        getAccountForVerifiedGoogleProfile(profile({
            _json: { email: "person@example.test", email_verified: false }
        })),
        /email is not verified/
    );
});

test("Google sign-in never auto-links an existing password account", async t => {
    const passwordUser = { _id: "password-user", passwordHash: "bcrypt-hash" };
    let updateAttempted = false;
    installUserStubs(t, {
        collection: { indexes: async () => [], dropIndex: async () => {} },
        init: async () => User,
        findOne: query => selected(query.googleId
            ? null
            : passwordUser),
        findOneAndUpdate: () => {
            updateAttempted = true;
            return selected(null);
        }
    });

    await assert.rejects(
        getAccountForVerifiedGoogleProfile(profile()),
        /already registered/
    );
    assert.equal(updateAttempted, false);
});

test("new verified Google signups remain pending until profile completion", async t => {
    let accountCreated = false;
    installUserStubs(t, {
        collection: { indexes: async () => [], dropIndex: async () => {} },
        init: async () => User,
        findOne: query => query.username
            ? Promise.resolve(null)
            : selected(null),
        create: async () => {
            accountCreated = true;
            throw new Error("Google account must not be created before Continue.");
        }
    });

    const pendingSignup = await getAccountForVerifiedGoogleProfile(profile());

    assert.equal(pendingSignup.pendingSignup, true);
    assert.equal(pendingSignup.email, "person@example.test");
    assert.equal(pendingSignup.googleId, "google-account-1");
    assert.equal(accountCreated, false);
});

test("verified Google accounts link atomically and concurrent callbacks resolve to one user", async t => {
    const emailUser = {
        _id: "email-user",
        email: "person@example.test",
        passwordHash: null,
        profilePicture: null
    };
    const usersByGoogleId = new Map();
    const updateQueries = [];

    installUserStubs(t, {
        collection: { indexes: async () => [], dropIndex: async () => {} },
        init: async () => User,
        findOne: query => {
            if (query.googleId) {
                return selected(usersByGoogleId.get(query.googleId) || null);
            }
            return selected(emailUser);
        },
        findOneAndUpdate: (query, update) => {
            updateQueries.push(query);
            if (
                emailUser.googleId ||
                query.passwordHash !== null ||
                !query.$or
            ) {
                return selected(null);
            }

            emailUser.googleId = update.$set.googleId;
            const linked = { ...emailUser };
            usersByGoogleId.set(emailUser.googleId, linked);
            return selected(linked);
        }
    });

    const [first, second] = await Promise.all([
        getAccountForVerifiedGoogleProfile(profile()),
        getAccountForVerifiedGoogleProfile(profile())
    ]);

    assert.equal(first._id, emailUser._id);
    assert.equal(second._id, emailUser._id);
    assert.equal(usersByGoogleId.size, 1);
    assert.equal(updateQueries.length, 2);
    assert.ok(updateQueries.every(query =>
        query.passwordHash === null &&
        query.$or.some(condition => condition.googleId === null)
    ));
});

test("Google sign-in replaces the legacy sparse googleId index", async t => {
    const droppedIndexes = [];
    installUserStubs(t, {
        collection: {
            indexes: async () => [{
                name: "googleId_1",
                key: { googleId: 1 },
                unique: true,
                sparse: true
            }],
            dropIndex: async name => droppedIndexes.push(name)
        },
        init: async () => User,
        findOne: query => query.username
            ? Promise.resolve(null)
            : selected(null)
    });

    await getAccountForVerifiedGoogleProfile(profile());

    assert.deepEqual(droppedIndexes, ["googleId_1"]);
});
