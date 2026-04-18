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
	PresignPut(ctx context.Context, objectKey, contentType string, maxBytes int64, ttl time.Duration) (string, error)
	// PublicURL returns the canonical public URL for an object key.
	PublicURL(objectKey string) string
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

func (s *s3Storage) PresignPut(ctx context.Context, key, contentType string, maxBytes int64, ttl time.Duration) (string, error) {
	req, err := s.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(maxBytes),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}

func (s *s3Storage) PublicURL(key string) string {
	return s.publicURLBase + "/" + strings.TrimLeft(key, "/")
}

func (s *s3Storage) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	return err
}
