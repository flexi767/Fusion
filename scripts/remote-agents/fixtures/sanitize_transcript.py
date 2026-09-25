#!/usr/bin/env python3
"""Turn a real Codex/Claude transcript into a publishable, structure-only fixture.

FNXC:RemoteAgentFixtures 2026-09-25-04:28:
Phase 0 of the AgentPulse integration plan needs sanitized native fixtures (model changes,
compaction, resumed sessions, file edits) so parser and accounting behaviour can be reconciled
against real provider formats. Fixtures are public, so the sanitizer keeps only structure:
event and block types, enum-like fields, numbers (token counts, durations, line numbers),
booleans and relative timing. Every other string becomes a deterministic placeholder, every
identifier maps to a stable surrogate (so tool calls still pair with their results), and diffs
keep only their line markers so added/removed counts stay exact.
`validate()` is the gate: a fixture containing any string outside the placeholder grammar or
the enum allowlist is rejected, so a new provider field cannot silently leak text.

Usage: sanitize_transcript.py PROVIDER INPUT.jsonl OUTPUT.jsonl [--head N] [--start N] [--limit N]
Runs anywhere Python 3 runs; sanitize on the host that owns the transcript so raw text never
leaves it.
"""
import argparse
import datetime
import json
import re
import sys

FIXTURE_EPOCH = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)

# Keys whose string values are schema enums, kept verbatim when they look like an enum.
ENUM_KEYS = {
    'type', 'subtype', 'role', 'phase', 'stop_reason', 'status', 'service_tier', 'model',
    'level', 'operation', 'effort', 'summary_mode', 'originator', 'approval_policy',
    'sandbox_mode', 'reasoning_effort', 'speed', 'userType', 'permissionMode', 'entrypoint',
}
ENUM_VALUE = re.compile(r'^[A-Za-z][A-Za-z0-9_.:\-]{0,63}$')
# Provider model ids may carry a context-window suffix such as `[1m]` or be `<synthetic>`.
MODEL_VALUE = re.compile(r'^(<synthetic>|[A-Za-z][A-Za-z0-9_.:\-]{0,63}(\[[0-9a-z]{1,8}\])?)$')
# `name` is kept only on tool-call objects, where it is a tool name rather than free text.
TOOL_TYPES = {'tool_use', 'function_call', 'custom_tool_call', 'McpToolCall', 'CommandExecution'}
# Keys holding identifiers; mapped to stable surrogates so relations survive.
ID_KEYS = {
    'id', 'uuid', 'parentUuid', 'leafUuid', 'sessionId', 'session_id', 'tool_use_id', 'turn_id',
    'response_id', 'call_id', 'requestId', 'request_id', 'item_id', 'logicalParentUuid',
    'promptId', 'messageId', 'agentId',
}
# Keys holding a filesystem path; mapped to a stable placeholder path.
PATH_KEYS = {'cwd', 'file_path', 'path', 'filePath', 'previous_path', 'previousPath', 'notebook_path'}
DIFF_KEYS = {'unified_diff', 'diff', 'patch'}
TIME_KEYS = {'timestamp', 'started_at', 'completed_at', 'created_at', 'at'}
# Opaque blobs that carry no structure worth keeping.
DROP_KEYS = {'encrypted_content', 'signature', 'data', 'image_url', 'source'}
# Keys that are free-form maps keyed by data (e.g. FileChange paths); their KEYS are mapped.
PATH_KEYED_MAPS = {'changes'}

ISO = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$')
FILLER = 'lorem ipsum dolor sit amet '
TEXT_CAP = 48

PLACEHOLDER = re.compile(
    r'^(id-\d+|/workspace/project(/file-\d+(\.[a-z0-9]{1,5})?)?|'
    r'(lorem ipsum dolor sit amet ?)*(lorem|ipsum|dolor|sit|amet|lorem ipsum|lorem ipsum dolor|'
    r'lorem ipsum dolor sit|lorem ipsum dolor sit amet)?)$'
)
DIFF_LINE = re.compile(r'^(@@ -\d+(,\d+)? \+\d+(,\d+)? @@|[+\- ]x?|(\+\+\+|---) x|\\ x|x?)$')
FIXTURE_TIME = re.compile(r'^2026-0[1-9]-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$')


