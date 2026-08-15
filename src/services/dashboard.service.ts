import { dashboardRepository } from "../repositories/dashboard.repository.js";
import { translateFulfillmentStatus } from "../lib/order-status.js";

export class DashboardService {
  async getStockStats(days = 30) {
    const [lowStock, noSales, turnover, stockValue, deadStock] =
      await Promise.all([
        dashboardRepository.getLowStock(),
        dashboardRepository.getNoSales30d(days),
        dashboardRepository.getTurnoverRate(days),
        dashboardRepository.getStockValueByCategory(),
        dashboardRepository.getDeadStock(90),
      ]);

    return {
      low_stock: lowStock,
      no_sales_30d: noSales,
      turnover_rate: turnover,
      stock_value_by_category: stockValue,
      dead_stock: deadStock,
    };
  }

  async getMarketingStats(days = 30, dates: { start_date?: string; end_date?: string } = {}) {
    return dashboardRepository.getMarketingStats(days, dates);
  }

  async getOrdersStats(days = 30, dates: { start_date?: string; end_date?: string } = {}) {
    const stats = await dashboardRepository.getOrdersStats(days, dates);
    stats.by_status = stats.by_status.map((s: any) => ({
      ...s,
      status_label: translateFulfillmentStatus(s.status),
    }));
    return stats;
  }
}

export const dashboardService = new DashboardService();
