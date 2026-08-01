import { customerRepository, type UpsertCustomerInput } from '../repositories/customer.repository.js';

export class CustomerService {
  async upsertFromOrder(data: UpsertCustomerInput) {
    return customerRepository.upsertFromOrder(data);
  }

  async listCustomers(page = 1, limit = 20, filters: { search?: string } = {}) {
    return customerRepository.findAll(page, limit, filters);
  }

  async getCustomer(id: string) {
    const customer = await customerRepository.findById(id);
    if (!customer) return null;
    const indicators = await customerRepository.getIndicators(id);
    return { ...customer, indicators };
  }

  async getCustomerOrders(id: string) {
    const customer = await customerRepository.findById(id);
    if (!customer) return null;
    return customerRepository.findOrders(id);
  }
}

export const customerService = new CustomerService();
