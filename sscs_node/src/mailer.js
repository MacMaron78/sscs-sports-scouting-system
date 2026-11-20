import nodemailer from "nodemailer";

export function createPasswordResetEmailSender(env = process.env) {
    const configKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"];
    const configured = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"].some((key) => env[key]);
    if (!configured) return null;

    const missing = configKeys.filter((key) => !env[key]);
    if (missing.length) {
        throw new Error(`Configure all password-reset email settings: ${missing.join(", ")}.`);
    }

    const port = Number(env.SMTP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("SMTP_PORT must be a valid TCP port.");
    }
    if (env.SMTP_SECURE && !["true", "false"].includes(env.SMTP_SECURE.toLowerCase())) {
        throw new Error("SMTP_SECURE must be true or false.");
    }

    const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
        auth: {
            user: env.SMTP_USER,
            pass: env.SMTP_PASSWORD,
        },
    });

    return ({ to, resetUrl }) => transporter.sendMail({
        from: env.SMTP_FROM,
        to,
        subject: "Reset your SSCS password",
        text: [
            "We received a request to reset the password for your SSCS account.",
            "",
            `Use this one-time link within 60 minutes: ${resetUrl}`,
            "",
            "If you did not request this, you can ignore this email.",
        ].join("\n"),
    });
}
