from flask import Flask, render_template, request, redirect, url_for, session, abort
from flask_socketio import SocketIO, emit, join_room, leave_room
from werkzeug.security import generate_password_hash, check_password_hash
import random
import string
import math
import time
import threading
import sqlite3
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# In-memory stores (demo only). Replace with a real database for production.
DB_PATH = os.path.join(os.path.dirname(__file__), 'data.db')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS rooms (
            code TEXT PRIMARY KEY,
            created_by TEXT NOT NULL,
            max_players INTEGER NOT NULL DEFAULT 2,
            vs_bot INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.commit()
    conn.close()


def ensure_default_admin():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT username FROM users WHERE username=?", ('admin',))
    row = cur.fetchone()
    if not row:
        cur.execute(
            "INSERT INTO users(username,password_hash,role) VALUES(?,?,?)",
            ('admin', generate_password_hash('admin123'), 'admin')
        )
        conn.commit()
    conn.close()

# Rooms: code -> room_state
# room_state = {
#   'created_by': username,
#   'players': { username: { 'sid': str, 'x': float, 'y': float, 'r': float, 'color': str, 'dx': float, 'dy': float } },
#   'foods': [ { 'x': float, 'y': float, 'r': float } ],
# }
rooms = {}

# Reverse lookups
sid_to_username = {}    # sid -> username (display name)
sid_to_room = {}        # sid -> room_code
sid_to_playerkey = {}   # sid -> playerKey (unique for rendering)

# Game constants
MAP_WIDTH = 4000
MAP_HEIGHT = 4000
INITIAL_RADIUS = 12.0
FOOD_TARGET = 500
FOOD_RADIUS = 3.0
PLAYER_SPEED_BASE = 260.0  # pixels/sec for radius 12
TICK_HZ = 20
TICK_DT = 1.0 / TICK_HZ


def require_login():
    if 'username' not in session:
        return redirect(url_for('login'))


def is_admin(username: str) -> bool:
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT role FROM users WHERE username=?", (username,))
    row = cur.fetchone()
    conn.close()
    return bool(row and row['role'] == 'admin')


def random_code(n: int = 6) -> str:
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=n))


def random_color() -> str:
    return '#%06x' % random.randint(0, 0xFFFFFF)


def ensure_foods(room_state):
    while len(room_state['foods']) < FOOD_TARGET:
        room_state['foods'].append({
            'x': random.uniform(0, MAP_WIDTH),
            'y': random.uniform(0, MAP_HEIGHT),
            'r': FOOD_RADIUS
        })


def create_room(created_by: str, vs_bot: bool = False) -> str:
    code = random_code()
    while code in rooms:
        code = random_code()
    rooms[code] = {
        'created_by': created_by,
        'players': {},
        'foods': [],
        'vs_bot': bool(vs_bot)
    }
    ensure_foods(rooms[code])
    # Persist metadata
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT OR REPLACE INTO rooms(code, created_by, max_players, vs_bot) VALUES(?,?,?,?)",
        (code, created_by, 2, 1 if vs_bot else 0)
    )
    conn.commit()
    conn.close()
    # Spawn bot if needed
    if vs_bot:
        add_bot_to_room(code)
    return code


def add_player_to_room(username: str, sid: str, room_code: str):
    room = rooms.get(room_code)
    if not room:
        return None
    # Capacity check (max 2 players; if vs_bot, only 1 human allowed)
    human_players = [p for p in room['players'].values() if not p.get('is_bot')]
    capacity = 2 - (1 if room.get('vs_bot') else 0)
    if len(human_players) >= capacity:
        return None
    # Unique player key (stable for this socket connection)
    suffix = sid[-4:]
    player_key = f"{username}#{suffix}"
    # Ensure uniqueness even if collision
    while player_key in room['players']:
        player_key = f"{username}#{random.randint(1000,9999)}"
    room['players'][player_key] = {
        'sid': sid,
        'name': username,
        'x': random.uniform(0, MAP_WIDTH),
        'y': random.uniform(0, MAP_HEIGHT),
        'r': INITIAL_RADIUS,
        'color': random_color(),
        'dx': 0.0,
        'dy': 0.0,
        'is_bot': False
    }
    sid_to_room[sid] = room_code
    sid_to_playerkey[sid] = player_key
    return player_key


