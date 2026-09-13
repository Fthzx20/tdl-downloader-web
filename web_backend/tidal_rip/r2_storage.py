import os
import asyncio
from typing import Optional

class R2StorageManager:
    """Manages temporary uploads and presigned download URL generation for Cloudflare R2."""

    def __init__(self, config):
        self.config = config
        self._s3_client = None
        self._client_key = None

    def is_configured(self) -> bool:
        return bool(
            self.config.r2_enabled
            and self.config.r2_account_id
            and self.config.r2_access_key_id
            and self.config.r2_secret_access_key
            and self.config.r2_bucket_name
        )

    def _get_s3_client(self):
        import boto3
        from botocore.config import Config as BotoConfig

        key = (
            self.config.r2_account_id.strip(),
            self.config.r2_access_key_id.strip(),
            self.config.r2_secret_access_key.strip()
        )
        if self._s3_client is not None and self._client_key == key:
            return self._s3_client

        if self._s3_client is not None:
            try:
                self._s3_client.close()
            except Exception:
                pass

        endpoint_url = f"https://{key[0]}.r2.cloudflarestorage.com"
        self._s3_client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=key[1],
            aws_secret_access_key=key[2],
            config=BotoConfig(signature_version="s3v4"),
            region_name="auto"
        )
        self._client_key = key
        return self._s3_client

    def _upload_and_presign_sync(self, local_file_path: str, object_name: Optional[str] = None, expires_in: int = 3600) -> str:
        if not os.path.exists(local_file_path):
            raise FileNotFoundError(f"File not found for R2 upload: {local_file_path}")

        filename = os.path.basename(local_file_path)
        key = object_name or f"temp_downloads/{filename}"

        client = self._get_s3_client()
        bucket = self.config.r2_bucket_name.strip()

        # Determine Content-Type
        content_type = "application/octet-stream"
        if filename.endswith(".flac"):
            content_type = "audio/flac"
        elif filename.endswith(".mp3"):
            content_type = "audio/mpeg"
        elif filename.endswith(".zip"):
            content_type = "application/zip"
        elif filename.endswith(".lrc"):
            content_type = "text/plain; charset=utf-8"

        # Upload to R2
        client.upload_file(
            local_file_path,
            bucket,
            key,
            ExtraArgs={
                "ContentType": content_type,
                "ContentDisposition": f'attachment; filename="{filename}"'
            }
        )

        # Generate presigned download URL
        if self.config.r2_public_domain.strip():
            public_domain = self.config.r2_public_domain.strip().rstrip("/")
            url = f"{public_domain}/{key}"
        else:
            url = client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=expires_in
            )

        # Clean up local file immediately after successful upload
        try:
            os.remove(local_file_path)
        except Exception:
            pass

        return url

    async def upload_and_get_url(self, local_file_path: str, object_name: Optional[str] = None, expires_in: int = 3600) -> str:
        """Asynchronously uploads a local file to R2, removes local file, and returns presigned download URL."""
        return await asyncio.to_thread(self._upload_and_presign_sync, local_file_path, object_name, expires_in)
