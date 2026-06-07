const { createTransporter } = require('./smtp');

const otpTransporter = createTransporter('otp');

module.exports = otpTransporter;
