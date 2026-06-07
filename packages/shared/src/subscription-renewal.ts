import { Temporal } from "@js-temporal/polyfill";
import {
  type BillingCycle,
  type CustomCycleUnit,
  type DateOnly,
  type SubscriptionStatus,
  isValidDateOnly,
} from "./runtime";

export type RenewalMode = "auto" | "manual";

export interface SubscriptionRenewalInput {
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  startDate: string;
  nextBillingDate: string;
  autoRenew: boolean;
  autoCalculateNextBillingDate: boolean;
  customDays?: number | null | undefined;
  customCycleUnit?: CustomCycleUnit | null | undefined;
}

export interface AdvanceBillingDateInput {
  billingCycle: BillingCycle;
  startDate: string;
  nextBillingDate: string;
  autoCalculateNextBillingDate: boolean;
  customDays?: number | null | undefined;
  customCycleUnit?: CustomCycleUnit | null | undefined;
}

export interface SubscriptionRenewalResult {
  nextBillingDate: DateOnly;
  status: SubscriptionStatus;
}

const MAX_ADVANCE_CYCLES = 20_000;

export function isAutoRenewEligible(subscription: SubscriptionRenewalInput, today: string): boolean {
  return (
    subscription.autoRenew &&
    subscription.billingCycle !== "one-time" &&
    (subscription.status === "active" || subscription.status === "trial") &&
    isValidDateOnly(subscription.startDate) &&
    isValidDateOnly(subscription.nextBillingDate) &&
    isValidDateOnly(today) &&
    compareDateOnly(subscription.nextBillingDate, today) < 0
  );
}

export function isManualRenewEligible(subscription: SubscriptionRenewalInput): boolean {
  return (
    !subscription.autoRenew &&
    subscription.billingCycle !== "one-time" &&
    (subscription.status === "active" || subscription.status === "trial" || subscription.status === "expired") &&
    isValidDateOnly(subscription.startDate) &&
    isValidDateOnly(subscription.nextBillingDate)
  );
}

export function advanceSubscriptionRenewal(
  subscription: SubscriptionRenewalInput,
  today: string,
  mode: RenewalMode,
): SubscriptionRenewalResult | null {
  if (mode === "auto" && !isAutoRenewEligible(subscription, today)) return null;
  if (mode === "manual" && !isManualRenewEligible(subscription)) return null;
  const nextBillingDate = advanceBillingDate(subscription, today, mode);
  return {
    nextBillingDate,
    status: mode === "manual" && subscription.status === "expired" ? "active" : subscription.status,
  };
}

export function advanceBillingDate(
  input: AdvanceBillingDateInput,
  today: string,
  mode: RenewalMode,
): DateOnly {
  assertRenewableBillingCycle(input.billingCycle);
  const original = assertDateOnly(input.nextBillingDate);
  const anchor = assertDateOnly(input.autoCalculateNextBillingDate ? input.startDate : input.nextBillingDate);
  const threshold = mode === "manual" && compareDateOnly(original, today) > 0 ? original : assertDateOnly(today);
  const strict = mode === "manual";

  return firstCycleDateAfter(anchor, input, threshold, strict);
}

export function calculateNextBillingDate(
  startDate: string,
  cycle: BillingCycle,
  customDays?: number | null | undefined,
  referenceDate?: string | null | undefined,
  customCycleUnit: CustomCycleUnit = "day",
): DateOnly {
  const anchor = assertDateOnly(startDate);
  if (cycle === "one-time") return anchor;
  const threshold = referenceDate ? assertDateOnly(referenceDate) : anchor;
  return firstCycleDateAfter(anchor, {
    billingCycle: cycle,
    startDate: anchor,
    nextBillingDate: anchor,
    autoCalculateNextBillingDate: true,
    customDays,
    customCycleUnit,
  }, threshold, false);
}

