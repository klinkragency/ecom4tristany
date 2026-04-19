// Package payments wraps Stripe. The rest of the codebase shouldn't import
// stripe-go directly — go through this package so swapping processors later
// stays localized.
package payments

import (
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/paymentintent"
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

func (c *Client) Enabled() bool            { return c.secretKey != "" }
func (c *Client) WebhookSecret() string    { return c.webhookSecret }

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
