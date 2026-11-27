"""Tests for pull_guard.py. Run: python3 -m unittest test_pull_guard (in stats-scraper/)."""
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

import pull_guard

D = dt.date.fromisoformat
SUNDAY = D("2026-11-29")


class Check(unittest.TestCase):
    def test_no_clock_goes(self):
        self.assertTrue(pull_guard.check({}, "linkedin", SUNDAY)[0])
        self.assertTrue(pull_guard.check({"cws": {}}, "cws", SUNDAY)[0])

    def test_last_sunday_never_blocks_sunday(self):
        self.assertTrue(pull_guard.check({"lastRun": "2026-11-22"}, "linkedin", SUNDAY)[0])

    def test_thursday_pull_lets_sunday_go(self):
        self.assertTrue(pull_guard.check({"cws": {"lastRun": "2026-11-26"}}, "cws", SUNDAY)[0])

    def test_friday_pull_skips_sunday(self):
        ok, msg = pull_guard.check({"lastRun": "2026-11-27"}, "linkedin", SUNDAY)
        self.assertFalse(ok)
        self.assertIn("next allowed 2026-11-30", msg)

    def test_cws_runs_daily(self):
        self.assertTrue(pull_guard.check({"cws": {"lastRun": "2026-11-28"}}, "cws", SUNDAY)[0])

    def test_cws_twice_same_day_skips(self):
        # Sunday 03:00 (weekly job) pulled; the 04:00 nightly call skips.
        ok, msg = pull_guard.check({"cws": {"lastRun": "2026-11-29"}}, "cws", SUNDAY)
        self.assertFalse(ok)
        self.assertIn("next allowed 2026-11-30", msg)

    def test_linkedin_still_three_days(self):
        self.assertFalse(pull_guard.check({"lastRun": "2026-11-28"}, "linkedin", SUNDAY)[0])
        self.assertTrue(pull_guard.check({"lastRun": "2026-11-26"}, "linkedin", SUNDAY)[0])

    def test_forced_date_is_ignored(self):
        cfg = {"cws": {"lastRun": "2026-11-22", "lastForcedRun": "2026-11-28"}}
        self.assertTrue(pull_guard.check(cfg, "cws", SUNDAY)[0])

    def test_clocks_are_separate(self):
        cfg = {"lastRun": "2026-11-28", "cws": {"lastRun": "2026-11-22"}}
        self.assertFalse(pull_guard.check(cfg, "linkedin", SUNDAY)[0])
        self.assertTrue(pull_guard.check(cfg, "cws", SUNDAY)[0])


class Record(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.cfg = Path(self.dir.name) / "config.local.json"
        self.cfg.write_text(json.dumps({"lastRun": "2026-11-22", "cws": {"lastRun": "2026-11-22"}}))

    def tearDown(self):
        self.dir.cleanup()

    def test_forced_pull_does_not_move_clock(self):
        pull_guard.record("cws", D("2026-11-26"), True, self.cfg)
        cfg = json.loads(self.cfg.read_text())
        self.assertEqual(cfg["cws"], {"lastRun": "2026-11-22", "lastForcedRun": "2026-11-26"})
        self.assertTrue(pull_guard.check(cfg, "cws", SUNDAY)[0])

    def test_forced_cws_pull_today_leaves_nightly_run_alone(self):
        pull_guard.record("cws", SUNDAY, True, self.cfg)   # manual --force on Sunday
        cfg = json.loads(self.cfg.read_text())
        self.assertEqual(cfg["cws"]["lastRun"], "2026-11-22")
        self.assertTrue(pull_guard.check(cfg, "cws", SUNDAY)[0])

    def test_unforced_pull_moves_only_its_clock(self):
        pull_guard.record("linkedin", D("2026-11-29"), False, self.cfg)
        cfg = json.loads(self.cfg.read_text())
        self.assertEqual(cfg["lastRun"], "2026-11-29")
        self.assertEqual(cfg["cws"]["lastRun"], "2026-11-22")


if __name__ == "__main__":
    unittest.main()
