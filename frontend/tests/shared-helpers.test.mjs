import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const presentationSource = await readFile(
    new URL("../js/shared/workout-presentation.js", import.meta.url),
    "utf8"
);
const timeZoneConfigSource = await readFile(
    new URL("../js/shared/timezone-config.js", import.meta.url),
    "utf8"
);
const catalogSource = await readFile(
    new URL("../js/shared/exercise-catalog.js", import.meta.url),
    "utf8"
);

test("workout presentation helpers share safe formatting and the app timezone", () => {
    const window = {};
    vm.runInNewContext(timeZoneConfigSource, { window });
    vm.runInNewContext(presentationSource, { window, Intl, Date });
    const { presentation } = window.MUSTMAKE;

    assert.equal(presentation.escapeHTML("<workout>"), "&lt;workout&gt;");
    assert.equal(
        presentation.formatWorkoutDetails({
            reps: 10,
            sets: 2,
            weight: 5
        }),
        "5 kg each hand · 10 reps × 2 sets = 20 reps"
    );
    assert.equal(
        presentation.formatWorkoutDetails({
            amount: 3.5,
            unit: "km",
            duration: 90
        }),
        "3.5 km · 1 min 30 sec"
    );
    assert.equal(
        presentation.formatDate("2026-11-04", {
            day: "numeric",
            month: "short",
            year: "numeric"
        }),
        "4 Nov 2026"
    );
});

test("exercise catalog fetch is shared and the response is cached", async () => {
    const stored = new Map();
    const calls = [];
    const catalog = [{ slug: "squats" }];
    const window = { backend_url: "" };
    const context = {
        window,
        sessionStorage: {
            getItem: key => stored.get(key) || null,
            setItem: (key, value) => stored.set(key, value)
        },
        fetch: async (...args) => {
            calls.push(args);
            await new Promise(resolve => setTimeout(resolve, 0));
            return {
                ok: true,
                status: 200,
                json: async () => catalog
            };
        },
        console
    };
    vm.runInNewContext(catalogSource, context);

    const [first, second] = await Promise.all([
        window.MUSTMAKE.loadExerciseCatalog(),
        window.MUSTMAKE.loadExerciseCatalog()
    ]);

    assert.equal(first[0].slug, catalog[0].slug);
    assert.equal(second[0].slug, catalog[0].slug);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "/api/exercises?v=4");
    const cached = await window.MUSTMAKE.loadExerciseCatalog();
    assert.equal(cached[0].slug, catalog[0].slug);
    assert.equal(calls.length, 1);
});
