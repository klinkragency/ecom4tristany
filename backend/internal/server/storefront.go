package server

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/product"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func storefrontProductsList(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		limit, _ := strconv.Atoi(q.Get("limit"))
		page, err := product.List(r.Context(), db, product.ListParams{
			Search:      q.Get("q"),
			Status:      "active",
			Tag:         q.Get("tag"),
			Vendor:      q.Get("vendor"),
			ProductType: q.Get("type"),
			Limit:       limit,
			Cursor:      q.Get("cursor"),
		})
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "list_error", err.Error())
			return
		}
		httpx.JSON(w, http.StatusOK, page)
	}
}

func storefrontProductByHandle(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle := chi.URLParam(r, "handle")
		p, err := product.LoadByHandle(r.Context(), db, handle)
		if err != nil {
			if errors.Is(err, product.ErrNotFound) {
				httpx.Error(w, http.StatusNotFound, "not_found", "product not found")
				return
			}
			httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
			return
		}
		if p.Status != "active" {
			httpx.Error(w, http.StatusNotFound, "not_found", "product not found")
			return
		}
		httpx.JSON(w, http.StatusOK, p)
	}
}