class Sanitizer:
    def __init__(self):
        self.ids, self.paths, self.offset = {}, {}, None

    def surrogate(self, value):
        return self.ids.setdefault(value, f'id-{len(self.ids) + 1}')

    def path(self, value):
        if value not in self.paths:
            ext = re.search(r'\.([a-z0-9]{1,5})$', value.lower())
            self.paths[value] = (f'/workspace/project/file-{len(self.paths) + 1}' +
                                 (f'.{ext.group(1)}' if ext else ''))
        return self.paths[value]

    def time(self, value):
        try:
            parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return self.text(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.timezone.utc)
        if self.offset is None:
            self.offset = parsed - FIXTURE_EPOCH
        shifted = parsed - self.offset
        return shifted.strftime('%Y-%m-%dT%H:%M:%S.') + f'{shifted.microsecond // 1000:03d}Z'

    @staticmethod
    def text(value):
        # Whole filler words only, roughly the original length up to TEXT_CAP.
        length, words = min(len(value), TEXT_CAP), []
        for word in (FILLER.split() * (TEXT_CAP // 5 + 1)):
            if len(' '.join(words + [word])) > length:
                break
            words.append(word)
        return ' '.join(words)

    @staticmethod
    def diff(value):
        lines = []
        for line in value.split('\n'):
            header = re.match(r'^@@ -(\d+)(,\d+)? \+(\d+)(,\d+)? @@', line)
            if header:
                lines.append(header.group(0))
            elif line.startswith(('+++', '---')):
                lines.append(line[:3] + ' x')
            elif line[:1] in ('+', '-', ' ', '\\'):
                lines.append(line[0] + ('x' if len(line) > 1 else ''))
            else:
                lines.append('x' if line else '')
        return '\n'.join(lines)

    def value(self, key, value, parent_type=None):
        if isinstance(value, dict):
            return self.mapping(value)
        if isinstance(value, list):
            if key == 'lines':  # Claude structuredPatch hunks
                return [self.diff(line) if isinstance(line, str) else self.value(None, line) for line in value]
            return [self.value(key, item, parent_type) for item in value]
        if not isinstance(value, str):
            return value  # numbers, booleans, null carry structure, not text
        if key in TIME_KEYS or ISO.match(value):
            return self.time(value)
        if key in ID_KEYS:
            return self.surrogate(value)
        if key == 'cwd':
            return '/workspace/project'
        if key in PATH_KEYS:
            return self.path(value)
        if key == 'name' and parent_type in TOOL_TYPES and ENUM_VALUE.match(value):
            return value
        if key in DIFF_KEYS:
            return self.diff(value)
        if key == 'model' and MODEL_VALUE.match(value):
            return value
        if key in ENUM_KEYS and ENUM_VALUE.match(value):
            return value
        return self.text(value)

    def mapping(self, obj):
        out = {}
        for key, val in obj.items():
            if key in DROP_KEYS:
                continue
            if key in PATH_KEYED_MAPS and isinstance(val, dict):
                out[key] = {self.path(k): self.value(None, v) for k, v in val.items()}
            else:
                out[key] = self.value(key, val, obj.get('type'))
        return out


def validate(event, trail='event'):
    """Raise ValueError when a sanitized event contains anything but structure."""
    if isinstance(event, dict):
        for key, val in event.items():
            if not ENUM_VALUE.match(key) and not PLACEHOLDER.match(key):
                raise ValueError(f'{trail}: unexpected key {key!r}')
            if isinstance(val, str):
                ok = (PLACEHOLDER.match(val) or FIXTURE_TIME.match(val) or
                      (key in ENUM_KEYS and ENUM_VALUE.match(val)) or
                      (key == 'model' and MODEL_VALUE.match(val)) or
                      (key == 'name' and event.get('type') in TOOL_TYPES and ENUM_VALUE.match(val)) or
                      (key in DIFF_KEYS and all(DIFF_LINE.match(line) for line in val.split('\n'))))
                if not ok:
                    raise ValueError(f'{trail}.{key}: string is not structure-only')
            else:
                validate(val, f'{trail}.{key}')
    elif isinstance(event, list):
        for index, item in enumerate(event):
            if isinstance(item, str):
                if not (PLACEHOLDER.match(item) or DIFF_LINE.match(item) or FIXTURE_TIME.match(item)):
                    raise ValueError(f'{trail}[{index}]: string is not structure-only')
            else:
                validate(item, f'{trail}[{index}]')


def sanitize_file(provider, source, target, start=0, limit=None, head=0):
    """`head` keeps the first N lines (e.g. Codex session_meta) before the `start` window."""
    if provider not in ('codex', 'claude'):
        raise ValueError('provider must be codex or claude')
    sanitizer, written = Sanitizer(), 0
    with open(source, errors='replace') as fh, open(target, 'w') as out:
        for index, line in enumerate(fh):
            if head <= index < start:
                continue
            if limit is not None and written >= limit + min(head, start):
                break
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            clean = sanitizer.mapping(event)
            validate(clean)
            out.write(json.dumps(clean, sort_keys=True, separators=(',', ':')) + '\n')
            written += 1
    return written


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('provider', choices=('codex', 'claude'))
    parser.add_argument('source'); parser.add_argument('target')
    parser.add_argument('--start', type=int, default=0)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--head', type=int, default=0)
    args = parser.parse_args(argv)
    count = sanitize_file(args.provider, args.source, args.target, args.start, args.limit, args.head)
    print(f'wrote {count} sanitized events to {args.target}', file=sys.stderr)


if __name__ == '__main__':
    main()
