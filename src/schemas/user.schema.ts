import { z } from 'zod';

export const UserSchema = {
  // Base user schema for database operations
  base: z.object({
    id: z.uuid(),
    email: z.email('Invalid email format'),
    username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username cannot exceed 50 characters'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    first_name: z.string().min(1, 'First name is required').max(100, 'First name cannot exceed 100 characters'),
    last_name: z.string().min(1, 'Last name is required').max(100, 'Last name cannot exceed 100 characters'),
    created_at: z.date().optional(),
    updated_at: z.date().optional(),
    status: z.boolean().default(true),
  }),

  // Registration schema
  register: z.object({
    email: z.email('Invalid email format'),
    username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username cannot exceed 50 characters'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    first_name: z.string().min(1, 'First name is required').max(100, 'First name cannot exceed 100 characters'),
    last_name: z.string().min(1, 'Last name is required').max(100, 'Last name cannot exceed 100 characters'),
  }),

  // Login schema
  login: z.object({
    email: z.email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
  }),

  // Update profile schema (all fields optional)
  update: z.object({
    username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username cannot exceed 50 characters').optional(),
    first_name: z.string().min(1, 'First name is required').max(100, 'First name cannot exceed 100 characters').optional(),
    last_name: z.string().min(1, 'Last name is required').max(100, 'Last name cannot exceed 100 characters').optional(),
    status: z.boolean().optional(),
  }),

  // Change password schema
  changePassword: z.object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(6, 'New password must be at least 6 characters'),
  }),

  // User response schema (excludes sensitive data)
  response: z.object({
    id: z.uuid(),
    email: z.email(),
    username: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    created_at: z.date(),
    updated_at: z.date(),
  }),

  // User list response schema
  listResponse: z.object({
    users: z.array(z.object({
      id: z.number(),
      email: z.email(),
      username: z.string(),
      first_name: z.string(),
      last_name: z.string(),
      created_at: z.date(),
      updated_at: z.date(),
    })),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  }),
};

// Type exports for TypeScript inference
export type User = z.infer<typeof UserSchema.base>;
export type UserRegister = z.infer<typeof UserSchema.register>;
export type UserLogin = z.infer<typeof UserSchema.login>;
export type UserUpdate = z.infer<typeof UserSchema.update>;
export type UserChangePassword = z.infer<typeof UserSchema.changePassword>;
export type UserResponse = z.infer<typeof UserSchema.response>;
export type UserListResponse = z.infer<typeof UserSchema.listResponse>;