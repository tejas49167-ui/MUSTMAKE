const test = require("node:test");
const assert = require("node:assert/strict");
const {
    getLocalDate,
    getLocalDayBounds,
    getNextReminderAt,
    isReminderWindow
} = require("../utils/email-reminder-time");
const {
    NOTIFICATION_TYPE,
    processDueUser,
    runDueReminders
} = require("../services/email-reminder.service");

const now = new Date("2026-03-08T12:35:00.000Z");
const dueAt = new Date("2026-03-08T12:30:00.000Z");

function createFixture(options = {}) {
    const user = {
        _id: "user-1",
        name: "Athlete",
        email: "athlete@example.test",
        emailVerifiedAt: new Date("2025-01-01T00:00:00.000Z"),
        emailPreferences: {
            enabled: true,
            dailyExerciseReminder: true,
            nextReminderAt: dueAt
        },
        ...(options.user || {})
    };
    let log = null;
    let exerciseChecks = 0;
    const sent = [];
    const updates = [];

    const UserModel = {
        async updateOne(filter, update) {
            updates.push({ filter, update });
            const expected = filter["emailPreferences.nextReminderAt"];
            if (
                expected &&
                user.emailPreferences.nextReminderAt?.getTime() !== expected.getTime()
            ) {
                return { matchedCount: 0 };
            }
            if (update.$set?.["emailPreferences.nextReminderAt"] !== undefined) {
                user.emailPreferences.nextReminderAt =
                    update.$set["emailPreferences.nextReminderAt"];
            }
            return { matchedCount: 1 };
        },
        findById() {
            return { select: async () => options.currentUser || user };
        },
        find() {
            const query = {
                select() { return this; },
                sort() { return this; },
                limit() { return this; },
                lean: async () => [user]
            };
            return query;
        }
    };

    const WorkoutModel = {
        async exists(filter) {
            exerciseChecks += 1;
            options.onExerciseCheck?.(exerciseChecks, filter);
            return options.exerciseCompleted === true ||
                (options.exerciseCompleted === "after-claim" && exerciseChecks > 1);
        },
        async distinct() {
            return options.workoutDates || [];
        }
    };

    const LogModel = {
        async updateOne(filter, update, config) {
            if (config?.upsert) {
                if (!log) {
                    log = {
                        ...filter,
                        status: update.$setOnInsert.status,
                        attemptCount: update.$setOnInsert.attemptCount,
                        leaseToken: null,
                        leaseExpiresAt: null,
                        nextAttemptAt: null
                    };
                }
                return { upsertedCount: log ? 1 : 0 };
            }
            if (
                log &&
                log.user === filter.user &&
                log.localDate === filter.localDate &&
                log.leaseToken === filter.leaseToken &&
                log.status === filter.status
            ) {
                Object.assign(log, update.$set);
            }
            return { matchedCount: 1 };
        },
        async findOneAndUpdate(filter, update) {
            if (
                !log ||
                log.status !== "pending" && log.status !== "failed" &&
                    !(log.status === "sending" && log.leaseExpiresAt <= nowForClaim) ||
                log.attemptCount >= 5 ||
                log.nextAttemptAt && log.nextAttemptAt > nowForClaim ||
                log.leaseExpiresAt && log.leaseExpiresAt > nowForClaim
            ) {
                return null;
            }
            Object.assign(log, update.$set);
            log.attemptCount += update.$inc.attemptCount;
            return { attemptCount: log.attemptCount };
        },
        async findOne(filter) {
            return log &&
                log.user === filter.user &&
                log.notificationType === filter.notificationType &&
                log.localDate === filter.localDate
                ? log
                : null;
        }
    };

    let nowForClaim = now;
    let currentNow = now;
    const dependencies = {
        UserModel,
        WorkoutModel,
        LogModel,
        nowProvider: () => currentNow,
        sendReminder: async (...args) => {
            sent.push(args);
            if (options.sendFailure) throw new Error("Resend is unavailable.");
            return { messageId: "resend-message-1" };
        }
    };

    return {
        user,
        logModel: LogModel,
        getLog() { return log; },
        sent,
        updates,
        dependencies,
        setNow(value) {
            nowForClaim = value;
            currentNow = value;
        },
        setLog(value) { log = value; }
    };
}

