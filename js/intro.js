// @ts-nocheck
var canvas  = document.getElementById('intro-canvas');
var ctx     = canvas.getContext('2d');
var skipBtn = document.getElementById('skip-btn');

function resize(){ canvas.width=window.innerWidth; canvas.height=window.innerHeight; }
resize();
window.addEventListener('resize', resize);

// state
var scene        = 0;
var sceneTimer   = 0;
var frameCount   = 0;
var animId       = null;
var selectedEnemy= null;  // which enemy card was clicked (null = none)

// scene 3 (meet enemies) stays until player clicks CONTINUE
// all other scenes auto advance
var SCENE_DURATION = 220; // frames (3.6 sec) for auto scenes
var HOW_TO_PLAY_DURATION = 380; // frames (6.3 sec) for how to play scene

// enemy data
var enemies = [
  {
    type:  0,
    name:  'THE INSPECTOR',
    col:   '#4488ff',
    bio:   'A government official sent to\nshut down unlicensed experiments.\nArmed with a clipboard, a briefcase\nfull of paperwork, and zero\nsense of humour.'
  },
  {
    type:  1,
    name:  'THE ROBOT',
    col:   '#aaaaaa',
    bio:   'A rogue cyber unit deployed to\nlaunch digital attacks on your\nequipment. Small but menacing.\nIts antenna blinks red when\nit has locked onto a target.'
  },
  {
    type:  2,
    name:  'SAFETY OFFICER',
    col:   '#ff8800',
    bio:   'By-the-book and built like a\nwall. Carries industrial foam\nto extinguish your experiment.\nHas never once smiled on the job.'
  },
  {
    type:  3,
    name:  'ESCAPED ANIMAL',
    col:   '#44cc44',
    bio:   'Nobody knows how it got in.\nNobody knows what it wants.\nIt is running directly at your\nexperiment at full speed and\nit is absolutely furious.'
  }
];

// positions for the 4 enemy cards  calculated in draw based on canvas size
function getEnemyPositions(){
  var W = canvas.width, H = canvas.height;
  var spacing = W / 5;
  return [
    { x: spacing,     y: H * 0.45 },
    { x: spacing * 2, y: H * 0.45 },
    { x: spacing * 3, y: H * 0.45 },
    { x: spacing * 4, y: H * 0.45 }
  ];
}

// skip button/ navigation
skipBtn.addEventListener('click', function(){ goToGame(); });

function goToGame(){
  cancelAnimationFrame(animId);
  window.location.href = 'game.html';
}

function updateDots(){
  // scenes: 0=lab, 1=scientist, 2=orb, 3=meet enemies, 4=how to play, 5=go!
  for(var i=0;i<6;i++){
    var d = document.getElementById('d'+i);
    if(d) d.className = 'dot'+(i===scene?' active':'');
  }
}

function nextScene(){
  selectedEnemy = null;
  scene++;
  sceneTimer = 0;
  if(scene >= 6){ goToGame(); return; }
  updateDots();
}

// click
canvas.addEventListener('click', function(e){
  var rect = canvas.getBoundingClientRect();
  var mx   = e.clientX - rect.left;
  var my   = e.clientY - rect.top;

  if(scene === 3){
    // check if clicked on an enemy card
    var positions = getEnemyPositions();
    var hitR      = 90; // click radius around enemy center
    var clicked   = false;
    for(var i=0;i<4;i++){
      var p = positions[i];
      if(Math.hypot(mx-p.x, my-p.y) < hitR + 40){
        selectedEnemy = selectedEnemy === i ? null : i; // toggle
        clicked = true;
        break;
      }
    }
    // check if clicked CONTINUE button
    if(!clicked){
      var W=canvas.width, H=canvas.height;
      var btnX=W/2, btnY=H*0.9;
      if(mx>btnX-90&&mx<btnX+90&&my>btnY-20&&my<btnY+20){
        nextScene();
      }
    }
  }
});

