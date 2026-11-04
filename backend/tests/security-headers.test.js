const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

test("production responses include secure headers and protected routes reject anonymous access", async t => {
    const frontendDeployment = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, "../../frontend/vercel.json"),
        "utf8"
    ));
    const staticHeaders = frontendDeployment.headers[0].headers;
    const staticCsp = staticHeaders.find(header =>
        header.key === "Content-Security-Policy"
    ).value;
    assert.match(staticCsp, /frame-ancestors 'none'/);
    assert.match(staticCsp, /https:\/\/cdn\.jsdelivr\.net/);
    assert.match(staticCsp, /https:\/\/fonts\.googleapis\.com/);
    assert.match(staticCsp, /https:\/\/storage\.googleapis\.com/);
    assert.match(staticCsp, /script-src-attr 'none'/);
    const publicHtmlSource = fs.readFileSync(
        path.resolve(__dirname, "../../frontend/index.html"),
        "utf8"
    );
    const jsonLdScript = publicHtmlSource.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/
    );
    assert.ok(jsonLdScript);
    const jsonLdHash = crypto.createHash("sha256")
        .update(jsonLdScript[1])
        .digest("base64");
    assert.ok(staticCsp.includes(`'sha256-${jsonLdHash}'`));

    const previousNodeEnv = process.env.NODE_ENV;
    const previousTrustProxy = process.env.TRUST_PROXY;
    process.env.NODE_ENV = "production";
    process.env.TRUST_PROXY = "false";

    const appPath = require.resolve("../app");
    delete require.cache[appPath];
    const app = require("../app");
    const server = app.listen(0);

    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        delete require.cache[appPath];
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY;
        else process.env.TRUST_PROXY = previousTrustProxy;
    });

    await new Promise(resolve => server.once("listening", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/`);
    const csp = response.headers.get("content-security-policy");
    assert.equal(response.status, 200);
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /https:\/\/cdn\.jsdelivr\.net/);
    assert.match(csp, /https:\/\/fonts\.googleapis\.com/);
    assert.match(csp, /https:\/\/storage\.googleapis\.com/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.ok(csp.includes(`'sha256-${jsonLdHash}'`));
    assert.equal(response.headers.get("strict-transport-security"), "max-age=15552000");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(
        response.headers.get("permissions-policy"),
        "camera=(self), microphone=(), geolocation=()"
    );
    assert.ok(response.headers.get("referrer-policy"));
    assert.equal(app.get("trust proxy"), false);

    const landingPage = await fetch(`${baseUrl}/pages/index.html`);
    const landingHtml = await landingPage.text();
    assert.equal(landingPage.status, 200);
    assert.match(landingHtml, /\/js\/core\/require-auth\.js/);
    assert.doesNotMatch(landingHtml, /<script>\s*try\s*\{/);
    const publicPage = await fetch(`${baseUrl}/index.html`);
    const publicHtml = await publicPage.text();
    assert.equal(publicPage.status, 200);
    assert.match(publicHtml, /\/js\/core\/redirect-authenticated\.js/);
    assert.match(csp, /sha256-0kYa\/blvQdHg5cNcqjMOcf17NueaqYD2GZ3E6BpsMU8=/);

    const protectedRequests = [
        { method: "GET", path: "/api/profile" },
        { method: "GET", path: "/api/workouts/today" },
        { method: "GET", path: "/api/competition" },
        { method: "GET", path: "/api/auth/me" },
        { method: "GET", path: "/api/users/0123456789abcdef01234567" },
        { method: "POST", path: "/api/workouts", body: { exercise: "Squats" } },
        { method: "POST", path: "/api/competition/add", body: { competitorId: "0123456789abcdef01234567" } },
        { method: "PUT", path: "/api/profile", body: { name: "Attacker" } },
        { method: "DELETE", path: "/api/workouts/0123456789abcdef01234567" },
        { method: "DELETE", path: "/api/competition/0123456789abcdef01234567" },
        { method: "DELETE", path: "/api/account" }
    ];
    for (const request of protectedRequests) {
        const headers = { Origin: "https://mustmake.site" };
        if (request.body) headers["Content-Type"] = "application/json";
        const anonymous = await fetch(`${baseUrl}${request.path}`, {
            method: request.method,
            headers,
            ...(request.body ? { body: JSON.stringify(request.body) } : {})
        });
        assert.equal(
            anonymous.status,
            401,
            `${request.method} ${request.path} must require authentication`
        );
    }

    const forbiddenOrigin = await fetch(`${baseUrl}/api/workouts`, {
        method: "POST",
        headers: {
            Origin: "https://attacker.example",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ exercise: "Squats", reps: 10, sets: 2 })
    });
    assert.equal(forbiddenOrigin.status, 403);

    const anonymousDelete = await fetch(`${baseUrl}/api/account`, {
        method: "DELETE",
        headers: { Origin: "https://mustmake.site" }
    });
    assert.equal(anonymousDelete.status, 401);
});
