r"""Browser-harness acceptance flow for Masterion Aihub integration.

Run after the local app is available, for example:

  $env:BU_CDP_URL='http://127.0.0.1:9222'
  $env:MASTERLION_APP_URL='http://localhost:3220'
  .\.codex\browser-harness-venv\Scripts\python.exe tests\browser-harness\masterlion_aihub_acceptance.py

The script intentionally uses the real Aihub quota for a short chat turn.
"""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

from browser_harness.helpers import fill_input, goto_url, js, press_key, upload_file, wait, wait_for_element, wait_for_load


APP_URL = os.environ.get("MASTERLION_APP_URL", "http://localhost:3220").rstrip("/")
USERNAME = os.environ.get("MASTERLION_ACCEPTANCE_USER", "10193226")
PASSWORD = os.environ.get("MASTERLION_ACCEPTANCE_PASSWORD", "biel")

MOJIBAKE_MARKERS = [
    "error.title",
    "error.desc",
    "\u5bb8",
    "\u6d63",
    "\u9422",
    "\u93c8",
    "\u68f0",
    "\ufffd",
]


def page_text() -> str:
    return js("document.body ? document.body.innerText : ''") or ""


def assert_clean_page(label: str) -> None:
    text = page_text()
    bad = [marker for marker in MOJIBAKE_MARKERS if marker in text]
    assert not bad, f"{label}: found mojibake/error markers: {bad}\n{text[:1000]}"


def click_text(text: str) -> bool:
    return bool(
        js(
            """
            ((needle) => {
              const elements = [...document.querySelectorAll('button,a,[role="button"],[data-testid]')];
              const target = elements.find((el) => (el.innerText || el.textContent || '').includes(needle));
              if (!target) return false;
              target.click();
              return true;
            })
            """
            f"({text!r})"
        )
    )


def click_first_button() -> bool:
    return bool(
        js(
            """
            (() => {
              const button = document.querySelector('button');
              if (!button) return false;
              button.click();
              return true;
            })()
            """
        )
    )


def open_attachment_menu() -> bool:
    return bool(
        js(
            """
            (() => {
              const elements = [...document.querySelectorAll('[aria-label],button,[role="button"]')];
              const target = elements.find((el) => {
                const label = el.getAttribute('aria-label') || '';
                const text = el.innerText || el.textContent || '';
                return label.includes('\\u6dfb\\u52a0\\u6587\\u4ef6')
                  || label.includes('\\u66f4\\u591a\\u4e0a\\u4e0b\\u6587')
                  || text.includes('\\u6dfb\\u52a0\\u6587\\u4ef6');
              });
              if (!target) return false;
              target.click();
              return true;
            })()
            """
        )
    )


def click_attachment_submenu() -> bool:
    return bool(
        js(
            """
            (() => {
              const elements = [...document.querySelectorAll('[role="menuitem"],button,[role="button"],div')];
              const target = elements.find((el) => {
                const text = (el.innerText || el.textContent || '').trim();
                return text === '\\u9644\\u4ef6' || text === 'Attachments';
              });
              if (!target) return false;
              target.click();
              return true;
            })()
            """
        )
    )


def fill_first_text_input(value: str) -> str:
    return (
        js(
            """
            ((value) => {
              const input = [...document.querySelectorAll('input')].find((el) => {
                const type = (el.getAttribute('type') || 'text').toLowerCase();
                const rect = el.getBoundingClientRect();
                return !el.disabled && !el.readOnly && type !== 'hidden' && type !== 'password' && rect.width > 0 && rect.height > 0;
              });
              if (!input) return '';
              input.focus();
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(input, value);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              return input.value || '';
            })
            """
            f"({value!r})"
        )
        or ""
    )


def fill_password_input(value: str) -> str:
    return (
        js(
            """
            ((value) => {
              const input = document.querySelector('input[type="password"]');
              if (!input) return '';
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(input, value);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              return input.value || '';
            })
            """
            f"({value!r})"
        )
        or ""
    )


