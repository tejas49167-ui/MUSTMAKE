const crypto = require("crypto");
const User = require("../models/User");
const Workout = require("../models/Workout");
const EmailNotificationLog = require("../models/EmailNotificationLog");
const emailService = require("./email.service");
const { getWorkoutStreak } = require("./workout-streak.service");
const {
    REMINDER_TIME,
    REMINDER_TIME_ZONE,
    getLocalDate,
    getLocalDayBounds,
    getNextReminderAt,
    isReminderWindow
} = require("../utils/email-reminder-time");
const { logFailure } = require("../utils/safe-log");

const NOTIFICATION_TYPE = "daily-exercise-reminder";
const LEASE_DURATION_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;
const PROCESS_CONCURRENCY = 10;
const RETRY_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000];

function isReminderEligible(user) {
    const preferences = user?.emailPreferences;
    return Boolean(
        typeof user.email === "string" &&
        preferences?.enabled === true &&
        preferences?.dailyExerciseReminder === true
    );
}

function sameInstant(left, right) {
    return left instanceof Date &&
        right instanceof Date &&
        left.getTime() === right.getTime();
}

async function hasExerciseToday(userId, localDate, workoutModel = Workout) {
    return Boolean(await workoutModel.exists({
        user: userId,
        date: localDate
    }));
}

async function scheduleNextReminder(user, now, userModel = User, expectedDueAt) {
    const preferences = user.emailPreferences || {};
    const active = preferences.enabled === true &&
        preferences.dailyExerciseReminder === true;
    const nextReminderAt = active
        ? getNextReminderAt(
            now,
            REMINDER_TIME,
            REMINDER_TIME_ZONE
        )
        : null;
    const filter = { _id: user._id };
    if (expectedDueAt) {
        filter["emailPreferences.nextReminderAt"] = expectedDueAt;
    }

    await userModel.updateOne(filter, {
        $set: { "emailPreferences.nextReminderAt": nextReminderAt }
    });
}

async function ensureLogRecord(logModel, identity, now) {
    try {
        await logModel.updateOne(
            identity,
            {
                $setOnInsert: {
                    status: "pending",
                    attemptCount: 0,
                    createdAt: now,
                    updatedAt: now
                }
            },
            { upsert: true, timestamps: false }
        );
    } catch (error) {
        if (error.code !== 11000) throw error;
    }
}

async function claimNotification(logModel, identity, now) {
    await ensureLogRecord(logModel, identity, now);
    const leaseToken = crypto.randomUUID();
    const log = await logModel.findOneAndUpdate(
        {
            ...identity,
            status: { $in: ["pending", "failed", "sending"] },
            attemptCount: { $lt: MAX_ATTEMPTS },
            $and: [
                {
                    $or: [
                        { leaseExpiresAt: null },
                        { leaseExpiresAt: { $lte: now } }
                    ]
                },
                {
                    $or: [
                        { nextAttemptAt: null },
                        { nextAttemptAt: { $lte: now } }
                    ]
                }
            ]
        },
        {
            $set: {
                status: "sending",
                leaseToken,
                leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
                lastAttemptAt: now,
                nextAttemptAt: null,
                lastError: null
            },
            $inc: { attemptCount: 1 }
        },
        { new: true }
    );

    return log ? { leaseToken, attemptCount: log.attemptCount } : null;
}

async function updateLog(logModel, identity, leaseToken, update) {
    await logModel.updateOne(
        { ...identity, leaseToken, status: "sending" },
        {
            ...update,
            $set: {
                ...(update.$set || {}),
                leaseToken: null,
                leaseExpiresAt: null
            }
        }
    );
}

