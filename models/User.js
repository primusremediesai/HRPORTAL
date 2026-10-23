const mongoose = require('mongoose');
const argon2 = require('argon2');

const userSchema = new mongoose.Schema({
  name: { type: String, default: 'HR User' },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['admin', 'hr_manager', 'employee'], 
    default: 'admin' 
  },
  employeeCode: { type: String, sparse: true },
  department: { type: String, default: 'Human Resources' },
  isActive: { type: Boolean, default: true },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date },
  lastLogin: { type: Date }
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
