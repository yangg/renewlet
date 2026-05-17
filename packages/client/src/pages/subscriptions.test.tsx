import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assertDateOnly } from "@/lib/time/date-only";
import type { Subscription } from "@/types/subscription";
import Subscriptions from "./subscriptions";

type FixedBillingCycle = Exclude<Subscription["billingCycle"], "custom">;
type SubscriptionBaseFixture = Omit<Subscription, "billingCycle" | "customDays">;
type SubscriptionOverrides = Partial<Omit<Subscription, "billingCycle" | "customDays">> & (
  | { billingCycle?: FixedBillingCycle; customDays?: undefined }
  | { billingCycle: "custom"; customDays?: number }
);

const mocks = vi.hoisted(() => ({
  useSubscriptions: vi.fn(),
  useSettings: vi.fn(),
  handleAddSubscription: vi.fn(),
  handleDeleteSubscription: vi.fn(),
  handleEditSubscription: vi.fn(),
  handleSaveSubscription: vi.fn(),
  handleEditDialogOpenChange: vi.fn(),
}));

vi.mock("@/hooks/use-subscriptions", () => ({
  useSubscriptions: mocks.useSubscriptions,
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: mocks.useSettings,
}));

vi.mock("@/hooks/use-exchange-rates", () => ({
  useExchangeRates: () => ({
    convert: (amount: number, from: string, to: string) => {
      if (from === to) return amount;
      if (from === "USD" && to === "CNY") return amount * 7;
      if (from === "CNY" && to === "USD") return amount / 7;
      return amount;
    },
  }),
}));

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: {
      categories: [
        {
          id: "productivity",
          value: "productivity",
          labels: { "zh-CN": "生产力", "en-US": "Productivity" },
          color: "hsl(200 80% 50%)",
        },
      ],
      statuses: [
        {
          id: "active",
          value: "active",
          labels: { "zh-CN": "活跃", "en-US": "Active" },
          color: "hsl(160 84% 45%)",
        },
      ],
      paymentMethods: [],
      currencies: [],
    },
    updateCategories: vi.fn(),
    updateStatuses: vi.fn(),
    updatePaymentMethods: vi.fn(),
    updateCurrencies: vi.fn(),
  }),
}));

vi.mock("@/modules/subscriptions/application/use-subscription-crud", () => ({
  useSubscriptionCrud: () => ({
    editingSubscription: undefined,
    editDialogOpen: false,
    handleAddSubscription: mocks.handleAddSubscription,
    handleDeleteSubscription: mocks.handleDeleteSubscription,
    handleEditSubscription: mocks.handleEditSubscription,
    handleSaveSubscription: mocks.handleSaveSubscription,
    handleEditDialogOpenChange: mocks.handleEditDialogOpenChange,
  }),
}));

vi.mock("@/modules/subscriptions/application/use-subscription-export", () => ({
  useSubscriptionExport: () => ({
    exportToJSON: vi.fn(),
    exportToCSV: vi.fn(),
  }),
}));

vi.mock("@/components/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/components/subscription-card", () => ({
  SubscriptionCard: ({ subscription }: { subscription: Subscription }) => (
    <article data-testid="subscription-card">{subscription.name}</article>
  ),
}));

vi.mock("@/components/add-subscription-dialog", () => ({
  AddSubscriptionDialog: ({ trigger }: { trigger?: ReactNode }) => trigger ?? null,
}));

vi.mock("@/components/edit-subscription-dialog", () => ({
  EditSubscriptionDialog: () => null,
}));

function subscription(overrides: SubscriptionOverrides = {}): Subscription {
  const base: SubscriptionBaseFixture = {
    id: "sub",
    name: "Service",
    logo: undefined,
    price: 10,
    currency: "USD",
    category: "productivity",
    status: "active",
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-01-01"),
    nextBillingDate: assertDateOnly("2026-02-01"),
    autoCalculateNextBillingDate: true,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    tags: [],
    reminderDays: 3,
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

function renderSubscriptionsPage() {
  return render(
    <TooltipProvider delayDuration={0}>
      <Subscriptions />
    </TooltipProvider>,
  );
}

function visibleSubscriptionNames() {
  return screen.getAllByTestId("subscription-card").map((card) => card.textContent);
}

describe("Subscriptions page sorting", () => {
  beforeAll(() => {
    Element.prototype.hasPointerCapture ??= vi.fn(() => false);
    Element.prototype.setPointerCapture ??= vi.fn();
    Element.prototype.releasePointerCapture ??= vi.fn();
  });

  beforeEach(() => {
    mocks.useSettings.mockReturnValue({
      data: {
        timezone: "Asia/Shanghai",
        defaultCurrency: "CNY",
      },
    });
    mocks.useSubscriptions.mockReturnValue({
      data: [
        subscription({ id: "annual-usd", name: "Annual USD", price: 120, currency: "USD", billingCycle: "annual" }),
        subscription({ id: "monthly-cny", name: "Monthly CNY", price: 80, currency: "CNY", billingCycle: "monthly" }),
        subscription({ id: "quarterly-cny", name: "Quarterly CNY", price: 180, currency: "CNY", billingCycle: "quarterly" }),
      ],
      isPending: false,
    });
  });

  it("sorts visible cards and clears sorting without marking the count as filtered", async () => {
    const user = userEvent.setup();
    renderSubscriptionsPage();

    expect(visibleSubscriptionNames()).toEqual(["Annual USD", "Monthly CNY", "Quarterly CNY"]);

    await user.click(screen.getByRole("combobox", { name: "排序" }));
    await user.click(await screen.findByRole("option", { name: "月成本最高" }));

    await waitFor(() => {
      expect(visibleSubscriptionNames()).toEqual(["Monthly CNY", "Annual USD", "Quarterly CNY"]);
    });
    expect(screen.queryByText(/从 3 个中筛选/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清除筛选" }));

    await waitFor(() => {
      expect(visibleSubscriptionNames()).toEqual(["Annual USD", "Monthly CNY", "Quarterly CNY"]);
    });
    expect(screen.getByRole("combobox", { name: "排序" })).toHaveTextContent("默认顺序");
  });
});
