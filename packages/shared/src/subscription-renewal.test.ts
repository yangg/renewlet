import { describe, expect, it } from "vitest";
import fixtures from "./subscription-renewal-fixtures.json";
import {
  advanceSubscriptionRenewal,
  isAutoRenewEligible,
  isManualRenewEligible,
  type RenewalMode,
  type SubscriptionRenewalInput,
} from "./subscription-renewal";

type Fixture = {
  name: string;
  input: SubscriptionRenewalInput;
  today: string;
  mode: RenewalMode;
  eligible: boolean;
  expectedNextBillingDate?: string;
  expectedStatus?: string;
};

describe("subscription renewal", () => {
  it.each(fixtures as Fixture[])("matches fixture $name", (fixture) => {
    const eligible = fixture.mode === "auto"
      ? isAutoRenewEligible(fixture.input, fixture.today)
      : isManualRenewEligible(fixture.input);
    expect(eligible).toBe(fixture.eligible);

    const result = advanceSubscriptionRenewal(fixture.input, fixture.today, fixture.mode);
    if (!fixture.eligible) {
      expect(result).toBeNull();
      return;
    }
    expect(result).toEqual({
      nextBillingDate: fixture.expectedNextBillingDate,
      status: fixture.expectedStatus,
    });
  });
});
