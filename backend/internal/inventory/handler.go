package inventory

import "github.com/jackc/pgx/v5/pgxpool"

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }
