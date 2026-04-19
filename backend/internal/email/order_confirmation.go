package email

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/3mg/shop/backend/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

type orderSnapshot struct {
	number        string
	email         string
	customerName  string
	currency      string
	subtotalCents int
	shippingCents int
	taxCents      int
	totalCents    int
	items         []emailLine
	shipping      *emailAddress
}

type emailLine struct {
	productTitle   string
	variantTitle   string
	unitPriceCents int
	quantity       int
	totalCents     int
	imageURL       string
}

type emailAddress struct {
	firstName, lastName, addressLine1, addressLine2 string
	city, postalCode, country, phone                string
}

// SendOrderConfirmation builds and sends the order confirmation email.
// Fire-and-forget — failures are logged but don't block the caller.
func SendOrderConfirmation(ctx context.Context, db *pgxpool.Pool, cfg *config.Config, orderID string) {
	snap, err := loadOrderSnapshot(ctx, db, orderID)
	if err != nil {
		slog.Error("email: load order snapshot", "order_id", orderID, "err", err)
		return
	}
	body, textBody := renderOrderConfirmation(cfg, snap)
	sender := New(cfg)
	sender.SendAsync(Message{
		To:      snap.email,
		Subject: fmt.Sprintf("Order %s confirmed — %s", snap.number, cfg.ShopName),
		HTML:    body,
		Text:    textBody,
	})
}

func loadOrderSnapshot(ctx context.Context, db *pgxpool.Pool, id string) (*orderSnapshot, error) {
	s := &orderSnapshot{}
	err := db.QueryRow(ctx, `
        SELECT o.number, o.email,
               COALESCE((SELECT first_name || ' ' || last_name FROM order_addresses WHERE order_id = o.id AND kind = 'shipping'), ''),
               o.currency, o.subtotal_cents, o.shipping_cents, o.tax_cents, o.total_cents
        FROM orders o WHERE o.id = $1
    `, id).Scan(&s.number, &s.email, &s.customerName,
		&s.currency, &s.subtotalCents, &s.shippingCents, &s.taxCents, &s.totalCents)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(ctx, `
        SELECT product_title, variant_title, unit_price_cents, quantity, total_cents, image_url
        FROM order_line_items WHERE order_id = $1 ORDER BY created_at
    `, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var l emailLine
		if err := rows.Scan(&l.productTitle, &l.variantTitle, &l.unitPriceCents,
			&l.quantity, &l.totalCents, &l.imageURL); err != nil {
			return nil, err
		}
		s.items = append(s.items, l)
	}
	// Shipping address
	addrRows, err := db.Query(ctx, `
        SELECT first_name, last_name, address_line1, address_line2, city, postal_code, country, phone
        FROM order_addresses WHERE order_id = $1 AND kind = 'shipping'
    `, id)
	if err != nil {
		return nil, err
	}
	defer addrRows.Close()
	if addrRows.Next() {
		a := &emailAddress{}
		if err := addrRows.Scan(&a.firstName, &a.lastName, &a.addressLine1, &a.addressLine2,
			&a.city, &a.postalCode, &a.country, &a.phone); err != nil {
			return nil, err
		}
		s.shipping = a
	}
	return s, nil
}

