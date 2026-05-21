/**
 * Italian labels for every enum used in the UI.
 *
 * Keep this file in sync with prisma/schema.prisma. Every status in the
 * Prisma enum has exactly one entry here.
 */
import type {
  CallStatus,
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  ShipmentDeliveryStatus,
  CustomerStatus,
  UpsellOutcomeStatus,
  UpsellKind,
  UserRole,
  LogisticsEventType,
} from "@prisma/client";

export type Tone = "default" | "success" | "warning" | "destructive" | "muted" | "secondary";

// ─── Call status ─────────────────────────────────────────────────────────
export const callStatusLabel: Record<CallStatus, string> = {
  TO_CALL: "Da chiamare",
  ANSWERED: "Risposto",
  NO_ANSWER: "Non risposto",
  WRONG_NUMBER: "Numero errato",
  BUSY: "Occupato",
  CALL_LATER: "Richiamare",
  CALLBACK_SCHEDULED: "Call back programmato",
  ORDER_CONFIRMED: "Ordine confermato",
  ORDER_CANCELLED: "Ordine annullato",
  RETURN_REQUESTED: "Reso richiesto",
  REFUND_REQUESTED: "Rimborso richiesto",
  SHIPPING_ISSUE: "Problema spedizione",
  UPSELL_DONE: "Upsell effettuato",
  CROSSSELL_DONE: "Cross-sell effettuato",
  NOT_INTERESTED: "Cliente non interessato",
  COMPLAINT_OPENED: "Reclamo aperto",
  CASE_RESOLVED: "Caso risolto",
};

export const callStatusTone: Record<CallStatus, Tone> = {
  TO_CALL: "default",
  ANSWERED: "secondary",
  NO_ANSWER: "muted",
  WRONG_NUMBER: "destructive",
  BUSY: "muted",
  CALL_LATER: "warning",
  CALLBACK_SCHEDULED: "warning",
  ORDER_CONFIRMED: "success",
  ORDER_CANCELLED: "destructive",
  RETURN_REQUESTED: "warning",
  REFUND_REQUESTED: "warning",
  SHIPPING_ISSUE: "destructive",
  UPSELL_DONE: "success",
  CROSSSELL_DONE: "success",
  NOT_INTERESTED: "muted",
  COMPLAINT_OPENED: "destructive",
  CASE_RESOLVED: "success",
};

// ─── Order status ────────────────────────────────────────────────────────
export const orderStatusLabel: Record<OrderStatus, string> = {
  CREATED: "Creato",
  CONFIRMED: "Confermato",
  PROCESSING: "In lavorazione",
  SHIPPED: "Spedito",
  IN_TRANSIT: "In transito",
  OUT_FOR_DELIVERY: "In consegna",
  DELIVERED: "Consegnato",
  RETURNED: "Reso",
  CANCELLED: "Annullato",
  ON_HOLD: "In attesa",
};

export const orderStatusTone: Record<OrderStatus, Tone> = {
  CREATED: "muted",
  CONFIRMED: "secondary",
  PROCESSING: "secondary",
  SHIPPED: "default",
  IN_TRANSIT: "default",
  OUT_FOR_DELIVERY: "warning",
  DELIVERED: "success",
  RETURNED: "warning",
  CANCELLED: "destructive",
  ON_HOLD: "muted",
};

// ─── Payment ─────────────────────────────────────────────────────────────
export const paymentStatusLabel: Record<PaymentStatus, string> = {
  PENDING: "In attesa",
  PAID: "Pagato",
  REFUNDED: "Rimborsato",
  FAILED: "Fallito",
};

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  COD: "Contrassegno",
  CARD: "Carta",
  BANK_TRANSFER: "Bonifico",
  OTHER: "Altro",
};

// ─── Shipment ────────────────────────────────────────────────────────────
export const shipmentStatusLabel: Record<ShipmentDeliveryStatus, string> = {
  PENDING: "In attesa",
  IN_TRANSIT: "In transito",
  OUT_FOR_DELIVERY: "In consegna",
  DELIVERED: "Consegnato",
  REFUSED: "Rifiutato",
  RETURNED: "Reso al mittente",
  LOST: "Smarrito",
  DELAYED: "In ritardo",
  EXCEPTION: "Anomalia",
};

export const shipmentStatusTone: Record<ShipmentDeliveryStatus, Tone> = {
  PENDING: "muted",
  IN_TRANSIT: "default",
  OUT_FOR_DELIVERY: "warning",
  DELIVERED: "success",
  REFUSED: "destructive",
  RETURNED: "destructive",
  LOST: "destructive",
  DELAYED: "warning",
  EXCEPTION: "destructive",
};

// ─── Customer ────────────────────────────────────────────────────────────
export const customerStatusLabel: Record<CustomerStatus, string> = {
  ACTIVE: "Attivo",
  BLOCKED: "Bloccato",
  VIP: "VIP",
  NEW: "Nuovo",
};

export const customerStatusTone: Record<CustomerStatus, Tone> = {
  ACTIVE: "secondary",
  BLOCKED: "destructive",
  VIP: "success",
  NEW: "default",
};

// ─── Upsell ──────────────────────────────────────────────────────────────
export const upsellOutcomeLabel: Record<UpsellOutcomeStatus, string> = {
  ACCEPTED: "Accettato",
  REJECTED: "Rifiutato",
  DEFERRED: "Rimandato",
};

export const upsellOutcomeTone: Record<UpsellOutcomeStatus, Tone> = {
  ACCEPTED: "success",
  REJECTED: "destructive",
  DEFERRED: "warning",
};

export const upsellKindLabel: Record<UpsellKind, string> = {
  RELATED: "Correlato",
  BUNDLE: "Bundle",
  COMPLEMENT: "Complemento",
  UPGRADE: "Upgrade",
};

// ─── User ────────────────────────────────────────────────────────────────
export const userRoleLabel: Record<UserRole, string> = {
  OPERATOR: "Operatore",
  SUPERVISOR: "Supervisore",
  ADMIN: "Amministratore",
};

// ─── Logistics event ─────────────────────────────────────────────────────
export const logisticsEventLabel: Record<LogisticsEventType, string> = {
  SHIPMENT_CREATED: "Spedizione creata",
  SHIPMENT_PICKED_UP: "Ritirato dal corriere",
  SHIPMENT_IN_TRANSIT: "In transito",
  SHIPMENT_OUT_FOR_DELIVERY: "In consegna",
  SHIPMENT_DELIVERED: "Consegnato",
  SHIPMENT_REFUSED: "Rifiutato",
  SHIPMENT_RETURNED: "Reso al mittente",
  SHIPMENT_LOST: "Smarrito",
  SHIPMENT_DELAYED: "In ritardo",
  SHIPMENT_EXCEPTION: "Anomalia",
  ORDER_UPDATED: "Ordine aggiornato",
  CUSTOMER_UPDATED: "Cliente aggiornato",
  UNKNOWN: "Evento sconosciuto",
};
