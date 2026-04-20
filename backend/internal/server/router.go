package server

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/3mg/shop/backend/internal/admin"
	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/cart"
	"github.com/3mg/shop/backend/internal/checkout"
	"github.com/3mg/shop/backend/internal/collection"
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/customer"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/inventory"
	"github.com/3mg/shop/backend/internal/order"
	"github.com/3mg/shop/backend/internal/payments"
	"github.com/3mg/shop/backend/internal/product"
	"github.com/3mg/shop/backend/internal/session"
	"github.com/3mg/shop/backend/internal/shipping"
	"github.com/3mg/shop/backend/internal/storage"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Deps struct {
	Cfg      *config.Config
	Log      *slog.Logger
	DB       *pgxpool.Pool
	Sessions *session.Store
	Storage  storage.Storage
	Pay      *payments.Client
}

func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(RequestID)
	r.Use(Logger(d.Log))
	r.Use(Recover(d.Log))
	r.Use(SecurityHeaders)
	r.Use(CORS(d.Cfg.CORSOrigins))
	r.Use(IPRateLimit(d.Cfg.RateLimitRPS))

	r.Get("/api/health", healthHandler(d.DB))
	r.Get("/api/csrf", csrfHandler(d.Cfg))

	// Admin
	adminH := admin.NewHandler(d.DB, d.Sessions)
	productH := product.NewHandler(d.DB, d.Storage)
	r.Route("/api/admin", func(r chi.Router) {
		r.Use(auth.CSRF())
		r.Post("/auth/login", adminH.Login)

		r.Group(func(r chi.Router) {
			r.Use(auth.RequireAdmin(d.Sessions))
			r.Post("/auth/logout", adminH.Logout)
			r.Get("/me", adminH.Me)

			// Products
			r.Get("/products", productH.List)
			r.Post("/products", productH.Create)
			r.Get("/products/{id}", productH.Get)
			r.Put("/products/{id}", productH.Update)
			r.Delete("/products/{id}", productH.Delete)

			// Options + option values
			r.Post("/products/{id}/options", productH.AddOption)
			r.Delete("/options/{optionId}", productH.DeleteOption)
			r.Post("/options/{optionId}/values", productH.AddOptionValue)
			r.Delete("/option-values/{valueId}", productH.DeleteOptionValue)

			// Variants
			r.Post("/products/{id}/variants", productH.AddVariant)
			r.Put("/variants/{variantId}", productH.UpdateVariant)
			r.Delete("/variants/{variantId}", productH.DeleteVariant)

			// Media
			r.Post("/products/{id}/media/presign", productH.PresignMediaUpload)
			r.Post("/products/{id}/media", productH.AttachMedia)
			r.Post("/products/{id}/media/reorder", productH.ReorderMedia)
			r.Put("/media/{mediaId}", productH.UpdateMedia)
			r.Delete("/media/{mediaId}", productH.DeleteMedia)

			// CSV import / export
			r.Get("/catalog/exports/products", productH.ExportCSV)
			r.Post("/catalog/imports/products", productH.ImportCSVHandler)

			// Collections
			collH := collection.NewHandler(d.DB)
			r.Get("/collections", collH.List)
			r.Post("/collections", collH.Create)
			r.Get("/collections/{id}", collH.Get)
			r.Put("/collections/{id}", collH.Update)
			r.Delete("/collections/{id}", collH.Delete)
			r.Post("/collections/{id}/products", collH.AttachProducts)
			r.Delete("/collections/{id}/products/{productId}", collH.DetachProduct)
			r.Post("/collections/{id}/products/reorder", collH.ReorderProducts)
			r.Post("/collections/{id}/rules", collH.AddRule)
			r.Delete("/rules/{ruleId}", collH.DeleteRule)

			// Inventory — locations + levels + transfers
			invH := inventory.NewHandler(d.DB)
			r.Get("/locations", invH.ListLocations)
			r.Post("/locations", invH.CreateLocation)
			r.Put("/locations/{id}", invH.UpdateLocation)
			r.Delete("/locations/{id}", invH.DeleteLocation)

			r.Get("/products/{id}/inventory", invH.ProductMatrix)
			r.Post("/inventory/set", invH.SetLevels)
			r.Post("/inventory/adjust", invH.Adjust)

			r.Get("/transfers", invH.ListTransfers)
			r.Post("/transfers", invH.CreateTransfer)
			r.Get("/transfers/{id}", invH.GetTransfer)
			r.Post("/transfers/{id}/ship", invH.ShipTransfer)
			r.Post("/transfers/{id}/receive", invH.ReceiveTransfer)
			r.Post("/transfers/{id}/cancel", invH.CancelTransfer)

			// Orders (admin view + lifecycle actions).
			orderH := order.NewHandler(d.DB)
			refundH := order.NewRefundHandler(orderH, d.Pay)
			r.Get("/orders", orderH.List)
			r.Get("/orders/{id}", orderH.Get)
			r.Post("/orders/{id}/cancel", orderH.Cancel)
			r.Put("/orders/{id}/note", orderH.SetNote)
			r.Put("/orders/{id}/tags", orderH.SetTags)
			r.Post("/orders/{id}/refunds", refundH.Create)

			// Customers (admin view + CRM actions).
			custAdminH := customer.NewHandler(d.DB, d.Sessions)
			r.Get("/customers", custAdminH.AdminList)
			r.Get("/customers/{id}", custAdminH.AdminGet)
			r.Put("/customers/{id}/note", custAdminH.AdminSetNote)
			r.Put("/customers/{id}/tags", custAdminH.AdminSetTags)
			r.Post("/customers/{id}/store-credit", custAdminH.AdminGrantCredit)

			// GDPR (admin-side)
			r.Get("/customers/{id}/data-export", custAdminH.AdminDataExport)
			r.Post("/customers/{id}/erase", custAdminH.AdminAccountErase)

			// Merge duplicates
			r.Post("/customers/{id}/merge", custAdminH.AdminMerge)

			// Customer segments (saved filters)
			r.Get("/segments", custAdminH.ListSegments)
			r.Post("/segments", custAdminH.CreateSegment)
			r.Get("/segments/{id}", custAdminH.GetSegment)
			r.Put("/segments/{id}", custAdminH.UpdateSegment)
			r.Delete("/segments/{id}", custAdminH.DeleteSegment)
			r.Get("/segments/{id}/customers", custAdminH.PreviewSegment)
		})
	})

	// Storefront (public)
	r.Route("/api/storefront", func(r chi.Router) {
		r.Get("/products", storefrontProductsList(d.DB))
		r.Get("/products/{handle}", storefrontProductByHandle(d.DB))
		r.Get("/collections", storefrontCollectionsList(d.DB))
		r.Get("/collections/{handle}", storefrontCollectionByHandle(d.DB))

		// Cart (guests + authenticated customers).
		cartH := cart.NewHandler(d.DB, d.Cfg)
		r.Group(func(r chi.Router) {
			r.Use(auth.OptionalCustomer(d.Sessions))
			r.Use(auth.CSRF())
			r.Get("/cart", cartH.Get)
			r.Post("/cart/items", cartH.Add)
			r.Put("/cart/items/{itemId}", cartH.Update)
			r.Delete("/cart/items/{itemId}", cartH.Remove)
			r.Post("/cart/clear", cartH.Clear)
		})

		// Checkout — init PaymentIntent given current cart + addresses.
		checkoutH := checkout.NewHandler(d.DB, d.Cfg, d.Pay)
		r.Group(func(r chi.Router) {
			r.Use(auth.OptionalCustomer(d.Sessions))
			r.Use(auth.CSRF())
			r.Post("/checkout/init", checkoutH.Init)
		})
		// Order lookup (by ID, no auth required — ID is an unguessable UUID).
		r.Get("/orders/{id}", checkoutH.GetStorefrontOrder)
	})

	// Stripe webhook — no CSRF, no session; Stripe authenticates via the
	// Stripe-Signature header (verified with STRIPE_WEBHOOK_SECRET).
	r.Post("/api/webhooks/stripe", checkout.NewHandler(d.DB, d.Cfg, d.Pay).StripeWebhook)

	// Customer
	custH := customer.NewHandlerWithConfig(d.DB, d.Sessions, d.Cfg)
	r.Route("/api/customer", func(r chi.Router) {
		r.Use(auth.CSRF())
		r.Post("/auth/register", custH.Register)
		r.Post("/auth/login", custH.Login)
		// Password reset — public (no session required)
		r.Post("/auth/password-reset/request", custH.RequestPasswordReset)
		r.Post("/auth/password-reset/confirm", custH.ConfirmPasswordReset)

		r.Group(func(r chi.Router) {
			r.Use(auth.RequireCustomer(d.Sessions))
			r.Post("/auth/logout", custH.Logout)
			r.Get("/me", custH.Me)

			// Extended profile + store credit
			r.Get("/profile", custH.MeExtended)
			r.Put("/profile", custH.UpdateProfile)

			// Address book
			r.Get("/addresses", custH.ListAddresses)
			r.Post("/addresses", custH.CreateAddress)
			r.Put("/addresses/{id}", custH.UpdateAddress)
			r.Delete("/addresses/{id}", custH.DeleteAddress)

			// Order history (customer-facing)
			r.Get("/orders", custH.ListMyOrders)
			r.Get("/orders/{id}", custH.GetMyOrder)

			// Store credit ledger
			r.Get("/store-credit", custH.MyStoreCredit)

			// GDPR (customer self-service)
			r.Get("/data-export", custH.MyDataExport)
			r.Post("/account/erase", custH.MyAccountErase)
		})
	})

	return r
}

func healthHandler(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dbStatus := "up"
		ctx, cancel := context.WithTimeout(r.Context(), 500_000_000) // 500ms
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			dbStatus = "down"
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok": dbStatus == "up",
			"db": dbStatus,
		})
	}
}

func csrfHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, err := auth.NewCSRFToken()
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "csrf_error", "could not generate token")
			return
		}
		auth.SetCSRFCookie(w, token, cfg.SessionCookieDomain, cfg.SessionCookieSecure)
		httpx.JSON(w, http.StatusOK, map[string]string{"csrfToken": token})
	}
}
