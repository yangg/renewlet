package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type subscriptionResponse struct {
	Subscription map[string]interface{} `json:"subscription"`
}

// handleSubscriptionRenew 推进当前用户的一条手动续订订阅。
func handleSubscriptionRenew(app core.App, e *core.RequestEvent) error {
	locale := requestLocale(e.Request)
	if _, err := decodeOptionalStrictJSON[subscriptionRenewRequest](e.Request, locale); err != nil {
		return e.BadRequestError(validationErrorMessage(locale, "common.invalidRequestBody", err), err)
	}
	subscriptionID := strings.TrimSpace(e.Request.PathValue("id"))
	// 手动续订是认证用户的写入边界；查询同时带 id 和 user，避免通过错误码枚举他人订阅。
	record, err := app.FindFirstRecordByFilter(
		"subscriptions",
		"id = {:id} && user = {:user}",
		dbx.Params{"id": subscriptionID, "user": e.Auth.Id},
	)
	if err != nil || record == nil {
		return e.NotFoundError("SUBSCRIPTION_NOT_FOUND", err)
	}
	today := todayDateOnly(time.Now(), currentUserSettingsTimezone(app, e.Auth))
	result, ok, err := advanceSubscriptionRenewal(subscriptionRenewalInputFromRecord(record), today, renewalModeManual)
	if err != nil {
		return e.BadRequestError(err.Error(), err)
	}
	if !ok {
		return e.BadRequestError("SUBSCRIPTION_RENEW_NOT_ALLOWED", nil)
	}
	record.Set("nextBillingDate", result.NextBillingDate)
	record.Set("status", result.Status)
	if err := app.Save(record); err != nil {
		return e.BadRequestError("SUBSCRIPTION_RENEW_FAILED", err)
	}
	return e.JSON(http.StatusOK, subscriptionResponse{Subscription: subscriptionAPIFromRecord(record)})
}

func subscriptionAPIFromRecord(record *core.Record) map[string]interface{} {
	billingCycle := record.GetString("billingCycle")
	out := map[string]interface{}{
		"id":                           record.Id,
		"name":                         record.GetString("name"),
		"price":                        record.GetFloat("price"),
		"currency":                     record.GetString("currency"),
		"billingCycle":                 billingCycle,
		"category":                     record.GetString("category"),
		"status":                       record.GetString("status"),
		"pinned":                       record.GetBool("pinned"),
		"publicHidden":                 record.GetBool("publicHidden"),
		"startDate":                    record.GetString("startDate"),
		"nextBillingDate":              record.GetString("nextBillingDate"),
		"autoRenew":                    billingCycle != "one-time" && record.GetBool("autoRenew"),
		"autoCalculateNextBillingDate": record.GetBool("autoCalculateNextBillingDate"),
		"tags":                         jsonValueForResponse(record.Get("tags"), []string{}),
		"reminderDays":                 record.GetInt("reminderDays"),
		"repeatReminderEnabled":        record.GetBool("repeatReminderEnabled"),
		"repeatReminderInterval":       normalizeRepeatReminderInterval(record.GetString("repeatReminderInterval")),
		"repeatReminderWindow":         normalizeRepeatReminderWindow(record.GetString("repeatReminderWindow")),
		"extra":                        jsonValueForResponse(record.Get("extra"), map[string]interface{}{}),
	}
	if value := strings.TrimSpace(record.GetString("logo")); value != "" {
		out["logo"] = value
	}
	if billingCycle == "custom" {
		out["customDays"] = maxInt(1, record.GetInt("customDays"))
		out["customCycleUnit"] = normalizeCustomCycleUnit(record.GetString("customCycleUnit"))
	}
	if billingCycle == "one-time" && record.GetInt("oneTimeTermCount") > 0 {
		out["oneTimeTermCount"] = record.GetInt("oneTimeTermCount")
		out["oneTimeTermUnit"] = normalizeCustomCycleUnit(record.GetString("oneTimeTermUnit"))
	}
	for _, field := range []string{"paymentMethod", "trialEndDate", "website", "notes"} {
		if value := strings.TrimSpace(record.GetString(field)); value != "" {
			out[field] = value
		}
	}
	if !record.GetDateTime("created").IsZero() {
		out["createdAt"] = record.GetDateTime("created").Time().UTC().Format(time.RFC3339Nano)
	}
	if !record.GetDateTime("updated").IsZero() {
		out["updatedAt"] = record.GetDateTime("updated").Time().UTC().Format(time.RFC3339Nano)
	}
	return out
}

func jsonValueForResponse(value interface{}, fallback interface{}) interface{} {
	data, err := jsonBytesFromValue(value)
	if err != nil || len(data) == 0 {
		return fallback
	}
	var decoded interface{}
	if err := json.Unmarshal(data, &decoded); err != nil || decoded == nil {
		return fallback
	}
	return decoded
}

func currentUserSettingsTimezone(app core.App, user *core.Record) string {
	settings, err := currentUserSettings(app, user, nil)
	if err != nil {
		return defaultAppSettings().Timezone
	}
	return settings.Timezone
}
