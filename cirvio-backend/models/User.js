const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const educationSchema = new mongoose.Schema({
    level: { type: String, default: '' },
    className: { type: String, default: '' },
    stream: { type: String, default: '' },
    streamOther: { type: String, default: '' },
    course: { type: String, default: '' },
    courseOther: { type: String, default: '' },
    year: { type: String, default: '' }
}, { _id: false });

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
        education: { type: educationSchema, default: () => ({}) },
        interests: [{ type: String, trim: true, maxlength: 100 }],
        onboardingCompleted: { type: Boolean, default: false },
        authProvider: { type: String, enum: ['password', 'google', 'phone'], default: 'password' },
        passwordSet: { type: Boolean, default: true },
        trustRatings: [
            {
                user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
                value: { type: Number, min: 1, max: 5, required: true },
                createdAt: { type: Date, default: Date.now },
                updatedAt: { type: Date, default: Date.now }
            }
        ],
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
