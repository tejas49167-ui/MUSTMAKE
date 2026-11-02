const { getFrontendOrigins } = require("../utils/auth-cookie");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FRONTEND_ORIGINS = getFrontendOrigins();

function csrfOrigin(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get("Origin");
    if (origin && FRONTEND_ORIGINS.has(origin)) return next();

    return res.status(403).json({
        message: "Request origin is not allowed."
    });
}

module.exports = csrfOrigin;
