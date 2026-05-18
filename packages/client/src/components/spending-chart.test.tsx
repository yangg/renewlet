import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import type { Subscription } from "@/types/subscription";
import { assertDateOnly } from "@/lib/time/date-only";
import { SpendingChart } from "./spending-chart";

type FixedBillingCycle = Exclude<Subscription["billingCycle"], "custom">;
type SubscriptionBaseFixture = Omit<Subscription, "billingCycle" | "customDays">;
type SubscriptionOverrides = Partial<Omit<Subscription, "billingCycle" | "customDays">> & (
  | { billingCycle?: FixedBillingCycle; customDays?: undefined }
  | { billingCycle: "custom"; customDays?: number }
);

const mocks = vi.hoisted(() => ({
  rechartsLegendProps: [] as Array<Record<string, unknown>>,
  rechartsPieChartProps: [] as Array<Record<string, unknown>>,
  rechartsPieProps: [] as Array<Record<string, unknown>>,
  rechartsTooltipProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("recharts", () => ({
  Cell: () => null,
  Legend: (props: Record<string, unknown>) => {
    mocks.rechartsLegendProps.push(props);
    return <div data-testid="recharts-legend" />;
  },
  Pie: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
    mocks.rechartsPieProps.push(props);
    return <div>{children}</div>;
  },
  PieChart: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
    mocks.rechartsPieChartProps.push(props);
    return <div>{children}</div>;
  },
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: (props: Record<string, unknown>) => {
    mocks.rechartsTooltipProps.push(props);
    const renderContent = props["content"] as
      | ((args: { active: boolean; payload: Array<{ name: string; value: number }> }) => ReactNode)
      | undefined;

    return (
      <div data-testid="chart-tooltip">
        {renderContent?.({
          active: true,
          payload: [{ name: "生产力", value: 20 }],
        })}
      </div>
    );
  },
}));

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({ config: DEFAULT_CUSTOM_CONFIG }),
}));

vi.mock("@/hooks/use-exchange-rates", () => ({
  useExchangeRates: () => ({
    convert: (amount: number) => amount,
    getCurrencySymbol: () => "¥",
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: {
      defaultCurrency: "CNY",
    },
  }),
}));

function subscription(overrides: SubscriptionOverrides = {}): Subscription {
  const base: SubscriptionBaseFixture = {
    id: "sub",
    name: "Service",
    logo: undefined,
    price: 20,
    currency: "CNY",
    category: "productivity",
    status: "active",
    paymentMethod: undefined,
    startDate: assertDateOnly("2026-01-01"),
    nextBillingDate: assertDateOnly("2099-01-05"),
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

describe("SpendingChart", () => {
  beforeEach(() => {
    mocks.rechartsLegendProps.length = 0;
    mocks.rechartsPieChartProps.length = 0;
    mocks.rechartsPieProps.length = 0;
    mocks.rechartsTooltipProps.length = 0;
  });

  it("disables tooltip animation while keeping the custom content", () => {
    render(<SpendingChart subscriptions={[subscription()]} />);

    expect(mocks.rechartsTooltipProps).toEqual([
      expect.objectContaining({
        isAnimationActive: false,
        offset: 12,
        allowEscapeViewBox: { x: true, y: true },
        wrapperStyle: { pointerEvents: "none" },
      }),
    ]);
    expect(screen.getByTestId("chart-tooltip")).toHaveTextContent("生产力");
    expect(screen.getByTestId("chart-tooltip")).toHaveTextContent("¥20 / 月");
  });

  it("keeps the legend outside Recharts so it cannot shrink the pie plot area", () => {
    render(<SpendingChart subscriptions={[subscription()]} />);

    expect(mocks.rechartsLegendProps).toHaveLength(0);
    expect(mocks.rechartsPieChartProps).toEqual([
      expect.objectContaining({
        margin: { top: 4, right: 4, bottom: 4, left: 4 },
      }),
    ]);
    expect(mocks.rechartsPieProps).toEqual([
      expect.objectContaining({
        cy: "50%",
        innerRadius: "56%",
        outerRadius: "90%",
      }),
    ]);
    expect(within(screen.getByRole("list")).getByText("生产力")).toBeInTheDocument();
  });
});
