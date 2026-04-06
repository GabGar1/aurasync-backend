import bcrypt from 'bcrypt';
import { userRepository, type User, type CreateUserInput, type UpdateUserInput } from '../repositories/user.repository.js';
import { UserSchema, type UserRegister, type UserLogin, type UserUpdate, type UserChangePassword, type UserResponse, type UserListResponse } from '../schemas/user.schema.js';

export class UserService {
  private saltRounds = 12;

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  private sanitizeUser(user: User): Omit<User, 'password_hash'> & { first_name: string; last_name: string } {
    const { password_hash, ...sanitizedUser } = user;
    
    const first_name = user.first_name;
    const last_name = user.last_name;
    
    return {
      ...sanitizedUser,
      first_name,
      last_name,
    };
  }

  async createUser(userData: UserRegister): Promise<Omit<User, 'password_hash'> & { first_name: string; last_name: string }> {
    const validatedData = UserSchema.register.parse(userData);

    const existingUser = await userRepository.findByEmail(validatedData.email);
    if (existingUser) {
      throw new Error('Email already registered');
    }

    const passwordHash = await this.hashPassword(validatedData.password);

    const createInput: CreateUserInput = {
      first_name: validatedData.first_name,
      last_name: validatedData.last_name,
      email: validatedData.email,
      password_hash: passwordHash,
      role: 'EMPLOYEE', // Default role
      status: true
    };

    const user = await userRepository.create(createInput);
    return this.sanitizeUser(user);
  }

  async authenticateUser(credentials: UserLogin): Promise<Omit<User, 'password_hash'> & { first_name: string; last_name: string } | null> {
    const validatedCredentials = UserSchema.login.parse(credentials);

    const user = await userRepository.findByEmail(validatedCredentials.email);
    if (!user) {
      return null;
    }

    const isValidPassword = await this.verifyPassword(validatedCredentials.password, user.password_hash);
    if (!isValidPassword) {
      return null;
    }

    return this.sanitizeUser(user);
  }

  async getUserById(id: string): Promise<Omit<User, 'password_hash'> & { first_name: string; last_name: string } | null> {
    const user = await userRepository.findById(id);
    return user ? this.sanitizeUser(user) : null;
  }

  async updateUser(id: string, userData: UserUpdate): Promise<Omit<User, 'password_hash'> & { first_name: string; last_name: string } | null> {
    const validatedData = UserSchema.update.parse(userData);

    const existingUser = await userRepository.findById(id);
    if (!existingUser) {
      throw new Error('User not found');
    }

    const updateData: UpdateUserInput = {};

    if (validatedData.first_name) {
      updateData.first_name = validatedData.first_name;
    }

    if (validatedData.last_name) {
      updateData.last_name = validatedData.last_name;
    }

    const updatedUser = await userRepository.update(id, updateData);
    return updatedUser ? this.sanitizeUser(updatedUser) : null;
  }

  async changePassword(id: string, passwordData: UserChangePassword): Promise<boolean> {
    const validatedData = UserSchema.changePassword.parse(passwordData);

    const user = await userRepository.findById(id);
    if (!user) {
      throw new Error('User not found');
    }

    const isValidPassword = await this.verifyPassword(validatedData.current_password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Current password is incorrect');
    }

    const newPasswordHash = await this.hashPassword(validatedData.new_password);

    return userRepository.updatePassword(id, newPasswordHash);
  }

  async deleteUser(id: string): Promise<boolean> {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new Error('User not found');
    }

    return userRepository.delete(id);
  }

  async getUsers(
    page: number = 1,
    limit: number = 10,
    filters: {
      role?: string;
      search?: string;
    } = {}
  ): Promise<{
    users: (Omit<User, 'password_hash'> & { first_name: string; last_name: string })[];
    total: number;
    page: number;
    limit: number;
  }> {
    const result = await userRepository.findAll(page, limit, filters);
    
    return {
      ...result,
       users: result.users.map(user => this.sanitizeUser(user)) as Array<Omit<User, 'password_hash'> & { first_name: string; last_name: string }>,
    };
  }

  async getUsersByRole(role: string): Promise<(Omit<User, 'password_hash'> & { first_name: string; last_name: string })[]> {
    const users = await userRepository.getUsersByRole(role);
    return users.map(user => this.sanitizeUser(user));
  }

  async getUserStats(): Promise<{
    total: number;
    byRole: Record<string, number>;
    recent: number;
  }> {
    return userRepository.getUserStats();
  }

  async isEmailAvailable(email: string, excludeId?: string): Promise<boolean> {
    return !(await userRepository.emailExists(email, excludeId));
  }
}

export const userService = new UserService();