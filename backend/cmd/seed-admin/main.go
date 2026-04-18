package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/config"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	email := flag.String("email", "", "admin email")
	password := flag.String("password", "", "admin password")
	name := flag.String("name", "Owner", "admin name")
	role := flag.String("role", "owner", "admin role")
	flag.Parse()

	if *email == "" || *password == "" {
		fmt.Fprintln(os.Stderr, "usage: seed-admin --email=EMAIL --password=PASSWORD [--name=NAME] [--role=ROLE]")
		os.Exit(2)
	}
	normalized := strings.TrimSpace(strings.ToLower(*email))

	cfg, err := config.Load()
	if err != nil {
		die("config: %v", err)
	}

	ctx := context.Background()
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		die("db pool: %v", err)
	}
	defer db.Close()

	hash, err := auth.HashPassword(*password)
	if err != nil {
		die("hash: %v", err)
	}

	_, err = db.Exec(ctx, `
        INSERT INTO admin_users (email, password_hash, name, role)
        VALUES ($1, $2, $3, $4)
    `, normalized, hash, *name, *role)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			die("admin with email %q already exists", normalized)
		}
		die("insert: %v", err)
	}
	fmt.Printf("admin created: %s (role=%s)\n", normalized, *role)
}

func die(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}
