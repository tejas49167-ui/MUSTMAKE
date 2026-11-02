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
            hostname: "mustmake.vercel.app",
            href: "https://mustmake.vercel.app/login",
            origin: "https://mustmake.vercel.app"
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

    assert.equal(window.API_URL, "");
    assert.deepEqual(removedKeys, ["token"]);
    assert.equal(calls[0].init.credentials, "include");
    assert.equal(new Headers(calls[0].init.headers).has("Authorization"), false);
    assert.equal(new Headers(calls[0].init.headers).get("Content-Type"), "application/json");

    await window.fetch("/data/exercises.json");
    assert.equal(calls[1].init.credentials, undefined);
});
