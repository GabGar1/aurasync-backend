import { db } from '../lib/db.js';
import type { Knex } from 'knex';

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  password_hash: string;
  role: string;
  deleted_at?: Date | null;
  created_at: Date;
  updated_at: Date;
  status: boolean;
}

export interface CreateUserInput {
  first_name: string;
  last_name: string;
  email: string;
  password_hash: string;
  role?: string;
  status: boolean;
}

export interface UpdateUserInput {
  first_name?: string;
  last_name?: string;
  role?: string;
  status?: boolean;
}

export class UserRepository {
  private tableName = 'users';

  async findById(id: string): Promise<User | null> {
    const user = await db(this.tableName)
      .where({ id })
      .whereNull('deleted_at')
      .first();
    
    return user || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await db(this.tableName)
      .where({ email })
      .whereNull('deleted_at')
      .first();
    
    return user || null;
  }

  async create(userData: CreateUserInput): Promise<User> {
    const [user] = await db(this.tableName)
      .insert({
        ...userData,
        role: userData.role || 'EMPLOYEE',
      })
      .returning('*');
    
    return user;
  }

  async update(id: string, userData: UpdateUserInput): Promise<User | null> {
    const [user] = await db(this.tableName)
      .where({ id })
      .whereNull('deleted_at')
      .update({
        ...userData,
        updated_at: new Date(),
      })
      .returning('*');
    
    return user || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await db(this.tableName)
      .where({ id })
      .update({
        deleted_at: new Date(),
        updated_at: new Date(),
        status: false,
      });
    
    return result > 0;
  }

  async hardDelete(id: string): Promise<boolean> {
    const result = await db(this.tableName)
      .where({ id })
      .del();
    
    return result > 0;
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
    filters: {
      role?: string;
      search?: string;
    } = {}
  ): Promise<{ users: User[]; total: number; page: number; limit: number }> {
    let query = db(this.tableName)
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');

    if (filters.role) {
      query = query.where('role', filters.role);
    }

    if (filters.search) {
      query = query.where((builder: Knex.QueryBuilder) => {
        builder.where('first_name', 'ilike', `%${filters.search}%`)
          .orWhere('last_name', 'ilike', `%${filters.search}%`)
          .orWhere('email', 'ilike', `%${filters.search}%`);
      });
    }

    const totalQuery = query.clone().clearOrder().clearSelect().count('* as count');
    const totalResult = await totalQuery.first();
    const total = Number(totalResult?.count || 0);

    const offset = (page - 1) * limit;
    const users = await query.limit(limit).offset(offset);

    return {
      users,
      total,
      page,
      limit,
    };
  }

  async updatePassword(id: string, passwordHash: string): Promise<boolean> {
    const result = await db(this.tableName)
      .where({ id })
      .whereNull('deleted_at')
      .update({
        password_hash: passwordHash,
        updated_at: new Date(),
      });
    
    return result > 0;
  }

  async emailExists(email: string, excludeId?: string): Promise<boolean> {
    let query = db(this.tableName)
      .where({ email })
      .whereNull('deleted_at');

    if (excludeId) {
      query = query.whereNot('id', excludeId);
    }

    const user = await query.first();
    return !!user;
  }

  async getUsersByRole(role: string): Promise<User[]> {
    return db(this.tableName)
      .where({ role })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');
  }

  async getUserStats(): Promise<{
    total: number;
    byRole: Record<string, number>;
    recent: number;
  }> {
    const total = await db(this.tableName)
      .whereNull('deleted_at')
      .count('* as count')
      .first();

    const byRole = await db(this.tableName)
      .whereNull('deleted_at')
      .select('role')
      .count('* as count')
      .groupBy('role');

    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 30);
    const recent = await db(this.tableName)
      .whereNull('deleted_at')
      .where('created_at', '>=', recentDate)
      .count('* as count')
      .first();

    const roleStats: Record<string, number> = {};
    byRole.forEach(stat => {
      if (stat.role) {
        roleStats[stat.role] = Number(stat.count);
      }
    });

    return {
      total: Number(total?.count || 0),
      byRole: roleStats,
      recent: Number(recent?.count || 0),
    };
  }
}

export const userRepository = new UserRepository();