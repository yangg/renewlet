package main

import (
	"encoding/json"
	"os"
	"testing"
)

type subscriptionRenewalFixture struct {
	Name                    string                   `json:"name"`
	Input                   subscriptionRenewalInput `json:"input"`
	Today                   string                   `json:"today"`
	Mode                    renewalMode              `json:"mode"`
	Eligible                bool                     `json:"eligible"`
	ExpectedNextBillingDate string                   `json:"expectedNextBillingDate"`
	ExpectedStatus          string                   `json:"expectedStatus"`
}

func TestSubscriptionRenewalMatchesSharedFixtures(t *testing.T) {
	data, err := os.ReadFile("../../../shared/src/subscription-renewal-fixtures.json")
	if err != nil {
		t.Fatalf("read shared fixtures: %v", err)
	}
	var fixtures []subscriptionRenewalFixture
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatalf("decode shared fixtures: %v", err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			eligible := isAutoRenewEligible(fixture.Input, fixture.Today)
			if fixture.Mode == renewalModeManual {
				eligible = isManualRenewEligible(fixture.Input)
			}
			if eligible != fixture.Eligible {
				t.Fatalf("eligible=%v, want %v", eligible, fixture.Eligible)
			}

			result, ok, err := advanceSubscriptionRenewal(fixture.Input, fixture.Today, fixture.Mode)
			if err != nil {
				t.Fatalf("advance: %v", err)
			}
			if ok != fixture.Eligible {
				t.Fatalf("advanced=%v, want %v", ok, fixture.Eligible)
			}
			if !fixture.Eligible {
				return
			}
			if result.NextBillingDate != fixture.ExpectedNextBillingDate || result.Status != fixture.ExpectedStatus {
				t.Fatalf("result=%+v, want next=%s status=%s", result, fixture.ExpectedNextBillingDate, fixture.ExpectedStatus)
			}
		})
	}
}
