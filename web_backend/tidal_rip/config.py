import json
import os
import base64
import tempfile

class Config:
    """Manages application settings, secure tokens, and download configurations."""
    
    import base64 as _b64
    DEFAULT_CLIENT_ID = _b64.b64decode("ZlgySnhkbW50WldLMGl4VA==").decode("iso-8859-1")
    DEFAULT_CLIENT_SECRET = _b64.b64decode(
        "MU5tNUFmREFqeHJnSkZKYktOV0xlQXlLR1ZHbUlOdVhQUExIVlhBdnhBZz0="
    ).decode("iso-8859-1")

    # PKCE credentials — the only flow that grants r_usr/w_usr/w_sub scopes
    PKCE_CLIENT_ID = _b64.b64decode(
        _b64.b64decode(b"TmtKRVUxSmtjRXM=") + _b64.b64decode(b"NWFIRkZRbFJuVlE9PQ==")
    ).decode("utf-8")
    PKCE_CLIENT_SECRET = _b64.b64decode(
        _b64.b64decode(b"ZUdWMVVHMVpOMjVpY0ZvNVNVbGlURUZqVVQ=")
        + _b64.b64decode(b"a3pjMmhyWVRGV1RtaGxWVUZ4VGpaSlkzTjZhbFJIT0QwPQ==")
    ).decode("utf-8")
    PKCE_REDIRECT_URI = "https://tidal.com/android/login/auth"
    
    def __init__(self):
        # Determine a safe, writable directory for config (works across Windows, Linux, and non-root containers)
        config_dir_env = os.environ.get("CONFIG_DIR")
        if config_dir_env:
            self.config_dir = config_dir_env
        else:
            home = os.path.expanduser("~")
            if os.path.exists(home) and os.access(home, os.W_OK):
                self.config_dir = os.path.join(home, ".tidal_rip")
            else:
                self.config_dir = os.path.join(tempfile.gettempdir(), ".tidal_rip")
        self.config_path = os.path.join(self.config_dir, "config.json")
        
        # Default settings
        self.client_id = self.DEFAULT_CLIENT_ID
        self.client_secret = self.DEFAULT_CLIENT_SECRET
        self.pkce_client_id = self.PKCE_CLIENT_ID
        self.pkce_client_secret = self.PKCE_CLIENT_SECRET
        self.pkce_redirect_uri = self.PKCE_REDIRECT_URI
        self.access_token = ""
        self.refresh_token = ""
        self.token_expiry = 0.0
        self.user_id = ""
        self.user_name = ""
        # Determine default download directory
        default_dl = os.environ.get("DOWNLOAD_DIRECTORY")
        if not default_dl:
            home = os.path.expanduser("~")
            if os.path.exists(home) and os.access(home, os.W_OK):
                default_dl = os.path.join(home, "Music", "Tidal Downloads")
            else:
                default_dl = os.path.join(tempfile.gettempdir(), "Tidal Downloads")
        self.download_directory = default_dl
        self.quality_tier = "HI_RES_LOSSLESS"  # Options: LOW, HIGH, LOSSLESS, MAX, HI_RES_LOSSLESS
        self.login_browser = "Default Browser"
        self.allow_dolby_atmos = False
        
        # Cloudflare R2 Settings
        self.r2_enabled = os.environ.get("R2_ENABLED", "false").lower() == "true"
        self.r2_account_id = os.environ.get("R2_ACCOUNT_ID", "")
        self.r2_access_key_id = os.environ.get("R2_ACCESS_KEY_ID", "")
        self.r2_secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY", "")
        self.r2_bucket_name = os.environ.get("R2_BUCKET_NAME", "")
        self.r2_public_domain = os.environ.get("R2_PUBLIC_DOMAIN", "")

        self.load()


    def load(self):
        """Loads config from file if it exists, otherwise creates defaults."""
        target_path = self.config_path
        backup_path = os.path.join(os.getcwd(), "config.json")
        
        if not os.path.exists(target_path) and os.path.exists(backup_path):
            target_path = backup_path
            
        if not os.path.exists(target_path):
            # Check env fallback for tokens
            self.access_token = os.environ.get("TIDAL_ACCESS_TOKEN", self.access_token)
            self.refresh_token = os.environ.get("TIDAL_REFRESH_TOKEN", self.refresh_token)
            self.user_id = os.environ.get("TIDAL_USER_ID", self.user_id)
            self.save()
            return
            
        try:
            with open(target_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                
            loaded_client_id = data.get("client_id", self.DEFAULT_CLIENT_ID)
            # Migrate away from any old/non-working TV client IDs
            old_ids = {"7m7Ap0JC9j1cOM3n", "zU4XHVVkc2tDPo4t"}
            if loaded_client_id in old_ids:
                self.client_id = self.DEFAULT_CLIENT_ID
                self.client_secret = self.DEFAULT_CLIENT_SECRET
                # Clear old token so user is prompted to re-login with new client
                self.access_token = ""
                self.refresh_token = ""
                self.token_expiry = 0.0
            else:
                self.client_id = loaded_client_id
                self.client_secret = data.get("client_secret", self.DEFAULT_CLIENT_SECRET)
            self.access_token = data.get("access_token") or os.environ.get("TIDAL_ACCESS_TOKEN", "")
            self.refresh_token = data.get("refresh_token") or os.environ.get("TIDAL_REFRESH_TOKEN", "")
            self.token_expiry = float(data.get("token_expiry", 0.0))
            self.user_id = data.get("user_id") or os.environ.get("TIDAL_USER_ID", "")
            self.user_name = data.get("user_name", "")
            self.download_directory = data.get("download_directory", os.path.expanduser("~/Music/Tidal Downloads"))
            self.quality_tier = data.get("quality_tier", "HI_RES_LOSSLESS")
            self.login_browser = data.get("login_browser", "Default Browser")
            self.allow_dolby_atmos = data.get("allow_dolby_atmos", False)

            # R2 Storage settings
            self.r2_enabled = data.get("r2_enabled", self.r2_enabled)
            self.r2_account_id = data.get("r2_account_id", self.r2_account_id)
            self.r2_access_key_id = data.get("r2_access_key_id", self.r2_access_key_id)
            self.r2_secret_access_key = data.get("r2_secret_access_key", self.r2_secret_access_key)
            self.r2_bucket_name = data.get("r2_bucket_name", self.r2_bucket_name)
            self.r2_public_domain = data.get("r2_public_domain", self.r2_public_domain)

            # Auto-enable if all R2 credentials are present
            if self.r2_account_id and self.r2_access_key_id and self.r2_secret_access_key and self.r2_bucket_name:
                self.r2_enabled = True
        except Exception as e:
            print(f"Error loading configuration: {e}")

    def save(self):
        """Saves current configuration to file."""
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "token_expiry": self.token_expiry,
            "user_id": self.user_id,
            "user_name": self.user_name,
            "download_directory": self.download_directory,
            "quality_tier": self.quality_tier,
            "login_browser": self.login_browser,
            "allow_dolby_atmos": self.allow_dolby_atmos,
            "r2_enabled": self.r2_enabled,
            "r2_account_id": self.r2_account_id,
            "r2_access_key_id": self.r2_access_key_id,
            "r2_secret_access_key": self.r2_secret_access_key,
            "r2_bucket_name": self.r2_bucket_name,
            "r2_public_domain": self.r2_public_domain
        }
        try:
            os.makedirs(self.config_dir, exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
        except Exception as e:
            print(f"Notice: Could not save configuration to {self.config_path}: {e}")
            
        try:
            backup_path = os.path.join(os.getcwd(), "config.json")
            with open(backup_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
        except Exception:
            pass

    def clear_session(self):
        """Clears all session-related tokens and user credentials."""
        self.access_token = ""
        self.refresh_token = ""
        self.token_expiry = 0.0
        self.user_id = ""
        self.user_name = ""
        self.save()