def remove_player_by_sid(sid: str):
    room_code = sid_to_room.pop(sid, None)
    player_key = sid_to_playerkey.pop(sid, None)
    if not room_code or not player_key:
        return
    room = rooms.get(room_code)
    if not room:
        return
    room['players'].pop(player_key, None)
    # If room empty, delete it automatically (and metadata)
    if not room['players']:
        rooms.pop(room_code, None)
        conn = get_db()
        cur = conn.cursor()
        cur.execute("DELETE FROM rooms WHERE code=?", (room_code,))
        conn.commit()
        conn.close()


def add_bot_to_room(room_code: str):
    room = rooms.get(room_code)
    if not room:
        return None
    player_key = f"BOT#{random.randint(1000,9999)}"
    room['players'][player_key] = {
        'sid': f"bot-{player_key}",
        'name': 'BOT',
        'x': random.uniform(0, MAP_WIDTH),
        'y': random.uniform(0, MAP_HEIGHT),
        'r': INITIAL_RADIUS * 1.2,
        'color': '#ff6b6b',
        'dx': 0.0,
        'dy': 0.0,
        'is_bot': True
    }
    return player_key


def circle_contains(a_x, a_y, a_r, b_x, b_y, b_r):
    if a_r <= b_r:
        return False
    dx = a_x - b_x
    dy = a_y - b_y
    dist2 = dx * dx + dy * dy
    return dist2 <= (a_r - b_r) ** 2


def clamp(val, lo, hi):
    return max(lo, min(hi, val))


def step_room(room_code: str, room_state):
    # Move players
    for username, p in list(room_state['players'].items()):
        radius = p['r']
        # Speed decreases with radius (simple heuristic)
        speed = PLAYER_SPEED_BASE * (INITIAL_RADIUS / max(radius, INITIAL_RADIUS))
        # Simple bot AI: move towards closest target (food or player)
        if p.get('is_bot'):
            target_x, target_y = None, None
            # Prefer nearest player (human)
            min_d = float('inf')
            for other_key, other in room_state['players'].items():
                if other is p or other.get('is_bot'):
                    continue
                d = (other['x'] - p['x']) ** 2 + (other['y'] - p['y']) ** 2
                if d < min_d:
                    min_d = d
                    target_x, target_y = other['x'], other['y']
            # If no human, go to nearest food
            if target_x is None:
                for f in room_state['foods'][:50]:
                    d = (f['x'] - p['x']) ** 2 + (f['y'] - p['y']) ** 2
                    if d < min_d:
                        min_d = d
                        target_x, target_y = f['x'], f['y']
            if target_x is not None:
                vx_dir = target_x - p['x']
                vy_dir = target_y - p['y']
                mag = math.hypot(vx_dir, vy_dir) or 1.0
                p['dx'] = vx_dir / mag
                p['dy'] = vy_dir / mag
        vx = p['dx'] * speed * TICK_DT
        vy = p['dy'] * speed * TICK_DT
        p['x'] = clamp(p['x'] + vx, 0, MAP_WIDTH)
        p['y'] = clamp(p['y'] + vy, 0, MAP_HEIGHT)

    # Eat foods
    for username, p in list(room_state['players'].items()):
        px, py, pr = p['x'], p['y'], p['r']
        remaining_foods = []
        for f in room_state['foods']:
            if circle_contains(px, py, pr, f['x'], f['y'], f['r']):
                # Increase area -> adjust radius
                area = math.pi * (pr ** 2) + math.pi * (f['r'] ** 2)
                p['r'] = math.sqrt(area / math.pi)
            else:
                remaining_foods.append(f)
        room_state['foods'] = remaining_foods
    ensure_foods(room_state)

    # Player vs player eating
    # Larger player can eat smaller if fully contained and at least 10% larger
    eaten = set()
    player_items = list(room_state['players'].items())
    for i in range(len(player_items)):
        u_a, a = player_items[i]
        for j in range(len(player_items)):
            if i == j:
                continue
            u_b, b = player_items[j]
            if u_b in eaten or u_a in eaten:
                continue
            if a['r'] > 1.1 * b['r'] and circle_contains(a['x'], a['y'], a['r'], b['x'], b['y'], b['r']):
                # a eats b
                area = math.pi * (a['r'] ** 2) + math.pi * (b['r'] ** 2)
                a['r'] = math.sqrt(area / math.pi)
                eaten.add(u_b)

    for player_key in eaten:
        victim = room_state['players'].pop(player_key, None)
        if victim:
            sid_to_room.pop(victim.get('sid'), None)
            sid_to_playerkey.pop(victim.get('sid'), None)
        # Notify room
        emit('player_eliminated', {'id': player_key, 'name': victim.get('name') if victim else ''}, room=room_code)

    # Broadcast state snapshot
    snapshot = {
        'players': {u: {k: p[k] for k in ['x', 'y', 'r', 'color']} | {'name': p.get('name', '')} for u, p in room_state['players'].items()},
        'foods': room_state['foods'][:200],  # cap for bandwidth
        'map': {'w': MAP_WIDTH, 'h': MAP_HEIGHT}
    }
    socketio.emit('state_update', snapshot, room=room_code)