// renderOrderConfirmation returns (html, text). The HTML uses inline styles
// (required for Gmail / Outlook which strip <style> tags).
func renderOrderConfirmation(cfg *config.Config, s *orderSnapshot) (string, string) {
	var html bytes.Buffer
	fmt.Fprintf(&html, `<!doctype html><html><body style="margin:0;padding:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#f6f6f7;color:#111;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;">
    <h1 style="margin:0 0 8px 0;font-size:22px;">Thank you, %s!</h1>
    <p style="margin:0 0 16px 0;color:#4b5563;">Order <strong>%s</strong> has been confirmed. We'll let you know once it's on its way.</p>
    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:24px 0 8px;">Order summary</h2>
    <table style="width:100%%;border-collapse:collapse;font-size:14px;">`,
		htmlEsc(displayName(s.customerName, s.email)), htmlEsc(s.number))
	for _, it := range s.items {
		variantNote := ""
		if it.variantTitle != "" {
			variantNote = fmt.Sprintf(`<div style="color:#6b7280;font-size:12px;">%s</div>`, htmlEsc(it.variantTitle))
		}
		fmt.Fprintf(&html, `
      <tr style="border-top:1px solid #e5e7eb;">
        <td style="padding:12px 0;width:64px;vertical-align:top;">
          %s
        </td>
        <td style="padding:12px 0 12px 12px;vertical-align:top;">
          <div style="font-weight:500;">%s</div>
          %s
          <div style="color:#6b7280;font-size:12px;">Qty %d</div>
        </td>
        <td style="padding:12px 0;text-align:right;vertical-align:top;">%s</td>
      </tr>`,
			imageTag(it.imageURL),
			htmlEsc(it.productTitle),
			variantNote,
			it.quantity,
			htmlEsc(formatMoney(it.totalCents, s.currency)))
	}
	fmt.Fprintf(&html, `
    </table>
    <table style="width:100%%;border-top:1px solid #e5e7eb;margin-top:16px;padding-top:12px;font-size:14px;">
      <tr><td style="padding:2px 0;color:#6b7280;">Subtotal</td><td style="padding:2px 0;text-align:right;">%s</td></tr>
      <tr><td style="padding:2px 0;color:#6b7280;">Shipping</td><td style="padding:2px 0;text-align:right;">%s</td></tr>
      <tr><td style="padding:2px 0;color:#9ca3af;font-size:12px;">incl. VAT</td><td style="padding:2px 0;text-align:right;color:#9ca3af;font-size:12px;">%s</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;">Total</td><td style="padding:6px 0;text-align:right;font-weight:600;">%s</td></tr>
    </table>`,
		htmlEsc(formatMoney(s.subtotalCents, s.currency)),
		htmlEsc(formatMoney(s.shippingCents, s.currency)),
		htmlEsc(formatMoney(s.taxCents, s.currency)),
		htmlEsc(formatMoney(s.totalCents, s.currency)))
	if s.shipping != nil {
		fmt.Fprintf(&html, `
    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:24px 0 8px;">Shipping to</h2>
    <p style="margin:0;font-size:14px;line-height:1.4;">
      %s %s<br>
      %s%s<br>
      %s %s<br>
      %s
    </p>`,
			htmlEsc(s.shipping.firstName), htmlEsc(s.shipping.lastName),
			htmlEsc(s.shipping.addressLine1), htmlEsc(prefix(s.shipping.addressLine2, "<br>")),
			htmlEsc(s.shipping.postalCode), htmlEsc(s.shipping.city),
			htmlEsc(s.shipping.country))
	}
	fmt.Fprintf(&html, `
    <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;">
      Questions? Just reply to this email.
    </p>
  </div>
  <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px;">
    © %s · <a href="%s" style="color:#9ca3af;">%s</a>
  </p>
</div>
</body></html>`,
		htmlEsc(cfg.ShopName), htmlEsc(cfg.ShopPublicURL), htmlEsc(cfg.ShopPublicURL))

	// Plain text fallback
	var text bytes.Buffer
	fmt.Fprintf(&text, "Thank you, %s!\n\nOrder %s is confirmed.\n\n", displayName(s.customerName, s.email), s.number)
	fmt.Fprintf(&text, "Items:\n")
	for _, it := range s.items {
		fmt.Fprintf(&text, "  - %s", it.productTitle)
		if it.variantTitle != "" {
			fmt.Fprintf(&text, " (%s)", it.variantTitle)
		}
		fmt.Fprintf(&text, " × %d — %s\n", it.quantity, formatMoney(it.totalCents, s.currency))
	}
	fmt.Fprintf(&text, "\nSubtotal: %s\nShipping: %s\nincl. VAT: %s\nTotal: %s\n",
		formatMoney(s.subtotalCents, s.currency),
		formatMoney(s.shippingCents, s.currency),
		formatMoney(s.taxCents, s.currency),
		formatMoney(s.totalCents, s.currency))
	if s.shipping != nil {
		fmt.Fprintf(&text, "\nShipping to:\n%s %s\n%s\n", s.shipping.firstName, s.shipping.lastName, s.shipping.addressLine1)
		if s.shipping.addressLine2 != "" {
			fmt.Fprintf(&text, "%s\n", s.shipping.addressLine2)
		}
		fmt.Fprintf(&text, "%s %s\n%s\n", s.shipping.postalCode, s.shipping.city, s.shipping.country)
	}
	fmt.Fprintf(&text, "\n— %s (%s)\n", cfg.ShopName, cfg.ShopPublicURL)

	return html.String(), text.String()
}

// ─── small helpers ───────────────────────────────────────────────────────

func formatMoney(cents int, currency string) string {
	return fmt.Sprintf("%.2f %s", float64(cents)/100.0, currency)
}

func displayName(name, email string) string {
	if s := strings.TrimSpace(name); s != "" {
		return s
	}
	if i := strings.IndexByte(email, '@'); i > 0 {
		return email[:i]
	}
	return email
}

func prefix(s, p string) string {
	if s == "" {
		return ""
	}
	return p + s
}

func imageTag(url string) string {
	if url == "" {
		return `<div style="width:64px;height:64px;background:#f3f4f6;border-radius:6px;"></div>`
	}
	return fmt.Sprintf(`<img src="%s" alt="" width="64" height="64" style="width:64px;height:64px;object-fit:cover;border-radius:6px;display:block;">`, htmlEsc(url))
}

var htmlReplacer = strings.NewReplacer(
	"&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;",
)

func htmlEsc(s string) string { return htmlReplacer.Replace(s) }