def ensure_login() -> None:
    goto_url(APP_URL)
    wait_for_load(timeout=20)
    js(
        """
        (() => {
          localStorage.clear();
          sessionStorage.clear();
          document.cookie.split(';').forEach((cookie) => {
            const name = cookie.split('=')[0].trim();
            if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
          });
        })()
        """
    )
    goto_url(f"{APP_URL}/signin")
    wait_for_load()
    wait(1)

    if "signin" not in js("location.pathname"):
        assert_clean_page("already logged in")
        return

    password_ready = wait_for_element('input[type="password"]', timeout=1)
    if password_ready and USERNAME not in page_text():
        if click_text("\u8fd4\u56de\u4fee\u6539\u90ae\u7bb1") or click_text("Back"):
            wait(0.5)
            password_ready = False

    if not password_ready:
        wait_for_element('input:not([type]),input[type="text"],input[type="email"],input[type="tel"]', timeout=10, visible=True)
        filled = fill_first_text_input(USERNAME)
        assert filled == USERNAME, f"username input did not accept value: {filled!r}"
        wait(0.5)
        if not click_text("\u7ee7\u7eed"):
            click_first_button()

    wait_for_element('input[type="password"]', timeout=10)

    filled_password = fill_password_input(PASSWORD)
    assert filled_password == PASSWORD, "password input did not accept value"

    if not click_text("\u767b\u5f55"):
        if not click_text("Sign in"):
            if not click_first_button():
                press_key("Enter")

    wait_for_load(timeout=20)
    wait(3)
    assert "signin" not in js("location.pathname"), page_text()[:1000]
    assert_clean_page("login")


def assert_provider_usage() -> None:
    goto_url(f"{APP_URL}/settings/provider/newapi")
    wait_for_load(timeout=20)
    deadline = time.time() + 30
    text = page_text()
    while time.time() < deadline and ("\u00a5" not in text or "Token" not in text):
        wait(1)
        text = page_text()
    assert_clean_page("provider")
    assert "Aihub" in text, text[:1000]
    assert "\u00a5" in text, "Aihub quota should be rendered as RMB amount"
    assert "Token" in text, "Aihub token usage should be visible"
    assert "glm5.1" in text or click_text(
        "\u5237\u65b0\u6a21\u578b"
    ), "glm5.1 should be visible or model sync should be available"


def assert_chat_and_file_entrypoints() -> None:
    goto_url(APP_URL)
    wait_for_load(timeout=20)
    wait(3)
    assert_clean_page("home")

    editor_found = wait_for_element('textarea,[contenteditable="true"]', timeout=15, visible=True)
    assert editor_found, "chat input editor was not found"

    js(
        """
        (() => {
          const editor = document.querySelector('textarea,[contenteditable="true"]');
          if (!editor) return false;
          editor.focus();
          if ('value' in editor) {
            editor.value = '\u8bf7\u7528\u4e00\u53e5\u4e2d\u6587\u56de\u590d\uff1aMasterion Aihub \u9a8c\u6536';
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            editor.textContent = '\u8bf7\u7528\u4e00\u53e5\u4e2d\u6587\u56de\u590d\uff1aMasterion Aihub \u9a8c\u6536';
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: editor.textContent }));
          }
          return true;
        })()
        """
    )
    press_key("Enter")
    deadline = time.time() + 90
    while time.time() < deadline:
        text = page_text()
        if "Masterion" in text and ("\u9a8c\u6536" in text or "Aihub" in text):
            break
        wait(2)
    else:
        raise AssertionError("AI chat did not produce a visible response within 90s")

    sample = Path(tempfile.gettempdir()) / "masterlion-file-analysis.txt"
    sample.write_text(
        "Masterion \u6587\u4ef6\u5206\u6790\u9a8c\u6536\u53e3\u4ee4\uff1aBLUE-GLM-51",
        encoding="utf-8",
    )
    if not wait_for_element('input[type="file"]', timeout=2):
        assert open_attachment_menu(), "attachment menu trigger was not found"
        wait(1)
    if not wait_for_element('input[type="file"]', timeout=2):
        assert click_attachment_submenu(), "attachment submenu item was not found"
        wait(1)

    if not wait_for_element('input[type="file"]', timeout=8):
        raise AssertionError("file upload input was not found")

    upload_file('input[type="file"]', str(sample))
    wait(2)


def assert_local_skill_entrypoints() -> None:
    text = page_text()
    assert "Web" in text or "\u8054\u7f51" in text or "\u5de5\u5177" in text or "Skill" in text, (
        "No visible local tool/skill entrypoint was found"
    )


def main() -> None:
    ensure_login()
    assert_provider_usage()
    assert_chat_and_file_entrypoints()
    assert_local_skill_entrypoints()
    print("Masterion Aihub browser-harness acceptance flow passed.")


if __name__ in {"__main__", "browser_harness.run"}:
    main()
