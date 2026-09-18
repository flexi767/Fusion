#!/usr/bin/env python3
"""Append Fusion feedback hooks without changing existing hooks or Codex trust."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shlex
import sys


def install(path, command, apply=False):
    original = path.read_text() if path.exists() else '{}'
    config = json.loads(original)
    hooks = config.setdefault('hooks', {})
    changed = False
    for event in ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse']:
        groups = hooks.setdefault(event, [])
        if any(h.get('command') == command for g in groups for h in g.get('hooks', [])):
            continue
        groups.append({'hooks': [{'type': 'command', 'command': command, 'timeout': 3}]})
        changed = True
    if not changed:
        print(str(path) + ': already installed'); return
    if not apply:
        print(str(path) + ': would append Fusion hooks; use --apply to install'); return
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        backup = path.with_name(path.name + '.fusion-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        backup.write_text(original); os.chmod(backup, 0o600)
    temporary = path.with_name(path.name + '.fusion-tmp')
    temporary.write_text(json.dumps(config, indent=2) + '\n'); os.chmod(temporary, 0o600)
    temporary.replace(path)
    print(str(path) + ': Fusion hooks appended; existing hooks preserved')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', required=True); p.add_argument('--project', required=True); p.add_argument('--host', required=True)
    p.add_argument('--token-file', type=Path, required=True); p.add_argument('--state', type=Path, required=True)
    p.add_argument('--home', type=Path, default=Path.home()); p.add_argument('--apply', action='store_true')
    args = p.parse_args()
    script = Path(__file__).resolve().with_name('feedback_hook.py')
    for provider, path in [('codex', args.home / '.codex/hooks.json'), ('claude', args.home / '.claude/settings.json')]:
        command = shlex.join([sys.executable, str(script), '--url', args.url, '--project', args.project, '--host', args.host, '--provider', provider, '--token-file', str(args.token_file.resolve()), '--state', str(args.state.resolve())])
        install(path, command, args.apply)
    print('Codex: enable its hooks feature if needed and review/trust the new definitions in the native CLI. Trust is never set by this installer.')
    print('Claude: restart or resume a session to load the updated hook settings.')


if __name__ == '__main__':
    main()