test("a workout completed on the user's local day suppresses the reminder", async () => {
    const fixture = createFixture({ exerciseCompleted: true });

    const result = await processDueUser(fixture.user, now, fixture.dependencies);

    assert.equal(result.result, "exercise-completed");
    assert.equal(fixture.sent.length, 0);
    assert.equal(fixture.updates.length, 1);
    assert.equal(fixture.updates[0].filter["emailPreferences.nextReminderAt"], dueAt);
});

test("no workout today sends one reminder with the current streak", async () => {
    const fixture = createFixture({
        workoutDates: ["2026-03-07", "2026-03-06"]
    });

    const result = await processDueUser(fixture.user, now, fixture.dependencies);

    assert.equal(result.result, "sent");
    assert.equal(fixture.sent.length, 1);
    assert.equal(fixture.sent[0][2], "2026-03-08");
    assert.equal(
        fixture.sent[0][3],
        2
    );
    assert.equal(
        fixture.sent[0][4],
        `${NOTIFICATION_TYPE}:user-1:2026-03-08`
    );
    assert.equal(fixture.getLog().status, "sent");
    assert.equal(fixture.getLog().attemptCount, 1);
    assert.equal(fixture.getLog().resendMessageId, "resend-message-1");
});

test("master and individual reminder preferences and unverified email all suppress delivery", async t => {
    for (const user of [
        { emailPreferences: { ...createFixture().user.emailPreferences, enabled: false } },
        { emailPreferences: { ...createFixture().user.emailPreferences, dailyExerciseReminder: false } },
        { emailVerifiedAt: null }
    ]) {
        await t.test(JSON.stringify(user), async () => {
            const fixture = createFixture({ user });
            const result = await processDueUser(fixture.user, now, fixture.dependencies);

            assert.equal(result.result, "ineligible");
            assert.equal(fixture.sent.length, 0);
        });
    }
});

test("duplicate scheduler invocations claim the same user only once", async () => {
    const fixture = createFixture();

    const results = await Promise.all([
        runDueReminders(now, fixture.dependencies),
        runDueReminders(now, fixture.dependencies)
    ]);

    assert.equal(fixture.sent.length, 1);
    assert.equal(results.reduce((sum, result) => sum + result.sent, 0), 1);
});

test("concurrent workers cannot claim an active notification lease twice", async () => {
    const fixture = createFixture();

    const results = await Promise.all([
        processDueUser(fixture.user, now, fixture.dependencies),
        processDueUser(fixture.user, now, fixture.dependencies)
    ]);

    assert.equal(fixture.sent.length, 1);
    assert.equal(results.filter(result => result.result === "sent").length, 1);
});

test("an expired worker lease is reclaimed after a serverless restart", async () => {
    const fixture = createFixture();
    fixture.setLog({
        user: fixture.user._id,
        notificationType: NOTIFICATION_TYPE,
        localDate: "2026-03-08",
        status: "sending",
        attemptCount: 1,
        leaseToken: "expired-lease",
        leaseExpiresAt: new Date(now.getTime() - 1),
        nextAttemptAt: null
    });

    const result = await processDueUser(fixture.user, now, fixture.dependencies);

    assert.equal(result.result, "sent");
    assert.equal(fixture.sent.length, 1);
    assert.equal(fixture.getLog().attemptCount, 2);
    assert.equal(fixture.getLog().status, "sent");
});

test("an expired final lease stops retrying and advances to the next day", async () => {
    const fixture = createFixture();
    fixture.setLog({
        user: fixture.user._id,
        notificationType: NOTIFICATION_TYPE,
        localDate: "2026-03-08",
        status: "sending",
        attemptCount: 5,
        leaseToken: "expired-final-lease",
        leaseExpiresAt: new Date(now.getTime() - 1),
        nextAttemptAt: null
    });

    const result = await processDueUser(fixture.user, now, fixture.dependencies);

    assert.equal(result.result, "already-claimed");
    assert.equal(fixture.sent.length, 0);
    assert.equal(fixture.getLog().status, "failed");
    assert.equal(
        fixture.user.emailPreferences.nextReminderAt.toISOString(),
        "2026-03-09T12:30:00.000Z"
    );
});

