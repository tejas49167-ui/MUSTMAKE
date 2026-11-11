module.exports = {
    ...require("./auth/otp.controller"),
    ...require("./auth/password-session.controller"),
    ...require("./auth/oauth.controller")
};
