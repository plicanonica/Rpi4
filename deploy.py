#!/usr/bin/env python3
"""
Deploy CloudDrive to Raspberry Pi.

Usage:
    python deploy.py [--host HOST] [--user USER] [--password PASSWORD]

Defaults:
    host     = 192.168.86.55
    user     = pi
    password = Raspberry1234
"""

import argparse
import os
import posixpath
import sys
import stat
from pathlib import Path

try:
    import paramiko
    from paramiko import SFTPClient
except ImportError:
    sys.exit("Install paramiko:  pip install paramiko")

# -- Configuration --------------------------------------------------------─
LOCAL_ROOT   = Path(__file__).parent
REMOTE_APP   = '/home/pi/cloudrive_app'
REMOTE_STORE = '/home/pi/cloudrive'
SERVICE_NAME = 'cloudrive'
SERVICE_FILE = 'cloudrive.service'

DEPLOY_FILES = [
    ('app.py',                  f'{REMOTE_APP}/app.py'),
    ('requirements.txt',        f'{REMOTE_APP}/requirements.txt'),
    ('cloudrive.service',       f'{REMOTE_APP}/cloudrive.service'),
    ('templates/index.html',    f'{REMOTE_APP}/templates/index.html'),
    ('static/css/style.css',    f'{REMOTE_APP}/static/css/style.css'),
    ('static/js/app.js',        f'{REMOTE_APP}/static/js/app.js'),
]

# -- Helpers --------------------------------------------------------------─
def run(ssh: paramiko.SSHClient, cmd: str, check=True) -> str:
    print(f'  $ {cmd}')
    _, stdout, stderr = ssh.exec_command(cmd)
    out  = stdout.read().decode('utf-8', errors='replace').strip()
    err  = stderr.read().decode('utf-8', errors='replace').strip()
    code = stdout.channel.recv_exit_status()
    safe_out = out.encode(sys.stdout.encoding or 'utf-8', errors='replace').decode(sys.stdout.encoding or 'utf-8')
    safe_err = err.encode(sys.stdout.encoding or 'utf-8', errors='replace').decode(sys.stdout.encoding or 'utf-8')
    if safe_out:  print(f'    {safe_out}')
    if safe_err:  print(f'    [stderr] {safe_err}')
    if check and code != 0:
        raise RuntimeError(f'Command failed (exit {code}): {cmd}')
    return out


def upload_file(sftp: SFTPClient, local: Path, remote: str):
    # Use posixpath to avoid Windows backslashes in remote paths
    parent = posixpath.dirname(remote)
    try:
        sftp.stat(parent)
    except FileNotFoundError:
        sftp.mkdir(parent)
    print(f'  upload: {local.relative_to(LOCAL_ROOT)}  ->  {remote}')
    sftp.put(str(local), remote)


def ensure_remote_dirs(sftp: SFTPClient, dirs: list[str]):
    for d in dirs:
        try:
            sftp.stat(d)
        except FileNotFoundError:
            sftp.mkdir(d)
            print(f'  mkdir:  {d}')


# -- Main ------------------------------------------------------------------
def deploy(host: str, user: str, password: str):
    print(f'\nConnecting to {user}@{host} ...')
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(host, username=user, password=password, timeout=15)
    sftp = ssh.open_sftp()
    print('Connected.\n')

    # 1. Create remote directories
    print('-- Creating directories --')
    ensure_remote_dirs(sftp, [
        REMOTE_APP,
        f'{REMOTE_APP}/templates',
        f'{REMOTE_APP}/static',
        f'{REMOTE_APP}/static/css',
        f'{REMOTE_APP}/static/js',
        REMOTE_STORE,
    ])

    # 2. Upload source files
    print('\n-- Uploading files --')
    for rel, remote in DEPLOY_FILES:
        local = LOCAL_ROOT / Path(rel)
        upload_file(sftp, local, remote)

    sftp.close()

    # 3. Install Python dependencies
    print('\n-- Installing dependencies --')
    run(ssh, f'python3 -m venv {REMOTE_APP}/.venv')
    run(ssh, f'{REMOTE_APP}/.venv/bin/pip install -q --upgrade pip')
    run(ssh, f'{REMOTE_APP}/.venv/bin/pip install -q -r {REMOTE_APP}/requirements.txt')

    # 4. Install and enable systemd service
    print('\n-- Installing systemd service --')
    run(ssh, f'sudo cp {REMOTE_APP}/{SERVICE_FILE} /etc/systemd/system/{SERVICE_NAME}.service')
    run(ssh, 'sudo systemctl daemon-reload')
    run(ssh, f'sudo systemctl enable {SERVICE_NAME}')
    run(ssh, f'sudo systemctl restart {SERVICE_NAME}')

    # 5. Verify
    print('\n-- Verifying service --')
    status = run(ssh, f'sudo systemctl is-active {SERVICE_NAME}', check=False)
    if status == 'active':
        print(f'\nOK: CloudDrive is running at  http://{host}:5000')
    else:
        print(f'\nFAIL: Service may not have started. Check with:\n  sudo journalctl -u {SERVICE_NAME} -n 30')

    ssh.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Deploy CloudDrive to Raspberry Pi')
    parser.add_argument('--host',     default='192.168.86.55')
    parser.add_argument('--user',     default='pi')
    parser.add_argument('--password', default='Raspberry1234')
    args = parser.parse_args()

    try:
        deploy(args.host, args.user, args.password)
    except KeyboardInterrupt:
        print('\nAborted.')
    except Exception as e:
        print(f'\nDeploy failed: {e}')
        sys.exit(1)
