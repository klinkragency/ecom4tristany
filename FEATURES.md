# FEATURES — Single-Shop Shopify-Like Ecommerce

Complete feature inventory for the platform. Modeled on Shopify's capabilities but scoped to **one shop** (no multi-store, no Plus-exclusive multi-org features). Each section lists: scope, admin-side capabilities, storefront/customer-side capabilities, key data model concepts, and explicit non-goals for v1.

> This is the authoritative feature list. The implementation plan at `~/.claude/plans/i-want-to-create-replicated-scone.md` phases these features into buildable chunks. Each phase gets its own spec before code is written.

## Table of contents

1. [Catalog, Products & Inventory](#1-catalog-products--inventory)
2. [Orders, Payments, Refunds & Fraud](#2-orders-payments-refunds--fraud)
3. [Customers, Segments, Accounts & Store Credit](#3-customers-segments-accounts--store-credit)
4. [Promotions, Discounts & Marketing](#4-promotions-discounts--marketing)
5. [Storefront, Themes, Content, Menus, Files & Metaobjects](#5-storefront-themes-content-menus-files--metaobjects)
6. [Sales Channels](#6-sales-channels)
7. [Shipping, Pickup, Fulfillment & Returns](#7-shipping-pickup-fulfillment--returns)
8. [Analytics, Finance & Reporting](#8-analytics-finance--reporting)
9. [Customer Support — Inbox](#9-customer-support--inbox)
10. [Automation — Flow](#10-automation--flow)
11. [International — Markets](#11-international--markets)
12. [POS / Retail](#12-pos--retail)
13. [Users, Permissions, Settings, Apps & Plus Options](#13-users-permissions-settings-apps--plus-options)
14. [Cross-cutting Requirements](#14-cross-cutting-requirements)

---

## 1. Catalog, Products & Inventory

### 1.1 Products
- Create / edit / duplicate / archive / delete products
- Fields: title, description (rich text), status (draft / active / archived), handle (URL slug), vendor, product type, tags
- SEO: meta title, meta description, URL handle override
- Publishing: per-sales-channel visibility, scheduled publishing, publish/unpublish
- Media: multiple images, videos (MP4, embed), 3D models (GLB), alt text, drag-reorder, per-variant images
- Per-product tax status (taxable / non-taxable) + tax code (for later tax integration)
- Per-product shipping requirements (weight, dimensions, HS code for customs)
- Gift card product type (separate flow — digital with auto-generated codes)

### 1.2 Variants & Options
- Up to 3 options per product (e.g. Size, Color, Material)
- Option values generate variants (cartesian product) with per-variant:
  - SKU, barcode (UPC/EAN/ISBN), price, compare-at price, cost
  - Weight / dimensions
  - Inventory tracking toggle
  - Per-location inventory levels
  - Individual image
  - Individual "continue selling when out of stock" flag
- Bulk editor for variants (spreadsheet-like)

### 1.3 Collections
- **Manual** collections: admin picks products explicitly, reorderable
- **Automated** (rule-based) collections: conditions (price range, tag, vendor, type, inventory, stock status) joined by AND/OR
- Collection metadata: title, handle, description, image, SEO fields
- Per-channel publishing
- Sort order (manual, best-selling, price asc/desc, alphabetical, date, inventory)

### 1.4 Inventory
- Multiple **locations** (warehouses, retail stores, 3PL, pop-up)
- Per-variant, per-location stock level (on-hand, committed, available, incoming)
- Inventory adjustments with reason codes (received, damaged, theft, correction, count)
- Stock transfers between locations (draft → in-transit → received)
- Reorder points + low-stock alerts per variant/location
- Bulk CSV import/export
- Barcode scanner entry
- Inventory history / audit log per SKU

### 1.5 Gift cards (as a product type)
- Denominations (preset + custom amount)
- Delivery: email to recipient with scheduled send
- Balance tracking, partial redemption, expiration rules
- Issue / refund / disable codes from admin

### 1.6 Bulk operations
- CSV import/export for products, variants, inventory
- Bulk edit (tags, prices, inventory, status)
- Product import from Shopify / WooCommerce CSV formats

### Data model
`product`, `product_option`, `product_option_value`, `variant`, `collection`, `collection_product`, `location`, `inventory_level`, `inventory_adjustment`, `stock_transfer`, `product_media`, `tag`, `gift_card`.

### Non-goals v1
- 3D model viewer integration (supports upload, storefront renders via `<model-viewer>` web component)
- Serialized inventory (per-unit tracking)
- Real-time ERP sync
- Unit-of-measure conversions

---

## 2. Orders, Payments, Refunds & Fraud

### 2.1 Order lifecycle
- States: `pending` → `paid` / `partially_paid` → `fulfilled` / `partially_fulfilled` → `cancelled` / `refunded` / `partially_refunded`
- Fulfillment states: `unfulfilled` / `partial` / `fulfilled` / `restocked`
- Financial states: `authorized` / `paid` / `partially_paid` / `refunded` / `partially_refunded` / `voided`
- Full state machine with allowed transitions + audit log

### 2.2 Order creation paths
- Online checkout (storefront)
- Draft orders (admin-created, invoice sent to customer)
- POS orders (Phase 12)
- Imported orders (from CSV)
- Subscription recurring orders (deferred)

### 2.3 Order details
- Line items (with variant snapshot, not live reference — frozen at purchase)
- Pricing snapshot: price, discount, tax, total
- Applied discount codes + automatic discounts breakdown
- Customer, shipping address, billing address
- Shipping method + rate snapshot
- Notes (customer-facing + internal)
- Tags
- Attribution (referrer, UTM, landing page, device)
- Timeline (all events: created, paid, fulfilled, note added, email sent, refund issued…)

### 2.4 Payments
- Stripe as primary processor (Phase 3)
- Payment methods: card (via Stripe Elements), Apple Pay, Google Pay, SEPA, iDEAL, Bancontact (configurable)
- Manual payment methods: bank transfer, money order, cash-on-delivery (admin marks paid)
- Payment capture modes: auto-capture on auth, manual capture (for fraud review)
- Multi-capture / partial capture
- Payment retries for failed auth
- Saved payment methods for returning customers (Stripe Customer + SetupIntent)

### 2.5 Refunds
- Full + partial refunds
- Refund to original payment method + refund to **store credit**
- Restock toggle per line item
- Refund reason codes
- Refund shipping toggle

### 2.6 Fraud
- Stripe Radar integration (risk score + recommendation)
- Address Verification Service (AVS), CVV check outcomes stored
- High-risk order queue (admin review required before fulfillment)
- Custom fraud rules (block list: email, IP, BIN, country)
- Chargeback tracking + evidence upload

### 2.7 Invoices & receipts
- Auto-generated order confirmation email (with branding)
- PDF invoice per order (EU-compliant: VAT number, invoice number series, seller/buyer info)
- Per-country invoice numbering sequence

### 2.8 Abandoned checkouts
- Captured at email-entry step during checkout
- Admin view of abandoned carts
- Recovery emails (Flow-driven in Phase 10)

### Data model
`order`, `order_line_item`, `order_address`, `order_note`, `order_tag`, `payment`, `refund`, `refund_line_item`, `fulfillment` (see §7), `timeline_event`, `fraud_assessment`, `chargeback`, `abandoned_checkout`, `invoice`.

### Non-goals v1
- Multi-currency per order (Phase 11)
- Marketplace-style split payments / payouts
- Buy-now-pay-later (beyond Stripe's hosted BNPL options)

---

## 3. Customers, Segments, Accounts & Store Credit

### 3.1 Customer accounts
- Registration (email + password), optional email verification
- Login, logout, password reset (email magic link)
- Passwordless login (email OTP) — optional
- OAuth social login (Google, Apple) — Phase 4+
- Account deletion (GDPR) + data export

### 3.2 Customer profile
- Contact: email, phone, name, DOB (optional), language, marketing consent
- Multiple saved addresses (shipping + billing, default flag)
- Tax-exempt flag + tax number (VAT ID for B2B)
- Accepts-marketing toggles per channel (email, SMS)
- Notes (admin-only), tags (admin-visible)

### 3.3 Order history (customer-facing)
- List of past orders with status + tracking
- Re-order button
- Request return / cancellation
- Download invoice PDFs

### 3.4 Admin customer view
- Search by name / email / phone / order number
- Lifetime value (LTV), order count, avg order value, last-order date
- Tags, notes, timeline (orders, support tickets, events)
- Merge duplicate customers

### 3.5 Segments
- Saved filters with boolean logic: tag = X AND LTV > 100 AND last_order < 30d ago…
- Predefined segments: VIP (top 10% LTV), at-risk (no order in 60d), first-time buyer, repeat buyer
- Dynamic segments (auto-update) vs. static lists (snapshot)
- Use in: promotions targeting, email campaigns, automation triggers

### 3.6 Store credit (gift-card-like balance per customer)
- Credit issued by: refund-to-credit, manual admin grant, promotional (birthday), compensation
- Credit spent at checkout (applied before/after discount depending on config)
- Double-entry ledger: every debit/credit recorded with source reference
- Expiration rules (configurable, default no-expire)
- Customer-facing balance view in account
- Admin view: ledger history per customer

### 3.7 B2B lite (optional for later)
- Company accounts with multiple buyer users
- Company-level payment terms (net 30 etc.) — deferred
- Per-company price lists — deferred

### Data model
`customer`, `customer_address`, `customer_tag`, `customer_segment`, `customer_segment_member`, `store_credit_account`, `store_credit_ledger_entry`, `auth_identity` (for OAuth).

### Non-goals v1
- Full B2B/wholesale channel (mentioned under §13 Plus options, deferred)
- Loyalty / points program (build as separate Flow-driven app later)
- SMS auth

---

## 4. Promotions, Discounts & Marketing

### 4.1 Discount types
- **Discount codes** (customer enters at checkout)
- **Automatic discounts** (applied when conditions match — no code)
- **Buy X get Y** (BOGO, BXGY)
- **Free shipping**
- **Amount off order** (fixed or %)
- **Amount off products** (fixed or %)

### 4.2 Conditions
- Minimum purchase: amount or quantity
- Customer eligibility: all / specific segments / specific customers / first-time-only
- Product eligibility: all / specific products / specific collections / specific tags
- Combination rules: combines-with-other-codes flags (shipping + order, order + product, product + product)
- Usage limits: total redemptions, per-customer redemptions
- Start / end dates + timezone
- Channel-specific (online only, POS only, both)

### 4.3 Discount management
- List, search, duplicate, disable, delete
- Bulk code generation (e.g. 10000 unique codes for a campaign)
- Per-code redemption analytics

### 4.4 Marketing essentials
- Transactional emails: order confirmation, shipped, delivered, refund, password reset, welcome
- Marketing emails: campaign builder (Phase 9+) — list, filter by segment, draft, schedule, send, track open/click
- SMS (deferred, via Twilio integration as an app)
- Pop-up builder for newsletter signup / exit-intent
- Embed checkout badges, discount banners

### 4.5 SEO & content marketing
- Product / collection / blog / page-level SEO fields
- Auto-generated `sitemap.xml`, `robots.txt`
- Structured data (JSON-LD) for products, breadcrumbs, articles
- Canonical URL handling for variant / filter combinations
- Redirects manager (old URL → new URL, 301/302)

### 4.6 Blog
- Articles, authors, tags, categories
- Draft / published states, scheduled publish
- Comments (moderated) — optional
- RSS feed

### Data model
`discount`, `discount_code`, `discount_usage`, `automatic_discount`, `email_template`, `marketing_campaign`, `email_send`, `redirect`, `blog_article`, `blog_author`.

### Non-goals v1
- Email deliverability infrastructure (use Postmark / Resend / SES as a service)
- A/B testing framework
- Personalization / product recommendations (can be bolted on later)

---

## 5. Storefront, Themes, Content, Menus, Files & Metaobjects

### 5.1 Storefront
- Public website: home, collections, product pages, cart, checkout, search, account, blog, policy pages
- Server-rendered (Next.js App Router) with ISR / SSG for catalog pages
- Mobile-first responsive
- WCAG 2.1 AA baseline
- PWA manifest + installable

### 5.2 Themes
- **v1:** Tailwind-based React component library as the "default theme" — no JSON templating yet
- **Later (Phase 8):** JSON template schema (Shopify-style) with sections + blocks
- Theme editor in admin: preview + component settings (colors, typography, logo, layout density)
- Live preview with unpublished changes
- Theme versioning + publish/rollback
- Multiple themes saved, one published at a time
- Global design tokens: colors, typography, spacing, border radius, shadow

### 5.3 Pages (static content)
- Rich-text page editor (About, Contact, FAQ, Policies)
- SEO fields
- Page templates (different layouts)
- Draft / published / scheduled

### 5.4 Menus / Navigation
- Main menu, footer menu, any custom menu
- Nested items (up to 3 levels)
- Link targets: page, collection, product, blog, external URL, custom
- Per-item: title, URL, optional icon, optional badge ("New", "Sale")

### 5.5 Files & media library
- Upload images, videos, PDFs, fonts, icons
- Per-file: alt text, tags, folder/collection, size, dimensions
- Automatic image optimization: resize, WebP/AVIF conversion, CDN delivery
- Search + filter library
- Reuse files across products / pages / blog / metaobjects
- Storage backend: S3-compatible (R2, MinIO, AWS S3) abstraction

### 5.6 Metaobjects (custom content types)
- Admin-defined types: e.g. "Chef profile", "FAQ entry", "Size guide", "Testimonial"
- Fields per type: text, rich text, number, boolean, date, reference to product / collection / file / other metaobject, list variants
- Bulk CRUD in admin
- Referenced from: theme templates, product pages, custom pages
- Public or private (admin-only)
- Versioning + draft state

### 5.7 Metafields (custom fields on existing entities)
- Attach key-value metafields to: product, variant, customer, order, collection, company, location
- Typed (text, number, date, reference, rich text, JSON)
- Namespaced (`custom.fabric_composition`, `custom.care_instructions`)
- Exposed to storefront via API
- Private (admin-only) vs. public

### 5.8 Search
- Storefront full-text search over products, collections, articles, pages
- Filters: price, availability, tag, vendor, option values (size, color), metafield-based
- Sort: relevance, price, newest, best-seller
- Engine: Postgres FTS → swap to Meilisearch / Typesense at scale
- Admin search (global cmd-K): orders, customers, products, discounts, settings

### Data model
`theme`, `theme_setting`, `page`, `menu`, `menu_item`, `file`, `file_tag`, `metaobject_definition`, `metaobject_field_definition`, `metaobject`, `metafield_definition`, `metafield`.

### Non-goals v1
- Multi-theme A/B testing
- Liquid-equivalent templating DSL (Shopify Liquid) — v1 uses React components directly
- Public theme marketplace

---

## 6. Sales Channels

### 6.1 Channel primitive
- Channel = where products are sold. First-party channels: online store, POS. Third-party: marketplace adapters.
- Per-product, per-variant publishing state per channel
- Per-channel pricing overrides (optional) — deferred
- Per-channel inventory availability

### 6.2 Channels list (v1)
- **Online store** (always on, always channel #1)
- **POS** (Phase 12)
- **Buy button / embeds** — generate embeddable cart + checkout for external sites

### 6.3 Channel stubs (adapter points, real integrations later)
- Meta (Facebook + Instagram shops) — product feed, catalog sync
- Google Shopping — Merchant Center feed
- TikTok Shop — feed + order ingestion
- Amazon / eBay — marketplace listing sync
- Pinterest — catalog feed
- Each stub is a separate app/integration project after primitives land

### 6.4 Product feeds
- Google Merchant Center XML / TSV
- Meta product catalog CSV
- Auto-regenerated on product change
- Public URL per channel feed

### Data model
`sales_channel`, `product_publication` (product × channel visibility), `channel_feed`.

### Non-goals v1
- Cross-channel order aggregation dashboards (Phase 8 analytics covers this broadly)
- Real marketplace SDK integrations

---

## 7. Shipping, Pickup, Fulfillment & Returns

### 7.1 Shipping configuration
- Shipping **zones** (country / state / postal code ranges)
- Per-zone **rates**:
  - Flat rate
  - Weight-based tiers
  - Price-based tiers
  - Free shipping thresholds
  - Carrier-calculated rates (API integration — Phase 2+)
- Rate conditions (only applies if cart has X, etc.)
- Rate scheduling (holiday shipping surcharges)

### 7.2 Shipping profiles
- Default profile for most products
- Custom profiles for heavy / oversized / HAZMAT items with different rates
- Per-product profile assignment

### 7.3 Packages
- Define package types (box sizes, envelopes) with dimensions + tare weight
- Used for carrier-calculated rates + customs declarations

### 7.4 Fulfillment
- Fulfillment workflow: `unfulfilled` → `in_progress` → `fulfilled` (with tracking) → `delivered`
- Per-line-item fulfillment (split shipments)
- Per-location fulfillment routing (assign order to location based on inventory)
- Bulk fulfillment (print packing slips for multiple orders)
- Packing slip / shipping label printing
- Carrier integrations (deferred — abstract `ShippingCarrier` interface):
  - UPS, FedEx, DHL, USPS, Colissimo, Chronopost, Mondial Relay…
- Tracking number entry + tracking page for customers
- Automatic fulfillment for digital goods / gift cards

### 7.5 Pickup (BOPIS — Buy Online Pickup In Store)
- Enable per-location
- Pickup rates (usually free)
- Pickup instructions (email + order page)
- Ready-for-pickup → picked-up flow in admin / POS
- Deferred to Phase 6 — flag as out-of-scope for v1

### 7.6 Local delivery
- Enable per-location with radius / postal code list
- Time windows, minimum order, delivery fee
- Delivery status: scheduled → out for delivery → delivered
- Deferred to Phase 6

### 7.7 Returns (RMA)
- Customer-initiated return request (reason + items selected)
- Admin approves / rejects
- Return shipping label generation (carrier API)
- Restock option per item
- Refund tied to return (to original payment method OR store credit)
- Exchange flow (create replacement draft order) — v2
- Return reason analytics

### 7.8 Fraud prevention in fulfillment
- Hold high-risk orders from auto-fulfillment
- Require admin approval for orders over $X

### Data model
`shipping_zone`, `shipping_rate`, `shipping_profile`, `package`, `fulfillment`, `fulfillment_line_item`, `tracking`, `return`, `return_line_item`, `return_reason`.

### Non-goals v1
- Real carrier API integrations (abstract interface + "manual shipping" only)
- Local delivery routing / driver app
- Multi-warehouse inventory allocation optimization

---

## 8. Analytics, Finance & Reporting

### 8.1 Event collection
- Server-side events (orders, refunds, fulfillments, signups, logins)
- Client-side events (page views, product views, add-to-cart, checkout step, purchase)
- First-party tracking (no 3rd-party cookies required)
- Exportable to GA4, Meta CAPI, TikTok, Google Ads (server-side forwarding)

### 8.2 Dashboards
- **Overview**: total sales, orders, conversion rate, avg order value, sessions, returning customer rate — with comparison to previous period
- **Sales**: gross sales, discounts, returns, net sales, taxes, shipping, tips, total
- **Acquisition**: sessions by source/medium/campaign, landing pages, devices
- **Behavior**: cart abandonment rate, checkout abandonment funnel, product views → add-to-cart rate
- **Customers**: new vs. returning, first-time vs. repeat, LTV curve
- **Products**: top sellers by revenue / units, low stock, out-of-stock losses
- **Marketing**: discount code performance, email campaign revenue, UTM attribution
- Date-range picker, comparison mode, export to CSV / PDF

### 8.3 Finance reports
- Daily / monthly payouts with Stripe reconciliation
- Transactions by status (authorized / captured / refunded / voided)
- Tax reports per jurisdiction (VAT returns helper — EU: per-country sales + OSS scheme)
- Chargebacks + disputes
- Gift card liability
- Store credit liability
- Balance sheet-style view: outstanding refunds, unfulfilled paid orders, gift card balance, store credit balance

### 8.4 Custom reports
- Report builder: pick metrics + dimensions + filters → table / chart
- Save / share / schedule (email CSV weekly)
- SQL-backed (admin power users can write SQL in sandbox DB)

### 8.5 Accounting integrations (stubs)
- Exports to QuickBooks, Xero, Pennylane (FR), Sage — CSV formats
- Real integrations = separate app projects

### Data model
Append-only `analytics_event` table (partitioned by date), materialized views for dashboards, `finance_report_snapshot`.

### Non-goals v1
- Real-time dashboards (5-minute refresh is fine)
- Cohort retention analysis (add in Phase 7+)
- Custom attribution models beyond last-click

---

## 9. Customer Support — Inbox

### 9.1 Unified conversation inbox
- Channels: email (IMAP poll or SES/Postmark inbound webhook), live chat widget, contact form, social DMs (deferred)
- Threaded conversations with customer timeline
- Assignment to staff member
- Statuses: open / snoozed / closed / spam
- Internal notes (not customer-visible)
- Mentions + notifications

### 9.2 Live chat
- Widget script on storefront
- Real-time (WebSocket or SSE)
- Pre-chat form (name, email, order #)
- Offline mode → becomes an email
- Typing indicators, read receipts
- File attachments

### 9.3 Customer context
- Right sidebar: customer profile, orders, LTV, tags, notes
- Related orders auto-linked based on order # in message body
- Quick actions: issue refund, send return label, add note, tag customer

### 9.4 Canned responses / macros
- Team library + personal snippets
- Variable substitution: `{{customer.first_name}}`, `{{order.number}}`
- Insert via slash command in composer

### 9.5 SLA / response tracking
- First response time, resolution time per conversation
- Reports: by agent, by channel, by tag

### 9.6 AI assist (optional)
- Suggested replies
- Auto-tag conversations by topic (refund, shipping, sizing…)
- Sentiment score

### Data model
`conversation`, `message`, `conversation_tag`, `conversation_assignment`, `canned_response`, `chat_widget_session`.

### Non-goals v1
- Voice channel
- Multi-language auto-translation

---

## 10. Automation — Flow

### 10.1 Flow engine
- **Trigger → conditions → actions** workflow model (Shopify Flow / Zapier-style)
- JSON-persisted definition + visual editor
- Versioning, enable/disable, run history

### 10.2 Triggers (catalog of events)
- Order created / paid / fulfilled / refunded / cancelled / risk-flagged
- Customer created / tag added / segment-entered
- Product out-of-stock / low-stock / published
- Cart abandoned
- Return requested / approved / received
- Inbox message received
- Scheduled (cron-like, e.g. "every Monday 9am")

### 10.3 Conditions
- Compare any field on the triggering entity
- Compound logic (AND / OR / NOT, nested)
- Reference related entities (order.customer.total_spent, line_item.product.tags)

### 10.4 Actions
- Send transactional email (built-in templates or custom)
- Send SMS (if Twilio configured)
- Tag / untag customer, product, order
- Create admin task / notification
- Call webhook (outbound HTTP)
- Hold / release fraud-flagged orders
- Adjust inventory (e.g. on cancellation)
- Issue store credit
- Add internal note
- Assign Inbox conversation

### 10.5 Example preset flows (shipped by default)
- "Tag VIP customers when LTV > €500"
- "Send recovery email 1h after abandoned checkout"
- "Notify staff on high-risk order"
- "Auto-restock inventory on refund"
- "Post-purchase review request email 10 days after delivery"

### 10.6 Run history & observability
- Per-run log: triggered at, conditions evaluated, actions taken, failures
- Retry on failure with exponential backoff
- Dead-letter queue for persistent failures

### Data model
`flow_definition`, `flow_run`, `flow_step_execution`, `flow_schedule`.

### Non-goals v1
- User-defined custom JavaScript in actions (sandbox complexity)
- Drag-drop node editor (v1 = form-based editor with step list; visual comes later)

---

## 11. International — Markets

### 11.1 Markets primitive
- A **market** = a grouping of countries with shared pricing / currency / tax / language / domain strategy
- Default market (home country) + additional markets (e.g. "EU outside home country", "UK", "USA", "Rest of world")
- Per-market enable/disable

### 11.2 Currencies
- Per-market currency + rounding rules
- Display conversion using daily FX rates (ECB feed) OR manual price overrides per product per market
- Price rounding: nearest .99, .95, or no rounding

### 11.3 Languages
- Per-market language list (e.g. FR, EN for French market)
- Storefront i18n: all UI strings + content translated
- Translation admin: key-value editor, import/export PO/XLIFF
- Auto-translate seed (via provider API — DeepL etc.) then human-edit
- Per-entity translation: product title/description, collection, page, blog, metaobject, menu, email template

### 11.4 Tax rules
- EU VAT: per-country rates, OSS / IOSS scheme for cross-border B2C
- VAT validation for B2B (VIES check)
- US: sales tax (state + local) — via TaxJar / Stripe Tax integration
- UK: post-Brexit VAT handling
- Tax-inclusive vs. tax-exclusive pricing per market
- Duties + import taxes (DDP display at checkout for supported destinations)

### 11.5 Domain strategy
- Subfolders (`/fr`, `/en`) or subdomains (`fr.shop.com`) or separate domains per market
- Geo-redirect on first visit (with "did you mean" banner, respects user choice)
- Hreflang tags auto-generated

### 11.6 Shipping per market
- Different shipping zones activated per market (see §7)
- International paperwork: HS codes, commercial invoice generation

### Data model
`market`, `market_country`, `market_language`, `currency`, `fx_rate`, `product_market_price_override`, `translation`, `tax_rule`, `tax_rate`.

### Non-goals v1
- Local payment method optimization per market (handled by Stripe automatically for supported methods)
- Market-specific product catalogs (all products available everywhere unless unpublished per market — v2)

---

## 12. POS / Retail

### 12.1 POS app
- Tablet-first (iPad / Android tablet), responsive down to phone
- Web-based (Next.js PWA) OR React Native wrapper — decide at design time
- Offline-first: sync queue when connection returns
- Staff PIN login, quick user switching

### 12.2 Cart / checkout flow
- Scan / search product (barcode scanner via camera or Bluetooth)
- Add custom items (one-off SKUs)
- Cart modifiers: line discounts, cart discount, tips
- Customer lookup / create from POS
- Tax calculation per store location

### 12.3 Payment methods (in-person)
- Card present (Stripe Terminal — chip, swipe, tap, Apple Pay, Google Pay)
- Cash (with drawer tracking)
- Store credit / gift card redemption
- Split payments (part card, part cash)
- Email / SMS receipt OR printed receipt

### 12.4 Hardware integrations
- **Stripe Terminal** readers (BBPOS, WisePOS E, Tap to Pay on iPhone/Android)
- Receipt printers: ESC/POS via network or USB
- Cash drawers (triggered via printer)
- Barcode scanners (USB HID or Bluetooth)
- Label printers (Zebra, Brother)

### 12.5 Staff management
- Staff accounts tied to admin user, with POS-specific PIN
- Per-shift clock-in/out
- Per-staff sales attribution
- Permissions: can refund, can apply manual discount, can void, etc.

### 12.6 Inventory sync
- POS sells against the same inventory as online
- Reservations during checkout to prevent overselling
- Transfer-in / transfer-out from POS

### 12.7 End-of-day
- Z-report: sales total, tender breakdown, refunds, expected cash drawer vs. counted
- Declare overages / shortages with reason

### 12.8 Retail-specific features
- Save carts / suspend transactions
- Layaway / orders for later pickup
- Phone orders (in-store staff create draft order for call-in customer)

### Data model
`pos_terminal`, `pos_session` (shift), `pos_cart`, `pos_payment`, `pos_reader`, `staff_pin`, `cash_movement`, `z_report`.

### Non-goals v1
- Full ERP / multi-location P&L
- Pop-up / mobile market POS without internet (true full offline — only partial offline queueing)

---

## 13. Users, Permissions, Settings, Apps & Plus Options

### 13.1 Staff users
- Invite via email (link expires after 48h)
- Account: email, name, phone, language, avatar, 2FA (TOTP)
- Session management: list active sessions, revoke
- Password policy (length + breach check via HIBP)

### 13.2 Roles & permissions (RBAC)
- Predefined roles: Owner, Admin, Staff, Limited staff, POS-only
- Custom roles with fine-grained permission toggles:
  - View / edit products, orders, customers, discounts, content, reports, settings, apps
  - Issue refunds (capped amount)
  - Access finance reports
  - Install / configure apps
  - Manage staff
- Per-location access restriction (staff tied to one store for POS)
- Audit log of permission changes

### 13.3 Audit log
- Append-only log of all admin actions: who, what, when, from where (IP, UA)
- Retention: 12 months v1, export to cold storage thereafter
- Filterable + searchable
- Webhook on high-risk actions (staff deletion, permission change, bulk customer export…)

### 13.4 Settings
- **Store profile**: name, legal name, address, phone, industry, company registration (SIRET), VAT number
- **Notifications**: which events email which staff
- **Checkout**: required fields, account creation policy (required / optional / guest), abandoned checkout email delay, tipping
- **Taxes**: per-region rules + rates (see §11)
- **Payments**: active gateways, manual payment methods, refund policy, authorization window
- **Shipping**: zones, rates, packages (see §7)
- **Locations**: warehouses, stores, pickup points
- **Policies**: privacy, refund, shipping, terms of service — rich-text with legal boilerplate templates
- **Domains**: custom domain connection (A / CNAME records), SSL, redirects (www ↔ apex)
- **Files**: storage usage, retention settings
- **Languages & regions**: see §11
- **Gift cards**: expiration, default denominations, allow refund to gift card

### 13.5 Apps / extensions platform
- Internal apps (admin UI extensions by store staff) — optional
- Public apps (third-party developers):
  - OAuth install flow with scope requests
  - Scopes per resource (read_products, write_orders…)
  - Webhooks subscribed by app (order/create, customer/update, inventory_level/update…)
  - App-specific settings page embedded in admin (iframe + session token)
  - Admin UI extensions (action cards on order/customer pages)
  - Theme app extensions (inject storefront blocks)
  - Checkout UI extensions (Phase 3+) — add custom fields, upsells
  - App billing (one-time, subscription, usage-based) — we bill, forward to developer
- App uninstall: revoke tokens, optional data retention

### 13.6 API / headless
- REST API for all admin resources
- GraphQL endpoint (Phase 7+ recommended but not required for v1 — REST is fine)
- Storefront API (public, read-mostly — products, collections, cart, checkout)
- Webhooks (outbound) for every mutating event
- API keys (per-app) with scopes + rate limits
- API versioning scheme (date-based: `2026-04`)

### 13.7 Plus-style options (available in-shop since single-shop only)
- **Wholesale / B2B channel**: password-protected storefront with per-company price lists (deferred beyond v1 core)
- **Checkout customization**: multi-step vs. one-page, required-fields config, custom scripts via checkout UI extensions
- **Scripts / Functions** (Shopify Functions equivalent): server-side customization hooks — line-item discounts, shipping-rate filtering, payment-method filtering — via sandboxed JS or WASM (very v2)
- **Custom reports** (see §8)
- **Priority support** — N/A (self-hosted)
- **Explicitly out of scope**: multi-store / org-level dashboards (user opted for single-shop)

### Data model
`staff_user`, `staff_role`, `staff_permission`, `staff_session`, `staff_2fa_secret`, `audit_log_entry`, `setting_kv`, `app`, `app_installation`, `app_scope`, `webhook_subscription`, `api_key`, `rate_limit_bucket`.

### Non-goals v1
- Full Shopify Functions equivalent (sandbox / WASM host) — huge scope
- Multi-store organization dashboards
- Custom mobile admin app (responsive admin web covers 90%)

---

## 14. Cross-cutting Requirements

These apply to every phase, not scoped to one area.

### 14.1 Security
- HTTPS everywhere, HSTS preload
- HttpOnly / Secure / SameSite cookies
- CSRF protection on all state-changing endpoints
- Rate limiting per IP + per user + per endpoint class
- Input validation at boundaries (struct tag-based or schema)
- SQL injection-proof via sqlc (parameterized)
- Secrets in env / secret manager, never in source or logs
- Auth: argon2id, 2FA (TOTP) for staff, HIBP breach check on password set
- PCI DSS SAQ A compliance (Stripe-hosted card fields — we never touch PAN)
- Security headers: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- Regular dependency audit in CI (govulncheck, bun audit)
- Admin-side audit log for all mutations (§13.3)
- Brute-force protection on login (account lockout + captcha after N fails)

### 14.2 Privacy / GDPR
- Cookie consent banner (storefront) — reject / accept granular categories
- Right to access: customer data export (JSON + CSV) on request
- Right to erasure: customer anonymization (keep order records for legal/tax, replace PII with redacted placeholders)
- Data retention policy per entity (e.g. abandoned checkouts: 90d, analytics events: 24 months)
- DPA-ready audit log, processing records
- EU data residency (host in EU region)

### 14.3 Accessibility
- WCAG 2.1 AA baseline on storefront + admin
- Keyboard navigation, focus management, ARIA labels
- Color contrast enforcement in theme tokens
- Screen-reader smoke tests in CI (axe-core)

### 14.4 Performance
- Storefront: Core Web Vitals green (LCP < 2.5s, CLS < 0.1, INP < 200ms)
- ISR/SSG for product & collection pages with on-demand revalidation on catalog update
- Image optimization (Next.js Image + R2/S3 CDN + WebP/AVIF)
- Admin: sub-second navigation via client-side routing + cached queries
- API: p95 < 200ms for read, < 500ms for write under nominal load
- DB: every query indexed, EXPLAIN-reviewed, N+1 caught in tests

### 14.5 Observability
- Structured JSON logs with request IDs (stdlib `log/slog`)
- Metrics: Prometheus endpoint (`/metrics`)
- Traces: OpenTelemetry, export to self-hosted Tempo / Jaeger or SaaS
- Error tracking: Sentry-compatible endpoint (self-hosted GlitchTip or Sentry cloud)
- Uptime monitoring + status page (statping or cronitor)

### 14.6 Reliability
- Daily Postgres backups (PITR if hosted on Crunchy/Supabase, else pg_dump + WAL-G)
- Test restore quarterly
- Zero-downtime deploys (blue/green or rolling)
- Graceful shutdown, in-flight request draining
- Idempotency keys on all mutating API endpoints

### 14.7 Developer experience
- `task dev` spins up full stack in < 30s
- Seed data script with realistic sample catalog
- Contract tests between backend + frontends (oapi-codegen from OpenAPI spec)
- Storybook for admin + storefront components (Phase 8)
- Runbook per production incident type

### 14.8 Localization baseline (even pre-Markets)
- All user-facing strings in translation files (i18n-ready from Phase 1)
- Date / time / number / currency formatting via `Intl`
- RTL support deferred until a RTL market is added

---

## Summary

14 feature areas, roughly **500+ discrete capabilities** when enumerated. No single sprint ships all of this — the roadmap in the plan file sequences them. This document is the complete reference: when implementing any phase, re-read the relevant section here to confirm scope, then narrow via a phase-specific spec.

Last updated: 2026-04-18.
