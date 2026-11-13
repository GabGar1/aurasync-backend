import { creditFeeRepository } from '../repositories/credit-fee.repository.js';
import { CreditFeeSchema, type CreditFeeCreate, type CreditFeeUpdate } from '../schemas/credit-fee.schema.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';

export class CreditFeeService {
  async listTiers() {
    return creditFeeRepository.listAll();
  }

  async createTier(data: CreditFeeCreate) {
    const v = CreditFeeSchema.create.parse(data);
    if (await creditFeeRepository.existsForInstallments(v.installments)) {
      throw new ConflictError('A credit fee tier for this number of installments already exists');
    }
    return creditFeeRepository.create(v);
  }

  async updateTier(id: string, data: CreditFeeUpdate) {
    const v = CreditFeeSchema.update.parse(data);
    const existing = await creditFeeRepository.findById(id);
    if (!existing) throw new NotFoundError('Credit fee tier not found');
    return creditFeeRepository.update(id, v);
  }
}

export const creditFeeService = new CreditFeeService();
