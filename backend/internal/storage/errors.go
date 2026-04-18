package storage

import "errors"

// errorsAs is a thin wrapper so storage.go stays dependency-light.
func errorsAs(err error, target any) bool {
	return errors.As(err, target)
}
