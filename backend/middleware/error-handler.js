function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);

    console.error("Unhandled request error:", req.method, req.path, error.message);
    return res.status(500).json({ message: "Internal server error." });
}

module.exports = errorHandler;
