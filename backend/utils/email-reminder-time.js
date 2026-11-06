const { DateTime } = require("luxon");

function isValidTimeZone(timeZone) {
    return typeof timeZone === "string" &&
        timeZone.length <= 100 &&
        DateTime.now().setZone(timeZone).isValid;
}

function isValidReminderTime(reminderTime) {
    return typeof reminderTime === "string" &&
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(reminderTime);
}

function getLocalDate(date, timeZone) {
    return DateTime.fromJSDate(date, { zone: timeZone }).toISODate();
}

function getReminderAtForDate(localDate, reminderTime, timeZone) {
    const reminder = DateTime.fromISO(`${localDate}T${reminderTime}`, {
        zone: timeZone
    });
    return reminder.isValid ? reminder.toUTC().toJSDate() : null;
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
    const localHour = DateTime.fromJSDate(date, { zone: "Asia/Kolkata" }).hour;
    return localHour === 18;
}

module.exports = {
    getLocalDate,
    getLocalDayBounds,
    getReminderAtForDate,
    getNextReminderAt,
    isReminderWindow,
    isValidReminderTime,
    isValidTimeZone
};