def game_loop():
    while True:
        start = time.time()
        for code, room in list(rooms.items()):
            try:
                step_room(code, room)
            except Exception:
                # Keep server running even if a room crashes
                pass
        elapsed = time.time() - start
        time.sleep(max(0.0, TICK_DT - elapsed))


# Start background game loop
socketio.start_background_task(game_loop)


@app.route('/')
def index():
    username = session.get('username')
    # Load room summaries from DB
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT code, created_by, max_players, vs_bot FROM rooms ORDER BY rowid DESC LIMIT 20")
    db_rooms = cur.fetchall()
    conn.close()
    rooms_summary = {}
    for r in db_rooms:
        code = r['code']
        active = rooms.get(code)
        players_count = len([p for p in (active['players'].values() if active else []) if not p.get('is_bot')])
        rooms_summary[code] = {
            'created_by': r['created_by'],
            'players': {},  # unused in summary
            'players_count': players_count,
            'vs_bot': bool(r['vs_bot'])
        }
    return render_template('index.html', username=username, rooms=rooms_summary)


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT username,password_hash,role FROM users WHERE username=?", (username,))
        row = cur.fetchone()
        conn.close()
        if row and check_password_hash(row['password_hash'], password):
            session['username'] = username
            return redirect(url_for('index'))
        return render_template('login.html', error='Username atau password salah')
    return render_template('login.html')


@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        if not username or not password:
            return render_template('signup.html', error='Isi semua field')
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT username FROM users WHERE username=?", (username,))
        if cur.fetchone():
            conn.close()
            return render_template('signup.html', error='Username sudah dipakai')
        cur.execute(
            "INSERT INTO users(username,password_hash,role) VALUES(?,?,?)",
            (username, generate_password_hash(password), 'player')
        )
        conn.commit()
        conn.close()
        session['username'] = username
        return redirect(url_for('index'))
    return render_template('signup.html')


@app.route('/guest_login')
def guest_login():
    name = request.args.get('name', '').strip()
    code = (request.args.get('code', '') or '').strip().upper()
    if not name or not code:
        return redirect(url_for('index'))
    # Prevent collision with registered users
    guest_username = f"guest_{name}_{random.randint(1000,9999)}"
    session['username'] = guest_username
    # Auto create room if not exists? For safety, require existing room
    if code not in rooms:
        return redirect(url_for('index'))
    return redirect(url_for('room', code=code))


@app.route('/logout')
def logout():
    session.pop('username', None)
    # Note: player removal is handled on socket disconnect per sid
    return redirect(url_for('index'))


@app.route('/create_room', methods=['POST'])
def http_create_room():
    resp = require_login()
    if resp:
        return resp
    vs_bot = request.form.get('vs_bot') == 'on'
    code = create_room(session['username'], vs_bot=vs_bot)
    return redirect(url_for('room', code=code))


