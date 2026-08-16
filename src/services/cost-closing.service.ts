import { costClosingRepository } from '../repositories/cost-closing.repository.js';
import { computeMonthlyAllocations } from '../lib/monthly-cost-engine.js';
import { z } from 'zod';

const CloseMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function resolvePeriod(input: { month?: string | undefined; start_date?: string | undefined; end_date?: string | undefined }): { start: string; end: string } {
  if (input.month) {
    const [y, m] = input.month.split('-').map(Number);
    const start = new Date(Date.UTC(y!, m! - 1, 1));
    const end = new Date(Date.UTC(y!, m!, 1));
    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    };
  }
  const start = new Date(`${input.start_date!}T00:00:00.000Z`);
  const end = new Date(`${input.end_date!}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    start: input.start_date!,
    end: end.toISOString().slice(0, 10),
  };
}

export class CostClosingService {
  async closeMonth(input: { month?: string | undefined; start_date?: string | undefined; end_date?: string | undefined }) {
    const v = CloseMonthSchema.parse(input);
    if (!v.month && (!v.start_date || !v.end_date)) {
      throw new Error('Provide month or start_date+end_date');
    }

    const { start, end } = resolvePeriod(v);

    const components = await costClosingRepository.listMonthlyComponents(start, end);
    const agg = await costClosingRepository.aggregateOrders(start, end);
    const allocations = computeMonthlyAllocations(components, agg);

    await costClosingRepository.applyAllocations(allocations, start, end);
    return {
      period: { start, end },
      components: components.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        allocation_basis: c.allocation_basis,
      })),
      orders: agg.order_count,
      products: agg.product_count,
      allocations: allocations.length,
    };
  }
}

export const costClosingService = new CostClosingService();
