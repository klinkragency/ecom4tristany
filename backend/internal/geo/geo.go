// Package geo detects a request's country of origin without a paid GeoIP
// database. Resolution order:
//
//  1. `CF-IPCountry` — Cloudflare sets this on every proxied request.
//  2. `X-Country-Code` — generic header many reverse proxies set.
//  3. `Fly-Client-Country` — Fly.io-specific (for shops deploying there).
//  4. `Accept-Language` — parse the primary language tag's region subtag
//     (e.g. "fr-FR" → "FR", "en-US" → "US"). Imperfect but free and
//     surprisingly good: browsers set their OS locale and the locale
//     matches the country for most users.
//
// Returns an empty string when we truly can't tell — the caller decides
// how to degrade (show no hint, use shop default, …).
package geo

import (
	"net/http"
	"strings"
)

// DetectCountry returns an uppercase ISO-3166-1 alpha-2 code, or "".
func DetectCountry(r *http.Request) string {
	for _, h := range []string{"CF-IPCountry", "X-Country-Code", "Fly-Client-Country"} {
		if v := strings.ToUpper(strings.TrimSpace(r.Header.Get(h))); len(v) == 2 {
			return v
		}
	}
	if lang := r.Header.Get("Accept-Language"); lang != "" {
		if c := countryFromAcceptLanguage(lang); c != "" {
			return c
		}
	}
	return ""
}

// countryFromAcceptLanguage parses the first tag with q-value >= 0.5 and
// returns its region subtag. Ignores primary-only tags ("en", "fr") since
// they don't pinpoint a country — we'd rather return nothing and fall
// through to default than guess.
func countryFromAcceptLanguage(h string) string {
	for _, part := range strings.Split(h, ",") {
		tag := strings.TrimSpace(part)
		// Strip quality suffix like ";q=0.8". We don't care about the value
		// beyond "not the wildcard *", since browsers list preferences in
		// order.
		if i := strings.Index(tag, ";"); i >= 0 {
			tag = tag[:i]
		}
		if tag == "" || tag == "*" {
			continue
		}
		// Expect primary-region form: "fr-FR", "en-US", "pt-BR".
		bits := strings.Split(tag, "-")
		if len(bits) < 2 {
			continue
		}
		region := strings.ToUpper(strings.TrimSpace(bits[1]))
		if len(region) == 2 {
			return region
		}
	}
	return ""
}

// ─── Country → suggested currency ───────────────────────────────────────

// Map of ISO-2 countries to ISO-4217 currency codes. Small curated list:
// the shop only needs to know which *active* currency to suggest, so we
// cover the common storefront targets and leave everything else at "".
var countryCurrency = map[string]string{
	// Eurozone — all EUR.
	"AT": "EUR", "BE": "EUR", "CY": "EUR", "DE": "EUR", "EE": "EUR",
	"ES": "EUR", "FI": "EUR", "FR": "EUR", "GR": "EUR", "IE": "EUR",
	"IT": "EUR", "LT": "EUR", "LU": "EUR", "LV": "EUR", "MT": "EUR",
	"NL": "EUR", "PT": "EUR", "SI": "EUR", "SK": "EUR", "HR": "EUR",
	// Non-Eurozone EU with own currency.
	"BG": "BGN", "CZ": "CZK", "DK": "DKK", "HU": "HUF", "PL": "PLN",
	"RO": "RON", "SE": "SEK",
	// Others.
	"GB": "GBP", "US": "USD", "CA": "CAD", "CH": "CHF", "NO": "NOK",
	"AU": "AUD", "NZ": "NZD", "JP": "JPY", "BR": "BRL", "IN": "INR",
}

// SuggestCurrency returns the currency code that's idiomatic in the given
// country, or "" if we don't have a mapping. The storefront UI cross-checks
// this against the list of ACTIVE currencies before actually suggesting it
// — if the shop doesn't have USD configured, suggesting it would be rude.
func SuggestCurrency(country string) string {
	return countryCurrency[strings.ToUpper(strings.TrimSpace(country))]
}
