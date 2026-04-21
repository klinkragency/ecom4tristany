package server

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/3mg/shop/backend/internal/admin"
	"github.com/3mg/shop/backend/internal/analytics"
	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/cart"
	"github.com/3mg/shop/backend/internal/checkout"
	"github.com/3mg/shop/backend/internal/cms"
	"github.com/3mg/shop/backend/internal/collection"
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/currency"
	"github.com/3mg/shop/backend/internal/customer"
	"github.com/3mg/shop/backend/internal/discount"
	"github.com/3mg/shop/backend/internal/fulfillment"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/inventory"
	"github.com/3mg/shop/backend/internal/order"
	"github.com/3mg/shop/backend/internal/payments"
	"github.com/3mg/shop/backend/internal/product"
	"github.com/3mg/shop/backend/internal/returns"
	"github.com/3mg/shop/backend/internal/session"
	"github.com/3mg/shop/backend/internal/shipping"
	"github.com/3mg/shop/backend/internal/storage"
	"github.com/3mg/shop/backend/internal/tax"

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
	adminUsersH := admin.NewUsersHandler(d.DB, d.Cfg, d.Sessions)
	adminSettingsH := admin.NewSettingsHandler(d.DB, d.Cfg)
	productH := product.NewHandler(d.DB, d.Storage)
	r.Route("/api/admin", func(r chi.Router) {
		r.Use(auth.CSRF())
		r.Post("/auth/login", adminH.Login)
		// Invite acceptance is public — the invitee has no session yet.
		r.Post("/auth/invite/accept", adminUsersH.AcceptInvite)

		r.Group(func(r chi.Router) {
			r.Use(auth.RequireAdmin(d.Sessions))
			r.Use(admin.AuditMiddleware(d.DB))
			r.Post("/auth/logout", adminH.Logout)
			r.Get("/me", adminH.Me)
			r.Post("/auth/change-password", adminUsersH.ChangePassword)

			// ── Platform (owner-only) ───────────────────────────────────
			r.Group(func(r chi.Router) {
				r.Use(auth.RequireRole(d.DB, auth.RoleOwner))
				r.Get("/users", adminUsersH.List)
				r.Post("/users", adminUsersH.Invite)
				r.Post("/users/{id}/resend-invite", adminUsersH.ResendInvite)
				r.Put("/users/{id}/role", adminUsersH.SetRole)
				r.Delete("/users/{id}", adminUsersH.Delete)
				r.Get("/settings", adminSettingsH.Get)
				r.Put("/settings", adminSettingsH.Update)
				r.Get("/audit", adminUsersH.AuditList)
				// Per-country VAT rates
				taxH := tax.NewHandler(d.DB)
				r.Get("/tax-rates", taxH.List)
				r.Put("/tax-rates", taxH.Upsert)
				r.Delete("/tax-rates/{country}", taxH.Delete)
			})

			// Products — read + non-destructive writes allowed for staff.
			r.Get("/products", productH.List)
			r.Post("/products", productH.Create)
			r.Get("/products/{id}", productH.Get)
			r.Put("/products/{id}", productH.Update)
			// Destructive actions require admin or owner.
			r.Group(func(r chi.Router) {
				r.Use(auth.RequireRole(d.DB, auth.RoleOwner, auth.RoleAdmin))
				r.Delete("/products/{id}", productH.Delete)
			})

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
			// Refunds + cancel — not staff.
			r.Group(func(r chi.Router) {
				r.Use(auth.RequireRole(d.DB, auth.RoleOwner, auth.RoleAdmin))
				r.Post("/orders/{id}/refunds", refundH.Create)
			})

			// Fulfillments
			fulfH := fulfillment.NewHandler(d.DB, d.Cfg)
			r.Get("/orders/{id}/fulfillments", fulfH.ListForOrder)
			r.Post("/orders/{id}/fulfillments", fulfH.Create)
			r.Put("/fulfillments/{fulfillmentId}/tracking", fulfH.UpdateTracking)
			r.Post("/fulfillments/{fulfillmentId}/cancel", fulfH.Cancel)

			// Returns / RMA (admin side)
			retH := returns.NewHandler(d.DB, d.Cfg, d.Pay)
			r.Get("/returns", retH.AdminList)
			r.Post("/returns", retH.AdminCreate)
			r.Get("/returns/{id}", retH.AdminGet)
			r.Post("/returns/{id}/approve", retH.AdminApprove)
			r.Post("/returns/{id}/reject", retH.AdminReject)
			r.Post("/returns/{id}/receive", retH.AdminReceive)
			r.Post("/returns/{id}/refund", retH.AdminRefund)
			r.Post("/returns/{id}/cancel", retH.AdminCancel)

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

			// Shipping zones & rates
			shipH := shipping.NewHandler(d.DB)
			r.Get("/shipping/zones", shipH.ListZones)
			r.Post("/shipping/zones", shipH.CreateZone)
			r.Get("/shipping/zones/{id}", shipH.GetZone)
			r.Put("/shipping/zones/{id}", shipH.UpdateZone)
			r.Delete("/shipping/zones/{id}", shipH.DeleteZone)
			r.Post("/shipping/zones/{zoneId}/rates", shipH.CreateRate)
			r.Put("/shipping/rates/{id}", shipH.UpdateRate)
			r.Delete("/shipping/rates/{id}", shipH.DeleteRate)

			// Discounts — write requires admin or owner.
			discH := discount.NewHandler(d.DB)
			r.Get("/discounts", discH.List)
			r.Get("/discounts/{id}", discH.Get)
			r.Group(func(r chi.Router) {
				r.Use(auth.RequireRole(d.DB, auth.RoleOwner, auth.RoleAdmin))
				r.Post("/discounts", discH.Create)
				r.Put("/discounts/{id}", discH.Update)
				r.Delete("/discounts/{id}", discH.Delete)
			})

			// Analytics dashboards
			anaH := analytics.NewHandler(d.DB)
			finH := analytics.NewFinanceHandler(d.DB, d.Pay)
			r.Get("/analytics/summary", anaH.Summary)
			r.Get("/analytics/sales", anaH.Sales)
			r.Get("/analytics/top-products", anaH.TopProducts)
			r.Get("/analytics/funnel", anaH.Funnel)
			r.Get("/analytics/finance/sales", finH.SalesReport)
			r.Get("/analytics/finance/refunds", finH.RefundsReport)
			r.Get("/analytics/finance/store-credit", finH.StoreCreditLiability)
			r.Get("/analytics/finance/payouts", finH.Payouts)

			// PostHog (server-side proxy)
			phH := analytics.NewPostHogHandler(d.Cfg)
			r.Get("/analytics/posthog/overview", phH.Overview)

			// CMS — pages, menus, blog
			cmsH := cms.NewHandler(d.DB)
			blogH := cms.NewBlogHandler(d.DB, d.Cfg)
			r.Get("/content/pages", cmsH.AdminListPages)
			r.Post("/content/pages", cmsH.AdminCreatePage)
			r.Get("/content/pages/{id}", cmsH.AdminGetPage)
			r.Put("/content/pages/{id}", cmsH.AdminUpdatePage)
			r.Delete("/content/pages/{id}", cmsH.AdminDeletePage)
			r.Get("/content/menus", cmsH.AdminListMenus)
			r.Get("/content/menus/{id}", cmsH.AdminGetMenu)
			r.Put("/content/menus/{id}", cmsH.AdminUpdateMenu)
			r.Get("/content/blog", blogH.AdminList)
			r.Post("/content/blog", blogH.AdminCreate)
			r.Get("/content/blog/{id}", blogH.AdminGet)
			r.Put("/content/blog/{id}", blogH.AdminUpdate)
			r.Delete("/content/blog/{id}", blogH.AdminDelete)
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
			r.Post("/cart/discount", cartH.ApplyDiscount)
			r.Delete("/cart/discount", cartH.RemoveDiscount)
		})

		// Checkout — init PaymentIntent given current cart + addresses.
		checkoutH := checkout.NewHandler(d.DB, d.Cfg, d.Pay)
		r.Group(func(r chi.Router) {
			r.Use(auth.OptionalCustomer(d.Sessions))
			r.Use(auth.CSRF())
			r.Post("/checkout/init", checkoutH.Init)
			r.Post("/checkout/shipping-quote", shipping.NewHandler(d.DB).Quote)
		})
		// Order lookup (by ID, no auth required — ID is an unguessable UUID).
		r.Get("/orders/{id}", checkoutH.GetStorefrontOrder)

		// CMS (public reads)
		cmsH := cms.NewHandler(d.DB)
		blogH := cms.NewBlogHandler(d.DB, d.Cfg)
		r.Get("/pages/{slug}", cmsH.StorefrontPageBySlug)
		r.Get("/menus/{handle}", cmsH.StorefrontMenuByHandle)
		r.Get("/blog", blogH.StorefrontList)
		r.Get("/blog/feed.xml", blogH.StorefrontFeed)
		r.Get("/blog/{slug}", blogH.StorefrontBySlug)

		// Analytics ingest (storefront events). No CSRF — the endpoint is
		// read-only semantically (can't change shop state) and tracker scripts
		// historically don't carry CSRF tokens. The session middleware sets an
		// anonymous session cookie so funnels can be computed.
		anaIngest := analytics.NewHandler(d.DB)
		r.Group(func(r chi.Router) {
			r.Use(analytics.SessionMiddleware(!d.Cfg.SessionCookieSecure))
			r.Use(auth.OptionalCustomer(d.Sessions))
			r.Post("/events", anaIngest.Track)
		})
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

			// Returns (customer self-service)
			custRetH := returns.NewHandler(d.DB, d.Cfg, d.Pay)
			r.Get("/returns", custRetH.CustomerList)
			r.Post("/returns", custRetH.CustomerRequest)
			r.Get("/returns/{id}", custRetH.CustomerGet)
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
