import { z } from 'zod';

export const UserSchema = {
  base: z.object({
    id: z.uuid(),
    email: z.email('Invalid email format'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    first_name: z.string().min(1, 'First name is required').max(100, 'First name cannot exceed 100 characters'),
    last_name: z.string().min(1, 'Last name is required').max(100, 'Last name cannot exceed 100 characters'),
    created_at: z.date().optional(),
    updated_at: z.date().optional(),
    status: z.boolean().default(true),
  }),

  register: z.object({
    email: z.email('Invalid email format'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    first_name: z.string().min(1, 'First name is required').max(100, 'First name cannot exceed 100 characters'),
    last_name: z.string().min(1, 'Last name is required').max(100, 'Last name cannot exceed 100 characters'),
  }),

  login: z.object({
    email: z.email('Invalid email format'),
    password: z.string().min(1, 'Password is required'),
  }),

  update: z.object({
    first_name: z.string().min(1, 'First name is required').max(100, 'First name cannot exceed 100 characters').optional(),
    last_name: z.string().min(1, 'Last name is required').max(100, 'Last name cannot exceed 100 characters').optional(),
    status: z.boolean().optional(),
  }),

  changePassword: z.object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: z.string().min(8, 'New password must be at least 8 characters'),
  }),

  response: z.object({
    id: z.uuid(),
    email: z.email(),
    first_name: z.string(),
    last_name: z.string(),
    created_at: z.date(),
    updated_at: z.date(),
  }),

  listResponse: z.object({
    users: z.array(z.object({
      id: z.string().uuid(),
      email: z.email(),
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

export type User = z.infer<typeof UserSchema.base>;
export type UserRegister = z.infer<typeof UserSchema.register>;
export type UserLogin = z.infer<typeof UserSchema.login>;
export type UserUpdate = z.infer<typeof UserSchema.update>;
export type UserChangePassword = z.infer<typeof UserSchema.changePassword>;
export type UserResponse = z.infer<typeof UserSchema.response>;
export type UserListResponse = z.infer<typeof UserSchema.listResponse>;