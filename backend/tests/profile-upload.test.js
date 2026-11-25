require("dotenv").config();

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const cloudinary = require("../config/cloudinary");
const profileController = require("../controllers/profile.controller");
const User = require("../models/User");

// Set readyState so connectDB() passes in unit tests
mongoose.connection.readyState = 1;
if (!process.env.MONGO_URI) {
    process.env.MONGO_URI = "mongodb://127.0.0.1:27017/test-profile-upload";
}

function responseStub() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

test("upload-signature endpoint returns signed Cloudinary upload payload", async () => {
    const res = responseStub();
    await profileController.getUploadSignature({ userId: "user-1" }, res);

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.signature, "signature should be present");
    assert.ok(res.body.timestamp, "timestamp should be present");
    assert.equal(res.body.apiKey, cloudinary.config().api_key);
    assert.equal(res.body.cloudName, cloudinary.config().cloud_name);
    assert.equal(res.body.folder, "just-do-it/profile-pictures");
    assert.equal(res.body.public_id, "user_user-1");
    assert.equal(res.body.overwrite, true);

    // Verify signature validity
    const expectedSignature = cloudinary.utils.api_sign_request(
        {
            folder: res.body.folder,
            overwrite: true,
            public_id: "user_user-1",
            timestamp: res.body.timestamp
        },
        cloudinary.config().api_secret
    );
    assert.equal(res.body.signature, expectedSignature);
});

test("upload-signature endpoint rejects unauthenticated requests", async () => {
    const res = responseStub();
    await profileController.getUploadSignature({}, res);

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, "Authentication required.");
});

test("profile update rejects base64 photo payloads with 400", async t => {
    const user = {
        _id: "user-1",
        name: "Athlete",
        email: "athlete@example.test",
        profilePicture: null,
        async save() {}
    };

    const originalFindById = User.findById;
    User.findById = () => ({
        select: async () => user
    });
    t.after(() => {
        User.findById = originalFindById;
    });

    const res = responseStub();
    await profileController.updateProfile({
        userId: "user-1",
        body: {
            profilePicture: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        }
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "Invalid profile photo.");
    assert.equal(user.profilePicture, null);
});

test("profile update rejects non-Cloudinary photo URLs with 400", async t => {
    const user = {
        _id: "user-1",
        name: "Athlete",
        email: "athlete@example.test",
        profilePicture: null,
        async save() {}
    };

    const originalFindById = User.findById;
    User.findById = () => ({
        select: async () => user
    });
    t.after(() => {
        User.findById = originalFindById;
    });

    const res = responseStub();
    await profileController.updateProfile({
        userId: "user-1",
        body: {
            profilePicture: "https://evil.com/malicious-avatar.png"
        }
    }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "Invalid profile photo.");
    assert.equal(user.profilePicture, null);
});

test("profile update saves valid Cloudinary secure_url directly without server upload", async t => {
    const cloudName = cloudinary.config().cloud_name;
    const validCloudinaryUrl = `https://res.cloudinary.com/${cloudName}/image/upload/v1234567890/just-do-it/profile-pictures/user_photo.jpg`;

    let saved = false;
    const user = {
        _id: "user-1",
        name: "Athlete",
        email: "athlete@example.test",
        profilePicture: null,
        async save() {
            saved = true;
        }
    };

    const originalFindById = User.findById;
    User.findById = () => ({
        select: async () => user
    });
    t.after(() => {
        User.findById = originalFindById;
    });

    const res = responseStub();
    await profileController.updateProfile({
        userId: "user-1",
        body: {
            profilePicture: validCloudinaryUrl
        }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(saved, true);
    assert.equal(user.profilePicture, validCloudinaryUrl);
});

test("profile update allows clearing photo with null", async t => {
    const cloudName = cloudinary.config().cloud_name;
    let saved = false;
    const user = {
        _id: "user-1",
        name: "Athlete",
        email: "athlete@example.test",
        profilePicture: `https://res.cloudinary.com/${cloudName}/image/upload/old.jpg`,
        async save() {
            saved = true;
        }
    };

    const originalFindById = User.findById;
    User.findById = () => ({
        select: async () => user
    });
    t.after(() => {
        User.findById = originalFindById;
    });

    const res = responseStub();
    await profileController.updateProfile({
        userId: "user-1",
        body: {
            profilePicture: null
        }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(saved, true);
    assert.equal(user.profilePicture, null);
});
