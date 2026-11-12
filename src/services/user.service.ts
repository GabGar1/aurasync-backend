import bcrypt from 'bcrypt';
import { userRepository, type User, type CreateUserInput, type UpdateUserInput } from '../repositories/user.repository.js';
import { UserSchema, type UserRegister, type UserLogin, type UserUpdate, type UserChangePassword, type UserResponse, type UserListResponse } from '../schemas/user.schema.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';

export class UserService {
  private saltRounds = 12;

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  private sanitizeUser(user: User): Omit<User, 'password_hash' | 'token_version'> & { first_name: string; last_name: string } {
    // Credentials and session internals never leave the service.
    const { password_hash: _hash, token_version: _tv, ...sanitizedUser } = user;
    
    const first_name = user.first_name;
    const last_name = user.last_name;
    
    return {
      ...sanitizedUser,
      first_name,
      last_name,
    };
  }

  async createUser(userData: UserRegister): Promise<Omit<User, 'password_hash' | 'token_version'> & { first_name: string; last_name: string }> {
    const validatedData = UserSchema.register.parse(userData);

    const existingUser = await userRepository.findByEmail(validatedData.email);
    if (existingUser) {
      throw new ConflictError('Email already registered');
    }

    const passwordHash = await this.hashPassword(validatedData.password);

    const createInput: CreateUserInput = {
      first_name: validatedData.first_name,
      last_name: validatedData.last_name,
      email: validatedData.email,
      password_hash: passwordHash,
      role: validatedData.role || 'EMPLOYEE',
      status: true
    };

    const user = await userRepository.create(createInput);
    return this.sanitizeUser(user);
  }

  async authenticateUser(credentials: UserLogin): Promise<Omit<User, 'password_hash' | 'token_version'> & { first_name: string; last_name: string } | null> {
    const validatedCredentials = UserSchema.login.parse(credentials);

    const user = await userRepository.findByEmail(validatedCredentials.email);
    if (!user) {
      return null;
    }

    const isValidPassword = await this.verifyPassword(validatedCredentials.password, user.password_hash);
    if (!isValidPassword) {
      return null;
    }

    if (!user.status) {
      return null;
    }

    return this.sanitizeUser(user);
  }

  async getUserById(id: string): Promise<Omit<User, 'password_hash' | 'token_version'> & { first_name: string; last_name: string } | null> {
    const user = await userRepository.findById(id);
    return user ? this.sanitizeUser(user) : null;
  }

  /**
   * Refuses changes that would leave the system without an active SUPER_ADMIN.
   * `remainsSuperAdmin` describes the target after the change.
   */
  private async assertNotLastSuperAdmin(target: User, remainsSuperAdmin: boolean): Promise<void> {
    const isActiveSuperAdmin = target.role === 'SUPER_ADMIN' && target.status;
    if (!isActiveSuperAdmin || remainsSuperAdmin) return;
    if ((await userRepository.countActiveSuperAdmins()) <= 1) {
      throw new ConflictError('Cannot remove the last active SUPER_ADMIN');
    }
  }

  /** @param actorId the user performing the change, when it comes from the API */
  async updateUser(id: string, userData: UserUpdate, actorId?: string): Promise<Omit<User, 'password_hash' | 'token_version'> & { first_name: string; last_name: string } | null> {
    const validatedData = UserSchema.update.parse(userData);

    const existingUser = await userRepository.findById(id);
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    if (actorId === id && validatedData.status === false) {
      throw new BadRequestError('You cannot deactivate your own account');
    }
    const nextRole = validatedData.role ?? existingUser.role;
    const nextStatus = validatedData.status ?? existingUser.status;
    await this.assertNotLastSuperAdmin(existingUser, nextRole === 'SUPER_ADMIN' && nextStatus);

    const updateData: UpdateUserInput = {};

    if (validatedData.first_name) {
      updateData.first_name = validatedData.first_name;
    }

    if (validatedData.last_name) {
      updateData.last_name = validatedData.last_name;
    }

    if (validatedData.role !== undefined) {
      updateData.role = validatedData.role;
    }

    if (validatedData.status !== undefined) {
      updateData.status = validatedData.status;
    }

    const updatedUser = await userRepository.update(id, updateData);
    return updatedUser ? this.sanitizeUser(updatedUser) : null;
  }

  async changePassword(id: string, passwordData: UserChangePassword): Promise<boolean> {
    const validatedData = UserSchema.changePassword.parse(passwordData);

    const user = await userRepository.findById(id);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const isValidPassword = await this.verifyPassword(validatedData.current_password, user.password_hash);
    if (!isValidPassword) {
      throw new BadRequestError('Current password is incorrect');
    }

    const newPasswordHash = await this.hashPassword(validatedData.new_password);

    return userRepository.updatePassword(id, newPasswordHash);
  }

  /** Admin reset: no current password; revokes every session of the user. */
  async resetPassword(id: string, newPassword: string): Promise<boolean> {
    const { new_password } = UserSchema.resetPassword.parse({ new_password: newPassword });
    const user = await userRepository.findById(id);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return userRepository.updatePassword(id, await this.hashPassword(new_password));
  }

  async getAuthState(id: string) {
    return userRepository.getAuthState(id);
  }

  /** Invalidates every token issued so far for the user (logout). */
  async revokeSessions(id: string): Promise<void> {
    await userRepository.incrementTokenVersion(id);
  }

  /** @param actorId the user performing the deletion, when it comes from the API */
  async deleteUser(id: string, actorId?: string): Promise<boolean> {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    if (actorId === id) {
      throw new BadRequestError('You cannot delete your own account');
    }
    await this.assertNotLastSuperAdmin(user, false);

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
    users: (Omit<User, 'password_hash' | 'token_version'> & { first_name: string; last_name: string })[];
    total: number;
    page: number;
    limit: number;
  }> {
    const result = await userRepository.findAll(page, limit, filters);
    
    return {
      ...result,
       users: result.users.map(user => this.sanitizeUser(user)) as Array<Omit<User, 'password_hash' | 'token_version'> & { first_name: string; last_name: string }>,
    };
  }

  async getUsersByRole(role: string): Promise<(Omit<User, 'password_hash' | 'token_version'> & { first_name: string; last_name: string })[]> {
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