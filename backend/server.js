const app = require("./app");
const connectDB = require("./config/database");
const loginRateLimitService = require("./services/login-rate-limit.service");
const OTP = require("./models/OTP");
const OTPGuard = require("./models/OTPGuard");

const PORT = process.env.PORT || 4000;

(async () => {
    await connectDB();
    await Promise.all([
        loginRateLimitService.ensureIndexes(),
        OTP.init(),
        OTPGuard.init()
    ]);

    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
})();
