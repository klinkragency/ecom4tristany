package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/platform"
	"github.com/3mg/shop/backend/internal/server"
	"github.com/3mg/shop/backend/internal/session"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config: %v\n", err)
		os.Exit(1)
	}
	log := platform.NewLogger(cfg.LogLevel)

	ctx := context.Background()
	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Error("db pool", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.Ping(ctx); err != nil {
		log.Error("db ping", "err", err)
		os.Exit(1)
	}

	store := session.NewStore(db, cfg.SessionTTL, cfg.SessionCookieDomain, cfg.SessionCookieSecure)

	// Background GC for expired sessions
	gcCtx, cancelGC := context.WithCancel(ctx)
	defer cancelGC()
	go runSessionGC(gcCtx, store, log)

	h := server.NewRouter(server.Deps{
		Cfg:      cfg,
		Log:      log,
		DB:       db,
		Sessions: store,
	})

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		log.Info("listening", "addr", srv.Addr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server error", "err", err)
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
}

func runSessionGC(ctx context.Context, store *session.Store, log any) {
	t := time.NewTicker(15 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_ = store.DeleteExpired(ctx)
		}
	}
}
