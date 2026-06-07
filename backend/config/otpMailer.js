const nodemailer = require('nodemailer');

const otpTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.OTP_GMAIL_USER,
        pass: process.env.OTP_GMAIL_PASS
    }
});

module.exports = otpTransporter;
