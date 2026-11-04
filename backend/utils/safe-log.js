const SAFE_ERROR_CODES = new Set([
    "EAUTH",
    "ECONNECTION",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EENVELOPE",
    "ESOCKET",
    "NETWORK_ERROR",
    "SMTP_ERROR"
]);

function logFailure(context, error) {
    const details = {};
    if (Number.isInteger(error?.code)) {
        details.code = error.code;
    } else if (SAFE_ERROR_CODES.has(error?.code)) {
        details.code = error.code;
    }

    if (
        typeof error?.name === "string" &&
        /^[A-Z][A-Za-z0-9_]{0,39}$/.test(error.name)
    ) {
        details.name = error.name;
    }

    console.error(context, details);
}

module.exports = { logFailure };
