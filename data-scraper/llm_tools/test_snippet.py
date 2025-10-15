import json
import time
import pathlib
from typing import Optional

import ollama

# Prompt template pulled from the user's instructions. Replace the placeholder
# value passed into build_prompt() with the actual course description when testing.
PROMPT_TEMPLATE = """
You are a strict course classifier. Read the COURSE DESCRIPTION and return ONLY valid JSON.

TASKS
1) Gate: rate how related the course is to Entrepreneurship on a 0–100 scale (integer). Name this "entre_score".
2) If (and only if) entre_score > 0, rate each sublabel below on a 0–100 (integers). Multi-label is allowed.
3) Evidence: for any label with score ≥ 50, extract 1–3 short verbatim snippets (max 20 words each) from the course text that triggered the score. Do not invent text.

SCORING RUBRIC (high-level guidance)
- 90–100: central focus / taught in depth
- 70–89: major component / repeated emphasis
- 50–69: clearly covered but not the main focus
- 30–49: weak/occasional mention; borderline
- 1–29: incidental/irrelevant
- 0: absent

HIERARCHY RULE
- If entre_score < 60, downscale all sublabel scores by multiplying by (entre_score / 60), then round.

LABEL SET (use English keywords but match concepts in any language)
- PD (Personal development / soft skills): negotiation, persuasion, bargaining, trust building, self-leadership, emotional regulation, resilience, feedback, culture, cross-cultural collaboration, stakeholder communication, presentation, visualization, storytelling, narrative, conflict resolution/management, decision making, time/stress management, creativity, brainstorming, critical thinking, self-efficacy, listening, communication, coping with failure, non-verbal communication, systemic thinking, proactive, personal initiative, ethics.
- PB (Product building): product development, requirements/specification, concepting, design thinking, discovery, prototyping, testing, reliability, manufacturability, product management, project management (for building), feasibility, UX/UI, make/build projects, real-world challenges, fabrication, makerspace, discovery learning labs, inventing, device/drug development, practical/innovative solutions, cost–benefit, emerging tech, translational, practical application, regulatory/compliance, clinical evaluation, hands-on.
- VB-MKT (Venture marketing): go-to-market (GTM), segmentation/targeting, customer acquisition, sales funnel, pricing, channels, branding, marketing plan.
- VB-FIN (Venture finance): fundraising, due diligence, term sheet, venture capital, valuation, angel investing, managerial accounting, financial statements, P&L, cash flow, cap table, impact investing.
- VB-STRAT (Strategy/management): platforms, network effects, Blue Ocean, SWOT, competitive advantage, organizational structure, firm strategy, corporate innovation.
- VB-OPS (Operations): supply chain, inventory, logistics, demand forecasting, suppliers, contracts, project phases.
- VB-IP (IP/legal/tech-transfer): IP strategy, patent portfolio, freedom-to-operate, licensing, option agreements, tech transfer, industry partnership, regulatory/compliance.
- INTRO (Intro/process-based entrepreneurship): entrepreneurial mindset/identity/approach, opportunity identification/evaluation, customer discovery/interviews, lean startup, business model canvas, unit economics, MVP, pitch/pitch deck, coaching, demo day, business concept, startup/venturing, from lab to market, commercialization, social/sustainable entrepreneurship, startup ecosystem, founders, funding.

OUTPUT FORMAT (JSON only; no extra text)
{{
  "entre_score": <0-100 integer>,
  "labels": {{
    "PD": <0-100 integer>,
    "PB": <0-100 integer>,
    "VB-MKT": <0-100 integer>,
    "VB-FIN": <0-100 integer>,
    "VB-STRAT": <0-100 integer>,
    "VB-OPS": <0-100 integer>,
    "VB-IP": <0-100 integer>,
    "INTRO": <0-100 integer>
  }},
  "evidence": {{
    "PD": ["..."],
    "PB": ["..."],
    "VB-MKT": ["..."],
    "VB-FIN": ["..."],
    "VB-STRAT": ["..."],
    "VB-OPS": ["..."],
    "VB-IP": ["..."],
    "INTRO": ["..."]
  }}
}}

RULES
- Analyze only the provided course text; do not use outside knowledge.
- If a label is not supported, set its score to 0 and leave its evidence as an empty list.
- Keep evidence snippets short and verbatim; do not add commentary.
- Return valid JSON and nothing else.

COURSE DESCRIPTION:
<<<{course_description}>>>

"""


def build_prompt(course_description: str) -> str:
    """Inject the course description into the user-supplied template."""
    return PROMPT_TEMPLATE.format(course_description=course_description.strip())


def pre_edit(text: str) -> str:
    """Place to normalize/clean your input before sending to the model."""
    return text.strip()


def ask(model: str, course_description: str, system: Optional[str] = None, keep_alive: str = "5m") -> str:
    """Send a single-turn chat to Ollama using the official Python SDK, streaming tokens.

    Returns the full assistant response as a string.
    """
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": pre_edit(build_prompt(course_description))})

    chunks: list[str] = []
    for chunk in ollama.chat(model=model, messages=messages, stream=True, keep_alive=keep_alive):
        content = chunk["message"]["content"]
        print(content, end="", flush=True)  # live stream (optional)
        chunks.append(content)
    print()  # newline after streaming
    return "".join(chunks)


def save_jsonl(path: str, record: dict) -> None:
    pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> None:
    MODEL = "gpt-oss:120b-cloud"  # Ensure this model is pulled: `ollama pull gpt-oss:120b-cloud`

    system_prompt = (
        "You are a precise assistant. Return valid JSON and follow instructions strictly."
    )

    # TODO: paste the real course description here before running
    course_description = """
    Technology Ventures provides a science-based foundation and hands-on experience in launching new ventures. By working on their own concepts, students learn to recognize attractive market opportunities, design scalable business models, and develop effective market-entry strategies.
The course explores the earliest stages of the entrepreneurial process: from the identification of promising opportunities to the development of an effective market-entry strategy. In the fall semester (see Technology Ventures I), we concentrate on the discovery, evaluation, and testing of entrepreneurial opportunities using science-based approaches and methodologies. In the spring semester, we further advance venture projects by addressing key strategic questions around commercialization, intellectual property, financing, and sustainability. The course is designed to be a "safe-to-fail" learning environment for students who are actively considering an entrepreneurial path -- whether you are still searching for an idea or are already working on an early-stage concept. Throughout the course you will have access to EPFL's makerspace and prototyping facilities, receive feedback from peers, instructors, and external experts, and gain valuable exposure to the local entrepreneurial ecosystem.
    """

    response_text = ask(MODEL, course_description, system_prompt)

    # Also print the final response (already streamed above)
    print("\n--- Final Response (captured) ---\n")
    print(response_text)

    save_jsonl(
        "runs/ollama_logs.jsonl",
        {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "model": MODEL,
            "system": system_prompt,
            "course_description_len": len(course_description.strip()),
            "response": response_text,
        },
    )


if __name__ == "__main__":
    main()
