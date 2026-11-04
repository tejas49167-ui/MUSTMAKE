import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const transportScript = await readFile(
    new URL("../js/core/change_backend_url.js", import.meta.url),
    "utf8"
);

test("API requests use cookies and drop bearer headers without changing static fetches", async () => {
    const calls = [];
    const removedKeys = [];
    const window = {
        location: {
            hostname: "mustmake.site",
            href: "https://mustmake.site/login",
            origin: "https://mustmake.site"
        },
        fetch: async (input, init) => {
            calls.push({ input, init });
            return new Response(null, { status: 204 });
        }
    };

    runInNewContext(transportScript, {
        window,
        localStorage: {
            removeItem: key => removedKeys.push(key)
        },
        URL,
        Request,
        Headers,
        console
    });

    await window.fetch("/api/workouts", {
        method: "POST",
        headers: {
            Authorization: "Bearer legacy-token",
            "Content-Type": "application/json"
        }
    });

    assert.equal(window.backend_url, "");
    assert.equal(window.frontend_url, "https://mustmake.site");
    assert.deepEqual(removedKeys, ["token"]);
    assert.equal(calls[0].init.credentials, "include");
    assert.equal(new Headers(calls[0].init.headers).has("Authorization"), false);
    assert.equal(new Headers(calls[0].init.headers).get("Content-Type"), "application/json");

    await window.fetch("/data/exercises.json");
    assert.equal(calls[1].init.credentials, undefined);
});

test("local frontend uses the local backend URL", () => {
    const window = {
        location: {
            hostname: "localhost",
            href: "http://localhost:5500/login",
            origin: "http://localhost:5500"
        },
        fetch: async () => new Response(null, { status: 204 })
    };

    runInNewContext(transportScript, {
        window,
        localStorage: { removeItem() {} },
        URL,
        Request,
        Headers,
        console
    });

    assert.equal(window.backend_url, "http://localhost:4000");
    assert.equal(window.frontend_url, "http://localhost:5500");
});
