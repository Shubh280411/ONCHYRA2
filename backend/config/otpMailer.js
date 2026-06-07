const nodemailer = require('nodemailer');

const otpTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: {
        user: process.env.OTP_GMAIL_USER,
        pass: process.env.OTP_GMAIL_PASS
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000
});

module.exports = otpTransporter;
