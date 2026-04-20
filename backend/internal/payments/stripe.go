// Package payments wraps Stripe. The rest of the codebase shouldn't import
// stripe-go directly — go through this package so swapping processors later
// stays localized.
package payments

import (
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/paymentintent"
	"github.com/stripe/stripe-go/v82/payout"
	"github.com/stripe/stripe-go/v82/refund"
)

type Client struct {
	secretKey     string
	webhookSecret string
}

func NewClient(secretKey, webhookSecret string) *Client {
	stripe.Key = secretKey
	return &Client{secretKey: secretKey, webhookSecret: webhookSecret}
}

// Enabled reports whether Stripe is configured with a real-looking secret key.
// Rejects the env-var placeholders so a mis-configured deploy fails loudly at
// the checkout endpoint instead of hitting Stripe and getting a 401.
func (c *Client) Enabled() bool {
	if c.secretKey == "" {
		return false
	}
	if len(c.secretKey) < 7 {
		return false
	}
	prefix := c.secretKey[:7]
	return prefix == "sk_test" || prefix == "sk_live"
}
func (c *Client) WebhookSecret() string { return c.webhookSecret }

// CreatePaymentIntent creates a PaymentIntent for the given order total.
// `amountCents` is the smallest currency unit (cents for EUR). `orderID` is
// stored as metadata so the webhook can link the event back to the order.
func (c *Client) CreatePaymentIntent(amountCents int64, currency, orderID, customerEmail string) (*stripe.PaymentIntent, error) {
	params := &stripe.PaymentIntentParams{
		Amount:   stripe.Int64(amountCents),
		Currency: stripe.String(currency),
		AutomaticPaymentMethods: &stripe.PaymentIntentAutomaticPaymentMethodsParams{
			Enabled: stripe.Bool(true),
		},
	}
	params.AddMetadata("order_id", orderID)
	if customerEmail != "" {
		params.ReceiptEmail = stripe.String(customerEmail)
		params.AddMetadata("customer_email", customerEmail)
	}
	return paymentintent.New(params)
}

// Refund issues a full or partial refund for a PaymentIntent.
func (c *Client) Refund(paymentIntentID string, amountCents int64) (*stripe.Refund, error) {
	params := &stripe.RefundParams{
		PaymentIntent: stripe.String(paymentIntentID),
	}
	if amountCents > 0 {
		params.Amount = stripe.Int64(amountCents)
	}
	return refund.New(params)
}

// Payout is a slim projection of a Stripe payout row for the finance UI.
// We flatten the fields the admin cares about so the UI doesn't need to
// import stripe-go types.
type Payout struct {
	ID          string `json:"id"`
	AmountCents int64  `json:"amountCents"`
	Currency    string `json:"currency"`
	Status      string `json:"status"`      // pending | in_transit | paid | failed | canceled
	ArrivalDate int64  `json:"arrivalDate"` // unix seconds
	Created     int64  `json:"created"`     // unix seconds
	Method      string `json:"method"`      // standard | instant
}

// ListPayouts returns the most recent payouts from Stripe. Used by the
// finance dashboard to reconcile revenue against deposits in the bank.
// Returns an empty slice when Stripe isn't configured so the UI degrades
// gracefully.
func (c *Client) ListPayouts(limit int) ([]Payout, error) {
	if !c.Enabled() {
		return []Payout{}, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	params := &stripe.PayoutListParams{}
	params.Limit = stripe.Int64(int64(limit))
	iter := payout.List(params)
	out := make([]Payout, 0, limit)
	for iter.Next() {
		p := iter.Payout()
		out = append(out, Payout{
			ID:          p.ID,
			AmountCents: p.Amount,
			Currency:    string(p.Currency),
			Status:      string(p.Status),
			ArrivalDate: p.ArrivalDate,
			Created:     p.Created,
			Method:      string(p.Method),
		})
	}
	return out, iter.Err()
}
