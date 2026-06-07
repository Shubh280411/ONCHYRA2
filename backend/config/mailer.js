const { createTransporter } = require('./smtp');

const transporter = createTransporter('main');

module.exports = transporter;
