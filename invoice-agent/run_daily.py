#!/usr/bin/env python3
"""Daily runner: scheduled (APScheduler, config schedule.daily_at) or on
demand with --now. Phase 0 demo: `python run_daily.py --now` on an empty
setup logs a clean empty run."""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.common import db  # noqa: E402
from src.common.config import graph_client_secret, load_settings  # noqa: E402
from src.pipeline import run_once  # noqa: E402


def _graph_client(settings):
    mb = settings["mailbox"]
    if "TODO" in str(mb.get("tenant_id", "")) or not graph_client_secret():
        return None  # mailbox not configured yet — folder ingest still runs
    from src.ingest.graph_mail import GraphClient

    return GraphClient(settings)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--now", action="store_true", help="run once immediately")
    parser.add_argument("--no-digest", action="store_true")
    args = parser.parse_args()

    base = os.path.dirname(os.path.abspath(__file__))
    settings = load_settings(base)
    conn = db.connect(settings)

    def job():
        stats = run_once(conn, settings, graph_client=_graph_client(settings),
                         send_digest=not args.no_digest)
        print("run complete:", stats)

    if args.now:
        job()
        return

    from apscheduler.schedulers.blocking import BlockingScheduler

    hour, minute = settings["schedule"]["daily_at"].split(":")
    sched = BlockingScheduler()
    sched.add_job(job, "cron", hour=int(hour), minute=int(minute))
    print(f"scheduled daily at {settings['schedule']['daily_at']} — Ctrl+C to stop")
    sched.start()


if __name__ == "__main__":
    main()
