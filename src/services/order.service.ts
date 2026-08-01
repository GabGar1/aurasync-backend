import {
  orderRepository,
  type CreateOrderInput,
  type UpdateOrderInput,
  type CreateOrderItemInput,
  type NuvemshopOrderData
} from '../repositories/order.repository.js';
import { OrderSchema, type OrderCreate, type OrderUpdate } from '../schemas/order.schema.js';
import { websocketManager } from '../lib/websocket.js';
import { customerService } from './customer.service.js';
import { enrichOrder } from '../lib/order-status.js';

type EnrichedOrder = ReturnType<typeof enrichOrder>;

export class OrderService {

  async createOrder(orderData: OrderCreate): Promise<EnrichedOrder> {
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

    const order = await orderRepository.create(createInput);
    return enrichOrder(order);
  }

  async getOrderById(id: string): Promise<EnrichedOrder | null> {
    const order = await orderRepository.findById(id);
    return order ? enrichOrder(order) : null;
  }

  async findByNuvemshopOrderId(nuvemshopOrderId: string) {
    return await orderRepository.findByNuvemshopOrderId(nuvemshopOrderId);
  }

  async updateOrder(id: string, orderData: OrderUpdate): Promise<EnrichedOrder | null> {
    const validatedData = OrderSchema.update.parse(orderData);

    const existingOrder = await orderRepository.findById(id);
    if (!existingOrder) {
      throw new Error('Order not found');
    }

    const updateData: UpdateOrderInput = {};

    if (validatedData.customer_name !== undefined) updateData.customer_name = validatedData.customer_name;
    if (validatedData.status !== undefined) updateData.status = validatedData.status;

    const updated = await orderRepository.update(id, updateData);
    return updated ? enrichOrder(updated) : null;
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
  ): Promise<{ orders: EnrichedOrder[]; total: number; page: number; limit: number }> {
    const result = await orderRepository.findAll(page, limit, filters);
    return { ...result, orders: result.orders.map(enrichOrder) };
  }

  async handleNuvemshopWebhook(data: NuvemshopOrderData): Promise<EnrichedOrder> {
    console.log(`Processing webhook for Nuvemshop order ID: ${data.id}`);

    const updatedOrder = await this.upsertOrderFromNuvemshop(data);

    // After the order is updated, notify all connected clients
    websocketManager.broadcast({
      event: 'orders_updated',
      message: `Order ${updatedOrder.id} was updated. Status: ${updatedOrder.status}`,
      orderId: updatedOrder.id
    });

    return updatedOrder;
  }

  async upsertOrderFromNuvemshop(data: NuvemshopOrderData): Promise<EnrichedOrder> {
    const order = await orderRepository.upsertOrderFromNuvemshop(data);

    try {
      await customerService.upsertFromOrder({
        email: data.contact_email ?? null,
        name: data.customer?.name ?? 'Cliente',
        city: data.shipping_address?.city ?? null,
        province: data.shipping_address?.province ?? null,
        payment_method: data.payment_details?.method ?? null,
        gateway: data.gateway ?? null,
        storefront: data.storefront ?? null,
        utm_source: data.customer_visit?.utm_parameters?.utm_source ?? null,
        utm_medium: data.customer_visit?.utm_parameters?.utm_medium ?? null,
        utm_campaign: data.customer_visit?.utm_parameters?.utm_campaign ?? null,
        total: Number(order.total_amount),
        date: order.created_at,
      });
    } catch (error) {
      console.error("Failed to upsert customer:", error);
    }

    return enrichOrder(order);
  }
}

export const orderService = new OrderService();
