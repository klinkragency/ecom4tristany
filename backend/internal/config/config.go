package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env                 string
	Port                int
	LogLevel            string
	DatabaseURL         string
	SessionCookieDomain string
	SessionCookieSecure bool
	SessionTTL          time.Duration
	CSRFKey             string
	CORSOrigins         []string
	RateLimitRPS        int
	RateLimitLoginRPM   int

	// Stripe
	StripeSecretKey      string
	StripePublishableKey string
	StripeWebhookSecret  string

	// Commerce
	ShopCurrency   string
	ShopVATPercent int
}

func Load() (*Config, error) {
	cfg := &Config{
		Env:                 getenv("APP_ENV", "development"),
		Port:                getenvInt("APP_PORT", 8080),
		LogLevel:            getenv("APP_LOG_LEVEL", "info"),
		DatabaseURL:         getenv("DATABASE_URL", ""),
		SessionCookieDomain: getenv("SESSION_COOKIE_DOMAIN", "localhost"),
		SessionCookieSecure: getenvBool("SESSION_COOKIE_SECURE", false),
		SessionTTL:          getenvDuration("SESSION_TTL", 7*24*time.Hour),
		CSRFKey:             getenv("CSRF_KEY", ""),
		CORSOrigins:         splitCSV(getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")),
		RateLimitRPS:        getenvInt("RATE_LIMIT_RPS", 20),
		RateLimitLoginRPM:   getenvInt("RATE_LIMIT_LOGIN_RPM", 10),

		StripeSecretKey:      getenv("STRIPE_SECRET_KEY", ""),
		StripePublishableKey: getenv("STRIPE_PUBLISHABLE_KEY", ""),
		StripeWebhookSecret:  getenv("STRIPE_WEBHOOK_SECRET", ""),

		ShopCurrency:   getenv("SHOP_CURRENCY", "EUR"),
		ShopVATPercent: getenvInt("SHOP_VAT_PERCENT", 20),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if len(cfg.CSRFKey) < 32 {
		return nil, fmt.Errorf("CSRF_KEY must be at least 32 characters")
	}
	if cfg.Env == "production" && !cfg.SessionCookieSecure {
		return nil, fmt.Errorf("SESSION_COOKIE_SECURE must be true in production")
	}
	return cfg, nil
}

func (c *Config) IsProd() bool { return c.Env == "production" }

func getenv(k, def string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return def
}

func getenvInt(k string, def int) int {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getenvBool(k string, def bool) bool {
	if v, ok := os.LookupEnv(k); ok {
		switch strings.ToLower(v) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return def
}

func getenvDuration(k string, def time.Duration) time.Duration {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
