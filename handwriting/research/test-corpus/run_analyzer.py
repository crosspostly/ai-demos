#!/usr/bin/env python3
"""Run the static browser analyzer against every corpus image.

Usage: python3 research/test-corpus/run_analyzer.py
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from functools import partial
import json
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / 'research' / 'test-corpus'
OUT = CORPUS / 'analysis-results.json'
PORT = 8765

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def run():
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(('127.0.0.1', PORT), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True)
        page = browser.new_page()
        page.goto(f'http://127.0.0.1:{PORT}/prototype/landing/index.html', wait_until='domcontentloaded')
        page.add_script_tag(url=f'http://127.0.0.1:{PORT}/prototype/landing/analyze.js')
        page.wait_for_function('() => Boolean(window.HandwritingAnalyzer)')
        for item in json.loads((CORPUS / 'manifest.json').read_text())['samples']:
            path = '/research/test-corpus/' + item['file']
            result = page.evaluate('''async (src) => {
                const img = new Image();
                img.src = src;
                await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
                const res = window.HandwritingAnalyzer.analyse(img);
                return {
                    rows: res.lines.length,
                    raw_rows: res.rowsRaw,
                    components: res.comps.length,
                    core_components: res.core.length,
                    orange_rows: res.unstableLines.length,
                    red_outliers: res.outliers.length,
                    score: res.score,
                    crop: res.crop,
                    deskew_angle_deg: res.pageSkewDeg,
                    metrics: res.metrics
                };
            }''', path)
            results.append({'id': item['id'], 'file': item['file'], **result})
        browser.close()
    server.shutdown()
    payload = {
        'analyzer': 'prototype/landing/analyze.js',
        'corpus_manifest': 'research/test-corpus/manifest.json',
        'note': 'Engineering regression output only; not a clinical or normative label.',
        'samples': results,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    print(f'wrote {len(results)} rows to {OUT}')
    print('id score rows orange red deskew')
    for r in results:
        print(r['id'], r['score'], r['rows'], r['orange_rows'], r['red_outliers'], r['deskew_angle_deg'])


if __name__ == '__main__':
    run()
