const nodemailer = require('nodemailer');

function toBool(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    return ['true', '1', 'yes'].includes(String(value).toLowerCase());
}

function toInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function firstEnv(keys) {
    for (const key of keys) {
        if (process.env[key]) return process.env[key];
    }
    return undefined;
}

function getSmtpSettings(kind) {
    const isOtp = kind === 'otp';
    const host = firstEnv([
        isOtp ? 'OTP_SMTP_HOST' : 'MAIL_SMTP_HOST',
        'SMTP_HOST'
    ]) || 'smtp.gmail.com';
    const port = toInt(firstEnv([
        isOtp ? 'OTP_SMTP_PORT' : 'MAIL_SMTP_PORT',
        'SMTP_PORT'
    ]), host === 'smtp.gmail.com' ? 587 : 587);
    const secure = toBool(firstEnv([
        isOtp ? 'OTP_SMTP_SECURE' : 'MAIL_SMTP_SECURE',
        'SMTP_SECURE'
    ]), port === 465);
    const requireTLS = toBool(firstEnv([
        isOtp ? 'OTP_SMTP_REQUIRE_TLS' : 'MAIL_SMTP_REQUIRE_TLS',
        'SMTP_REQUIRE_TLS'
    ]), !secure);
    const user = firstEnv([
        isOtp ? 'OTP_SMTP_USER' : 'MAIL_SMTP_USER',
        'SMTP_USER',
        isOtp ? 'OTP_GMAIL_USER' : 'GMAIL_USER'
    ]);
    const pass = firstEnv([
        isOtp ? 'OTP_SMTP_PASS' : 'MAIL_SMTP_PASS',
        'SMTP_PASS',
        isOtp ? 'OTP_GMAIL_PASS' : 'GMAIL_PASS'
    ]);
    const senderEmail = firstEnv([
        isOtp ? 'OTP_MAIL_FROM_EMAIL' : 'MAIL_FROM_EMAIL',
        isOtp ? 'OTP_SMTP_FROM_EMAIL' : 'MAIL_SMTP_FROM_EMAIL',
        isOtp ? 'OTP_GMAIL_USER' : 'GMAIL_USER'
    ]) || user;
    const senderName = firstEnv([
        isOtp ? 'OTP_MAIL_FROM_NAME' : 'MAIL_FROM_NAME',
        isOtp ? 'OTP_SMTP_FROM_NAME' : 'MAIL_SMTP_FROM_NAME'
    ]) || (isOtp ? 'ONCHYRA Verify' : 'ONCHYRA');
    const appsScript = {
        enabled: process.env.EMAIL_PROVIDER === 'apps_script' || Boolean(process.env.GMAIL_APPS_SCRIPT_URL),
        url: process.env.GMAIL_APPS_SCRIPT_URL,
        secret: process.env.GMAIL_APPS_SCRIPT_SECRET
    };

    return {
        host,
        port,
        secure,
        requireTLS,
        auth: { user, pass },
        connectionTimeout: toInt(process.env.SMTP_CONNECTION_TIMEOUT_MS, 30000),
        greetingTimeout: toInt(process.env.SMTP_GREETING_TIMEOUT_MS, 30000),
        socketTimeout: toInt(process.env.SMTP_SOCKET_TIMEOUT_MS, 30000),
        sender: `"${senderName}" <${senderEmail}>`,
        senderEmail,
        providerLabel: appsScript.enabled ? 'gmail-apps-script' : `${host}:${port}`,
        appsScript
    };
}

function createAppsScriptTransporter(settings) {
    return {
        mailSettings: settings,
        async sendMail(options) {
            const response = await fetch(settings.appsScript.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    secret: settings.appsScript.secret,
                    to: options.to,
                    subject: options.subject,
                    html: options.html || '',
                    name: options.from || settings.sender
                })
            });

            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.success !== true) {
                throw new Error(data.error || `Apps Script mail failed with HTTP ${response.status}`);
            }

            return {
                messageId: data.messageId || `apps-script-${Date.now()}`,
                response: 'gmail-apps-script'
            };
        }
    };
}

function createTransporter(kind) {
    const settings = getSmtpSettings(kind);
    if (settings.appsScript.enabled) {
        const missing = [
            ['GMAIL_APPS_SCRIPT_URL', settings.appsScript.url],
            ['GMAIL_APPS_SCRIPT_SECRET', settings.appsScript.secret]
        ].filter(([, value]) => !value).map(([key]) => key);

        if (missing.length) {
            throw new Error(`Gmail Apps Script mailer is missing env vars: ${missing.join(', ')}`);
        }

        return createAppsScriptTransporter(settings);
    }

    const transporter = nodemailer.createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        requireTLS: settings.requireTLS,
        auth: settings.auth,
        connectionTimeout: settings.connectionTimeout,
        greetingTimeout: settings.greetingTimeout,
        socketTimeout: settings.socketTimeout
    });

    transporter.mailSettings = settings;
    return transporter;
}

module.exports = { createTransporter };
