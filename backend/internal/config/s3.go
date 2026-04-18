package config

type S3Config struct {
	Endpoint        string
	Region          string
	AccessKey       string
	SecretKey       string
	Bucket          string
	PublicURLBase   string
	ForcePathStyle  bool
}

func (c *Config) S3() S3Config {
	return S3Config{
		Endpoint:       getenv("S3_ENDPOINT", ""),
		Region:         getenv("S3_REGION", "auto"),
		AccessKey:      getenv("S3_ACCESS_KEY", ""),
		SecretKey:      getenv("S3_SECRET_KEY", ""),
		Bucket:         getenv("S3_BUCKET", ""),
		PublicURLBase:  getenv("S3_PUBLIC_URL_BASE", ""),
		ForcePathStyle: getenvBool("S3_FORCE_PATH_STYLE", false),
	}
}
