package storage

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Storage is an abstraction over S3-compatible object storage
// (Cloudflare R2 in prod, MinIO in dev).
type Storage interface {
	// PresignPut returns a time-limited URL the browser can PUT to directly.
	// The browser MUST send a Content-Type header matching `contentType`.
	PresignPut(ctx context.Context, objectKey, contentType string, ttl time.Duration) (string, error)
	// PublicURL returns the canonical public URL for an object key.
	PublicURL(objectKey string) string
	// HeadObject returns true if the object exists.
	HeadObject(ctx context.Context, objectKey string) (bool, error)
	// Delete removes an object by key.
	Delete(ctx context.Context, objectKey string) error
}

type s3Storage struct {
	client        *s3.Client
	presigner     *s3.PresignClient
	bucket        string
	publicURLBase string
}

func New(ctx context.Context, cfg config.S3Config) (Storage, error) {
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("S3_BUCKET is required")
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, ""),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("aws config: %w", err)
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
		}
		o.UsePathStyle = cfg.ForcePathStyle
	})
	publicBase := strings.TrimRight(cfg.PublicURLBase, "/")
	return &s3Storage{
		client:        client,
		presigner:     s3.NewPresignClient(client),
		bucket:        cfg.Bucket,
		publicURLBase: publicBase,
	}, nil
}

func (s *s3Storage) PresignPut(ctx context.Context, key, contentType string, ttl time.Duration) (string, error) {
	req, err := s.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}

func (s *s3Storage) PublicURL(key string) string {
	return s.publicURLBase + "/" + strings.TrimLeft(key, "/")
}

func (s *s3Storage) HeadObject(ctx context.Context, key string) (bool, error) {
	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		// HeadObject returns a 404 as an error. Treat as "not found" without surfacing.
		var apiErr interface{ ErrorCode() string }
		if ok := errAs(err, &apiErr); ok {
			if apiErr.ErrorCode() == "NotFound" || apiErr.ErrorCode() == "NoSuchKey" {
				return false, nil
			}
		}
		return false, err
	}
	return true, nil
}

func (s *s3Storage) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	return err
}

// errAs is a tiny wrapper to avoid importing errors in the hot path of storage.go.
func errAs(err error, target any) bool {
	return errorsAs(err, target)
}
