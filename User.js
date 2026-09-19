const mongoose = require('mongoose');
const argon2 = require('argon2');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'admin' },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date }
}, { timestamps: true });

userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  this.password = await argon2.hash(this.password);
});

userSchema.methods.verifyPassword = async function(candidatePassword) {
  return await argon2.verify(this.password, candidatePassword);
};

module.exports = mongoose.model('User', userSchema);

