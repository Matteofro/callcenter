/**
 * Typed realtime events emitted on the SSE channel.
 * Keep the union shape stable — the client switches on `type`.
 */

export type RealtimeEventType =
  | "customer.updated"
  | "order.updated"
  | "shipment.updated"
  | "call.updated"
  | "upsell.created"
  | "logistics.issue";

export interface RealtimeEventBase {
  id: string;
  type: RealtimeEventType;
  publishedAt: string; // ISO
  /** UUID of the affected entity */
  entityId: string;
  /** Optional related ids — eg. customer id when type=shipment.updated */
  related?: {
    customerId?: string;
    orderId?: string;
    shipmentId?: string;
  };
}

export interface CustomerUpdatedEvent extends RealtimeEventBase {
  type: "customer.updated";
}

export interface OrderUpdatedEvent extends RealtimeEventBase {
  type: "order.updated";
}

export interface ShipmentUpdatedEvent extends RealtimeEventBase {
  type: "shipment.updated";
  /** Convenience snapshot of the new delivery status */
  deliveryStatus?: string;
}

export interface CallUpdatedEvent extends RealtimeEventBase {
  type: "call.updated";
  status?: string;
}

export interface UpsellCreatedEvent extends RealtimeEventBase {
  type: "upsell.created";
  outcome?: string;
}

export interface LogisticsIssueEvent extends RealtimeEventBase {
  type: "logistics.issue";
  issue: "delayed" | "refused" | "lost" | "returned" | "exception";
}

export type RealtimeEvent =
  | CustomerUpdatedEvent
  | OrderUpdatedEvent
  | ShipmentUpdatedEvent
  | CallUpdatedEvent
  | UpsellCreatedEvent
  | LogisticsIssueEvent;
