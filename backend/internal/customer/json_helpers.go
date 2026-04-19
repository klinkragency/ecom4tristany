package customer

import (
	"encoding/json"
	"io"
)

// jsonEncoder returns a json.Encoder that pretty-prints with 2-space indent.
// Extracted so the GDPR export and any future JSON dumps share one place.
func jsonEncoder(w io.Writer) *json.Encoder {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc
}
