const nodemailer = require("nodemailer");
const { OTP_EXPIRY_MINUTES } = require("./auth.service");

function getEmailProvider() {
    const configuredProvider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
    if (configuredProvider && !["resend", "gmail"].includes(configuredProvider)) {
        throw new Error("EMAIL_PROVIDER must be either resend or gmail.");
    }

    return configuredProvider || (process.env.RESEND_API_KEY ? "resend" : "gmail");
}

async function sendOTPEmail(email, otp, purpose) {
    const action =
        purpose === "signup"
            ? "create your MUSTMAKE account"
            : "login to your MUSTMAKE account";

    const message = {
        to: email,
        subject: "Your MUSTMAKE verification code",
        html: `
                    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto;">
                        <h2>MUSTMAKE</h2>

                        <p>
                            Use this verification code to ${action}:
                        </p>

                        <div style="
                            font-size: 32px;
                            font-weight: bold;
                            letter-spacing: 8px;
                            padding: 20px 0;
                        ">
                            ${otp}
                        </div>

                        <p>
                            This code expires in ${OTP_EXPIRY_MINUTES} minutes.
                        </p>

                        <p>
                            If you did not request this code, you can safely ignore this email.
                        </p>
                    </div>
                `
    };

    const provider = getEmailProvider();
    if (provider === "resend") {
        const apiKey = process.env.RESEND_API_KEY;
        const from = process.env.EMAIL_FROM;
        if (!apiKey || !from) {
            throw new Error("RESEND_API_KEY and EMAIL_FROM are required for Resend.");
        }

        let response;
        try {
            response = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ ...message, from })
            });
        } catch (error) {
            console.error("[email] Resend request failed.", {
                code: error.code || "NETWORK_ERROR"
            });
            throw new Error("Resend email delivery failed.");
        }

        if (!response.ok) {
            console.error("[email] Resend rejected the email.", {
                status: response.status
            });
            throw new Error(`Resend email delivery failed (HTTP ${response.status}).`);
        }
        return;
    }

    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD are required for Gmail.");
    }

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    });

    try {
        await transporter.sendMail({
            ...message,
            from: process.env.GMAIL_USER
        });
    } catch (error) {
        console.error("[email] Gmail delivery failed.", {
            code: error.code || "SMTP_ERROR"
        });
        throw new Error("Gmail email delivery failed.");
    }
}

module.exports = { sendOTPEmail, getEmailProvider };