export function addBillingCycles(
  date: string,
  cycle: BillingCycle,
  cycleCount: number,
  customDays?: number | null | undefined,
  customCycleUnit: CustomCycleUnit = "day",
): DateOnly {
  const start = toPlainDate(date);
  const count = Math.max(1, Math.trunc(cycleCount));
  const customCount = Math.max(1, Math.trunc(customDays ?? 30)) * count;
  switch (cycle) {
    case "weekly":
      return fromPlainDate(start.add({ weeks: count }));
    case "monthly":
      return fromPlainDate(start.add({ months: count }));
    case "quarterly":
      return fromPlainDate(start.add({ months: 3 * count }));
    case "semi-annual":
      return fromPlainDate(start.add({ months: 6 * count }));
    case "annual":
      return fromPlainDate(start.add({ years: count }));
    case "custom":
      return addCustomBillingCycles(start, customCount, customCycleUnit);
    case "one-time":
      return fromPlainDate(start);
  }
}

function firstCycleDateAfter(
  anchor: string,
  input: AdvanceBillingDateInput,
  threshold: string,
  strict: boolean,
): DateOnly {
  const initialCycles = initialCycleCount(anchor, input, threshold, strict);
  let cycleCount = Math.max(1, initialCycles);
  for (let attempts = 0; attempts < MAX_ADVANCE_CYCLES; attempts += 1) {
    const candidate = addBillingCycles(anchor, input.billingCycle, cycleCount, input.customDays, input.customCycleUnit ?? "day");
    const comparison = compareDateOnly(candidate, threshold);
    if (strict ? comparison > 0 : comparison >= 0) return candidate;
    cycleCount += 1;
  }
  throw new Error("SUBSCRIPTION_RENEWAL_ADVANCE_LIMIT_EXCEEDED");
}

function initialCycleCount(
  anchor: string,
  input: AdvanceBillingDateInput,
  threshold: string,
  strict: boolean,
): number {
  const dayStep = exactDayStep(input);
  if (!dayStep) return 1;
  const diff = toPlainDate(anchor).until(toPlainDate(threshold), { largestUnit: "day" }).days;
  const adjusted = strict ? diff + 1 : diff;
  return Math.max(1, Math.ceil(adjusted / dayStep));
}

function exactDayStep(input: Pick<AdvanceBillingDateInput, "billingCycle" | "customDays" | "customCycleUnit">): number | null {
  if (input.billingCycle === "weekly") return 7;
  if (input.billingCycle !== "custom") return null;
  const count = Math.max(1, Math.trunc(input.customDays ?? 30));
  if ((input.customCycleUnit ?? "day") === "day") return count;
  if (input.customCycleUnit === "week") return count * 7;
  return null;
}

function addCustomBillingCycles(
  start: Temporal.PlainDate,
  count: number,
  unit: CustomCycleUnit,
): DateOnly {
  switch (unit) {
    case "week":
      return fromPlainDate(start.add({ weeks: count }));
    case "month":
      return fromPlainDate(start.add({ months: count }));
    case "year":
      return fromPlainDate(start.add({ years: count }));
    case "day":
      return fromPlainDate(start.add({ days: count }));
  }
}

function assertRenewableBillingCycle(cycle: BillingCycle): asserts cycle is Exclude<BillingCycle, "one-time"> {
  if (cycle === "one-time") {
    throw new Error("SUBSCRIPTION_RENEWAL_ONE_TIME_NOT_RENEWABLE");
  }
}

function assertDateOnly(value: string): DateOnly {
  if (!isValidDateOnly(value)) {
    throw new Error(`Invalid date-only value: ${value}`);
  }
  return value as DateOnly;
}

function toPlainDate(value: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(assertDateOnly(value));
}

function fromPlainDate(value: Temporal.PlainDate): DateOnly {
  return assertDateOnly(value.toString());
}

function compareDateOnly(left: string, right: string): number {
  return Temporal.PlainDate.compare(toPlainDate(left), toPlainDate(right));
}
