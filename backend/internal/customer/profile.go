package customer

import (
	"net/http"
	"strings"

	"github.com/3mg/shop/backend/internal/httpx"
)

type MeResp struct {
	ID                string `json:"id"`
	Email             string `json:"email"`
	FirstName         string `json:"firstName"`
	LastName          string `json:"lastName"`
	Phone             string `json:"phone"`
	MarketingConsent  bool   `json:"marketingConsent"`
	StoreCreditCents  int    `json:"storeCreditCents"`
	StoreCreditCurrency string `json:"storeCreditCurrency"`
}

type UpdateProfileReq struct {
	FirstName        *string `json:"firstName,omitempty"`
	LastName         *string `json:"lastName,omitempty"`
	Phone            *string `json:"phone,omitempty"`
	MarketingConsent *bool   `json:"marketingConsent,omitempty"`
}

// UpdateProfile updates the current customer's profile fields. Email change
// is deferred (requires verification flow) — only handled by password reset
// in a future iteration.
func (h *Handler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	var req UpdateProfileReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	sets := []string{"updated_at = now()"}
	args := []any{cid}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, col+" = $"+strconvItoa(len(args)))
	}
	if req.FirstName != nil {
		add("first_name", strings.TrimSpace(*req.FirstName))
	}
	if req.LastName != nil {
		add("last_name", strings.TrimSpace(*req.LastName))
	}
	if req.Phone != nil {
		add("phone", strings.TrimSpace(*req.Phone))
	}
	if req.MarketingConsent != nil {
		add("marketing_consent", *req.MarketingConsent)
	}
	if len(sets) > 1 {
		if _, err := h.db.Exec(r.Context(),
			"UPDATE customers SET "+strings.Join(sets, ", ")+" WHERE id = $1", args...); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
			return
		}
	}
	h.loadMe(w, r, cid)
}

// MeExtended is a richer /me that includes store credit balance. The original
// customer.Handler.Me (in handler.go) is kept for backwards compat with the
// auth flow but the storefront will switch to this once the account page lands.
func (h *Handler) MeExtended(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	h.loadMe(w, r, cid)
}

func (h *Handler) loadMe(w http.ResponseWriter, r *http.Request, cid string) {
	var resp MeResp
	err := h.db.QueryRow(r.Context(), `
        SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.marketing_consent,
               COALESCE(sa.balance_cents, 0), COALESCE(sa.currency, 'EUR')
        FROM customers c
        LEFT JOIN store_credit_accounts sa ON sa.customer_id = c.id
        WHERE c.id = $1
    `, cid).Scan(&resp.ID, &resp.Email, &resp.FirstName, &resp.LastName,
		&resp.Phone, &resp.MarketingConsent,
		&resp.StoreCreditCents, &resp.StoreCreditCurrency)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, resp)
}

// strconvItoa: tiny helper to avoid importing strconv just for Itoa.
func strconvItoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [12]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
