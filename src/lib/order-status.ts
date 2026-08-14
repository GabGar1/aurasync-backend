import type { Order, OrderItem } from '../repositories/order.repository.js';

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  CANCELED: 'Cancelado',
  open: 'Em aberto',
  closed: 'Concluído',
  cancelled: 'Cancelado',
  paid: 'Pago',
  shipped: 'Enviado',
};

const PAYMENT_LABELS: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
  voided: 'Estornado',
  PENDING: 'Pendente',
  PAID: 'Pago',
  CANCELED: 'Cancelado',
};

const FULFILLMENT_LABELS: Record<string, string> = {
  pending: 'Pendente',
  shipped: 'Enviado',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
  PENDING: 'Pendente',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  CANCELED: 'Cancelado',
};

export function translateOrderStatus(status: string | null | undefined): string {
  if (!status) return 'Sem status';
  return STATUS_LABELS[status] || status;
}

export function translatePaymentStatus(status: string | null | undefined): string {
  if (!status) return 'Sem status';
  return PAYMENT_LABELS[status] || status;
}

export function translateFulfillmentStatus(status: string | null | undefined): string {
  if (!status) return 'Sem status';
  return FULFILLMENT_LABELS[status] || status;
}

export function deriveCommercialStatus(status: string | null | undefined): string {
  switch (status) {
    case 'CANCELED':
    case 'cancelled':
      return 'Cancelado';
    case 'PAID':
    case 'DELIVERED':
    case 'closed':
    case 'paid':
      return 'Venda concretizada';
    case 'SHIPPED':
    case 'shipped':
      return 'Enviado';
    default:
      return 'Em aberto';
  }
}

export function enrichOrderItem(item: OrderItem) {
  return {
    ...item,
    unit_total_cost: Number(item.unit_total_cost || 0),
    unit_profit: Number(item.unit_profit || 0),
    margin_percent: Number(item.margin_percent || 0),
  };
}

export function enrichOrder(order: Order & { items: OrderItem[] }) {
  return {
    ...order,
    status_label: translateOrderStatus(order.status),
    payment_status_label: translatePaymentStatus(order.payment_status),
    fulfillment_status_label: translateFulfillmentStatus(order.fulfillment_status),
    commercial_status: deriveCommercialStatus(order.status),
    total_cost: Number(order.total_cost || 0),
    total_profit: Number(order.total_profit || 0),
    margin_percent: Number(order.margin_percent || 0),
    is_fair: (order as any).is_fair ?? false,
    monthly_cost_total: Number((order as any).monthly_cost_total || 0),
    total_cost_with_monthly: Number(order.total_cost || 0) + Number((order as any).monthly_cost_total || 0),
    monthly_allocations: (order as any).monthly_allocations ?? [],
    items: order.items.map(enrichOrderItem),
  };
}
