import { describe, expect, it } from "vitest";
import { subscriptionCreateBodySchema } from "./subscriptions";

const validSubscriptionCreateBody = {
  name: "Logo Test",
  logo: null,
  price: 0.83,
  currency: "CNY",
  billingCycle: "monthly",
  customDays: null,
  category: "productivity",
  status: "active",
  paymentMethod: null,
  startDate: "2026-05-15",
  nextBillingDate: "2026-06-15",
  autoCalculateNextBillingDate: true,
  trialEndDate: null,
  website: null,
  notes: null,
  tags: [],
  reminderDays: 3,
  repeatReminderEnabled: false,
  repeatReminderInterval: "1h",
  repeatReminderWindow: "72h",
};

describe("subscription API schemas", () => {
  it("accepts private asset paths and normal URLs for subscription logos", () => {
    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "/api/app/assets/2pbs0lgyypqhjoy",
    }).success).toBe(true);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "https://example.com/logo.png",
    }).success).toBe(true);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "data:image/png;base64,aGVsbG8=",
    }).success).toBe(true);
  });

  it("keeps website URLs strict while rejecting unrelated relative logo paths", () => {
    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      website: "/api/app/assets/2pbs0lgyypqhjoy",
    }).success).toBe(false);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      logo: "/other/assets/2pbs0lgyypqhjoy",
    }).success).toBe(false);
  });

  it("accepts only supported repeat reminder presets", () => {
    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      repeatReminderEnabled: true,
      repeatReminderInterval: "3h",
      repeatReminderWindow: "full",
    }).success).toBe(true);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      repeatReminderInterval: "2h",
    }).success).toBe(false);

    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      repeatReminderWindow: "forever",
    }).success).toBe(false);
  });

  it("accepts expired as a first-class subscription status", () => {
    expect(subscriptionCreateBodySchema.safeParse({
      ...validSubscriptionCreateBody,
      status: "expired",
    }).success).toBe(true);
  });
});
