package checkout

// For Phase 3 MVP, prices are tax-inclusive (EU convention) and there's a
// single flat VAT rate. We back-solve the tax portion from the gross total:
//
//   net   = gross * 100 / (100 + vat)
//   tax   = gross - net
//
// When Phase 10 (Markets) lands we'll swap this for a country-aware lookup.

// BackSolveVAT returns the tax portion of a tax-inclusive amount, in cents.
// Uses banker's rounding to avoid systematic bias.
func BackSolveVAT(grossCents, vatPercent int) int {
	if vatPercent <= 0 {
		return 0
	}
	// tax = gross * vat / (100 + vat), rounded to nearest cent.
	num := int64(grossCents) * int64(vatPercent)
	den := int64(100 + vatPercent)
	q := num / den
	r := num % den
	// round half-to-even
	if r*2 > den || (r*2 == den && q%2 != 0) {
		q++
	}
	return int(q)
}