async function processDueUser(user, now, dependencies = {}) {
    const userModel = dependencies.UserModel || User;
    const workoutModel = dependencies.WorkoutModel || Workout;
    const logModel = dependencies.LogModel || EmailNotificationLog;
    const sendReminder = dependencies.sendReminder ||
        emailService.sendExerciseReminderEmail;
    const nowProvider = dependencies.nowProvider || (() => new Date());
    const getStreak = dependencies.getStreak ||
        ((userId, localDate) => getWorkoutStreak(userId, localDate, workoutModel));

    if (!isReminderEligible(user)) {
        return { result: "ineligible" };
    }

    const preferences = user.emailPreferences;
    const dueAt = preferences.nextReminderAt;
    const localDate = getLocalDate(now, REMINDER_TIME_ZONE);

    const identity = {
        user: user._id,
        notificationType: NOTIFICATION_TYPE,
        localDate
    };

    if (await hasExerciseToday(user._id, localDate, workoutModel)) {
        await scheduleNextReminder(user, now, userModel, dueAt);
        return { result: "exercise-completed" };
    }

    const claim = await claimNotification(logModel, identity, now);
    if (!claim) {
        const existing = await logModel.findOne(identity);
        const expiredFinalLease = existing?.status === "sending" &&
            existing.attemptCount >= MAX_ATTEMPTS &&
            existing.leaseExpiresAt instanceof Date &&
            existing.leaseExpiresAt <= now;
        if (expiredFinalLease) {
            await updateLog(logModel, identity, existing.leaseToken, {
                $set: {
                    status: "failed",
                    nextAttemptAt: null,
                    lastError: "Maximum delivery attempts reached."
                }
            });
        }
        if (
            existing &&
            (existing.status === "sent" || existing.status === "skipped" ||
                (existing.status === "failed" && existing.attemptCount >= MAX_ATTEMPTS) ||
                expiredFinalLease
            )
        ) {
            await scheduleNextReminder(user, now, userModel, dueAt);
        }
        return { result: "already-claimed" };
    }

    let attemptNow = now;
    try {
        const currentUser = await userModel.findById(user._id)
            .select("email name emailPreferences");
        attemptNow = nowProvider();
        const currentPreferences = currentUser?.emailPreferences;
        const preferencesUnchanged = currentUser &&
            isReminderEligible(currentUser) &&
            sameInstant(currentPreferences.nextReminderAt, dueAt) &&
            getLocalDate(attemptNow, REMINDER_TIME_ZONE) === localDate;

        if (!preferencesUnchanged) {
            await updateLog(logModel, identity, claim.leaseToken, {
                $set: {
                    status: "skipped",
                    lastError: "Preferences changed before delivery."
                }
            });
            if (currentUser) {
                await scheduleNextReminder(currentUser, attemptNow, userModel, dueAt);
            }
            return { result: "preferences-changed" };
        }

        if (await hasExerciseToday(
            currentUser._id,
            localDate,
            workoutModel
        )) {
            await updateLog(logModel, identity, claim.leaseToken, {
                $set: { status: "skipped", lastError: "Exercise completed today." }
            });
            await scheduleNextReminder(currentUser, attemptNow, userModel, dueAt);
            return { result: "exercise-completed" };
        }

        const streak = await getStreak(currentUser._id, localDate);
        const delivery = await sendReminder(
            currentUser.email,
            currentUser.name,
            localDate,
            streak,
            `${NOTIFICATION_TYPE}:${currentUser._id}:${localDate}`
        );

        await updateLog(logModel, identity, claim.leaseToken, {
            $set: {
                status: "sent",
                resendMessageId: delivery.messageId,
                deliveredAt: new Date()
            }
        });
        await scheduleNextReminder(currentUser, attemptNow, userModel, dueAt);
        return { result: "sent" };
    } catch (error) {
        const retryDelay = RETRY_DELAYS_MS[claim.attemptCount - 1];
        const retryAt = retryDelay === undefined
            ? null
            : new Date(attemptNow.getTime() + retryDelay);
        await updateLog(logModel, identity, claim.leaseToken, {
            $set: {
                status: "failed",
                nextAttemptAt: retryAt,
                lastError: "Email delivery failed."
            }
        });
        logFailure("Exercise reminder delivery failed.", error);
        if (!retryAt) {
            await scheduleNextReminder(user, attemptNow, userModel, dueAt);
        }
        return { result: "failed" };
    }
}

async function runDueReminders(now = new Date(), dependencies = {}) {
    if (!isReminderWindow(now)) {
        return { checked: 0, sent: 0, failed: 0, skipped: 0 };
    }

    const userModel = dependencies.UserModel || User;
    const workoutModel = dependencies.WorkoutModel || Workout;
    const logModel = dependencies.LogModel || EmailNotificationLog;
    await Promise.all(
        [userModel, workoutModel, logModel]
            .filter(model => typeof model.init === "function")
            .map(model => model.init())
    );
    const { end } = getLocalDayBounds(now, REMINDER_TIME_ZONE);
    const users = await userModel.find({
        "emailPreferences.enabled": true,
        "emailPreferences.dailyExerciseReminder": true,
        "emailPreferences.nextReminderAt": { $lt: end }
    })
        .select("_id email name emailPreferences")
        .sort({ "emailPreferences.nextReminderAt": 1 })
        .limit(BATCH_SIZE)
        .lean();

    const results = {
        checked: users.length,
        sent: 0,
        failed: 0,
        skipped: 0
    };
    for (let index = 0; index < users.length; index += PROCESS_CONCURRENCY) {
        const batch = users.slice(index, index + PROCESS_CONCURRENCY);
        const outcomes = await Promise.allSettled(
            batch.map(user => processDueUser(user, now, dependencies))
        );
        let batchError;
        for (const settled of outcomes) {
            if (settled.status === "rejected") {
                batchError ||= settled.reason;
                continue;
            }

            const outcome = settled.value;
            if (outcome.result === "sent") results.sent += 1;
            if (outcome.result === "failed") results.failed += 1;
            if (
                outcome.result === "exercise-completed" ||
                outcome.result === "preferences-changed" ||
                outcome.result === "ineligible"
            ) {
                results.skipped += 1;
            }
        }
        if (batchError) throw batchError;
    }
    return results;
}

module.exports = {
    MAX_ATTEMPTS,
    NOTIFICATION_TYPE,
    claimNotification,
    hasExerciseToday,
    isReminderEligible,
    processDueUser,
    runDueReminders,
    scheduleNextReminder
};
