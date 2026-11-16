import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const authMechanicsSource = await readFile(
    new URL("../js/shared/auth-mechanics.js", import.meta.url),
    "utf8"
);

test("auth links intercept only unmodified primary clicks", () => {
    const window = {};
    runInNewContext(authMechanicsSource, { window });

    const isUnmodifiedPrimaryClick = window.authMechanics.isUnmodifiedPrimaryClick;
    assert.equal(isUnmodifiedPrimaryClick({ button: 0 }), true);
    for (const event of [
        { button: 1 },
        { button: 0, ctrlKey: true },
        { button: 0, metaKey: true },
        { button: 0, shiftKey: true },
        { button: 0, altKey: true }
    ]) {
        assert.equal(isUnmodifiedPrimaryClick(event), false);
    }
});
