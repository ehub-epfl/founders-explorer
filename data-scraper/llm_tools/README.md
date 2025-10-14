# LLM Toolkit for Course Classification & Rating

This package contains helper scripts to classify EPFL courses and generate ratings
with the `gpt-oss-120b` model (or any compatible chat-completion endpoint).

## Folder layout

```
data-scraper/
├─ llm_tools/
│  ├─ README.md              ← this file
│  ├─ requirements.txt       ← minimal Python dependencies
│  ├─ .env.example           ← configuration template
│  ├─ llm_client.py          ← thin HTTP client for chat models
│  ├─ classify_courses.py    ← course → tags/classifications
│  └─ rate_courses.py        ← course → numeric ratings
```

The scripts read the CSV exports produced by the scraper (`coursebook_courses.csv`,
`coursebook_programs.csv`, etc.) and write enriched JSON/CSV ready for ingestion.

## Quick start

1. **Create a virtualenv**

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. **Install dependencies**

   ```bash
   pip install -r data-scraper/llm_tools/requirements.txt
   ```

3. **Configure credentials**

   Copy `.env.example` and fill in your API information:

   ```bash
   cp data-scraper/llm_tools/.env.example data-scraper/llm_tools/.env
   ```

   | Variable           | Description                                                   |
   |--------------------|---------------------------------------------------------------|
   | `LLM_API_KEY`      | API key for the LLM endpoint (e.g., OSS deployment token).    |
   | `LLM_BASE_URL`     | Base URL for the completions endpoint (defaults to OpenAI).   |
   | `LLM_MODEL`        | Model identifier, e.g. `gpt-oss-120b`.                        |

   The scripts automatically read variables from `.env` when present.

4. **Classify courses**

   ```bash
   python data-scraper/llm_tools/classify_courses.py \
     --input data-scraper/data/coursebook_courses.csv \
     --output data-scraper/data/course_classifications.json
   ```

5. **Generate ratings**

   ```bash
   python data-scraper/llm_tools/rate_courses.py \
     --input data-scraper/data/coursebook_courses.csv \
     --output data-scraper/data/course_ratings.json
   ```

The classification script produces per-course labels such as level, topic,
recommended audience, etc. Ratings create numeric scores (0–5) for up to five
dimensions (skills, venture, product, relevance, foundations) to align with the
existing front-end expectations.

## Customising prompts

Both scripts expose flags to override the default prompt templates. For advanced
use cases you can maintain custom YAML/JSON prompt files and pass them via
`--prompt-path`. See the docstrings in `classify_courses.py` and
`rate_courses.py` for details.

## Safety & costs

Large language models can generate incorrect or biased information. Always review
outputs manually before shipping them to production or exposing them to users.

Remember that every call to the model incurs latency and cost; consider batching
and caching responses for incremental updates.

## Extending the toolkit

- Add new scripts alongside `classify_courses.py` and `rate_courses.py`.
- Reuse the `LLMClient` helper so authentication behaviour stays consistent.
- Keep dependencies minimal to maintain reproducibility inside our Docker/CI
  environments.

Happy prompting!
