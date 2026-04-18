package auth

import (
	"strings"
	"testing"
)

func TestHashAndVerify(t *testing.T) {
	pw := "correct-horse-battery-staple"
	h, err := HashPassword(pw)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !strings.HasPrefix(h, "$argon2id$") {
		t.Fatalf("hash prefix wrong: %q", h)
	}
	if err := VerifyPassword(pw, h); err != nil {
		t.Fatalf("verify: %v", err)
	}
	if err := VerifyPassword("wrong", h); err == nil {
		t.Fatal("expected mismatch error")
	}
}

func TestHashDifferentEachTime(t *testing.T) {
	a, _ := HashPassword("same")
	b, _ := HashPassword("same")
	if a == b {
		t.Fatal("hashes should differ due to random salt")
	}
}

func TestVerifyBadHash(t *testing.T) {
	if err := VerifyPassword("x", "not-a-hash"); err == nil {
		t.Fatal("expected error for malformed hash")
	}
}