// helpers
function drawOutlineText(text, x, y, size, col, maxW){
  ctx.font        = 'bold '+size+'px Arial Black, Arial';
  ctx.textAlign   = 'center';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = size * 0.18;
  ctx.lineJoin    = 'round';
  ctx.strokeText(text, x, y, maxW||9999);
  ctx.fillStyle   = col;
  ctx.fillText(text, x, y, maxW||9999);
}

// fade in/out alpha for auto scenes
function sceneAlpha(){
  if(sceneTimer < 20) return sceneTimer / 20;
  if(sceneTimer > SCENE_DURATION - 20) return (SCENE_DURATION-sceneTimer)/20;
  return 1;
}

// floating bubbles
var bubbles=[];
for(var i=0;i<25;i++){
  bubbles.push({
    x:Math.random()*1920, y:Math.random()*1080,
    r:3+Math.random()*10,
    speed:0.3+Math.random()*0.6,
    wobble:Math.random()*Math.PI*2,
    col:['#39ff14','#b44fff','#f7c948','#00e5ff'][Math.floor(Math.random()*4)]
  });
}
function drawBubbles(){
  for(var i=0;i<bubbles.length;i++){
    var b=bubbles[i];
    b.y-=b.speed; b.wobble+=0.02; b.x+=Math.sin(b.wobble)*0.4;
    if(b.y<-20){ b.y=canvas.height+10; b.x=Math.random()*canvas.width; }
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
    ctx.fillStyle=b.col; ctx.globalAlpha=0.12; ctx.fill();
    ctx.globalAlpha=0.35; ctx.strokeStyle=b.col; ctx.lineWidth=1; ctx.stroke();
    ctx.globalAlpha=1;
  }
}

