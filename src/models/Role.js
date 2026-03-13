const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema(
  {
    role_name: {
      type: String,
      required: [true, 'Role name is required'],
      unique: true,
      trim: true,
      // e.g. Staff, Sub-Manager, Manager, Admin, Root
    },
    permissions: {
      type: Object,
      default: {
        can_manual_punch: false,
        can_view_all_staff: false,
        can_create_users: false,
        can_manage_inventory: false,
        can_manage_rotas: false,
        can_manage_shops: false,
        can_manage_roles: false,
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Role', roleSchema);
