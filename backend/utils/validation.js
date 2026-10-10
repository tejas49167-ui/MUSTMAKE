const { getDateString } = require("./date");

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidDateOnly(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isAtLeastAge(dateOfBirth, minimumAge) {
    const [birthYear, birthMonth, birthDay] = dateOfBirth.split("-").map(Number);
    const [currentYear, currentMonth, currentDay] = getDateString().split("-").map(Number);
    let age = currentYear - birthYear;

    if (
        currentMonth < birthMonth ||
        (currentMonth === birthMonth && currentDay < birthDay)
    ) {
        age -= 1;
    }

    return age >= minimumAge;
}

function parseWorkoutNumber(value, { integer = false, min = 0 } = {}) {
    if (
        (typeof value !== "number" && typeof value !== "string") ||
        (typeof value === "string" && value.trim() === "")
    ) {
        return { valid: false, value: null };
    }

    const number = Number(value);
    const valid = Number.isFinite(number) && number >= min &&
        (integer ? Number.isSafeInteger(number) : true);

    return { valid, value: valid ? number : null };
}

function isValidEmail(value) {
    return typeof value === "string" &&
        value.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

module.exports = {
    escapeRegex,
    isPlainObject,
    isValidDateOnly,
    isAtLeastAge,
    parseWorkoutNumber,
    isValidEmail
};
