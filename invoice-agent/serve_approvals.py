#!/usr/bin/env python3
"""Run the approval / review web app (waitress, internal interface only)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from waitress import serve  # noqa: E402

from src.approvals.webapp import create_app  # noqa: E402
from src.common.config import load_settings  # noqa: E402

if __name__ == "__main__":
    settings = load_settings(os.path.dirname(os.path.abspath(__file__)))
    host, port = settings["server"]["host"], settings["server"]["port"]
    print(f"approval app on http://{host}:{port}")
    serve(create_app(settings), host=host, port=port)
