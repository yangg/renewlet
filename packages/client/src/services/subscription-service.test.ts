// 订阅 service 测试保护 PocketBase/Worker 响应进入前端 domain 前的运行时归一化边界。
import { describe, expect, it } from "vitest";
import { fromApiSubscription } from "./subscription-service";

const legacyPocketBaseRow = {
  collectionId: "subscriptions",
  collectionName: "subscriptions",
  id: "sub_legacy",
  name: "Perplexity Pro",
  logo: "https://example.com/perplexity.svg",
  price: 20,
  currency: "USD",
  billingCycle: "monthly",
  customDays: 0,
  customCycleUnit: "",
  category: "ai_tools",
  status: "active",
  pinned: false,
  publicHidden: false,
  paymentMethod: "apple_pay",
  startDate: "2026-02-03",
  nextBillingDate: "2026-05-29",
  autoCalculateNextBillingDate: false,
  trialEndDate: "",
  website: "https://www.perplexity.ai/",
  notes: "Demo data",
  tags: ["AI", "Search"],
  reminderDays: 7,
  repeatReminderEnabled: false,
  repeatReminderInterval: "1h",
  repeatReminderWindow: "72h",
  created: "2026-06-04 23:43:33.958Z",
  updated: "2026-06-04 23:43:33.958Z",
};

describe("subscription service normalization", () => {
  it("ignores legacy custom fields on fixed PocketBase cycles", () => {
    const subscription = fromApiSubscription(legacyPocketBaseRow);

    expect(subscription).toMatchObject({
      billingCycle: "monthly",
      customDays: undefined,
      customCycleUnit: undefined,
      name: "Perplexity Pro",
    });
  });

  it("defaults legacy PocketBase rows without autoRenew to manual renewal", () => {
    expect(fromApiSubscription(legacyPocketBaseRow).autoRenew).toBe(false);
    expect(fromApiSubscription({ ...legacyPocketBaseRow, autoRenew: true }).autoRenew).toBe(true);
    expect(fromApiSubscription({ ...legacyPocketBaseRow, autoRenew: false }).autoRenew).toBe(false);
  });

  it("defaults legacy custom PocketBase rows without a unit to day", () => {
    const subscription = fromApiSubscription({
      ...legacyPocketBaseRow,
      billingCycle: "custom",
      customDays: 45,
      customCycleUnit: "",
    });

    expect(subscription).toMatchObject({
      billingCycle: "custom",
      customDays: 45,
      customCycleUnit: "day",
    });
  });

  it("keeps supported custom cycle units", () => {
    const subscription = fromApiSubscription({
      ...legacyPocketBaseRow,
      billingCycle: "custom",
      customDays: 3,
      customCycleUnit: "year",
    });

    expect(subscription).toMatchObject({
      billingCycle: "custom",
      customDays: 3,
      customCycleUnit: "year",
    });
  });
});
