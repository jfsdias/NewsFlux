from __future__ import annotations

import unittest
from pathlib import Path

from run_controlled_repetitions import (
    DIAGNOSTIC_CONFIG_CONTENT,
    isolated_command,
    suite_command,
    validate_repeat_count,
)


class ControlledRepetitionTests(unittest.TestCase):
    def test_repetition_count_is_bounded_and_explicit(self) -> None:
        self.assertEqual(validate_repeat_count("5"), 5)
        for value in ("0", "11", "many"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_repeat_count(value)

    def test_isolated_real_pen_diagnostic_has_independent_repetitions_and_no_retries(self) -> None:
        command = isolated_command(Path("/tmp/diagnostic-artifacts"), 5)

        self.assertIn("--config=r8-d4d-playwright.config.js", command)
        self.assertIn("R8-D4D PEN DIAGNOSTIC", command)
        self.assertIn("--repeat-each=5", command)
        self.assertIn("--retries=0", command)
        self.assertIn("--workers=1", command)
        self.assertEqual(command.count("Input.dispatchMouseEvent"), 0)
        self.assertIn("retries: 0", DIAGNOSTIC_CONFIG_CONTENT)
        self.assertIn('testDir: "./r8-d4d-ux-reach-diagnostic"', DIAGNOSTIC_CONFIG_CONTENT)

    def test_full_suite_command_runs_the_entire_suite_without_retries(self) -> None:
        command = suite_command(Path("/tmp/full-suite-artifacts"))

        self.assertIn("--retries=0", command)
        self.assertIn("--workers=1", command)
        self.assertFalse(any(arg == "--grep" or arg.startswith("--grep=") for arg in command))
        self.assertFalse(any(arg.startswith("--repeat-each=") for arg in command))


if __name__ == "__main__":
    unittest.main()
