import os
import shutil
import mimetypes
from pathlib import Path
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_file, abort
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 4 * 1024 * 1024 * 1024  # 4 GB max upload

STORAGE_ROOT = Path(os.environ.get('STORAGE_ROOT', '/home/pi/cloudrive')).resolve()
STORAGE_ROOT.mkdir(parents=True, exist_ok=True)


def resolve_path(rel: str) -> Path:
    """Resolve a user-supplied relative path safely within STORAGE_ROOT."""
    path = (STORAGE_ROOT / rel.lstrip('/')).resolve()
    if not str(path).startswith(str(STORAGE_ROOT)):
        abort(403)
    return path


def entry_info(path: Path) -> dict:
    stat = path.stat()
    rel = str(path.relative_to(STORAGE_ROOT)).replace('\\', '/')
    mime, _ = mimetypes.guess_type(path.name)
    return {
        'name': path.name,
        'path': rel,
        'is_dir': path.is_dir(),
        'size': stat.st_size if path.is_file() else None,
        'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
        'mime': mime,
    }


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/files')
def list_files():
    rel = request.args.get('path', '')
    path = resolve_path(rel)
    if not path.exists() or not path.is_dir():
        return jsonify({'error': 'Not found'}), 404

    items = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    entries = [entry_info(p) for p in items]

    parts = [p for p in rel.strip('/').split('/') if p]
    breadcrumbs = [{'name': p, 'path': '/'.join(parts[:i + 1])} for i, p in enumerate(parts)]

    total, used, free = shutil.disk_usage(STORAGE_ROOT)
    return jsonify({
        'path': rel,
        'entries': entries,
        'breadcrumbs': breadcrumbs,
        'disk': {'total': total, 'used': used, 'free': free},
    })


@app.route('/api/upload', methods=['POST'])
def upload():
    rel = request.args.get('path', '')
    dest = resolve_path(rel)
    if not dest.is_dir():
        return jsonify({'error': 'Destination is not a directory'}), 400

    saved = []
    for f in request.files.getlist('files'):
        filename = secure_filename(f.filename)
        if filename:
            target = dest / filename
            # avoid overwrite: append (1), (2), …
            stem, suffix = Path(filename).stem, Path(filename).suffix
            counter = 1
            while target.exists():
                target = dest / f'{stem} ({counter}){suffix}'
                counter += 1
            f.save(target)
            saved.append(target.name)

    return jsonify({'saved': saved})

#ciao

@app.route('/api/download')
def download():
    rel = request.args.get('path', '')
    path = resolve_path(rel)
    if not path.is_file():
        return jsonify({'error': 'Not a file'}), 404
    return send_file(path, as_attachment=True, download_name=path.name)


@app.route('/api/preview')
def preview():
    rel = request.args.get('path', '')
    path = resolve_path(rel)
    if not path.is_file():
        return jsonify({'error': 'Not a file'}), 404
    return send_file(path)


@app.route('/api/mkdir', methods=['POST'])
def mkdir():
    data = request.get_json()
    parent = resolve_path(data.get('path', ''))
    name = secure_filename(data.get('name', '').strip())
    if not name:
        return jsonify({'error': 'Invalid folder name'}), 400
    new_dir = parent / name
    if new_dir.exists():
        return jsonify({'error': 'Already exists'}), 409
    new_dir.mkdir()
    return jsonify({'created': name})


@app.route('/api/delete', methods=['POST'])
def delete():
    data = request.get_json()
    path = resolve_path(data.get('path', ''))
    if not path.exists():
        return jsonify({'error': 'Not found'}), 404
    if path == STORAGE_ROOT:
        return jsonify({'error': 'Cannot delete root'}), 403
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()
    return jsonify({'deleted': path.name})


@app.route('/api/rename', methods=['POST'])
def rename():
    data = request.get_json()
    path = resolve_path(data.get('path', ''))
    new_name = secure_filename(data.get('new_name', '').strip())
    if not new_name:
        return jsonify({'error': 'Invalid name'}), 400
    new_path = path.parent / new_name
    if new_path.exists():
        return jsonify({'error': 'Name already taken'}), 409
    path.rename(new_path)
    return jsonify({'renamed': new_name})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
