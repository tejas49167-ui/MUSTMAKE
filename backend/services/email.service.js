const nodemailer = require("nodemailer");
const { OTP_EXPIRY_MINUTES } = require("./auth.service");
const { logFailure } = require("../utils/safe-log");
const { getFrontendRedirect } = require("../config/urls");

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

    try {
        await transporter.sendMail({
            ...message,
            from: process.env.GMAIL_USER
        });
    } catch (error) {
        logFailure("[email] Gmail delivery failed.", error);
        throw new Error("Gmail email delivery failed.");
    }
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

async function sendExerciseReminderEmail(email, name, localDate, idempotencyKey) {
   if (getEmailProvider() !== "resend") {
       throw new Error("Exercise reminders require the Resend email provider.");
   }

   const apiKey = process.env.RESEND_API_KEY;
   const from = process.env.EMAIL_FROM;
   if (!apiKey || !from) {
       throw new Error("RESEND_API_KEY and EMAIL_FROM are required for Resend.");
   }

   const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi there,";
   const todayUrl = escapeHtml(getFrontendRedirect("/today"));
   const message = {
       from,
       to: email,
       subject: "A little reminder to move today",
       html: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827">
 <div style="max-width:560px;margin:32px auto;padding:32px 24px;background:#fff;border-radius:16px">
   <p style="margin:0 0 24px;color:#2563eb;font-size:14px;font-weight:700;letter-spacing:2px">MUSTMAKE</p>
   <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">Your daily movement reminder</h1>
   <p style="margin:0 0 16px;font-size:16px;line-height:1.6">${greeting}</p>
   <p style="margin:0 0 24px;font-size:16px;line-height:1.6">You haven't logged an exercise for ${escapeHtml(localDate)} yet. A short session is a great way to keep your momentum going.</p>
   <a href="${todayUrl}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700">Log today's exercise</a>
   <p style="margin:28px 0 0;color:#6b7280;font-size:12px;line-height:1.5">You can change your email notification preferences in MUSTMAKE Settings.</p>
 </div>
</body>
</html>`
   };

   let response;
   try {
       response = await fetch("https://api.resend.com/emails", {
           method: "POST",
           headers: {
               Authorization: `Bearer ${apiKey}`,
               "Idempotency-Key": idempotencyKey,
               "Content-Type": "application/json"
           },
           body: JSON.stringify(message)
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
