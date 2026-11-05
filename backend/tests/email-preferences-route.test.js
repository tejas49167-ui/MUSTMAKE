const test = require("node:test");
const assert = require("node:assert/strict");
const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
const originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
const app = require("../app");
if (originalGoogleClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
else process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
if (originalGoogleClientSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
else process.env.GOOGLE_CLIENT_SECRET = originalGoogleClientSecret;

test("email preference endpoints require the existing authenticated session", async t => {
    const server = app.listen(0);
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
    });
    await new Promise(resolve => server.once("listening", resolve));

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const getResponse = await fetch(`${baseUrl}/api/settings/email-notifications`);
    const updateResponse = await fetch(`${baseUrl}/api/settings/email-notifications`, {
        method: "PUT",
        headers: {
            Origin: "https://mustmake.site",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ enabled: true })
    });

    assert.equal(getResponse.status, 401);
    assert.equal(updateResponse.status, 401);
});

test("the scheduled job endpoint rejects requests without its cron secret", async t => {
    const originalSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";
    const server = app.listen(0);
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        if (originalSecret === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = originalSecret;
    });
    await new Promise(resolve => server.once("listening", resolve));

    const url = `http://127.0.0.1:${server.address().port}/api/cron/exercise-reminders`;
    const missing = await fetch(url);
    const invalid = await fetch(url, {
        headers: { Authorization: "Bearer wrong-secret" }
    });

    assert.equal(missing.status, 401);
    assert.equal(invalid.status, 401);
});
