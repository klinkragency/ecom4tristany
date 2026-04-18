// Package htmlx centralizes HTML sanitization so untrusted admin input
// (product + collection descriptions) can't inject XSS.
package htmlx

import (
	"sync"

	"github.com/microcosm-cc/bluemonday"
)

var (
	once   sync.Once
	policy *bluemonday.Policy
)

// Sanitize returns a safe subset of HTML suitable for rendering to the
// storefront. Tags that Tiptap's StarterKit + Link extension can produce are
// allowed. Everything else (scripts, iframes, styles, event handlers, …) is
// stripped.
func Sanitize(s string) string {
	once.Do(initPolicy)
	return policy.Sanitize(s)
}

func initPolicy() {
	p := bluemonday.UGCPolicy() // safe baseline: allows p, br, b, i, u, ul, ol, li, h2-h6, blockquote, code, pre, a…

	// UGCPolicy already permits <a href>, but we make sure rel + target are forced
	// to safe values and disallow anything outside http(s) / mailto / tel.
	p.RequireParseableURLs(true)
	p.AllowURLSchemes("http", "https", "mailto", "tel")
	p.RequireNoFollowOnLinks(true)
	p.AddTargetBlankToFullyQualifiedLinks(true)

	// Never allow inline styles or class attributes — the storefront controls styling.
	p.AllowNoAttrs().OnElements("p", "div", "span", "strong", "em", "u", "s", "ul", "ol", "li", "blockquote", "pre", "code", "h2", "h3", "h4", "h5", "h6", "br", "hr")

	policy = p
}