test("failed Resend delivery is retried and then recorded as delivered", async t => {
    const originalError = console.error;
    console.error = () => {};
    t.after(() => { console.error = originalError; });

    const fixture = createFixture({ sendFailure: true });
    const failed = await processDueUser(fixture.user, now, fixture.dependencies);
    assert.equal(failed.result, "failed");
    assert.equal(fixture.sent.length, 1);

    fixture.dependencies.sendReminder = async () => ({ messageId: "retry-message" });
    const retryAt = new Date(now.getTime() + 60_000);
    fixture.setNow(retryAt);
    const retried = await processDueUser(fixture.user, retryAt, fixture.dependencies);

    assert.equal(retried.result, "sent");
    assert.equal(fixture.sent.length, 1);
});

test("preference changes before delivery cancel an already claimed reminder", async () => {
    const changedUser = createFixture().user;
    changedUser.emailPreferences.enabled = false;
    changedUser.emailPreferences.nextReminderAt = null;
    const fixture = createFixture({ currentUser: changedUser });

    const result = await processDueUser(fixture.user, now, fixture.dependencies);

    assert.equal(result.result, "preferences-changed");
    assert.equal(fixture.sent.length, 0);
});

test("a legacy reminder schedule does not prevent the fixed daily reminder", async () => {
    const yesterdayDue = new Date("2026-03-07T14:30:00.000Z");
    const fixture = createFixture();
    fixture.user.emailPreferences.nextReminderAt = yesterdayDue;

    const result = await processDueUser(fixture.user, now, fixture.dependencies);

    assert.equal(result.result, "sent");
    assert.equal(fixture.sent.length, 1);
});

test("a worker crossing local midnight does not send the previous day's reminder", async () => {
    const fixture = createFixture();
    fixture.dependencies.nowProvider = () => new Date("2026-03-09T12:35:00.000Z");

    const result = await processDueUser(fixture.user, now, fixture.dependencies);

    assert.equal(result.result, "preferences-changed");
    assert.equal(fixture.sent.length, 0);
    assert.equal(fixture.getLog().status, "skipped");
    assert.equal(
        fixture.user.emailPreferences.nextReminderAt.toISOString(),
        "2026-03-10T12:30:00.000Z"
    );
});

test("reminders only run during the 6 PM India delivery window", () => {
    assert.equal(isReminderWindow(new Date("2026-03-08T12:30:00.000Z")), true);
    assert.equal(isReminderWindow(new Date("2026-03-08T12:25:00.000Z")), false);
    assert.equal(isReminderWindow(new Date("2026-03-08T13:30:00.000Z")), false);
    assert.equal(isReminderWindow(new Date("2026-03-08T15:00:00.000Z")), false);
});

test("local-midnight calculation follows the configured IANA timezone", () => {
    assert.equal(
        getLocalDate(new Date("2026-07-14T03:59:00.000Z"), "America/New_York"),
        "2026-07-13"
    );
    assert.equal(
        getLocalDate(new Date("2026-07-14T04:00:00.000Z"), "America/New_York"),
        "2026-07-14"
    );
});

test("local day bounds account for spring-forward and fall-back daylight saving", () => {
    const springDay = getLocalDayBounds(
        new Date("2026-03-08T16:00:00.000Z"),
        "America/New_York"
    );
    const fallDay = getLocalDayBounds(
        new Date("2026-11-01T16:00:00.000Z"),
        "America/New_York"
    );

    assert.equal(springDay.end.getTime() - springDay.start.getTime(), 23 * 60 * 60 * 1000);
    assert.equal(fallDay.end.getTime() - fallDay.start.getTime(), 25 * 60 * 60 * 1000);
});

test("reminders in a skipped daylight-saving hour move forward without changing local date", () => {
    const reminderAt = getNextReminderAt(
        new Date("2026-03-08T05:00:00.000Z"),
        "02:30",
        "America/New_York"
    );

    assert.equal(getLocalDate(reminderAt, "America/New_York"), "2026-03-08");
    assert.equal(
        new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23"
        }).format(reminderAt),
        "03:30"
    );
});

test("fall-back repeated reminder time still resolves to one local notification date", () => {
    const firstOccurrence = getNextReminderAt(
        new Date("2026-11-01T04:30:00.000Z"),
        "01:30",
        "America/New_York"
    );
    const secondOccurrence = new Date(firstOccurrence.getTime() + 60 * 60 * 1000);

    assert.equal(getLocalDate(firstOccurrence, "America/New_York"), "2026-11-01");
    assert.equal(getLocalDate(secondOccurrence, "America/New_York"), "2026-11-01");
});
