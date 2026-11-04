const { logFailure } = require("../utils/safe-log");

function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    logFailure("Unhandled request error.", error);
    return res.status(500).json({ message: "Internal server error." });
}

module.exports = errorHandler;