// scientist character
function drawScientistChar(cx,cy,scale){
  scale=scale||1;
  var sw=54*scale, hr=sw*0.42;
  var bob=Math.sin(frameCount*0.05)*4*scale;
  var lSh={x:cx-sw/2,y:cy+bob},rSh={x:cx+sw/2,y:cy+bob};
  var lEl={x:cx-sw*0.85,y:cy+38*scale+bob},rEl={x:cx+sw*0.85,y:cy+38*scale+bob};
  var lWr={x:cx-sw*0.9,y:cy+75*scale+bob},rWr={x:cx+sw*0.9,y:cy+75*scale+bob};
  var lHip={x:cx-sw*0.3,y:cy+75*scale+bob},rHip={x:cx+sw*0.3,y:cy+75*scale+bob};
  var ls=Math.sin(frameCount*0.07)*14*scale;
  var lKn={x:cx-sw*0.25-ls*0.3,y:cy+110*scale+bob},rKn={x:cx+sw*0.25+ls*0.3,y:cy+110*scale+bob};
  var lAn={x:cx-sw*0.22-ls*0.5,y:cy+145*scale+bob},rAn={x:cx+sw*0.22+ls*0.5,y:cy+145*scale+bob};
  var hx=cx,hy=cy-hr*1.2+bob;
  ctx.strokeStyle='#2a2a3a'; ctx.lineWidth=sw*0.22; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(lHip.x,lHip.y); ctx.lineTo(lKn.x,lKn.y); ctx.lineTo(lAn.x,lAn.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rHip.x,rHip.y); ctx.lineTo(rKn.x,rKn.y); ctx.lineTo(rAn.x,rAn.y); ctx.stroke();
  ctx.fillStyle='#111'; ctx.strokeStyle='#000'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.ellipse(lAn.x+4*scale,lAn.y+4*scale,10*scale,5*scale,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(rAn.x+4*scale,rAn.y+4*scale,10*scale,5*scale,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle='#eef0f5'; ctx.strokeStyle='#b0b8cc'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(lSh.x-6*scale,lSh.y); ctx.lineTo(lHip.x-10*scale,lHip.y); ctx.lineTo(rHip.x+10*scale,rHip.y); ctx.lineTo(rSh.x+6*scale,rSh.y); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle='#d8dce8';
  ctx.beginPath(); ctx.moveTo(cx,lSh.y+14*scale); ctx.lineTo(lSh.x+8*scale,lSh.y+28*scale); ctx.lineTo(cx-8*scale,lHip.y*0.4+lSh.y*0.6); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx,rSh.y+14*scale); ctx.lineTo(rSh.x-8*scale,rSh.y+28*scale); ctx.lineTo(cx+8*scale,rHip.y*0.4+rSh.y*0.6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle='#eef0f5'; ctx.lineWidth=sw*0.18; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(lSh.x,lSh.y); ctx.lineTo(lEl.x,lEl.y); ctx.lineTo(lWr.x,lWr.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rSh.x,rSh.y); ctx.lineTo(rEl.x,rEl.y); ctx.lineTo(rWr.x,rWr.y); ctx.stroke();
  ctx.fillStyle='#5599ee'; ctx.strokeStyle='#3377cc'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(lWr.x,lWr.y,7*scale,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(rWr.x,rWr.y,7*scale,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.lineCap='butt';
  ctx.fillStyle='#f0c090'; ctx.fillRect(hx-6*scale,hy+hr*0.6,12*scale,hr*0.5);
  ctx.fillStyle='#f5c8a0'; ctx.strokeStyle='#d4a070'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.ellipse(hx,hy,hr*0.78,hr,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle='#eeeeee'; ctx.strokeStyle='#cccccc'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(hx-hr*0.82,hy-hr*0.1); ctx.bezierCurveTo(hx-hr*1.4,hy-hr*1.5,hx-hr*0.4,hy-hr*2.1,hx,hy-hr*1.9); ctx.bezierCurveTo(hx+hr*0.4,hy-hr*2.1,hx+hr*1.4,hy-hr*1.5,hx+hr*0.82,hy-hr*0.1); ctx.fill(); ctx.stroke();
  ctx.strokeStyle='#dddddd'; ctx.lineWidth=hr*0.1; ctx.lineCap='round';
  var spk=[[-1.5,-0.7],[-1.2,-1.5],[-0.5,-2.2],[0.3,-2.3],[1.1,-1.8],[1.45,-0.9]];
  for(var i=0;i<spk.length;i++){ ctx.beginPath(); ctx.moveTo(hx+spk[i][0]*hr*0.65,hy+spk[i][1]*hr*0.55); ctx.lineTo(hx+spk[i][0]*hr*0.95,hy+spk[i][1]*hr*0.85); ctx.stroke(); }
  ctx.lineCap='butt';
  var gy=hy-hr*0.08;
  ctx.strokeStyle='#555'; ctx.lineWidth=hr*0.1;
  ctx.beginPath(); ctx.moveTo(hx-hr*0.88,gy); ctx.lineTo(hx+hr*0.88,gy); ctx.stroke();
  ctx.fillStyle='rgba(80,180,255,0.38)'; ctx.strokeStyle='#777'; ctx.lineWidth=hr*0.1;
  ctx.beginPath(); ctx.arc(hx-hr*0.3,gy,hr*0.27,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(hx+hr*0.3,gy,hr*0.27,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.arc(hx-hr*0.37,gy-hr*0.1,hr*0.08,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(hx+hr*0.23,gy-hr*0.1,hr*0.08,0,Math.PI*2); ctx.fill();
}

// experiment orb 
function drawIntroOrb(cx,cy,r){
  var pulse=Math.sin(frameCount*0.06)*0.12;
  var col='hsl(140,100%,55%)';
  var g=ctx.createRadialGradient(cx,cy,0,cx,cy,r*(1.8+pulse));
  g.addColorStop(0,'rgba(0,255,80,0.35)'); g.addColorStop(1,'transparent');
  ctx.beginPath(); ctx.arc(cx,cy,r*(1.8+pulse),0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
  ctx.beginPath(); ctx.arc(cx,cy,r*(1+pulse),0,Math.PI*2);
  ctx.fillStyle=col; ctx.shadowColor=col; ctx.shadowBlur=30; ctx.fill();
  ctx.shadowBlur=0; ctx.strokeStyle='#fff'; ctx.lineWidth=3; ctx.stroke();
}

function drawEnemyAt(type, x, y, scale){
  window.introMode = true;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  var fakeE = { x:x, y:y, vx:1, type:type, leg:frameCount*0.15, r:28 };
  if(type===0)      drawInspector(fakeE);
  else if(type===1) drawRobot(fakeE);
  else if(type===2) drawSafetyOfficer(fakeE);
  else if(type===3) drawChicken(fakeE);
  ctx.restore();
  window.introMode = false;
}

// how to play : demonstration poses 
function drawHowToPlayStep(cx, cy, stepIndex, scale){
  scale = scale || 1;
  var sw = 54*scale, hr = sw*0.42;
  var bob = Math.sin(frameCount*0.05)*3*scale;

  // base positions
  var lSh={x:cx-sw/2, y:cy+bob}, rSh={x:cx+sw/2, y:cy+bob};
  var lHip={x:cx-sw*0.3, y:cy+75*scale+bob}, rHip={x:cx+sw*0.3, y:cy+75*scale+bob};
  var lKn={x:cx-sw*0.25, y:cy+110*scale+bob}, rKn={x:cx+sw*0.25, y:cy+110*scale+bob};
  var lAn={x:cx-sw*0.22, y:cy+145*scale+bob}, rAn={x:cx+sw*0.22, y:cy+145*scale+bob};
  var hx=cx, hy=cy-hr*1.2+bob;
  var lEl, rEl, lWr, rWr;

  if(stepIndex===0){
    // HIT arms swing out to sides
    var swing = Math.sin(frameCount*0.1)*20*scale;
    lEl={x:cx-sw*1.1+swing, y:cy+30*scale+bob};
    rEl={x:cx+sw*1.1-swing, y:cy+30*scale+bob};
    lWr={x:cx-sw*1.5+swing, y:cy+20*scale+bob};
    rWr={x:cx+sw*1.5-swing, y:cy+20*scale+bob};
  } else if(stepIndex===1){
    // SHIELD both arms raised above head
    lEl={x:cx-sw*0.5, y:cy-20*scale+bob};
    rEl={x:cx+sw*0.5, y:cy-20*scale+bob};
    lWr={x:cx-sw*0.3, y:cy-55*scale+bob};
    rWr={x:cx+sw*0.3, y:cy-55*scale+bob};
  } else {
    // DODGE  body leaning sideways
    var lean = Math.sin(frameCount*0.06)*18*scale;
    lEl={x:cx-sw*0.85+lean, y:cy+38*scale+bob};
    rEl={x:cx+sw*0.85+lean, y:cy+38*scale+bob};
    lWr={x:cx-sw*0.9+lean,  y:cy+75*scale+bob};
    rWr={x:cx+sw*0.9+lean,  y:cy+75*scale+bob};
    lHip.x += lean*0.6; rHip.x += lean*0.6;
  }

  // draw legs
  ctx.strokeStyle='#2a2a3a'; ctx.lineWidth=sw*0.22; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(lHip.x,lHip.y); ctx.lineTo(lKn.x,lKn.y); ctx.lineTo(lAn.x,lAn.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rHip.x,rHip.y); ctx.lineTo(rKn.x,rKn.y); ctx.lineTo(rAn.x,rAn.y); ctx.stroke();
  // draw coat
  ctx.fillStyle='#eef0f5'; ctx.strokeStyle='#b0b8cc'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(lSh.x-6*scale,lSh.y); ctx.lineTo(lHip.x-10*scale,lHip.y); ctx.lineTo(rHip.x+10*scale,rHip.y); ctx.lineTo(rSh.x+6*scale,rSh.y); ctx.closePath(); ctx.fill(); ctx.stroke();
  // draw arms
  var armCol = stepIndex===1 ? '#44aaff' : '#eef0f5'; // blue when shielding
  ctx.strokeStyle=armCol; ctx.lineWidth=sw*0.18; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(lSh.x,lSh.y); ctx.lineTo(lEl.x,lEl.y); ctx.lineTo(lWr.x,lWr.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rSh.x,rSh.y); ctx.lineTo(rEl.x,rEl.y); ctx.lineTo(rWr.x,rWr.y); ctx.stroke();
  // gloves
  ctx.fillStyle='#5599ee'; ctx.strokeStyle='#3377cc'; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.arc(lWr.x,lWr.y,7*scale,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(rWr.x,rWr.y,7*scale,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.lineCap='butt';
  // head
  ctx.fillStyle='#f0c090'; ctx.fillRect(hx-6*scale,hy+hr*0.6,12*scale,hr*0.5);
  ctx.fillStyle='#f5c8a0'; ctx.strokeStyle='#d4a070'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.ellipse(hx,hy,hr*0.78,hr,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
  // hair
  ctx.fillStyle='#eee'; ctx.strokeStyle='#ccc'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(hx-hr*0.82,hy-hr*0.1); ctx.bezierCurveTo(hx-hr*1.4,hy-hr*1.5,hx-hr*0.4,hy-hr*2.1,hx,hy-hr*1.9); ctx.bezierCurveTo(hx+hr*0.4,hy-hr*2.1,hx+hr*1.4,hy-hr*1.5,hx+hr*0.82,hy-hr*0.1); ctx.fill(); ctx.stroke();
  // goggles
  var gy=hy-hr*0.08;
  ctx.strokeStyle='#555'; ctx.lineWidth=hr*0.1;
  ctx.beginPath(); ctx.moveTo(hx-hr*0.88,gy); ctx.lineTo(hx+hr*0.88,gy); ctx.stroke();
  ctx.fillStyle='rgba(80,180,255,0.38)'; ctx.strokeStyle='#777'; ctx.lineWidth=hr*0.1;
  ctx.beginPath(); ctx.arc(hx-hr*0.3,gy,hr*0.27,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(hx+hr*0.3,gy,hr*0.27,0,Math.PI*2); ctx.fill(); ctx.stroke();
  // shield effect when arms up
  if(stepIndex===1){
    ctx.beginPath(); ctx.arc(hx,hy+hr*2,hr*2.2+Math.sin(frameCount*0.08)*5,0,Math.PI*2);
    ctx.fillStyle='rgba(68,170,255,0.15)'; ctx.fill();
    ctx.strokeStyle='rgba(68,170,255,0.7)'; ctx.lineWidth=3; ctx.stroke();
  }
  // dodge arrow when leaning
  if(stepIndex===2){
    var arrowX = cx + Math.sin(frameCount*0.06)*18*scale;
    ctx.fillStyle='#f7c948'; ctx.font='bold '+Math.round(40*scale)+'px Arial';
    ctx.textAlign='center';
    ctx.fillText(arrowX > cx ? '►' : '◄', cx, cy+180*scale);
  }
}

// main loop
function loop(){
  animId = requestAnimationFrame(loop);
  frameCount++;
  sceneTimer++;

  // auto advance for all scenes except scene 3 (enemies : manual continue)
  if(scene === 4 && sceneTimer >= HOW_TO_PLAY_DURATION) nextScene();
  else if(scene !== 3 && scene !== 4 && sceneTimer >= SCENE_DURATION) nextScene();

  var W=canvas.width, H=canvas.height;

  // background
  var bgCols=['#1a0a2e','#1a0a2e','#081520','#0d0d0d','#0a1020','#050a05'];
  ctx.fillStyle = bgCols[scene] || '#1a0a2e';
  ctx.fillRect(0,0,W,H);
  drawBubbles();

  //  vignette
  var vgr=ctx.createRadialGradient(W/2,H/2,H*0.5,W/2,H/2,H*0.9);
  vgr.addColorStop(0,'transparent'); vgr.addColorStop(1,'rgba(0,0,0,0.35)');
  ctx.fillStyle=vgr; ctx.fillRect(0,0,W,H);

  var a = scene===3 ? 1 : sceneAlpha();
  ctx.globalAlpha = a;

  // scene 0 : somewhere in a secret lab 
  if(scene===0){
    drawScientistChar(W/2, H*0.3, 1.6);
    var spot=ctx.createRadialGradient(W/2,H*0.65,0,W/2,H*0.65,180);
    spot.addColorStop(0,'rgba(100,255,100,0.12)'); spot.addColorStop(1,'transparent');
    ctx.fillStyle=spot; ctx.fillRect(0,0,W,H);
    drawOutlineText('SOMEWHERE IN A', W/2, H*0.82, Math.round(H*0.055), '#f7c948');
    drawOutlineText('SECRET LAB...', W/2, H*0.89, Math.round(H*0.055), '#f7c948');

  // scene 1: you are the mad scientist 
  } else if(scene===1){
    drawScientistChar(W/2, H*0.28, 1.8);
    // speech bubble
    var bx=W/2+130, by=H*0.12;
    ctx.fillStyle='#fff'; ctx.strokeStyle='#000'; ctx.lineWidth=3;
    ctx.beginPath(); ctx.roundRect(bx-10,by,220,54,[12]); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx+10,by+46); ctx.lineTo(bx-14,by+66); ctx.lineTo(bx+36,by+46); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#111'; ctx.font='bold 13px Arial'; ctx.textAlign='center';
    ctx.fillText('"My experiment', bx+100, by+22);
    ctx.fillText('MUST succeed!"',  bx+100, by+42);
    drawOutlineText('YOU ARE THE',    W/2, H*0.82, Math.round(H*0.055), '#39ff14');
    drawOutlineText('MAD SCIENTIST',  W/2, H*0.89, Math.round(H*0.055), '#39ff14');

  //  scene 2 : the experiment 
  } else if(scene===2){
    drawIntroOrb(W/2, H*0.42, Math.min(W,H)*0.1);
    drawOutlineText('YOUR EXPERIMENT IS',   W/2, H*0.75, Math.round(H*0.048), '#39ff14');
    drawOutlineText('ALMOST COMPLETE...',   W/2, H*0.82, Math.round(H*0.048), '#39ff14');
    ctx.font='bold '+Math.round(H*0.026)+'px Courier New';
    ctx.textAlign='center'; ctx.fillStyle='rgba(255,255,255,0.65)';
    ctx.fillText('Protect it at all costs.', W/2, H*0.9);

  //  scene 3  meet the enemies ─
  } else if(scene===3){
    drawOutlineText('MEET YOUR ENEMIES', W/2, H*0.08, Math.round(H*0.05), '#ff4444');
    ctx.font='bold '+Math.round(H*0.022)+'px Courier New';
    ctx.textAlign='center'; ctx.fillStyle='rgba(255,255,255,0.5)';
    ctx.fillText('Click an enemy to learn more', W/2, H*0.14);

    var positions = getEnemyPositions();

    for(var i=0;i<4;i++){
      var p   = positions[i];
      var ene = enemies[i];
      var isSelected = selectedEnemy === i;
      var scale = isSelected ? 1.9 : 1.7; // selected enemy pops slightly bigger

      // highlight ring when selected
      if(isSelected){
        ctx.beginPath(); ctx.arc(p.x, p.y, 95, 0, Math.PI*2);
        ctx.fillStyle='rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle=ene.col; ctx.lineWidth=3;
        ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);
      }

      // draw enemy
      drawEnemyAt(ene.type, p.x, p.y, scale);

      // name card underneath
      var ny = p.y + 100;
      ctx.fillStyle   = 'rgba(0,0,0,0.7)';
      ctx.strokeStyle = ene.col;
      ctx.lineWidth   = 2.5;
      ctx.beginPath(); ctx.roundRect(p.x-70, ny, 140, 32, [6]); ctx.fill(); ctx.stroke();
      ctx.font        = 'bold 13px Arial Black';
      ctx.textAlign   = 'center';
      ctx.fillStyle   = ene.col;
      ctx.fillText(ene.name, p.x, ny+21);

      // bio popup when selected
      if(isSelected){
        var popX = p.x, popY = ny + 44;
        // keep popup inside screen
        if(popX - 130 < 10) popX = 140;
        if(popX + 130 > W - 10) popX = W - 140;
        // popup card
        ctx.fillStyle   = 'rgba(10,5,25,0.92)';
        ctx.strokeStyle = ene.col;
        ctx.lineWidth   = 2;
        ctx.beginPath(); ctx.roundRect(popX-130, popY, 260, 110, [8]); ctx.fill(); ctx.stroke();
        // bio text — split by newline
        var lines = ene.bio.split('\n');
        ctx.font      = '12px Courier New';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.textAlign = 'center';
        for(var ln=0;ln<lines.length;ln++){
          ctx.fillText(lines[ln], popX, popY+20+ln*18);
        }
      }
    }

    // continue button
    var btnY = H*0.9;
    ctx.fillStyle   = '#39ff14';
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = 3;
    ctx.beginPath(); ctx.roundRect(W/2-90, btnY-22, 180, 44, [10]); ctx.fill(); ctx.stroke();
    ctx.font        = 'bold 16px Arial Black';
    ctx.textAlign   = 'center';
    ctx.fillStyle   = '#000';
    ctx.fillText('CONTINUE ▶', W/2, btnY+6);

  //  scene 4  how to play 
  } else if(scene===4){
    drawOutlineText('HOW TO PLAY', W/2, H*0.09, Math.round(H*0.055), '#39ff14');

    // 3 move demonstrations side by side
    var moves = [
      { label:'HIT ENEMIES',         desc:'Move your arms into\nthe enemies to destroy them', col:'#39ff14' },
      { label:'ACTIVATE SHIELD',      desc:'Raise BOTH arms above\nyour head for 2 seconds', col:'#44aaff' },
      { label:'DODGE PROJECTILES',    desc:'Lean your hips left\nor right to deflect shots', col:'#f7c948' }
    ];

    var spacing = W/4;
    for(var m=0;m<3;m++){
      var mv  = moves[m];
      var mx2 = spacing*(m+1);
      var my2 = H*0.4;

      // draw animated scientist in the pose
      drawHowToPlayStep(mx2, my2, m, 0.95);

      // move title
      ctx.font        = 'bold '+Math.round(H*0.028)+'px Arial Black';
      ctx.textAlign   = 'center';
      ctx.strokeStyle = '#000';
      ctx.lineWidth   = 3;
      ctx.strokeText(mv.label, mx2, H*0.78);
      ctx.fillStyle   = mv.col;
      ctx.fillText(mv.label,   mx2, H*0.78);

      // move description
      var dlines = mv.desc.split('\n');
      ctx.font      = '12px Courier New';
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 0;
      for(var dl=0;dl<dlines.length;dl++){
        ctx.fillText(dlines[dl], mx2, H*0.83+dl*18);
      }

      // divider line between moves
      if(m<2){
        ctx.strokeStyle='rgba(255,255,255,0.1)'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(spacing*(m+1)+spacing/2,H*0.15); ctx.lineTo(spacing*(m+1)+spacing/2,H*0.88); ctx.stroke();
      }
    }

    // countdown bar
    var barW=W*0.35, barPct=1-(sceneTimer/HOW_TO_PLAY_DURATION);
    ctx.fillStyle='rgba(255,255,255,0.12)'; ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.roundRect(W/2-barW/2,H*0.93,barW,6,[3]); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#39ff14';
    ctx.beginPath(); ctx.roundRect(W/2-barW/2,H*0.93,barW*barPct,6,[3]); ctx.fill();
    ctx.font='bold 11px Courier New'; ctx.textAlign='center'; ctx.fillStyle='rgba(255,255,255,0.45)';
    ctx.fillText('STARTING EXPERIMENT...', W/2, H*0.93+20);

  // scene 5  go! 
  } else if(scene===5){
    var gr=ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,H*0.5);
    gr.addColorStop(0,'rgba(0,255,80,0.2)'); gr.addColorStop(1,'transparent');
    ctx.fillStyle=gr; ctx.fillRect(0,0,W,H);
    drawOutlineText('PROTECT THE',  W/2, H*0.38, Math.round(H*0.08), '#39ff14');
    drawOutlineText('EXPERIMENT!',  W/2, H*0.38+H*0.11, Math.round(H*0.08), '#f7c948');
  }

  ctx.globalAlpha=1;
}

// start 
updateDots();
loop();