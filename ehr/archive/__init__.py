"""eArchive deposits (contract 06): queue, PDF, manifest, transports. Nothing here depends on eArchive's interface."""
from .cli import register as register_cli
from .queue import init_queue


def init_archive(app):
    init_queue(app)
    register_cli(app)
