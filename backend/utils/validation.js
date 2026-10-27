function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseWorkoutNumber(value, { integer = false, min = 0, max = Infinity } = {}) {
    if (
        (typeof value !== "number" && typeof value !== "string") ||
        (typeof value === "string" && value.trim() === "")
    ) {
        return { valid: false, value: null };
    }

    const number = Number(value);
    const valid = Number.isFinite(number) && number >= min && number <= max &&
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
    parseWorkoutNumber,
    isValidEmail
};
