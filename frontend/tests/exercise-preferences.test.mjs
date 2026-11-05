import test from "node:test";
import assert from "node:assert/strict";
import {
    getFrontViewPreference,
    getFrontViewPreferenceKey,
    getStrictAiPreference,
    getStrictAiPreferenceKey,
    setFrontViewPreference,
    setStrictAiPreference
} from "../js/features/exercises/camera-preference.js";

const storage = new Map();
const events = [];

globalThis.localStorage = {
    getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
        storage.set(key, String(value));
    }
};
globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
    }
};
globalThis.window = {
    dispatchEvent(event) {
        events.push(event);
    }
};

test("Strict AI and Front View preferences persist and emit their preference events", () => {
    assert.equal(getStrictAiPreference(), true);
    assert.equal(getFrontViewPreference(), false);

    assert.equal(setStrictAiPreference(false), true);
    assert.equal(setFrontViewPreference(true), true);

    assert.equal(storage.get(getStrictAiPreferenceKey()), "false");
    assert.equal(storage.get(getFrontViewPreferenceKey()), "true");
    assert.equal(getStrictAiPreference(), false);
    assert.equal(getFrontViewPreference(), true);
    assert.deepEqual(events.map(event => [event.type, event.detail.enabled]), [
        ["mustmake:strict-ai-change", false],
        ["mustmake:front-view-change", true]
    ]);
});
