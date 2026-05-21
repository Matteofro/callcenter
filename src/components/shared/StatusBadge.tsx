/**
 * Type-safe status badges for every enum we render. Drives colour tone from
 * the central i18n labels file so colour conventions stay consistent.
 */
import { Badge } from "@/components/ui/badge";
import {
  callStatusLabel,
  callStatusTone,
  orderStatusLabel,
  orderStatusTone,
  shipmentStatusLabel,
  shipmentStatusTone,
  customerStatusLabel,
  customerStatusTone,
  upsellOutcomeLabel,
  upsellOutcomeTone,
  paymentStatusLabel,
  type Tone,
} from "@/lib/i18n/labels";
import type {
  CallStatus,
  OrderStatus,
  ShipmentDeliveryStatus,
  CustomerStatus,
  UpsellOutcomeStatus,
  PaymentStatus,
} from "@prisma/client";

const toneToVariant: Record<Tone, "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "muted"> = {
  default: "default",
  secondary: "secondary",
  destructive: "destructive",
  muted: "muted",
  success: "success",
  warning: "warning",
};

export function CallStatusBadge({ status }: { status: CallStatus }) {
  return <Badge variant={toneToVariant[callStatusTone[status]]}>{callStatusLabel[status]}</Badge>;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={toneToVariant[orderStatusTone[status]]}>{orderStatusLabel[status]}</Badge>;
}

export function ShipmentStatusBadge({ status }: { status: ShipmentDeliveryStatus }) {
  return <Badge variant={toneToVariant[shipmentStatusTone[status]]}>{shipmentStatusLabel[status]}</Badge>;
}

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return <Badge variant={toneToVariant[customerStatusTone[status]]}>{customerStatusLabel[status]}</Badge>;
}

export function UpsellOutcomeBadge({ status }: { status: UpsellOutcomeStatus }) {
  return <Badge variant={toneToVariant[upsellOutcomeTone[status]]}>{upsellOutcomeLabel[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const variant = status === "PAID" ? "success" : status === "FAILED" ? "destructive" : status === "REFUNDED" ? "warning" : "muted";
  return <Badge variant={variant}>{paymentStatusLabel[status]}</Badge>;
}

export function RiskBadge({ score }: { score: number }) {
  if (score >= 70) return <Badge variant="destructive">Rischio alto · {score}</Badge>;
  if (score >= 40) return <Badge variant="warning">Rischio medio · {score}</Badge>;
  return <Badge variant="muted">Rischio basso · {score}</Badge>;
}