@app.route('/room/<code>')
def room(code):
    resp = require_login()
    if resp:
        return resp
    if code not in rooms:
        # If freshly created but not yet in memory (server restart): reconstruct minimal state
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT code, created_by, vs_bot FROM rooms WHERE code=?", (code,))
        row = cur.fetchone()
        conn.close()
        if not row:
            abort(404)
        # Recreate in-memory room
        rooms[code] = {
            'created_by': row['created_by'],
            'players': {},
            'foods': [],
            'vs_bot': bool(row['vs_bot'])
        }
        ensure_foods(rooms[code])
        if row['vs_bot']:
            add_bot_to_room(code)
    return render_template('room.html', code=code, username=session['username'])


@app.route('/admin', methods=['GET'])
def admin_panel():
    resp = require_login()
    if resp:
        return resp
    if not is_admin(session['username']):
        abort(403)
    # Build a summary from DB
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT code, created_by, max_players, vs_bot FROM rooms ORDER BY rowid DESC LIMIT 100")
    summary = []
    for r in cur.fetchall():
        code = r['code']
        active = rooms.get(code)
        players_count = len([p for p in (active['players'].values() if active else []) if not p.get('is_bot')])
        summary.append({
            'code': code,
            'created_by': r['created_by'],
            'players_count': players_count,
        })
    conn.close()
    return render_template('admin.html', username=session['username'], rooms=summary)


@app.route('/admin/delete_room', methods=['POST'])
def admin_delete_room():
    resp = require_login()
    if resp:
        return resp
    if not is_admin(session['username']):
        abort(403)
    code = request.form.get('code', '').strip().upper()
    room = rooms.pop(code, None)
    if room:
        # Notify connected players
        socketio.emit('room_closed', {'code': code}, room=code)
    # Remove from DB
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM rooms WHERE code=?", (code,))
    conn.commit()
    conn.close()
    return redirect(url_for('admin_panel'))


@socketio.on('connect')
def on_connect():
    username = session.get('username')
    if username:
        sid_to_username[request.sid] = username
    emit('connected', {'ok': True})


@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    username = sid_to_username.pop(sid, None)
    room_code = sid_to_room.get(sid)
    remove_player_by_sid(sid)
    if room_code and username:
        emit('player_left', {'name': username}, room=room_code)


@socketio.on('join_room')
def on_join_room(data):
    username = session.get('username')
    if not username:
        emit('error_message', {'message': 'Silakan login dulu'})
        return
    code = str(data.get('code', '')).upper()
    if code not in rooms:
        emit('error_message', {'message': 'Room tidak ditemukan'})
        return
    player_key = add_player_to_room(username, request.sid, code)
    if not player_key:
        emit('error_message', {'message': 'Room penuh (maks 2 pemain)'})
        return
    join_room(code)

    room_state = rooms[code]
    emit('init_state', {
        'you': {
            'id': player_key,
            'username': username,
            'color': room_state['players'][player_key]['color']
        },
        'players': {u: {k: p[k] for k in ['x', 'y', 'r', 'color']} | {'name': p.get('name', '')} for u, p in room_state['players'].items()},
        'foods': room_state['foods'],
        'map': {'w': MAP_WIDTH, 'h': MAP_HEIGHT},
        'code': code
    })
    emit('player_joined', {'id': player_key, 'name': username}, room=code, include_self=False)


@socketio.on('player_input')
def on_player_input(data):
    sid = request.sid
    code = sid_to_room.get(sid)
    if not code or code not in rooms:
        return
    dx = float(data.get('dx', 0.0))
    dy = float(data.get('dy', 0.0))
    # Normalize vector to unit length to avoid speed cheating
    mag = math.hypot(dx, dy)
    if mag > 0:
        dx /= mag
        dy /= mag
    player_key = sid_to_playerkey.get(sid)
    p = rooms[code]['players'].get(player_key)
    if p:
        p['dx'] = dx
        p['dy'] = dy


if __name__ == '__main__':
    init_db()
    ensure_default_admin()
    socketio.run(app, debug=True, host="127.0.0.1", port=8888)