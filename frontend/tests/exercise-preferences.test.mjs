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

globalThis.localStorage = {
    getItem(key) {
        return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
        storage.set(key, String(value));
    }
};
test("Strict AI and Front View preferences persist", () => {
    assert.equal(getStrictAiPreference(), true);
    assert.equal(getFrontViewPreference(), false);

    assert.equal(setStrictAiPreference(false), true);
    assert.equal(setFrontViewPreference(true), true);

    assert.equal(storage.get(getStrictAiPreferenceKey()), "false");
    assert.equal(storage.get(getFrontViewPreferenceKey()), "true");
    assert.equal(getStrictAiPreference(), false);
    assert.equal(getFrontViewPreference(), true);
});
