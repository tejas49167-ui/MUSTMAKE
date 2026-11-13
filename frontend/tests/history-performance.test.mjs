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

class FakeElement {
    constructor(tagName = "div") {
        this.tagName = tagName;
        this.children = [];
        this.parentNode = null;
        this.className = "";
        this.dataset = {};
        this.innerHTML = "";
        this.textContent = "";
        this.listeners = new Map();
        this.markupBytesWritten = 0;
        this.replaceChildrenCalls = 0;
        this.querySelectorCalls = 0;
        this.disabled = false;
        this.type = "";
    }

    set innerHTML(value) {
        this._innerHTML = value;
        this.markupBytesWritten += Buffer.byteLength(value);
    }

    get innerHTML() {
        return this._innerHTML || "";
    }

    append(...nodes) {
        nodes.forEach(node => this.appendChild(node));
    }

    appendChild(node) {
        if (node.isFragment) {
            node.children.splice(0).forEach(child => this.appendChild(child));
            return node;
        }
        node.parentNode?.removeChild(node);
        node.parentNode = this;
        this.children.push(node);
        return node;
    }

    removeChild(node) {
        const index = this.children.indexOf(node);
        if (index >= 0) this.children.splice(index, 1);
        node.parentNode = null;
    }

    remove() {
        this.parentNode?.removeChild(this);
    }

    insertAdjacentHTML(_position, html) {
        this._innerHTML = this.innerHTML + html;
        this.markupBytesWritten += Buffer.byteLength(html);
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    querySelector(selector) {
        this.querySelectorCalls += 1;
        const className = selector.slice(1);
        return this.children.find(child =>
            child.className.split(/\s+/).includes(className)
        ) || null;
    }

    querySelectorAll(selector) {
        const className = selector.slice(1);
        const matches = [];
        const visit = element => {
            element.children.forEach(child => {
                if (child.className.split(/\s+/).includes(className)) {
                    matches.push(child);
                }
                visit(child);
            });
        };
        visit(this);
        this.querySelectorAllCalls = (this.querySelectorAllCalls || 0) + 1;
        return matches;
    }

    replaceChildren(...children) {
        this.replaceChildrenCalls += 1;
        this.children.forEach(child => {
            child.parentNode = null;
        });
        this.children = [];
        this._innerHTML = "";
        children.forEach(child => this.appendChild(child));
    }
}

class FakeFragment extends FakeElement {
    constructor() {
        super();
        this.isFragment = true;
    }
}

test("history renders thousands of records incrementally across cursor pages", async () => {
    const source = await readFile(
        new URL("../js/features/workouts/script.js", import.meta.url),
        "utf8"
    );
    const history = new FakeElement("main");
    history.innerHTML = "Discipline always surprises";
    let pageNumber = 0;
    let bootstrapping = true;
    const pageCount = 40;
    const context = vm.createContext({
        URLSearchParams,
        console,
        localStorage: {
            getItem: key => key === "user" ? JSON.stringify({ id: "user-1" }) : null
        },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        document: {
            getElementById: id =>
                !bootstrapping && id === "history" ? history : null,
            createElement: tagName => new FakeElement(tagName),
            createDocumentFragment: () => new FakeFragment()
        },
        window: {
            backend_url: "https://api.example.test",
            showToast: () => null
        },
        fetch: async () => {
            const currentPage = pageNumber++;
            const workouts = Array.from({ length: 25 }, (_, offset) => ({
                date: "2026-11-04",
                exercise: `Workout ${currentPage * 25 + offset}`,
                reps: 10,
                sets: 2
            }));
            return {
                status: 200,
                ok: true,
                json: async () => ({
                    workouts,
                    nextCursor: currentPage < pageCount - 1
                        ? `cursor-${currentPage + 1}`
                        : null
                })
            };
        }
    });

    vm.runInContext(timeZoneConfigSource, context);
    vm.runInContext(presentationSource, context);
    vm.runInContext(source, context);
    bootstrapping = false;
    for (let page = 0; page < pageCount; page += 1) {
        await vm.runInContext(
            `loadHistory(${page === 0 ? "null" : JSON.stringify(`cursor-${page}`)})`,
            context
        );
    }

    const day = history.children.find(child => child.className === "history-day");
    assert.ok(day);
    assert.equal((day.innerHTML.match(/class="history-workout"/g) || []).length, 1000);
    assert.equal(history.querySelectorCalls, 0);
    assert.equal(history.children.some(child => child.className === "history-load-more"), false);
    assert.equal(history.replaceChildrenCalls, 1);
    assert.ok(day.markupBytesWritten < 500_000);
    assert.equal(pageNumber, pageCount);
});

test("public history appends thousands of dated records without rescanning the DOM", async () => {
    const source = await readFile(
        new URL("../js/features/profile/user-profile.js", import.meta.url),
        "utf8"
    );
    const list = new FakeElement("div");
    const profileRoot = new FakeElement("main");
    const dialog = new FakeElement("dialog");
    const preview = new FakeElement("img");
    const context = vm.createContext({
        URL,
        URLSearchParams,
        console,
        localStorage: {
            getItem: key => key === "user" ? JSON.stringify({ id: "viewer" }) : null,
            removeItem: () => {}
        },
        document: {
            getElementById: id => ({
                publicProfile: profileRoot,
                publicPhotoDialog: dialog,
                publicPhotoPreview: preview
            })[id] || null,
            createElement: tagName => new FakeElement(tagName),
            createDocumentFragment: () => new FakeFragment(),
            addEventListener: () => {}
        },
        window: {
            location: { search: "?id=profile" },
            history: { state: null },
            addEventListener: () => {},
            showToast: () => null
        },
        fetch: () => new Promise(() => {})
    });

    vm.runInContext(timeZoneConfigSource, context);
    vm.runInContext(presentationSource, context);
    vm.runInContext(source, context);
    for (let page = 0; page < 40; page += 1) {
        const workouts = Array.from({ length: 25 }, (_, offset) => {
            const index = page * 25 + offset;
            const date = new Date(Date.UTC(2026, 0, 1) - index * 86_400_000)
                .toISOString()
                .slice(0, 10);
            return { date, exercise: `Workout ${index}`, reps: 10, sets: 2 };
        });
        context.appendPublicWorkouts(list, workouts);
    }

    const days = list.children.filter(child => child.className === "history-day");
    assert.equal(days.length, 1000);
    assert.equal(
        days.reduce(
            (total, day) =>
                total + (day.innerHTML.match(/class="history-workout"/g) || []).length,
            0
        ),
        1000
    );
    assert.equal(list.querySelectorAllCalls || 0, 0);
    assert.equal(list.querySelectorCalls, 1);
});
