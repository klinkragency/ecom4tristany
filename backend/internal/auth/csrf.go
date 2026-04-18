package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
)

const (
	CSRFCookieName = "csrf_token"
	CSRFHeaderName = "X-CSRF-Token"
)

// NewCSRFToken returns a URL-safe random token suitable for both the cookie and the header.
func NewCSRFToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// SetCSRFCookie writes the CSRF cookie. It is NOT HttpOnly because the client reads it.
// It IS SameSite=Lax and Secure (in prod) so third-party sites can't read it.
func SetCSRFCookie(w http.ResponseWriter, token, domain string, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     CSRFCookieName,
		Value:    token,
		Path:     "/",
		Domain:   domain,
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   60 * 60 * 12,
	})
}

// VerifyCSRF performs double-submit cookie verification.
func VerifyCSRF(r *http.Request) bool {
	c, err := r.Cookie(CSRFCookieName)
	if err != nil || c.Value == "" {
		return false
	}
	hdr := r.Header.Get(CSRFHeaderName)
	if hdr == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(c.Value), []byte(hdr)) == 1
}
