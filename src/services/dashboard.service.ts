import { dashboardRepository } from "../repositories/dashboard.repository.js";

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

  async getMarketingStats(days = 30, dates: { start?: Date; end?: Date } = {}) {
    return dashboardRepository.getMarketingStats(days, dates);
  }

  async getOrdersStats(days = 30, dates: { start?: Date; end?: Date } = {}) {
    return dashboardRepository.getOrdersStats(days, dates);
  }
}

export const dashboardService = new DashboardService();
