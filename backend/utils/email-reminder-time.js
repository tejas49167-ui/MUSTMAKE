const { DateTime } = require("luxon");

const REMINDER_TIME = "18:00";
const REMINDER_TIME_ZONE = "Asia/Kolkata";

function getLocalDate(date, timeZone) {
    return DateTime.fromJSDate(date, { zone: timeZone }).toISODate();
}

function getLocalDayBounds(date, timeZone) {
    const localDay = DateTime.fromJSDate(date, { zone: timeZone }).startOf("day");
    return {
        start: localDay.toUTC().toJSDate(),
        end: localDay.plus({ days: 1 }).toUTC().toJSDate()
    };
}

function getNextReminderAt(now, reminderTime, timeZone) {
    const [hour, minute] = reminderTime.split(":").map(Number);
    const localNow = DateTime.fromJSDate(now, { zone: timeZone });
    let next = localNow.set({
        hour,
        minute,
        second: 0,
        millisecond: 0
    });

    if (next.toMillis() <= localNow.toMillis()) {
        next = localNow.plus({ days: 1 }).set({
            hour,
            minute,
            second: 0,
            millisecond: 0
        });
    }

    return next.toUTC().toJSDate();
}

function isReminderWindow(date) {
    const [hour] = REMINDER_TIME.split(":").map(Number);
    const localHour = DateTime.fromJSDate(date, {
        zone: REMINDER_TIME_ZONE
    }).hour;
    return localHour === hour;
}

module.exports = {
    REMINDER_TIME,
    REMINDER_TIME_ZONE,
    getLocalDate,
    getLocalDayBounds,
    getNextReminderAt,
    isReminderWindow
};
