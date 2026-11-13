const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");
const { OTP_EXPIRY_MINUTES } = require("./auth.service");
const { logFailure } = require("../utils/safe-log");

const APP_BASE_URL = process.env.APP_URL || "https://mustmake.vercel.app";
const FALLBACK_LOGO_URL = `${APP_BASE_URL}/assets/images/favicon.png`;
const LOCAL_LOGO_PATH = path.resolve(
    __dirname,
    "../../frontend/assets/images/favicon.png"
);

function getLogoConfig() {
    try {
        if (fs.existsSync(LOCAL_LOGO_PATH)) {
            const buffer = fs.readFileSync(LOCAL_LOGO_PATH);
            return {
                src: "cid:mustmake-logo",
                base64: buffer.toString("base64"),
                buffer
            };
        }
    } catch (_) {
        // Fallback to public URL if local file isn't readable
    }
    return {
        src: FALLBACK_LOGO_URL,
        base64: null,
        buffer: null
    };
}

function getEmailProvider() {
    const configuredProvider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
    if (configuredProvider && !["resend", "gmail"].includes(configuredProvider)) {
        throw new Error("EMAIL_PROVIDER must be either resend or gmail.");
    }

    return configuredProvider || (process.env.RESEND_API_KEY ? "resend" : "gmail");
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character]);
}

function buildOtpDigitBoxes(otpString) {
    const digits = String(otpString).trim().split("");
    return digits
        .map((digit, index) => {
            const rightPad = index === digits.length - 1 ? "0" : "6px";
            return `
        <td width="16.66%" style="padding:0 ${rightPad} 0 0;">
          <div style="height:52px;line-height:52px;background-color:#141417;background-image:linear-gradient(#141417,#141417);border-radius:10px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:22px;font-weight:700;color:#ffffff;">
            ${escapeHtml(digit)}
          </div>
        </td>`;
        })
        .join("");
}

