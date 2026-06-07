package main

import (
	"log/slog"
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

const subscriptionRenewalMaintenancePageSize = 500

var subscriptionRenewalCronMu sync.Mutex

type subscriptionRenewalMaintenanceResult struct {
	UsersProcessed       int
	SubscriptionsUpdated int
}

func registerSubscriptionRenewalCron(app core.App) error {
	if !envBool("SUBSCRIPTION_RENEWAL_SCHEDULER_ENABLED", true) {
		return nil
	}
	expr := envString("SUBSCRIPTION_RENEWAL_SCHEDULER_CRON", "* * * * *")
	return app.Cron().Add("renewlet_subscription_renewals", expr, func() {
		if !subscriptionRenewalCronMu.TryLock() {
			slog.Info("subscription renewal maintenance skipped overlapping tick")
			return
		}
		defer subscriptionRenewalCronMu.Unlock()

		result, err := renewAutoSubscriptionsForAllUsers(app, time.Now())
		if err != nil {
			slog.Error("subscription renewal maintenance failed", "error", err)
			return
		}
		if result.SubscriptionsUpdated > 0 {
			slog.Info("subscription renewal maintenance completed",
				"users", result.UsersProcessed,
				"updated", result.SubscriptionsUpdated,
			)
		}
	})
}

func renewAutoSubscriptionsForAllUsers(app core.App, now time.Time) (subscriptionRenewalMaintenanceResult, error) {
	result := subscriptionRenewalMaintenanceResult{}
	for offset := 0; ; offset += subscriptionRenewalMaintenancePageSize {
		users, err := app.FindRecordsByFilter("users", "banned = false", "created", subscriptionRenewalMaintenancePageSize, offset)
		if err != nil {
			return result, err
		}
		for _, user := range users {
			settings, err := currentUserSettings(app, user, nil)
			if err != nil {
				settings = defaultAppSettings()
			}
			updated, err := renewAutoSubscriptionsForUser(app, user.Id, settings.Timezone, now)
			if err != nil {
				return result, err
			}
			result.UsersProcessed++
			result.SubscriptionsUpdated += updated
		}
		if len(users) < subscriptionRenewalMaintenancePageSize {
			return result, nil
		}
	}
}

func renewAutoSubscriptionsForUser(app core.App, userID string, timezone string, now time.Time) (int, error) {
	if userID == "" {
		return 0, nil
	}
	today := todayDateOnly(now, timezone)
	updated := 0
	for {
		rows, err := app.FindRecordsByFilter(
			"subscriptions",
			"user = {:user} && autoRenew = true && billingCycle != 'one-time' && nextBillingDate < {:today} && (status = 'active' || status = 'trial')",
			"nextBillingDate",
			subscriptionRenewalMaintenancePageSize,
			0,
			dbx.Params{"user": userID, "today": today},
		)
		if err != nil {
			return updated, err
		}
		for _, record := range rows {
			result, ok, err := advanceSubscriptionRenewal(subscriptionRenewalInputFromRecord(record), today, renewalModeAuto)
			if err != nil {
				return updated, err
			}
			if !ok {
				continue
			}
			record.Set("nextBillingDate", result.NextBillingDate)
			record.Set("status", result.Status)
			if err := app.Save(record); err != nil {
				return updated, err
			}
			updated++
		}
		if len(rows) < subscriptionRenewalMaintenancePageSize {
			return updated, nil
		}
	}
}
