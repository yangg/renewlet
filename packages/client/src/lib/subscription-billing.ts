/**
 * 订阅账单周期计算工具。
 *
 * 架构位置：
 * - 表单自动计算下次扣费日。
 * - 仪表盘/统计页把不同周期统一折算到月度口径。
 *
 * 注意： 这里不做汇率换算；金额币种归一化由统计模型处理。
 */
import type { BillingCycle, CustomCycleUnit, Subscription } from "@/types/subscription";
import type { DateOnly } from "@/lib/time/date-only";
import { localizedLabel, type Locale } from "@/i18n/locales";
import { translate } from "@/i18n/messages";
import { CYCLE_LABELS } from "@/types/subscription";
import {
  addBillingCycles,
  calculateNextBillingDate as calculateSharedNextBillingDate,
} from "@renewlet/shared/subscription-renewal";

/**
 * 根据开始日期 + 周期计算“下一次扣费日期”。
 *
 * 规则：
 * - 未传 referenceDate 时，从 startDate 起加一个扣费周期，得到当前订阅周期的到期/下次扣费日期
 * - 传入 referenceDate 时，按 startDate 锚定周期，返回 referenceDate 当天或之后最近一次扣费日
 * - 自定义周期（custom）使用 customDays + customCycleUnit（默认 30 天）
 * - 一次性购买（one-time）不产生下一次扣费，防御性返回开始日
 *
 * 注意：
 * - 这是纯函数：不会修改传入的 Date 对象
 * - UI 侧（新增/编辑订阅）都依赖该计算逻辑，集中到一个文件便于统一维护
 */
export function calculateNextBillingDate(
  startDate: DateOnly,
  cycle: BillingCycle,
  customDays?: number,
  referenceDate?: DateOnly,
  customCycleUnit: CustomCycleUnit = "day",
): DateOnly {
  return calculateSharedNextBillingDate(startDate, cycle, customDays, referenceDate, customCycleUnit) as DateOnly;
}

/**
 * 将“单次扣费金额”折算为“月度金额”（不含汇率换算）。
 *
 * 说明：
 * - 该函数只做周期折算，不关心货币；如果需要统一口径，请先做汇率换算再折算（月度是线性变换，顺序无关）
 * - 目前项目里多个页面（仪表盘/统计/饼图）都需要这套折算规则，集中到这里便于统一维护
 *
 * 注意： weekly 使用 4.33 是产品口径近似值，不等同于精确自然月账单。
 */
export function toMonthlyAmount(
  amount: number,
  cycle: BillingCycle,
  customDays?: number,
  customCycleUnit: CustomCycleUnit = "day",
  oneTimeTermCount?: number,
  oneTimeTermUnit: CustomCycleUnit = "day",
): number {
  switch (cycle) {
    case "weekly":
      return amount * 4.33;
    case "monthly":
      return amount;
    case "quarterly":
      return amount / 3;
    case "semi-annual":
      return amount / 6;
    case "annual":
      return amount / 12;
    case "custom":
      return customDays ? customCycleToMonthlyAmount(amount, customDays, customCycleUnit) : amount;
    case "one-time":
      // one-time 无服务期是买断，不进入月均；有服务期时 price 表示整段预付权益总价。
      return oneTimeTermCount ? customCycleToMonthlyAmount(amount, oneTimeTermCount, oneTimeTermUnit) : 0;
    default:
      return amount;
  }
}

function customCycleToMonthlyAmount(amount: number, count: number, unit: CustomCycleUnit): number {
  switch (unit) {
    case "week":
      return (amount / count) * 4.33;
    case "month":
      return amount / count;
    case "year":
      return amount / count / 12;
    case "day":
    default:
      return (amount / count) * 30;
  }
}

export function isOneTimeFixedTerm(subscription: Pick<Subscription, "billingCycle" | "oneTimeTermCount" | "oneTimeTermUnit">): boolean {
  return subscription.billingCycle === "one-time" && Boolean(subscription.oneTimeTermCount && subscription.oneTimeTermUnit);
}

export function isOneTimeBuyout(subscription: Pick<Subscription, "billingCycle" | "oneTimeTermCount" | "oneTimeTermUnit">): boolean {
  return subscription.billingCycle === "one-time" && !isOneTimeFixedTerm(subscription);
}

export function calculateOneTimeTermEndDate(
  startDate: DateOnly,
  count: number,
  unit: CustomCycleUnit,
): DateOnly {
  return addBillingCycles(startDate, "custom", 1, count, unit) as DateOnly;
}

export function customCycleUnitLabelKey(unit: CustomCycleUnit): `subscription.customCycleUnit.${CustomCycleUnit}` {
  return `subscription.customCycleUnit.${unit}`;
}

export function formatBillingCycleLabel(subscription: Pick<Subscription, "billingCycle" | "customDays" | "customCycleUnit">, locale: Locale): string {
  if (subscription.billingCycle !== "custom") {
    return localizedLabel(CYCLE_LABELS[subscription.billingCycle], locale);
  }
  const count = subscription.customDays ?? 1;
  const unit = subscription.customCycleUnit ?? "day";
  const unitLabel = translate(locale, customCycleUnitLabelKey(unit));
  return translate(locale, "subscription.customCycleLabel", { count, unit: unitLabel });
}
