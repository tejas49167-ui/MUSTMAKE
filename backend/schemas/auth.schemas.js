const { isPlainObject, isValidEmail } = require("../utils/validation");

function parseOtpIdentity(body, requiredMessage) {
    const value = isPlainObject(body) ? body : {};
    if (typeof value.email !== "string" || typeof value.purpose !== "string") {
        return {
            valid: false,
            status: 400,
            message: requiredMessage
        };
    }

    const email = value.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
        return { valid: false, status: 400, message: "Enter a valid email address." };
    }
    if (!["login", "signup"].includes(value.purpose)) {
        return { valid: false, status: 400, message: "Invalid OTP purpose." };
    }

    return {
        valid: true,
        body: value,
        email,
        purpose: value.purpose
    };
}

function parseSignupCredentials(body) {
    const username = typeof body.username === "string"
        ? body.username.trim().toLowerCase()
        : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
        return {
            valid: false,
            status: 400,
            message: "Username must be 3 to 30 characters and use only letters, numbers or underscores."
        };
    }
    if (password.length < 6 || Buffer.byteLength(password, "utf8") > 72) {
        return {
            valid: false,
            status: 400,
            message: "Password must be at least 6 characters and no more than 72 bytes."
        };
    }

    return { valid: true, username, password };
}

function parsePasswordLogin(body) {
    const value = isPlainObject(body) ? body : {};
    const { login, password } = value;
    if (
        !login ||
        !password ||
        typeof login !== "string" ||
        typeof password !== "string"
    ) {
        return {
            valid: false,
            status: 400,
            message: "Username/email and password are required."
        };
    }

    return { valid: true, login, password };
}

module.exports = {
    parseOtpIdentity,
    parsePasswordLogin,
    parseSignupCredentials
};
