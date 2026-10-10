const nodemailer = require("nodemailer");
const { OTP_EXPIRY_MINUTES } = require("./auth.service");

async function sendOTPEmail(email, otp, purpose) {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
        throw new Error("GMAIL_USER and GMAIL_APP_PASSWORD are required.");
    }

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD
        }
    });

    const action =
        purpose === "signup"
            ? "create your MUSTMAKE account"
            : "login to your MUSTMAKE account";

    await transporter.sendMail({
        from: process.env.GMAIL_USER,
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
    });
}

module.exports = { sendOTPEmail };
