"""Offline benchmark on authored, visible-only public-style fixtures; no URL inputs."""
import argparse
import importlib.util
import json
import statistics
import subprocess
import sys
import time
from html.parser import HTMLParser
from pathlib import Path


class Projection(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.tags = set()

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag)


SENTENCES = [
    "The community garden opened on Saturday after months of preparation.",
    "Local volunteers will host weekly workshops about seasonal vegetables.",
    "Organizers published a calendar of activities for neighborhood families.",
]
NOISE = ["Menu directory", "Advertisement for furniture", "Footer directory"]


def fixtures():
    prose = "".join(f"<p>{s}</p>" for s in SENTENCES)
    return [
        ("plain", f"<article>{prose}</article>", SENTENCES, [], {"p"}),
        ("chrome", f"<nav>{NOISE[0]}</nav><article>{prose}</article><aside>{NOISE[1]}</aside><footer>{NOISE[2]}</footer>", SENTENCES, NOISE, {"p"}),
        ("short", f"<article><p>{SENTENCES[0]}</p></article>", SENTENCES[:1], [], {"p"}),
        ("structure", f"<article><h2>Garden schedule</h2>{prose}<ul><li>Monday workshop</li></ul><table><tr><td>Saturday market</td></tr></table><blockquote>Everyone is welcome.</blockquote></article>", SENTENCES + ["Garden schedule", "Monday workshop", "Saturday market", "Everyone is welcome."], [], {"h2", "p", "ul", "li", "table", "td", "blockquote"}),
        ("caption", f"<article>{prose}<figure><img alt='Garden photograph'><figcaption>Volunteers arrange seedlings.</figcaption></figure></article>", SENTENCES + ["Volunteers arrange seedlings."], [], {"p", "figure", "img", "figcaption"}),
        ("repetition", f"<article>{prose}<p>{SENTENCES[0]}</p></article>", SENTENCES + [SENTENCES[0]], [], {"p"}),
    ]


def score(output, expected, noise, tags):
    view = Projection()
    view.feed(output or "")
    visible = " ".join(" ".join(view.parts).split())
    required = {s: expected.count(s) for s in set(expected)}
    return {
        "retained": sum(min(visible.count(s), count) for s, count in required.items()),
        "expected": len(expected),
        "noise": sum(s in visible for s in noise),
        "semantic_tags": len(tags & view.tags),
        "expected_tags": len(tags),
        "empty": not bool(visible.strip()),
    }


def load_baseline(path):
    spec = importlib.util.spec_from_file_location("content_benchmark_baseline", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return lambda html: module.assess_content("Community garden", html).safe_html


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True, type=Path)
    args = parser.parse_args()
    rows = fixtures()
    report = {"scope": "authored visible-only HTML; no network", "fixtures": len(rows), "engines": {}}
    engines = {"existing_assessor": load_baseline(args.baseline)}
    try:
        import trafilatura
        engines["trafilatura"] = lambda html: trafilatura.extract(html, output_format="html", include_comments=False, include_tables=True, include_images=True, include_formatting=True, with_metadata=False)
    except ImportError:
        report["engines"]["trafilatura"] = {"status": "BLOCKED_DEPENDENCY"}
    for name, engine in engines.items():
        results = []
        for fixture, html, expected, noise, tags in rows:
            durations = []
            outputs = []
            for _ in range(5):
                start = time.perf_counter_ns()
                outputs.append(engine(html))
                durations.append((time.perf_counter_ns() - start) / 1e6)
            results.append({"fixture": fixture, **score(outputs[0], expected, noise, tags), "deterministic": all(x == outputs[0] for x in outputs), "median_ms": round(statistics.median(durations), 3)})
        report["engines"][name] = {"status": "EXECUTED", "rows": results}
    try:
        proc = subprocess.run(["node", str(Path(__file__).with_name("readability.mjs"))], input=json.dumps([html for _, html, *_ in rows]), text=True, capture_output=True, timeout=30)
        if proc.returncode == 0:
            result = json.loads(proc.stdout)
            report["engines"]["readability"] = {"status": "EXECUTED", "rows": [{"fixture": name, **score(item["html"], expected, noise, tags), "deterministic": item["deterministic"], "median_ms": item["median_ms"]} for (name, _, expected, noise, tags), item in zip(rows, result, strict=True)]}
        else:
            report["engines"]["readability"] = {"status": "BLOCKED_DEPENDENCY_OR_RUNTIME", "exit": proc.returncode}
    except (OSError, subprocess.TimeoutExpired):
        report["engines"]["readability"] = {"status": "BLOCKED_RUNTIME"}
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
