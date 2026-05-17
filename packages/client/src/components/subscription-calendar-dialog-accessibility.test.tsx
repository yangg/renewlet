import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { assertDateOnly } from "@/lib/time/date-only";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Subscription } from "@/types/subscription";
import { SubscriptionCalendar } from "./subscription-calendar";

type FixedBillingCycle = Exclude<Subscription["billingCycle"], "custom">;
type SubscriptionBaseFixture = Omit<Subscription, "billingCycle" | "customDays">;
type SubscriptionOverrides = Partial<Omit<Subscription, "billingCycle" | "customDays">> & (
  | { billingCycle?: FixedBillingCycle; customDays?: undefined }
  | { billingCycle: "custom"; customDays?: number }
);

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: {
      categories: [{ id: "productivity", value: "productivity", labels: { "zh-CN": "效率工具", "en-US": "Productivity" } }],
      statuses: [],
      paymentMethods: [],
      currencies: [],
    },
  }),
}));

vi.mock("@/hooks/use-exchange-rates", () => ({
  useExchangeRates: () => ({
    convert: (amount: number) => amount,
    getCurrencySymbol: (currency: string) => (currency === "USD" ? "$" : currency),
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: { defaultCurrency: "USD" },
  }),
}));

function subscription(overrides: SubscriptionOverrides = {}): Subscription {
  const base: SubscriptionBaseFixture = {
    id: "sub-1",
    name: "Aws",
    logo: undefined,
    price: 15,
    currency: "USD",
    category: "productivity",
    status: "active",
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-05-14"),
    nextBillingDate: assertDateOnly("2026-05-14"),
    autoCalculateNextBillingDate: true,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    reminderDays: 3,
    tags: [],
    repeatReminderEnabled: false,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
  };

  if (overrides.billingCycle === "custom") {
    return {
      ...base,
      ...overrides,
      billingCycle: "custom",
      customDays: overrides.customDays ?? 30,
    };
  }

  return {
    ...base,
    ...overrides,
    billingCycle: overrides.billingCycle ?? "monthly",
    customDays: undefined,
  };
}

function renderCalendar(subscriptions: Subscription[]) {
  return render(
    <TooltipProvider delayDuration={0}>
      <SubscriptionCalendar subscriptions={subscriptions} />
    </TooltipProvider>,
  );
}

describe("SubscriptionCalendar dialogs", () => {
  it("describes the subscription detail dialog", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([subscription()]);

    fireEvent.click(screen.getByRole("button", { name: "Aws" }));

    expect(screen.getByRole("dialog", { name: /Aws/ })).toHaveAccessibleDescription(
      "查看 Aws 的价格、周期、日期、标签、网站和备注。",
    );
  });

  it("describes the day subscription list dialog", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-14T12:00:00Z"));

    renderCalendar([
      subscription({ id: "sub-1", name: "Aws" }),
      subscription({ id: "sub-2", name: "Netflix" }),
      subscription({ id: "sub-3", name: "OpenAI" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "+1 更多" }));

    expect(screen.getByRole("dialog", { name: "5月14日 续费" })).toHaveAccessibleDescription(
      "选择 5月14日 要查看的订阅。",
    );
  });
});
