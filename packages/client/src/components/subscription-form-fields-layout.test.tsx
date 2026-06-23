import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assertDateOnly } from "@/lib/time/date-only";
import { createSubscriptionFormState, type SubscriptionFormState } from "@/types/subscription-form";
import { SubscriptionFormFields, type SubscriptionFormErrors } from "./subscription-form-fields";

const config = {
  categories: [{ id: "productivity", value: "productivity", labels: { "zh-CN": "效率工具", "en-US": "Productivity" } }],
  statuses: [{ id: "active", value: "active", labels: { "zh-CN": "活跃", "en-US": "Active" } }],
  paymentMethods: [{ id: "alipay", value: "alipay", labels: { "zh-CN": "支付宝", "en-US": "Alipay" } }],
  currencies: [
    { id: "CNY", value: "CNY", labels: { "zh-CN": "¥ 人民币 (CNY)", "en-US": "¥ Chinese Yuan (CNY)" }, enabled: true },
    { id: "USD", value: "USD", labels: { "zh-CN": "$ 美元 (USD)", "en-US": "$ US Dollar (USD)" }, enabled: true },
  ],
};

function Harness({
  errors,
  formOverrides = {},
}: {
  errors: SubscriptionFormErrors;
  formOverrides?: Partial<SubscriptionFormState>;
}) {
  const [formData, setFormData] = useState(() => createSubscriptionFormState({
    currency: "CNY",
    startDate: assertDateOnly("2026-01-01"),
    nextBillingDate: assertDateOnly("2026-02-01"),
    ...formOverrides,
  }));

  return (
    <TooltipProvider delayDuration={0}>
      <SubscriptionFormFields
        idPrefix=""
        config={config}
        formData={formData}
        setFormData={setFormData}
        showLogoField={false}
        onLogoUploadStatusChange={vi.fn()}
        errors={errors}
        notificationReminderDays={5}
      />
    </TooltipProvider>
  );
}

describe("SubscriptionFormFields layout", () => {
  it("renders price and currency errors at row level instead of inside one column", () => {
    render(<Harness errors={{ price: "请输入价格" }} />);

    const priceInput = screen.getByPlaceholderText("0.00");
    const priceField = priceInput.closest('[data-slot="form-field"]');
    const priceRow = priceInput.closest('[data-slot="form-field-row"]');
    const error = screen.getByRole("alert");

    expect(priceInput).toHaveAttribute("aria-describedby", "price-error");
    expect(error).toHaveAttribute("id", "price-error");
    expect(priceField).not.toContainElement(error);
    expect(priceRow).toContainElement(error);
  });

  it("keeps start date before next billing date in the date row", () => {
    render(<Harness errors={{}} />);

    const startLabel = screen.getByText("开始日期（可选）");
    const nextLabel = screen.getByText("到期日期");

    expect(Boolean(startLabel.compareDocumentPosition(nextLabel) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("associates auto-calculate start-date errors with the start date button", () => {
    render(<Harness
      errors={{ dates: "开启自动计算时需要开始日期" }}
      formOverrides={{ startDate: undefined, autoCalculate: true }}
    />);

    const startDateButton = document.getElementById("startDate");
    const nextBillingDateButton = document.getElementById("nextBillingDate");

    expect(startDateButton).toHaveAttribute("aria-invalid", "true");
    expect(startDateButton).toHaveAttribute("aria-describedby", "startDate-error");
    expect(nextBillingDateButton).toHaveAttribute("aria-invalid", "false");
  });
});
