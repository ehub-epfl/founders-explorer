"""Lightweight HTTP client for chat-based LLM endpoints."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Iterable, List, Mapping, Optional

import httpx
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential


load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=False)


class LLMConfigurationError(RuntimeError):
    """Raised when mandatory environment variables are missing."""


class LLMResponseError(RuntimeError):
    """Raised when the LLM endpoint responds with an error."""


@dataclass
class ChatMessage:
    role: str
    content: str

    def to_dict(self) -> Mapping[str, str]:
        return {"role": self.role, "content": self.content}


class LLMClient:
    """Minimal chat client with exponential backoff and sane defaults."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("LLM_API_KEY")
        self.base_url = base_url or os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1")
        self.model = model or os.environ.get("LLM_MODEL")
        try:
            self.timeout = float(timeout or os.environ.get("LLM_REQUEST_TIMEOUT", 60))
        except ValueError:
            self.timeout = 60.0

        if not self.api_key or not self.model:
            raise LLMConfigurationError(
                "LLM_API_KEY and LLM_MODEL must be configured (see llm_tools/.env.example)."
            )

        self._client = httpx.Client(
            base_url=self.base_url.rstrip("/"),
            timeout=self.timeout,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    def close(self) -> None:
        self._client.close()

    @retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(5), reraise=True)
    def generate(
        self,
        messages: Iterable[ChatMessage],
        temperature: float = 0.2,
        max_tokens: Optional[int] = None,
    ) -> str:
        body = {
            "model": self.model,
            "messages": [m.to_dict() for m in messages],
            "temperature": temperature,
        }
        if max_tokens is not None:
            body["max_tokens"] = max_tokens

        response = self._client.post("/chat/completions", content=json.dumps(body))
        if response.status_code >= 400:
            raise LLMResponseError(f"{response.status_code} {response.text}")

        data = response.json()
        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMResponseError(f"Malformed response: {data}") from exc


def default_system_prompt() -> str:
    return (
        "You are an expert academic advisor analysing EPFL course descriptions. "
        "Follow the instructions precisely and respond with valid JSON only."
    )


def build_messages(system_prompt: str, user_prompt: str) -> List[ChatMessage]:
    return [
        ChatMessage(role="system", content=system_prompt),
        ChatMessage(role="user", content=user_prompt),
    ]
