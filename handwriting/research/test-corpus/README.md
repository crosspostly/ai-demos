# Child Handwriting Test Corpus

A small, reproducible corpus for testing the visual handwriting-review prototype. It contains **30 samples in total: 24 real, anonymized handwriting samples** from primary-school children and 6 deterministic layout-stress pages derived from those real samples. The source images contain Malay handwritten sentences on lined writing samples. The files in `images/` are normalized derivatives: the source's white-on-black presentation was inverted to black ink on a white background, lightly cropped, and padded so the browser analyzer can process them consistently.

## Source and licence

The samples are a fixed subset of:

> Ramlan, Siti Azura (2023), “Potential Dysgraphia Handwriting Dataset of School-Age Children”, Mendeley Data, V1, DOI: [10.17632/39hr8dx76p.1](https://doi.org/10.17632/39hr8dx76p.1)

- Dataset landing page: <https://data.mendeley.com/datasets/39hr8dx76p/1>
- Direct archive used to prepare this subset: <https://data.mendeley.com/public-api/zip/39hr8dx76p/download/1>
- Source licence: **CC BY 4.0**
- Licence text: <https://creativecommons.org/licenses/by/4.0/>
- Source institution: Universiti Teknologi MARA, Malaysia

This repository includes adapted files under the same attribution requirement. Attribution is retained here and in the manifest. The subset is not a replacement for the full source dataset and must not be used to make clinical or educational-placement decisions.

## Privacy and safety

The selected images were checked visually before inclusion. No names, dates, faces, addresses, or other direct identifiers were observed. The source describes the children using anonymous IDs. The `source_group` field is retained only as provenance metadata; it is a research category from the source dataset, **not a diagnosis** and not a label produced by this application.

Do not add a child's photograph, school name, contact details, or unredacted worksheet header to this directory. The prototype measures visible geometric properties of a writing trace. It does not diagnose dysgraphia, dyslexia, ADHD, intelligence, personality, or handwriting causes.

## Files

- `images/` — 24 normalized real JPEG samples plus 6 synthetic multi-line stress tests, renamed to remove source identifiers.
- `manifest.json` — machine-readable metadata and SHA-256 checksums.
- `manifest.csv` — spreadsheet-friendly version of the same metadata.
- `run_analyzer.py` — reproducible browser batch runner for the static Canvas analyzer.
- `analysis-results.json` — generated output from the last batch run; it is intentionally not treated as ground truth.

## Metadata fields

Each sample records the sample ID, file path, real/synthetic status, source category, approximate age information available from the source, language, paper/guideline information, capture limitations, privacy note, source filename for provenance, and checksum. Exact age, writing instrument, camera conditions, and paper type were not provided by the source and are marked as unknown rather than guessed.

## How to run the analyzer

From the repository root:

```bash
python3 research/test-corpus/run_analyzer.py
```

The runner opens the same `prototype/landing/analyze.js` in headless Chromium and writes one JSON row per image. It reports the number of detected rows and components, orange/unstable rows, red outliers, composite score, crop bounds, and deskew angle. These outputs are engineering diagnostics for regression testing, not validated child-development norms.
