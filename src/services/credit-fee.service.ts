import { creditFeeRepository } from '../repositories/credit-fee.repository.js';
import { CreditFeeSchema, type CreditFeeUpdate } from '../schemas/credit-fee.schema.js';

export class CreditFeeService {
  async listTiers() {
    return creditFeeRepository.listActive();
  }

  async updateTier(id: string, data: CreditFeeUpdate) {
    const v = CreditFeeSchema.update.parse(data);
    const existing = await creditFeeRepository.findById(id);
    if (!existing) throw new Error('Credit fee tier not found');
    return creditFeeRepository.update(id, v);
  }
}

export const creditFeeService = new CreditFeeService();
