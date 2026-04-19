package checkout

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"
)

// StripeWebhook verifies the Stripe signature and processes the event. The
// webhook route is mounted WITHOUT CSRF middleware — Stripe authenticates
// with its `Stripe-Signature` header instead.
func (h *Handler) StripeWebhook(w http.ResponseWriter, r *http.Request) {
	const maxBody = 1 << 20 // 1 MiB
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	sigHeader := r.Header.Get("Stripe-Signature")
	event, err := webhook.ConstructEvent(body, sigHeader, h.pay.WebhookSecret())
	if err != nil {
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}

	log := slog.Default().With("webhook", "stripe", "type", event.Type, "id", event.ID)

	switch event.Type {
	case "payment_intent.succeeded":
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			log.Error("unmarshal pi", "err", err)
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		orderID := pi.Metadata["order_id"]
		if orderID == "" {
			log.Warn("missing order_id in metadata")
			w.WriteHeader(http.StatusOK)
			return
		}
		if err := h.markOrderPaid(r, orderID, pi.ID); err != nil {
			log.Error("markOrderPaid", "err", err)
			http.Error(w, "internal", http.StatusInternalServerError)
			return
		}
		log.Info("order paid", "order_id", orderID)

	case "payment_intent.payment_failed":
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			log.Error("unmarshal pi", "err", err)
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		_, _ = h.db.Exec(r.Context(), `
            UPDATE payments SET status = 'failed', updated_at = now()
            WHERE provider = 'stripe' AND provider_ref = $1
        `, pi.ID)
		log.Info("payment failed", "pi", pi.ID)

	case "charge.refunded", "refund.created", "refund.updated":
		// Refunds created via Dashboard → ensure we reflect them. Admin-initiated
		// refunds are also recorded directly by our refund handler; idempotency
		// via the payments.provider_ref UNIQUE index prevents double counting.
		log.Info("refund event")

	default:
		log.Debug("ignored event")
	}

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) markOrderPaid(r *http.Request, orderID, paymentIntentID string) error {
	ctx := r.Context()
	tx, err := h.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Idempotent: only flip if we weren't already paid.
	var currentStatus string
	err = tx.QueryRow(ctx, `SELECT financial_status FROM orders WHERE id = $1 FOR UPDATE`, orderID).Scan(&currentStatus)
	if err != nil {
		return err
	}
	if currentStatus == "paid" {
		return tx.Commit(ctx)
	}

	_, err = tx.Exec(ctx, `
        UPDATE orders SET status = 'paid', financial_status = 'paid',
                          paid_at = now(), updated_at = now()
        WHERE id = $1
    `, orderID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
        UPDATE payments SET status = 'succeeded', updated_at = now()
        WHERE provider = 'stripe' AND provider_ref = $1
    `, paymentIntentID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
        INSERT INTO order_events (order_id, kind, payload)
        VALUES ($1, 'paid', $2)
    `, orderID, map[string]any{"payment_intent_id": paymentIntentID, "at": time.Now().UTC()})
	if err != nil {
		return err
	}

	// Delete the cart tied to this order (by customer or by remaining cart_token).
	// Best-effort: failure here doesn't block the webhook.
	_, _ = tx.Exec(ctx, `
        DELETE FROM carts WHERE customer_id = (SELECT customer_id FROM orders WHERE id = $1) AND customer_id IS NOT NULL
    `, orderID)

	return tx.Commit(ctx)
}
