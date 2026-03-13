const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Staff & Inventory Management API',
      version: '1.0.0',
      description:
        'REST API for managing staff rotas, attendance (GPS + Biometric punch-in), and inventory with role-based access control.',
      contact: {
        name: 'API Support',
        email: 'root@org.com',
      },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local development' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token (from POST /api/auth/login)',
        },
      },
      schemas: {
        // ── Auth ──
        LoginRequest: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', example: 'root@org.com' },
            password: { type: 'string', example: 'Root@1234' },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            token: { type: 'string' },
            must_change_password: { type: 'boolean' },
            user: { $ref: '#/components/schemas/UserPublic' },
          },
        },

        // ── Role ──
        Role: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            role_name: { type: 'string', example: 'Manager' },
            permissions: {
              type: 'object',
              example: {
                can_create_users: false,
                can_view_all_staff: true,
                can_manage_rotas: true,
                can_manual_punch: true,
                can_manage_inventory: true,
                can_manage_shops: false,
                can_manage_roles: false,
              },
            },
          },
        },

        // ── Shop ──
        Shop: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string', example: 'Main Branch' },
            latitude: { type: 'number', example: 51.5074 },
            longitude: { type: 'number', example: -0.1278 },
            geofence_radius_m: { type: 'number', example: 150 },
          },
        },
        ShopInput: {
          type: 'object',
          required: ['name', 'latitude', 'longitude'],
          properties: {
            name: { type: 'string' },
            latitude: { type: 'number' },
            longitude: { type: 'number' },
            geofence_radius_m: { type: 'number', default: 100 },
          },
        },

        // ── User ──
        UserPublic: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string' },
            email: { type: 'string' },
            phone_code: { type: 'string' },
            phone_num: { type: 'string' },
            device_id: { type: 'string' },
            role_id: { $ref: '#/components/schemas/Role' },
            shop_id: { $ref: '#/components/schemas/Shop' },
            assigned_shop_ids: {
              type: 'array',
              items: { $ref: '#/components/schemas/Shop' },
            },
            is_active: { type: 'boolean' },
            must_change_password: { type: 'boolean' },
          },
        },
        CreateUserRequest: {
          type: 'object',
          required: ['name', 'email', 'password', 'role_id'],
          properties: {
            name: { type: 'string', example: 'Jane Doe' },
            email: { type: 'string', example: 'jane@org.com' },
            password: { type: 'string', example: 'Temp@1234' },
            phone_code: { type: 'string', example: '+44' },
            phone_num: { type: 'string', example: '7000000099' },
            role_id: { type: 'string' },
            device_id: { type: 'string' },
            shop_id: { type: 'string' },
            assigned_shop_ids: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        PasswordUpdateRequest: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 8 },
          },
        },
        AssignedShopStaffSummaryResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            scope: {
              type: 'object',
              properties: {
                all: { type: 'boolean' },
                shop_ids: { type: 'array', items: { type: 'string' } },
              },
            },
            totals: {
              type: 'object',
              properties: {
                shops: { type: 'integer' },
                users: { type: 'integer' },
              },
            },
            by_shop: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  shop: { $ref: '#/components/schemas/Shop' },
                  user_count: { type: 'integer' },
                  users: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        name: { type: 'string' },
                        email: { type: 'string' },
                        role_name: { type: 'string' },
                        shop_id: { type: 'string' },
                        assigned_shop_ids: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },

        // ── Rota ──
        Rota: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            user_id: { $ref: '#/components/schemas/UserPublic' },
            shop_id: { $ref: '#/components/schemas/Shop' },
            shift_date: { type: 'string', format: 'date' },
            start_time: { type: 'string', example: '09:00' },
            end_time: { type: 'string', example: '17:00' },
            note: { type: 'string' },
          },
        },
        RotaInput: {
          type: 'object',
          required: ['user_id', 'shop_id', 'shift_date', 'start_time'],
          properties: {
            user_id: { type: 'string' },
            shop_id: { type: 'string' },
            shift_date: { type: 'string', format: 'date' },
            start_time: { type: 'string', example: '09:00' },
            end_time: { type: 'string', example: '17:00' },
            note: { type: 'string' },
          },
        },
        BulkRotaRequest: {
          type: 'object',
          required: ['shop_id', 'week_start', 'days', 'assignments'],
          properties: {
            shop_id: { type: 'string' },
            week_start: { type: 'string', format: 'date', example: '2026-03-16', description: 'Any date — snapped to that ISO week Monday' },
            days: {
              type: 'array',
              items: { type: 'integer', minimum: 0, maximum: 6 },
              description: '0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun',
              example: [0, 1, 2, 3, 4],
            },
            assignments: {
              type: 'array',
              description: 'Each assignment is applied to every selected day. Multiple entries for same user = split shifts.',
              items: {
                type: 'object',
                required: ['user_id', 'start_time'],
                properties: {
                  user_id: { type: 'string' },
                  start_time: { type: 'string', example: '09:00' },
                  end_time: { type: 'string', example: '17:00' },
                  note: { type: 'string', example: 'Opening shift' },
                },
              },
            },
            replace_existing: {
              type: 'boolean',
              default: false,
              description: 'If true: delete the specified users\' full week first, then re-insert. Use to re-publish a week.',
            },
          },
        },
        BulkRotaResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            created: { type: 'integer', description: 'Number of new rota records inserted' },
            skipped: { type: 'integer', description: 'Number of entries skipped due to conflicts' },
            conflicts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  user_id: { type: 'string' },
                  date: { type: 'string' },
                  start_time: { type: 'string' },
                  reason: { type: 'string' },
                },
              },
            },
            message: { type: 'string' },
          },
        },
        WeekViewResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            week_start: { type: 'string' },
            week_end: { type: 'string' },
            shop_id: { type: 'string' },
            days: {
              type: 'object',
              description: 'Keys are day labels (e.g. "Mon 16 Mar"), values are arrays of Rota records',
              additionalProperties: {
                type: 'array',
                items: { $ref: '#/components/schemas/Rota' },
              },
            },
          },
        },
        DashboardResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            week_start: { type: 'string' },
            week_end: { type: 'string' },
            total_shifts: { type: 'integer' },
            by_shop: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  shop: { $ref: '#/components/schemas/Shop' },
                  days: {
                    type: 'object',
                    description: 'Keys: "Mon 16 Mar" etc. Values: shift entries for that day',
                    additionalProperties: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
            by_employee: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  user: { $ref: '#/components/schemas/UserPublic' },
                  shifts: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        rota_id: { type: 'string' },
                        date: { type: 'string', format: 'date' },
                        shop: { $ref: '#/components/schemas/Shop' },
                        start_time: { type: 'string' },
                        end_time: { type: 'string' },
                        note: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },

        // ── Attendance ──
        Attendance: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            user_id: { $ref: '#/components/schemas/UserPublic' },
            shop_id: { $ref: '#/components/schemas/Shop' },
            punch_in: { type: 'string', format: 'date-time' },
            punch_out: { type: 'string', format: 'date-time' },
            is_manual: { type: 'boolean' },
            manual_by: { $ref: '#/components/schemas/UserPublic' },
            punch_method: { type: 'string', enum: ['GPS+Biometric', 'Manual'] },
          },
        },
        VerifyLocationRequest: {
          type: 'object',
          required: ['shop_id', 'latitude', 'longitude'],
          properties: {
            shop_id: { type: 'string' },
            latitude: { type: 'number', example: 51.5074 },
            longitude: { type: 'number', example: -0.1278 },
          },
        },
        PunchInRequest: {
          type: 'object',
          required: ['shop_id', 'location_token', 'biometric_verified'],
          properties: {
            shop_id: { type: 'string' },
            location_token: { type: 'string' },
            biometric_verified: { type: 'boolean', example: true },
          },
        },
        ManualPunchInRequest: {
          type: 'object',
          required: ['user_id', 'shop_id'],
          properties: {
            user_id: { type: 'string' },
            shop_id: { type: 'string' },
          },
        },

        // ── Inventory ──
        InventoryItem: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            shop_id: { $ref: '#/components/schemas/Shop' },
            item_name: { type: 'string' },
            purchase_date: { type: 'string', format: 'date' },
            expiry_date: { type: 'string', format: 'date' },
            status: { type: 'string', enum: ['Good', 'Damaged', 'In Repair'] },
          },
        },
        InventoryItemInput: {
          type: 'object',
          required: ['shop_id', 'item_name'],
          properties: {
            shop_id: { type: 'string' },
            item_name: { type: 'string', example: 'Cash Register' },
            purchase_date: { type: 'string', format: 'date' },
            expiry_date: { type: 'string', format: 'date' },
            status: { type: 'string', enum: ['Good', 'Damaged', 'In Repair'], default: 'Good' },
          },
        },
        InventoryQuery: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            item_id: { $ref: '#/components/schemas/InventoryItem' },
            shop_id: { $ref: '#/components/schemas/Shop' },
            reported_by: { $ref: '#/components/schemas/UserPublic' },
            issue_note: { type: 'string' },
            status: { type: 'string', enum: ['Open', 'Resolved', 'Closed'] },
            repair_cost: { type: 'number' },
            resolve_note: { type: 'string' },
            resolved_by: { $ref: '#/components/schemas/UserPublic' },
            resolved_at: { type: 'string', format: 'date-time' },
          },
        },
        CreateQueryRequest: {
          type: 'object',
          required: ['item_id', 'issue_note'],
          properties: {
            item_id: { type: 'string' },
            shop_id: { type: 'string' },
            issue_note: { type: 'string', example: 'Screen cracked on impact' },
          },
        },
        CloseQueryRequest: {
          type: 'object',
          properties: {
            repair_cost: { type: 'number', example: 150 },
            resolve_note: { type: 'string', example: 'Replaced screen panel' },
          },
        },

        // ── Generic ──
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'], // JSDoc comments in route files
};

const swaggerSpec = swaggerJsdoc(options);
module.exports = swaggerSpec;
