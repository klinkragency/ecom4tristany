// r2-setup applies the CORS policy to the R2 bucket so browsers on the
// admin + storefront origins can upload directly via presigned URLs.
// Safe to re-run; overwrites the existing CORS config.
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/3mg/shop/backend/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		die("config: %v", err)
	}
	s3cfg := cfg.S3()

	origins := cfg.CORSOrigins
	if len(origins) == 0 {
		die("CORS_ORIGINS is empty — set it in .env before running r2-setup")
	}

	ctx := context.Background()
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(s3cfg.Region),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(s3cfg.AccessKey, s3cfg.SecretKey, ""),
		),
	)
	if err != nil {
		die("aws config: %v", err)
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if s3cfg.Endpoint != "" {
			o.BaseEndpoint = aws.String(s3cfg.Endpoint)
		}
		o.UsePathStyle = s3cfg.ForcePathStyle
	})

	// Verify the bucket is reachable with the credentials.
	if _, err := client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s3cfg.Bucket)}); err != nil {
		die("HeadBucket %q failed — check S3_BUCKET + credentials: %v", s3cfg.Bucket, err)
	}
	fmt.Printf("✓ bucket %q reachable\n", s3cfg.Bucket)

	_, err = client.PutBucketCors(ctx, &s3.PutBucketCorsInput{
		Bucket: aws.String(s3cfg.Bucket),
		CORSConfiguration: &types.CORSConfiguration{
			CORSRules: []types.CORSRule{
				{
					AllowedOrigins: origins,
					AllowedMethods: []string{"GET", "PUT", "HEAD"},
					AllowedHeaders: []string{"*"},
					ExposeHeaders:  []string{"ETag"},
					MaxAgeSeconds:  aws.Int32(3600),
				},
			},
		},
	})
	if err != nil {
		die("PutBucketCors: %v", err)
	}
	fmt.Printf("✓ CORS policy applied for origins: %v\n", origins)

	// Read it back for confirmation.
	out, err := client.GetBucketCors(ctx, &s3.GetBucketCorsInput{Bucket: aws.String(s3cfg.Bucket)})
	if err != nil {
		die("GetBucketCors: %v", err)
	}
	for i, rule := range out.CORSRules {
		fmt.Printf("  rule %d: origins=%v methods=%v\n", i, rule.AllowedOrigins, rule.AllowedMethods)
	}
	fmt.Println("Done.")
}

func die(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}
