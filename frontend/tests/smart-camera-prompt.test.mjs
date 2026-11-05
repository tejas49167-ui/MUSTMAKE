import test from "node:test";
import assert from "node:assert/strict";
import { getSmartCameraPromptState } from "../js/features/exercises/ai-monitor.js";

test("Smart Camera prompt follows initialization and fullscreen lifecycle", () => {
    assert.equal(getSmartCameraPromptState(true, false, "idle"), "preparing");
    assert.equal(getSmartCameraPromptState(true, false, "initializing"), "preparing");
    assert.equal(getSmartCameraPromptState(true, false, "running"), "scroll");
    assert.equal(getSmartCameraPromptState(true, true, "running"), null);
    assert.equal(getSmartCameraPromptState(true, false, "error"), null);
    assert.equal(getSmartCameraPromptState(false, false, "running"), null);
});
