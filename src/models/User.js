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
    active_shop_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      default: null,
    },
    assigned_shop_ids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Shop',
      },
    ],
    shop_history: [
      {
        shop_id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Shop',
        },
        changed_at: {
          type: Date,
          default: Date.now,
        },
        changed_by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },
        note: {
          type: String,
          maxlength: 200,
        },
      },
    ],
    is_active: {
      type: Boolean,
      default: true,
    },
    must_change_password: {
      type: Boolean,
      default: true, // Admin-created users must change on first login
    },
    refresh_token_hash: {
      type: String,
      default: null,
      select: false,
    },
    refresh_token_expires_at: {
      type: Date,
      default: null,
      select: false,
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

userSchema.pre('validate', function () {
  const assignedRaw = Array.isArray(this.assigned_shop_ids) ? this.assigned_shop_ids : [];
  const assigned = assignedRaw.filter(Boolean).map((id) => id.toString());

  if (!this.active_shop_id && this.shop_id) {
    this.active_shop_id = this.shop_id;
  }

  if (!this.active_shop_id && assigned.length > 0) {
    this.active_shop_id = assigned[0];
  }

  if (!this.shop_id && this.active_shop_id) {
    this.shop_id = this.active_shop_id;
  }

  const active = this.active_shop_id ? this.active_shop_id.toString() : null;
  if (active && !assigned.includes(active)) {
    assigned.push(active);
  }

  this.assigned_shop_ids = [...new Set(assigned)];
});

// Compare plain password with stored hash
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password_hash);
};

module.exports = mongoose.model('User', userSchema);
