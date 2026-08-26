/* Run once: node scripts/createAdmin.js
   Creates (or promotes) the admin account defined in your .env */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const email = (process.env.ADMIN_EMAIL || 'admin@cirvio.com').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'changeme123';

    let user = await User.findOne({ email });
    if (user) {
        user.role = 'admin';
        await user.save();
        console.log(`✅ Existing user ${email} promoted to admin`);
    } else {
        user = await User.create({ name: 'CIRVIO Admin', email, password, role: 'admin', verified: true });
        console.log(`✅ Admin account created: ${email}`);
    }
    await mongoose.disconnect();
})();