async function sendOTPEmail(email, otp, purpose) {
    const action =
        purpose === "signup"
            ? "create your MUSTMAKE account"
            : "sign in to your MUSTMAKE account";

    const safeOtp = escapeHtml(otp);
    const safeExpiry = escapeHtml(OTP_EXPIRY_MINUTES);
    const digitBoxesHtml = buildOtpDigitBoxes(otp);
    const logo = getLogoConfig();
    const targetPage = purpose === "signup" ? "/pages/signup.html" : "/pages/login.html";
    const copyUrl = `${APP_BASE_URL}${targetPage}?copy_otp=${encodeURIComponent(String(otp).trim())}`;

    const html = `<!doctype html>
<html lang="en" style="color-scheme:dark;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background-color:#000000;background-image:linear-gradient(#000000,#000000);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;-webkit-font-smoothing:antialiased;">
  <div style="max-width:420px;margin:0 auto;padding:36px 24px;background-color:#000000;background-image:linear-gradient(#000000,#000000);">
    
    <!-- Brand Header -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px;">
      <tr>
        <td style="vertical-align:middle;padding-right:10px;">
          <img src="${logo.src}" alt="MUSTMAKE" width="26" height="26" style="display:block;width:26px;height:26px;border-radius:6px;border:0;">
        </td>
        <td style="vertical-align:middle;padding-top:2px;">
          <span style="display:block;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:3px;line-height:1;text-transform:uppercase;">MUSTMAKE</span>
        </td>
      </tr>
    </table>

    <!-- Title & Description -->
    <h1 style="margin:0 0 10px;font-size:24px;font-weight:700;letter-spacing:-0.4px;line-height:1.25;color:#ffffff;">Verification Code</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#a1a1aa;">
      Use the verification code below to ${action}:
    </p>

    <!-- Fluid 6-Column OTP Grid (Never overflows mobile screens) -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:340px;margin:0 0 16px;table-layout:fixed;">
      <tr>
        ${digitBoxesHtml}
      </tr>
    </table>

    <!-- Aligned Full-Width Copy Button (Locked pure white in Gmail Dark Mode) -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:340px;margin:0 0 28px;">
      <tr>
        <td>
          <a href="${copyUrl}" target="_blank" style="display:block;width:100%;box-sizing:border-box;padding:13px 20px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);color:#000000 !important;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:0.2px;text-align:center;text-decoration:none;">
            &#10064;&nbsp; Copy Code
          </a>
        </td>
      </tr>
    </table>

    <!-- Expiry & Security Note -->
    <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#71717a;">
      This code expires in <strong style="color:#ffffff;font-weight:600;">${safeExpiry} minutes</strong>.
    </p>

    <p style="margin:0;font-size:12px;line-height:1.6;color:#52525b;">
      If you did not request this code, you can safely ignore this email.
    </p>
  </div>
</body>
</html>`;

    const provider = getEmailProvider();
    if (provider === "resend") {
        const apiKey = process.env.RESEND_API_KEY;
        const from = process.env.EMAIL_FROM;
        if (!apiKey || !from) {
            throw new Error("RESEND_API_KEY and EMAIL_FROM are required for Resend.");
        }

        const payload = {
            from,
            to: email,
            subject: `${safeOtp} is your MUSTMAKE verification code`,
            html
        };

        if (logo.base64) {
            payload.attachments = [
                {
                    filename: "favicon.png",
                    content: logo.base64,
                    content_id: "mustmake-logo"
                }
            ];
        }

        let response;
        try {
            response = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            logFailure("[email] Resend request failed.", error);
            throw new Error("Resend email delivery failed.");
        }

        if (!response.ok) {
            console.error("[email] Resend rejected the email.", {
                status: Number.isInteger(response.status) ? response.status : "unknown"
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

    const mailOptions = {
        from: process.env.GMAIL_USER,
        to: email,
        subject: `${safeOtp} is your MUSTMAKE verification code`,
        html
    };

    if (logo.buffer) {
        mailOptions.attachments = [
            {
                filename: "favicon.png",
                content: logo.buffer,
                cid: "mustmake-logo"
            }
        ];
    }

    try {
        await transporter.sendMail(mailOptions);
    } catch (error) {
        logFailure("[email] Gmail delivery failed.", error);
        throw new Error("Gmail email delivery failed.");
    }
}

async function sendExerciseReminderEmail(email, name, localDate, streak, idempotencyKey) {
    if (getEmailProvider() !== "resend") {
        throw new Error("Exercise reminders require the Resend email provider.");
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
        throw new Error("RESEND_API_KEY and EMAIL_FROM are required for Resend.");
    }

    const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
    const todayUrl = APP_BASE_URL;
    const streakMessage = streak > 0
        ? `You're on a ${streak}-day streak. Keep it alive by logging today's workout.`
        : "A new streak starts with one workout. You can still get today's session in.";
    const logo = getLogoConfig();

    const payload = {
        from,
        to: email,
        subject: "Your MUSTMAKE streak is waiting",
        html: `<!doctype html>
<html lang="en" style="color-scheme:dark;">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
</head>
<body style="margin:0;padding:0;background-color:#000000;background-image:linear-gradient(#000000,#000000);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;-webkit-font-smoothing:antialiased;">
  <div style="max-width:420px;margin:0 auto;padding:36px 24px;background-color:#000000;background-image:linear-gradient(#000000,#000000);">
    
    <!-- Brand Header -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px;">
      <tr>
        <td style="vertical-align:middle;padding-right:10px;">
          <img src="${logo.src}" alt="MUSTMAKE" width="26" height="26" style="display:block;width:26px;height:26px;border-radius:6px;border:0;">
        </td>
        <td style="vertical-align:middle;padding-top:2px;">
          <span style="display:block;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:3px;line-height:1;text-transform:uppercase;">MUSTMAKE</span>
        </td>
      </tr>
    </table>

    <h1 style="margin:0 0 14px;font-size:24px;font-weight:700;letter-spacing:-0.4px;line-height:1.25;color:#ffffff;">Don't give up on today.</h1>
    
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#a1a1aa;">${greeting}</p>
    
    <p style="margin:0 0 22px;font-size:15px;line-height:1.55;color:#a1a1aa;">
      You haven't logged a workout for <strong style="color:#ffffff;font-weight:600;">${escapeHtml(localDate)}</strong> yet.
    </p>

    <div style="margin:0 0 24px;padding:16px 18px;background-color:#141417;background-image:linear-gradient(#141417,#141417);border-radius:10px;">
      <p style="margin:0;font-size:15px;line-height:1.5;font-weight:600;color:#ffffff;">${escapeHtml(streakMessage)}</p>
    </div>

    <a href="${todayUrl}" style="display:inline-block;padding:13px 26px;border-radius:10px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);color:#000000 !important;font-size:14px;font-weight:700;letter-spacing:0.2px;text-decoration:none;">Log Workout &rarr;</a>

    <p style="margin:36px 0 0;font-size:12px;line-height:1.5;color:#52525b;">
      Daily consistency reminder &bull; <a href="${todayUrl}" style="color:#a1a1aa;text-decoration:underline;">mustmake.vercel.app</a>
    </p>
  </div>
</body>
</html>`
    };

    if (logo.base64) {
        payload.attachments = [
            {
                filename: "favicon.png",
                content: logo.base64,
                content_id: "mustmake-logo"
            }
        ];
    }

    let response;
    try {
        response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Idempotency-Key": idempotencyKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        logFailure("[email] Resend reminder request failed.", error);
        throw new Error("Resend email delivery failed.");
    }

    if (!response.ok) {
        console.error("[email] Resend rejected the reminder.", {
            status: Number.isInteger(response.status) ? response.status : "unknown"
        });
        throw new Error(`Resend email delivery failed (HTTP ${response.status}).`);
    }

    const result = await response.json();
    if (typeof result?.id !== "string" || !result.id) {
        throw new Error("Resend did not return a reminder message ID.");
    }
    return { messageId: result.id };
}

module.exports = {
    sendOTPEmail,
    sendExerciseReminderEmail,
    getEmailProvider
};