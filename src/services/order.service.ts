import {
  orderRepository,
  type OrderWithItems,
  type CreateOrderInput,
  type UpdateOrderInput,
  type CreateOrderItemInput
} from '../repositories/order.repository.js';
import { OrderSchema, type OrderCreate, type OrderUpdate } from '../schemas/order.schema.js';

export class OrderService {

  async createOrder(orderData: OrderCreate): Promise<OrderWithItems> {
    const validatedData = OrderSchema.create.parse(orderData);

    let calculatedTotal = 0;

    const items: CreateOrderItemInput[] = validatedData.items.map(item => {
      calculatedTotal += item.unit_price * item.quantity;

      const orderItem: CreateOrderItemInput = {
        variant_id: item.variant_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      };

      if (item.unit_cost !== undefined) orderItem.unit_cost = item.unit_cost;
      if (item.unit_packaging_cost !== undefined) orderItem.unit_packaging_cost = item.unit_packaging_cost;
      if (item.unit_platform_fee !== undefined) orderItem.unit_platform_fee = item.unit_platform_fee;

      return orderItem;
    });

    const createInput: CreateOrderInput = {
      total_amount: calculatedTotal,
      items,
    };

    if (validatedData.nuvemshop_order_id !== undefined) createInput.nuvemshop_order_id = validatedData.nuvemshop_order_id;
    if (validatedData.customer_name !== undefined) createInput.customer_name = validatedData.customer_name;
    if (validatedData.status !== undefined) createInput.status = validatedData.status;

    return await orderRepository.create(createInput);
  }

  async getOrderById(id: string): Promise<OrderWithItems | null> {
    return await orderRepository.findById(id);
  }

  async updateOrder(id: string, orderData: OrderUpdate): Promise<OrderWithItems | null> {
    const validatedData = OrderSchema.update.parse(orderData);

    const existingOrder = await orderRepository.findById(id);
    if (!existingOrder) {
      throw new Error('Order not found');
    }

    const updateData: UpdateOrderInput = {};

    if (validatedData.customer_name !== undefined) updateData.customer_name = validatedData.customer_name;
    if (validatedData.status !== undefined) updateData.status = validatedData.status;

    return await orderRepository.update(id, updateData);
  }

  async deleteOrder(id: string): Promise<boolean> {
    const existingOrder = await orderRepository.findById(id);
    if (!existingOrder) {
      throw new Error('Order not found');
    }

    if (existingOrder.status === 'CANCELED') {
      throw new Error('Order is already canceled');
    }

    return await orderRepository.delete(id);
  }

  async getOrders(
    page: number = 1,
    limit: number = 10,
    filters: { status?: string; search?: string } = {}
  ): Promise<{ orders: OrderWithItems[]; total: number; page: number; limit: number }> {
    return await orderRepository.findAll(page, limit, filters);
  }
}

export const orderService = new OrderService();