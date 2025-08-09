(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const params = new URLSearchParams(location.search);
  const code = location.pathname.split('/').pop();
  const name = params.get('name') || 'Guest';
  const vsbot = params.get('vsbot') === '1';

  function resize(){ canvas.width = innerWidth; canvas.height = innerHeight; }
  addEventListener('resize', resize); resize();

  // WebSocket connect
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${location.host}/api/ws`);
  let you = null;
  let world = { players: {}, foods: [], map: { w: 4000, h: 4000 } };
  let dx = 0, dy = 0;

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'join', payload: { code, name, vsBot: vsbot } }));
  });

  ws.addEventListener('message', (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'init') {
      you = msg.payload.you;
      world.players = msg.payload.players || {};
      world.foods = msg.payload.foods || [];
      world.map = msg.payload.map || world.map;
    } else if (msg.type === 'joined') {
      // ignore
    } else if (msg.type === 'error') {
      alert(msg.payload.message || 'Error');
      location.href = '/';
    }
  });

  function onMouseMove(e){
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const vx = e.clientX - cx, vy = e.clientY - cy;
    const m = Math.hypot(vx, vy) || 1; dx = vx / m; dy = vy / m;
    ws.readyState === 1 && ws.send(JSON.stringify({ type: 'input', payload: { dx, dy } }));
  }
  addEventListener('mousemove', onMouseMove);

  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (!you) { requestAnimationFrame(draw); return; }
    const me = world.players[you.id] || you;
    const camX = me.x || world.map.w/2;
    const camY = me.y || world.map.h/2;
    // grid
    ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    const grid=100, sx0=Math.floor((camX-canvas.width/2)/grid)*grid, sx1=Math.ceil((camX+canvas.width/2)/grid)*grid;
    for(let x=sx0;x<=sx1;x+=grid){ const sx=(x-camX)+canvas.width/2+0.5; ctx.beginPath(); ctx.moveTo(sx,0); ctx.lineTo(sx,canvas.height); ctx.stroke(); }
    const sy0=Math.floor((camY-canvas.height/2)/grid)*grid, sy1=Math.ceil((camY+canvas.height/2)/grid)*grid;
    for(let y=sy0;y<=sy1;y+=grid){ const sy=(y-camY)+canvas.height/2+0.5; ctx.beginPath(); ctx.moveTo(0,sy); ctx.lineTo(canvas.width,sy); ctx.stroke(); }

    // foods
    for(const f of world.foods){ const x=(f.x-camX)+canvas.width/2, y=(f.y-camY)+canvas.height/2; ctx.beginPath(); ctx.fillStyle='#6ee7b7'; ctx.arc(x,y,f.r,0,Math.PI*2); ctx.fill(); }
    const entries = Object.entries(world.players).sort((a,b)=>a[1].r-b[1].r);
    for(const [id,p] of entries){ const x=(p.x-camX)+canvas.width/2, y=(p.y-camY)+canvas.height/2; ctx.beginPath(); ctx.fillStyle=p.color||'#fff'; ctx.arc(x,y,p.r,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#fff'; ctx.font='14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; ctx.textAlign='center'; ctx.fillText(p.name||id,x,y-p.r-8); }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();


