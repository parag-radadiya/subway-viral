const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone_code: {
      type: String,
      trim: true, // e.g. "+44"
    },
    phone_num: {
      type: String,
      trim: true,
    },
    password_hash: {
      type: String,
      required: true,
      select: false, // never returned in queries by default
    },
    role_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: [true, 'Role is required'],
    },
    device_id: {
      type: String,
      trim: true,
      default: null,
    },
    shop_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      default: null,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    must_change_password: {
      type: Boolean,
      default: true, // Admin-created users must change on first login
    },
  },
  { timestamps: true }
);

// Hash password before saving
// Note: Mongoose v7+ async pre hooks — do NOT call next(), just return
userSchema.pre('save', async function () {
  if (!this.isModified('password_hash')) return;
  const salt = await bcrypt.genSalt(12);
  this.password_hash = await bcrypt.hash(this.password_hash, salt);
});

// Compare plain password with stored hash
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password_hash);
};

module.exports = mongoose.model('User', userSchema);
