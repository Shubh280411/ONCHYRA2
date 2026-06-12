const nodemailer = require('nodemailer');
const { createTransporter } = require('./smtp');

// Use SMTP directly for campaigns (bypass Apps Script so from address is correct)
function createMainMailer() {
    const host = process.env.MAIL_SMTP_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.MAIL_SMTP_PORT || process.env.SMTP_PORT, 10) || 587;
    const user = process.env.MAIL_SMTP_USER || process.env.SMTP_USER || process.env.GMAIL_USER;
    const pass = process.env.MAIL_SMTP_PASS || process.env.SMTP_PASS || process.env.GMAIL_PASS;
    const senderEmail = process.env.MAIL_FROM_EMAIL || process.env.MAIL_SMTP_FROM_EMAIL || user;
    const senderName = process.env.MAIL_FROM_NAME || process.env.MAIL_SMTP_FROM_NAME || 'ONCHYRA Updates';

    const transporter = nodemailer.createTransport({
        host, port,
        secure: port === 465,
        auth: { user, pass }
    });

    transporter.mailSettings = {
        sender: `"${senderName}" <${senderEmail}>`,
        senderEmail
    };

    return transporter;
}

const transporter = createMainMailer();

module.exports = transporter;
