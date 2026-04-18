package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters tuned for ~100ms on modern hardware.
// Format: $argon2id$v=19$m=<memKiB>,t=<time>,p=<parallelism>$<salt>$<hash>
const (
	argonTime    = uint32(2)
	argonMemory  = uint32(64 * 1024) // 64 MiB
	argonThreads = uint8(2)
	argonKeyLen  = uint32(32)
	argonSaltLen = 16
)

var (
	ErrHashFormat = errors.New("invalid password hash format")
	ErrMismatch   = errors.New("password does not match")
)

func HashPassword(password string) (string, error) {
	if password == "" {
		return "", errors.New("password required")
	}
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	), nil
}

func VerifyPassword(password, encoded string) error {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return ErrHashFormat
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return ErrHashFormat
	}
	var mem, iter uint32
	var par uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &mem, &iter, &par); err != nil {
		return ErrHashFormat
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return ErrHashFormat
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return ErrHashFormat
	}
	got := argon2.IDKey([]byte(password), salt, iter, mem, par, uint32(len(expected)))
	if subtle.ConstantTimeCompare(got, expected) != 1 {
		return ErrMismatch
	}
	return nil
}
