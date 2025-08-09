(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const socket = io();

  let world = { players: {}, foods: [], map: { w: 4000, h: 4000 } };
  let you = { id: '', username: window.INIT?.username || '', color: '#fff' };
  let joined = false;
  let dx = 0, dy = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // Join room
  socket.emit('join_room', { code: window.INIT?.code });

  socket.on('error_message', (m) => {
    alert(m.message || 'Error');
  });

  socket.on('init_state', (payload) => {
    you = payload.you;
    world.players = payload.players || {};
    world.foods = payload.foods || [];
    world.map = payload.map || world.map;
    joined = true;
  });

  socket.on('state_update', (snapshot) => {
    world.players = snapshot.players || world.players;
    world.foods = snapshot.foods || world.foods;
    world.map = snapshot.map || world.map;
  });

  socket.on('player_eliminated', ({ username }) => {
    if (username === you.username) {
      alert('Kamu tereliminasi!');
    }
  });

  socket.on('room_closed', ({ code }) => {
    alert(`Room ${code} ditutup admin.`);
    window.location.href = '/';
  });

  // Input handling
  function onMouseMove(e) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const mx = e.clientX;
    const my = e.clientY;
    const vx = mx - cx;
    const vy = my - cy;
    const mag = Math.hypot(vx, vy);
    if (mag > 0.0001) {
      dx = vx / mag;
      dy = vy / mag;
    } else {
      dx = 0; dy = 0;
    }
  }
  window.addEventListener('mousemove', onMouseMove);

  setInterval(() => {
    if (!joined) return;
    socket.emit('player_input', { dx, dy });
  }, 50);

  // Rendering
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Camera at your player position
    const me = world.players[you.id];
    const camX = me ? me.x : world.map.w / 2;
    const camY = me ? me.y : world.map.h / 2;

    // Draw grid
    const gridSize = 100;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const startX = Math.floor((camX - canvas.width / 2) / gridSize) * gridSize;
    const endX = Math.ceil((camX + canvas.width / 2) / gridSize) * gridSize;
    const startY = Math.floor((camY - canvas.height / 2) / gridSize) * gridSize;
    const endY = Math.ceil((camY + canvas.height / 2) / gridSize) * gridSize;
    for (let x = startX; x <= endX; x += gridSize) {
      const sx = Math.floor((x - camX) + canvas.width / 2) + 0.5;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height);
      ctx.stroke();
    }
    for (let y = startY; y <= endY; y += gridSize) {
      const sy = Math.floor((y - camY) + canvas.height / 2) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
      ctx.stroke();
    }

    // Draw foods
    for (const f of world.foods) {
      const sx = (f.x - camX) + canvas.width / 2;
      const sy = (f.y - camY) + canvas.height / 2;
      ctx.beginPath();
      ctx.fillStyle = '#6ee7b7';
      ctx.arc(sx, sy, f.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw players (sorted by radius)
    const entries = Object.entries(world.players).sort((a, b) => a[1].r - b[1].r);
    for (const [id, p] of entries) {
      const sx = (p.x - camX) + canvas.width / 2;
      const sy = (p.y - camY) + canvas.height / 2;
      ctx.beginPath();
      ctx.fillStyle = p.color || '#fff';
      ctx.arc(sx, sy, p.r, 0, Math.PI * 2);
      ctx.fill();

      // Username
      ctx.fillStyle = '#fff';
      ctx.font = '14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name || id, sx, sy - p.r - 8);
    }

    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();


