const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true, minlength: 6, select: false },
        college: { type: String, default: '' },
        course: { type: String, default: '' },
        city: { type: String, default: '' },
        phone: { type: String, default: '' },
        photo: { type: String, default: '' },
        role: { type: String, enum: ['user', 'employee', 'admin'], default: 'user' },
        verified: { type: Boolean, default: false },
        status: { type: String, enum: ['active', 'suspended'], default: 'active' }
    },
    { timestamps: true }
);

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

userSchema.methods.matchPassword = function (enteredPassword) {
    return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
