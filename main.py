import os
import sys

# Ensure web_backend is on the Python path
backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web_backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from server import app

if __name__ == "__main__":
    import uvicorn
    raw_port = os.environ.get("PORT", "8000")
    try:
        port = int(raw_port)
    except Exception:
        port = 8000
    print(f"Starting Tidal Rip API on 0.0.0.0:{port} from root runner...", flush=True)
    uvicorn.run("server:app", host="0.0.0.0", port=port, app_dir=backend_dir, reload=False)
