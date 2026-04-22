// variables from game.html
var canvas    = document.getElementById('game-canvas'); // full drawing screen
var ctx    = canvas ? canvas.getContext('2d') : null;
var vid       = document.getElementById('vid-g'); // holds webcam feed for MediaPipe
var livesEl   = document.getElementById('lives-display'); // displays remaining lives as hearts
var chargeBar = document.getElementById('charge-bar'); // // green progress bar
var roundEl   = document.getElementById('round-display'); // shows current round; updated when new round starts
var overlay   = document.getElementById('overlay'); // game overlay (start screen, game over, win)
var ovTitle   = document.getElementById('ov-title'); // big heading text - MAD LAB, GAME OVER, etc
var ovMsg     = document.getElementById('ov-msg'); // small descriptive text - instructions, final score, etc
var ovBtn     = document.getElementById('ov-btn'); // button for starting game, restarting after game over, etc
var roundAnn  = document.getElementById('round-announce'); // round announcement overlay
var roundTxt  = document.getElementById('round-text'); // text inside round announcment - ROUND 2, YOU WIN!

// state variables
var landmarks     = null; // 33 body points from MediaPipe Pose; each has x,y,z  and visibility (0-1); null = no body detected
var running       = false; // is the game currently running (vs paused at round transition or game over)
var transitioning = false;
var animId        = null;
var orbHits       = 0; // how many times orb has been hit; 3 hits = game over
var charge        = 0; // how charged the orb is; when it reaches 100, player completes the round and moves to the next one
var round         = 1; // current round number
var enemies       = []; // array of current enemies on screen; each has x,y,vx,vy,r,type,shootTimer,shootInterval
var projectiles   = []; // array of current projectiles on screen; each has x,y,vx,vy,r, and col (color)
var particles     = []; // explosion/burst effect when something gets hit; each has x,y,vx,vy,life,col,r
var spawnTimer    = 0; // counts frames until next enemy spawn; when it reaches 0, spawns new enemy and resets to spawn rate based on round number
var frameCount    = 0; // total frames elapsed in current round; used for timing and animations
var eid           = 0; // unique id for each enemy, used to track them even if they go off screen and change position 

// Shield state
var shieldActive    = false; // is shield current on?
var shieldTimer     = 0;   // counts down from 2 seconds while shield is active; when it reaches 0, shield turns off and cooldown starts
var shieldCooldown  = 0;   // counts down from 5 seconds after shield turns off
var SHIELD_DURATION = 120; // 2 seconds at 60fps; constant
var SHIELD_COOLDOWN = 300; // 5 seconds; constant

// For user dodge move  — track hip center x over time to detect lean
var hipHistory   = []; // stores last 20 hip center x positions; used to detect if player is leaning left or right to dodge incoming projectiles; compares oldest to newest to see how much player shifted
var LEAN_THRESH  = 0.08;   // how far hips must shift to count as a lean
var leanDir      = 0;      // stores the result of lean detection: -1=left, 0=none, 1=right
var leanCooldown = 0; // prevents same lean from triggering multiple dodges

// guard — if game canvas doesn't exist we're on intro page
// only initialise game logic if on game page
var onGamePage = !!document.getElementById('game-canvas');

function resize(){ // makes canvas fill entire browser window
  if(!canvas) return; // safety check
  canvas.width=window.innerWidth;
  canvas.height=window.innerHeight;
}
if(onGamePage){
  resize(); // runs function once when page loads
  window.addEventListener('resize', resize); // sets up listener so everytime user resizes browser, the resize function runs again to adjust canvas size
}
// display current lives, charge, and round in HUD
function updateHUD(){ // 
  var h=''; for(var i=0;i<3;i++) h+=i<(3-orbHits)?'♥':'♡'; // build string of hearts based on remaining lives
  livesEl.textContent=h;
  chargeBar.style.width=Math.min(100,charge)+'%'; // set width of green charge bar as a % based on current charge
  roundEl.textContent='ROUND '+round; // updates what round number is shown
}

// MediaPipe Pose setup 
var pose=null, // holds MediaPipe object
mpCam=null; // holds camera object that feeds video frames to MediaPipe
function initPose(){ // called when player clicks start button; initializes MediaPipe Pose and starts webcam feed
  pose=new Pose({ // creates new MediaPipe Pose object; this is what detects body landmarks from video feed;
     locateFile:function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/pose/'+f; }}); // tells MediaPipe where to find its files; using jsdelivr CDN here

  pose.setOptions({ modelComplexity:0, // uses lightest, fastest version of AI model; less accurate but needs to run fast
    smoothLandmarks:true, // smooths landmark positions between frames so it reduces jitter
    minDetectionConfidence:0.5, // how conifdent MediaPipe needs to be to count as detecting a person before starting tracking; 50% confident
    minTrackingConfidence:0.5 }); // once its tracking, how confident model needs to be each frame to keep tracking; if drop below 50%, re-detect from scratch 
  pose.onResults(function(r){ landmarks=r.poseLandmarks||null; }); // callback function that runs each time MediaPipe has new pose data; stores array of 33 body landmarks in global variable
  // sets up camera feed for MediaPipe
  mpCam=new Camera(vid,{ // grabs frames from webcam and sends to mediapipe 
    onFrame:async function(){ // sends current video frame to Mediapipe with pose.send(); this runs every frame
       await pose.send({image:vid}); // waits for mediapipe to process the frame and call the onResults callback before allowing next frame; this keeps pose data in sync with video
       }, width:480, height:360 // set to 480x360 instead of full HD to reduce processing time and make it smoother
      });
  mpCam.start().then(function(){  // tells camera to start; browser has to ask for camera permission, so this returns a promise that resolves when camera is successfully started; if successful, shows "READY" overlay and starts game after 3 seconds; if error (like user denies camera), shows error message and re-enables start button
    ovTitle.textContent='READY';
    ovMsg.textContent='Stand back — full body visible!\nStarting in 3 seconds...';
    setTimeout(function(){ overlay.classList.remove('show'); startRound(); }, 3000); // after 3 seconds, hide overlay and start game - gives player time to get in position
  }).catch(function(e){ // runs if theres an error starting camera
    ovTitle.textContent='CAMERA ERROR'; 
    ovMsg.textContent=e.message; // shows error message to user
    ovBtn.disabled=false; }); // re-enable start button so user can try again 
}

if(onGamePage){
  ovBtn.addEventListener('click', function(){
    ovBtn.disabled=true; ovTitle.textContent='LOADING...'; ovMsg.textContent='Starting body tracking...';
    resetGame();
    if(!pose){ initPose(); }
    else { overlay.classList.remove('show'); startRound(); }
  });
}
// round flow 
function startRound(){ // resets variables for new round; called at start of each round after round announcement
  transitioning=false; running=true; // sets game state to running 
  enemies=[]; projectiles=[]; particles=[]; // wipes all arrays of enemies, projectiles, and particles so new round starts with nothing on screen
  spawnTimer=0; frameCount=0; // resets spawn timer and frame count for new round
  shieldActive=false; shieldTimer=0; shieldCooldown=0; // resets shield state
  hipHistory=[]; leanDir=0; leanCooldown=0; // resets lean dodge state
  updateHUD(); // updates hearts, charge bar, and round display
  if(animId) cancelAnimationFrame(animId); // cancels any loop that might be still running from previous round
  loop(); // starts main game loop for the round
}

function announceRound(r,cb){
  running=false; // pauses game loop while round announcement is showing
  roundTxt.textContent=r<=3?'ROUND '+r:'YOU WIN!';  // sets text of round announcement based on round number; if r is 1,2, or 3 shows "ROUND 1", "ROUND 2", etc; if r is greater than 3 (like 4), shows "YOU WIN!"
  roundAnn.classList.add('show'); // shows round announcement overlay
  setTimeout(function(){ roundAnn.classList.remove('show'); if(cb) cb(); }, 1800); // waits 1.8 seconds, then hides round announcement and calls callback function to start round (or show win screen)
}

function resetGame(){ // resets all game variables to initial state
  cancelAnimationFrame(animId); animId=null; running=false; transitioning=false;
  orbHits=0; charge=0; round=1;
  enemies=[]; projectiles=[]; particles=[]; spawnTimer=0; frameCount=0; // reset game state
  shieldActive=false; shieldTimer=0; shieldCooldown=0; // reset shield state
  updateHUD(); // refreshes hearts, charge bar, and round display
}

function endRound(){
  if(transitioning) return; transitioning=true; running=false; charge=0;
  if(round>=3){ announceRound(4, doWin); }
  else{ round++; announceRound(round, startRound); }
}

function doGameOver(){ // called when player loses all 3 lives
  if(transitioning) return; transitioning=true; running=false; // check if in transition already
  cancelAnimationFrame(animId); // stops game loop
  ovTitle.textContent='EXPERIMENT FAILED'; ovMsg.textContent='They stopped you!\nFinal round: '+round; // updates overlay text to show game over
  ovBtn.textContent='TRY AGAIN'; ovBtn.disabled=false; overlay.classList.add('show'); // updates button text, and re-enables it for user
}

function doWin(){ // called when player wins game after 3 rounds 
  cancelAnimationFrame(animId); // stops game loop
  ovTitle.textContent='EXPERIMENT COMPLETE!'; ovMsg.textContent='GENIUS! All 3 rounds survived.'; // diplay win message
  ovBtn.textContent='PLAY AGAIN'; ovBtn.disabled=false; overlay.classList.add('show'); // updates button text and re-enables it for user
}

function getSpawnRate(){ return Math.max(40, 160-round*30); } // calculates enemy spawn rate based on round; higher round = more frequent spawns
// round 1: spawn every 130 frames (2 ish seconds)
// round 2: spawn every 100 frames (1.6 sec)
// round 3: spawn every 70 frames (1.2 sec)
// can't go below 40 
// ── Pose detection 
function getLM(i){ // gets landmark by index number
  if(!landmarks||!landmarks[i]||landmarks[i].visibility<0.35) return null; // if landmark array is empty (no body detected), or specific point is missing, return null
  // if MediaPipe isn't at least 35% confident about the position of the landmark, treat it as not detected 
  return landmarks[i]; // if passes three checks, return the landmark position x, y, visibility (0-1)
}

// Returns true if both wrists are above shoulders (shield pose)
function shieldPose(){
  var lSh=getLM(11), rSh=getLM(12), lWr=getLM(15), rWr=getLM(16); // LM(11) and LM(12) are shoulders, LM(15) and LM(16) are wrists
  if(!lSh||!rSh||!lWr||!rWr) return false; // if any of the four key points are missing, can't do shield pose, return false
  return lWr.y < lSh.y - 0.05 && rWr.y < rSh.y - 0.05; // if both wrists are at least 5% of screen height above shoulders, count as shield pose
}

// Detect hip lean — returns -1 (left), 0 (none), 1 (right)
function detectLean(){
  var lHip=getLM(23), rHip=getLM(24); // gets both hip landmarks; LM(23) is left hip, LM(24) is right hip
  if(!lHip||!rHip) return 0; // no lean if hips not detected
  var hipCx = (lHip.x+rHip.x)/2; // calculates center x of hips by averaging left and right hip x positions
  hipHistory.push(hipCx); // adds current hip position to history array
  if(hipHistory.length>20) hipHistory.shift(); // if array is longer than 20 entries, remove oldest one
  if(hipHistory.length<10) return 0; // need at least 10 frames of data to detect lean, so if history isn't that long yet, return no lean
  var oldest=hipHistory[0], newest=hipHistory[hipHistory.length-1]; // grabs oldest and newest hip positions from history to compare how much player has shifted hips over time
  var delta=newest-oldest; // large delta = lot of movement, small delta = mostly still
  if(Math.abs(delta)>LEAN_THRESH) return delta>0?-1:1; // if delta is greater than threshold, count as lean; if delta is positive, player moved to the left (because of mirrored video), so return -1; if delta is negative, player moved to the right, so return 1
  return 0; // if delta is smaller than threshold, count as no lean
}

// Enemies
var COLORS=['#4488ff','#aaaaaa','#ff8800','#44cc44']; // different color for each enemy
var LABELS=['INSPECTOR','ROBOT','OFFICER','ANIMAL']; // label text for each enemy 

function spawnEnemy(){
  var W=canvas.width, H=canvas.height; // get canvas dimensions to use for positioning enemies
  var left=Math.random()<0.5; // randomly decide if enemy spawns on left or right side of screen; 50% chance for each
  var spd=(1.2+round*0.3+Math.random()*0.4)*(left?1:-1); // calculate enemy speed based on round number; higher rounds = faster enemies; also adds small random amount to make it less predictable; if spawning on left, speed is positive (moves right); if spawning on right, speed is negative (moves left)
 // 1.2 - base speed
 // add 0.3 extra speed each round
 // add up to 0.4 random speed to make it less predictable
 // multiply by 1 or -1 to set direction based on spawn side

  enemies.push({ // adds new enemy object to array
    id:eid++, x:left?-50:W+50, // each enemy gets unique id number, and spawns just off screen on left or right; -50 LEFT, W+50 RIGHT
    y:H*0.5+(Math.random()-0.5)*H*0.2, // spawns around vertical center of screen, with variation up to 10%; keeps enemies mostly around player
    vx:spd, type:Math.floor(Math.random()*4), // randomly assigns enemy type (0-3) which determines color and label; each type has equal chance
    r:26, leg:0, // radius of enemy circle, starting value for leg animation
    shootTimer:Math.floor(60+Math.random()*80), // counts down to first shot; starts between 60 and 140 frames (1-2.3 seconds); adds random amount so not all enemies shoot at same time; after first shot, resets to shootInterval
    shootInterval:Math.floor(120+Math.random()*80-(round*20)) //  how many frames between shots; starts between 120 and 200 frames (2-3.3 seconds), minus 20 frames per round to make it more challenging; adds random amount to make it less predictable
  });
}
// Chicken
function drawChicken(e) {
  var x    = e.x, y = e.y;
  var flip = e.vx < 0;
  var leg  = Math.sin(e.leg) * 12;
  var flap = Math.sin(e.leg * 1.8) * 8;

  ctx.save();
  if (flip) { ctx.translate(x * 2, 0); ctx.scale(-1, 1); }

  // flying feathers scattered around body : drift and rotate each frame
  ctx.fillStyle = '#c47820';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  var featherOffsets = [
    [-30,-10,-0.8],[28,-5,0.5],[-22,15,1.2],
    [32,10,-0.4],[-35,5,0.9],[20,-18,-1.1]
  ];
  for (var f = 0; f < featherOffsets.length; f++) {
    var fo = featherOffsets[f];
    var fx = x + fo[0] + Math.sin(frameCount*0.08+f)*4;
    var fy = y + fo[1] + Math.sin(frameCount*0.1+f)*3;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(fo[2] + Math.sin(frameCount*0.06+f)*0.3);
    ctx.beginPath();
    ctx.ellipse(0, 0, 3, 8, 0, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // skinny legs kicking outward
  ctx.strokeStyle = '#c47820';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x-8, y+20); ctx.lineTo(x-20, y+36+leg); ctx.lineTo(x-30, y+44+leg); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x-36, y+42+leg); ctx.lineTo(x-22, y+46+leg); ctx.lineTo(x-18, y+40+leg); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x+8, y+20); ctx.lineTo(x+22, y+34-leg); ctx.lineTo(x+34, y+42-leg); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x+28, y+40-leg); ctx.lineTo(x+42, y+44-leg); ctx.lineTo(x+44, y+38-leg); ctx.stroke();
  ctx.lineCap = 'butt';

  // big round messy brown body
  ctx.fillStyle = '#c47820';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y, 32, 26, 0.15, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();

  // jagged feather texture on body edges
  ctx.strokeStyle = '#a06010';
  ctx.lineWidth = 1.5;
  var bodySpikes = [[-28,-8],[-26,4],[-20,16],[-10,22],[5,24],[20,18],[28,5],[26,-10],[16,-20],[0,-24],[-16,-22]];
  for (var s = 0; s < bodySpikes.length; s++) {
    ctx.beginPath();
    ctx.moveTo(x+bodySpikes[s][0]*0.7, y+bodySpikes[s][1]*0.7);
    ctx.lineTo(x+bodySpikes[s][0],     y+bodySpikes[s][1]);
    ctx.stroke();
  }

  // left wing  flaps up and down
  ctx.fillStyle = '#c47820';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x-12, y-5);
  ctx.bezierCurveTo(x-40, y-20-flap, x-48, y+5-flap, x-30, y+14);
  ctx.bezierCurveTo(x-20, y+18, x-10, y+8, x-12, y-5);
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#a06010'; ctx.lineWidth = 1.5;
  for (var wf = 0; wf < 4; wf++) {
    ctx.beginPath();
    ctx.moveTo(x-32+wf*5, y+10-flap*0.3);
    ctx.lineTo(x-38+wf*5, y+18-flap*0.3);
    ctx.stroke();
  }

  // right wing  flaps opposite phase
  ctx.fillStyle = '#c47820';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x+14, y-5);
  ctx.bezierCurveTo(x+36, y-15+flap, x+42, y+5+flap, x+26, y+12);
  ctx.bezierCurveTo(x+16, y+16, x+10, y+6, x+14, y-5);
  ctx.fill(); ctx.stroke();

  // stretched neck craning forward like its screaming
  ctx.fillStyle = '#c47820';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x+8,  y-18);
  ctx.bezierCurveTo(x+5, y-50, x+24, y-55, x+28, y-42);
  ctx.bezierCurveTo(x+30, y-30, x+18, y-20, x+8, y-18);
  ctx.fill(); ctx.stroke();

  // round white head
  ctx.fillStyle = '#f5f0e0';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(x+26, y-52, 20, 18, -0.3, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();

  // spiky red comb
  ctx.fillStyle = '#e82020';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x+10, y-62);
  ctx.lineTo(x+14, y-76);
  ctx.lineTo(x+19, y-64);
  ctx.lineTo(x+23, y-80);
  ctx.lineTo(x+28, y-65);
  ctx.lineTo(x+33, y-73);
  ctx.lineTo(x+38, y-62);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // red wattle under beak
  ctx.fillStyle = '#e82020';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x+14, y-42, 7, 10, 0.2, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();

  // top beak wide open
  ctx.fillStyle = '#e8a020';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(x+38, y-56); ctx.lineTo(x+56, y-50); ctx.lineTo(x+40, y-48); ctx.closePath();
  ctx.fill(); ctx.stroke();

  // bottom beak 
  ctx.beginPath();
  ctx.moveTo(x+38, y-46); ctx.lineTo(x+54, y-36); ctx.lineTo(x+36, y-38); ctx.closePath();
  ctx.fill(); ctx.stroke();

  // dark red open mouth interior
  ctx.fillStyle = '#8b0000';
  ctx.beginPath();
  ctx.moveTo(x+40, y-48); ctx.lineTo(x+53, y-44); ctx.lineTo(x+52, y-38); ctx.lineTo(x+38, y-42); ctx.closePath();
  ctx.fill();

  // tongue
  ctx.fillStyle = '#cc2020';
  ctx.beginPath();
  ctx.ellipse(x+45, y-42, 5, 3, 0.3, 0, Math.PI*2);
  ctx.fill();

  // huge wild googly eyes
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(x+30, y-56, 10, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x+44, y-54, 9,  0, Math.PI*2); ctx.fill(); ctx.stroke();

  //  pupils
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(x+33, y-54, 3.5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x+46, y-52, 3,   0, Math.PI*2); ctx.fill();

  // eye reflection
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x+34, y-56, 1.5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x+47, y-54, 1.2, 0, Math.PI*2); ctx.fill();

  // thick angry eyebrows 
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x+20, y-64); ctx.lineTo(x+34, y-68); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+54, y-62); ctx.lineTo(x+40, y-66); ctx.stroke();
  ctx.lineCap = 'butt';

  ctx.restore();
if(!window.introMode){
  ctx.font = 'bold 11px Courier New';
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  ctx.strokeText('ESCAPED!', x, y + 68);
  ctx.fillStyle = '#fff';
  ctx.fillText('ESCAPED!', x, y + 68);
}

  
}
// Inspector
function drawInspector(e) {
  var x     = e.x, y = e.y;
  var flip  = e.vx < 0;
  var leg   = Math.sin(e.leg) * 10;
  var sweat = Math.sin(frameCount * 0.1) * 2;

  ctx.save();
  if (flip) { ctx.translate(x * 2, 0); ctx.scale(-1, 1); }

  // oversized briefcase
  ctx.fillStyle = '#8B4513';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x+18, y+5, 52, 38, [5]);
  ctx.fill(); ctx.stroke();

  // inner panel detail
  ctx.fillStyle = '#a0522d';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x+22, y+9, 44, 30, [3]);
  ctx.fill(); ctx.stroke();

  // case handle
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x+32, y+5);
  ctx.bezierCurveTo(x+32, y-6, x+58, y-6, x+58, y+5);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // gold latch
  ctx.fillStyle = '#f7c948';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x+41, y+20, 10, 8);
  ctx.strokeRect(x+41, y+20, 10, 8);
  ctx.fillStyle = '#e0b030';
  ctx.fillRect(x+43, y+22, 6, 4);

  // top secret sticker
  ctx.fillStyle = '#ff4444';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x+24, y+28, 16, 10, [2]);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 6px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('TOP', x+32, y+34);
  ctx.fillText('SECRET', x+32, y+40);

  // dark navy pants
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x-10, y+28); ctx.lineTo(x-12, y+48+leg); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x+10, y+28); ctx.lineTo(x+12, y+48-leg); ctx.stroke();
  ctx.lineCap = 'butt';

  // black shoes
  ctx.fillStyle = '#111';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(x-14, y+54+leg, 12, 6, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x+14, y+54-leg, 12, 6, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();

  // dark navy suit jacket
  ctx.fillStyle = '#2a3a6a';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x-22, y-8, 44, 38, [6]);
  ctx.fill(); ctx.stroke();

  // white shirt
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(x-6, y-8); ctx.lineTo(x+6, y-8);
  ctx.lineTo(x+4, y+28); ctx.lineTo(x-4, y+28);
  ctx.closePath(); ctx.fill();

  // crooked red tie
  ctx.fillStyle = '#cc2020';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x-4, y-6); ctx.lineTo(x+4, y-6);
  ctx.lineTo(x+7, y+18); ctx.lineTo(x-3, y+18);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // tie knot
  ctx.fillStyle = '#aa1010';
  ctx.beginPath();
  ctx.roundRect(x-3, y-7, 6, 5, [2]);
  ctx.fill();

  // suit lapels
  ctx.fillStyle = '#2a3a6a';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x-6, y-8); ctx.lineTo(x-22, y-2); ctx.lineTo(x-16, y+14); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x+6, y-8); ctx.lineTo(x+22, y-2); ctx.lineTo(x+16, y+14); ctx.closePath();
  ctx.fill(); ctx.stroke();

  // suit buttons
  ctx.fillStyle = '#1a2a5a';
  for (var b = 0; b < 3; b++) {
    ctx.beginPath(); ctx.arc(x, y+2+b*8, 2, 0, Math.PI*2); ctx.fill();
  }

  // arm holding briefcase
  ctx.strokeStyle = '#2a3a6a';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x+18, y+5); ctx.lineTo(x+28, y+18); ctx.stroke();

  // free arm waving in panic
  ctx.beginPath();
  ctx.moveTo(x-20, y+2);
  ctx.lineTo(x-32, y-10+Math.sin(frameCount*0.08)*5);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // skin-toned round head
  ctx.fillStyle = '#f5c8a0';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(x, y-26, 20, 22, 0, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();

  // nervous blush on cheeks
  ctx.fillStyle = 'rgba(255,100,100,0.3)';
  ctx.beginPath(); ctx.ellipse(x-14, y-20, 8, 5, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x+14, y-20, 8, 5, 0, 0, Math.PI*2); ctx.fill();

  // slicked back hair 
  ctx.fillStyle = '#2a1a0a';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y-42, 19, 9, 0, Math.PI, Math.PI*2);
  ctx.fill(); ctx.stroke();

  // one strand sticking up
  ctx.strokeStyle = '#2a1a0a';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x+8, y-46);
  ctx.bezierCurveTo(x+12, y-54, x+18, y-52, x+14, y-44);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // thick black glasses  slightly askew
  ctx.fillStyle = 'rgba(150,200,255,0.3)';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.save();
  ctx.translate(x-9, y-28); ctx.rotate(-0.1);
  ctx.beginPath(); ctx.roundRect(-9, -7, 17, 13, [3]); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(x+9, y-27); ctx.rotate(0.08);
  ctx.beginPath(); ctx.roundRect(-8, -7, 17, 13, [3]); ctx.fill(); ctx.stroke();
  ctx.restore();

  // glasses bridge and arms
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x-1, y-28); ctx.lineTo(x+1, y-28); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x-18, y-28); ctx.lineTo(x-22, y-26); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+18, y-27); ctx.lineTo(x+22, y-25); ctx.stroke();

  // wide nervous eyes — tall ovals
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(x-9, y-28, 6, 7, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x+9, y-27, 6, 7, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();

  // small darting pupils
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(x-8,  y-27, 2.5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x+10, y-26, 2.5, 0, Math.PI*2); ctx.fill();

  // eye reflection
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x-7,  y-29, 1.2, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(x+11, y-28, 1.2, 0, Math.PI*2); ctx.fill();

  // raised eyebrows
  ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x-16, y-37); ctx.quadraticCurveTo(x-9, y-42, x-2, y-38); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x+2, y-37);  ctx.quadraticCurveTo(x+9, y-42, x+16, y-38); ctx.stroke();
  ctx.lineCap = 'butt';

  // open nervous mouth — small oval
  ctx.fillStyle = '#8b0000'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(x, y-14, 6, 5, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.roundRect(x-4, y-17, 8, 4, [1]); ctx.fill();

  // sweat
  ctx.fillStyle = '#88ccff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x-22, y-30+sweat);
  ctx.bezierCurveTo(x-26, y-30+sweat, x-28, y-24+sweat, x-24, y-22+sweat);
  ctx.bezierCurveTo(x-20, y-20+sweat, x-18, y-26+sweat, x-22, y-30+sweat);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x+24, y-34-sweat);
  ctx.bezierCurveTo(x+28, y-34-sweat, x+30, y-28-sweat, x+26, y-26-sweat);
  ctx.bezierCurveTo(x+22, y-24-sweat, x+20, y-30-sweat, x+24, y-34-sweat);
  ctx.fill(); ctx.stroke();

  ctx.restore();
if(!window.introMode){
  ctx.font = 'bold 11px Courier New';
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  ctx.strokeText('INSPECTOR', x, y + 72);
  ctx.fillStyle = '#fff';
  ctx.fillText('INSPECTOR', x, y + 72);
}

  
}
// Robot
function drawRobot(e) {
  var x    = e.x, y = e.y;
  var flip = e.vx < 0;
  var leg  = Math.sin(e.leg) * 10;  // leg march animation
  var spark = frameCount % 40 < 8;  // sparks flash on and off

  ctx.save();
  if (flip) { ctx.translate(x * 2, 0); ctx.scale(-1, 1); }

  // marching legs
  ctx.strokeStyle = '#666';
  ctx.lineWidth   = 8;
  ctx.lineCap     = 'round';

  // left leg marches forward
  ctx.beginPath();
  ctx.moveTo(x - 12, y + 24);
  ctx.lineTo(x - 14, y + 40 + leg);
  ctx.stroke();

  // right leg marches back
  ctx.beginPath();
  ctx.moveTo(x + 12, y + 24);
  ctx.lineTo(x + 14, y + 40 - leg);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // feet 
  ctx.fillStyle   = '#555';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.roundRect(x - 22, y + 38 + leg, 18, 10, [3]);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + 4,  y + 38 - leg, 18, 10, [3]);
  ctx.fill(); ctx.stroke();

  // body
  
  ctx.fillStyle   = '#888';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.roundRect(x - 28, y - 10, 56, 36, [8]);
  ctx.fill(); ctx.stroke();

  // body panel lines 
  ctx.strokeStyle = '#666';
  ctx.lineWidth   = 1.5;
  for (var r = 0; r < 3; r++) {
    ctx.beginPath();
    ctx.moveTo(x - 26, y + 2 + r * 10);
    ctx.lineTo(x + 26, y + 2 + r * 10);
    ctx.stroke();
  }

  // chest panel — dark rectangle with LEDs
  ctx.fillStyle   = '#333';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.roundRect(x - 16, y, 32, 20, [4]);
  ctx.fill(); ctx.stroke();

  // LED lights on chest panel — red, green, yellow
  var ledCols = ['#f00', '#0f0', '#ff0'];
  for (var l = 0; l < 3; l++) {
    ctx.fillStyle   = ledCols[l];
    ctx.shadowColor = ledCols[l];
    ctx.shadowBlur  = 8;
    ctx.beginPath();
    ctx.arc(x - 8 + l * 8, y + 10, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  //arms
  // left arm
  ctx.fillStyle   = '#777';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.roundRect(x - 40, y - 4, 14, 24, [4]);
  ctx.fill(); ctx.stroke();

  // left claw 
  ctx.strokeStyle = '#555';
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';
  ctx.beginPath(); ctx.moveTo(x - 36, y + 20); ctx.lineTo(x - 40, y + 30); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 30, y + 20); ctx.lineTo(x - 28, y + 30); ctx.stroke();
  ctx.lineCap = 'butt';

  // right arm
  ctx.fillStyle   = '#777';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.roundRect(x + 26, y - 4, 14, 24, [4]);
  ctx.fill(); ctx.stroke();

  // right claw
  ctx.strokeStyle = '#555';
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';
  ctx.beginPath(); ctx.moveTo(x + 30, y + 20); ctx.lineTo(x + 28, y + 30); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + 36, y + 20); ctx.lineTo(x + 38, y + 30); ctx.stroke();
  ctx.lineCap = 'butt';

  // head
  ctx.fillStyle   = '#999';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.arc(x, y - 22, 26, 0, Math.PI * 2); // round dome head
  ctx.fill(); ctx.stroke();

  // head rim 
  ctx.fillStyle   = '#777';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.ellipse(x, y - 8, 28, 8, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // antenna
  ctx.strokeStyle = '#666';
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - 48);
  ctx.lineTo(x, y - 62);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // antenna ball — flashes red 
  ctx.fillStyle   = frameCount % 30 < 15 ? '#f00' : '#800'; // blinks on and off
  ctx.shadowColor = '#f00';
  ctx.shadowBlur  = frameCount % 30 < 15 ? 14 : 4;
  ctx.beginPath();
  ctx.arc(x, y - 64, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.shadowBlur  = 0;

  // angry eyes
  ctx.fillStyle   = '#f00';
  ctx.shadowColor = '#f00';
  ctx.shadowBlur  = 12;

  // left eye 
  ctx.save();
  ctx.translate(x - 12, y - 26);
  ctx.rotate(0.2); // tilt inward
  ctx.beginPath();
  ctx.roundRect(-9, -4, 18, 8, [2]);
  ctx.fill();
  ctx.restore();

  // right eye — mirrored angle
  ctx.save();
  ctx.translate(x + 12, y - 26);
  ctx.rotate(-0.2);
  ctx.beginPath();
  ctx.roundRect(-9, -4, 18, 8, [2]);
  ctx.fill();
  ctx.restore();
  ctx.shadowBlur = 0;

  // eye outlines
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 1.5;
  ctx.save();
  ctx.translate(x - 12, y - 26); ctx.rotate(0.2);
  ctx.beginPath(); ctx.roundRect(-9, -4, 18, 8, [2]); ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(x + 12, y - 26); ctx.rotate(-0.2);
  ctx.beginPath(); ctx.roundRect(-9, -4, 18, 8, [2]); ctx.stroke();
  ctx.restore();

  // angry mouth
  ctx.strokeStyle = '#f00';
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';
  ctx.shadowColor = '#f00';
  ctx.shadowBlur  = 8;
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 12);
  ctx.lineTo(x + 10, y - 12); 
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineCap = 'butt';

  // sparks - fly off body
  if (spark) {
    var sparkPositions = [[-24, 5], [24, 8], [-20, -10], [22, -14]];
    for (var s = 0; s < sparkPositions.length; s++) {
      var sx = x + sparkPositions[s][0];
      var sy = y + sparkPositions[s][1];
      ctx.strokeStyle = '#ff0';
      ctx.shadowColor = '#ff0';
      ctx.shadowBlur  = 10;
      ctx.lineWidth   = 2;
      ctx.lineCap     = 'round';
      // small star shaped spark — 4 lines crossing
      ctx.beginPath(); ctx.moveTo(sx - 4, sy); ctx.lineTo(sx + 4, sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx - 3, sy - 3); ctx.lineTo(sx + 3, sy + 3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 3, sy - 3); ctx.lineTo(sx - 3, sy + 3); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.shadowBlur = 0;
    }
  }

  ctx.restore();
if(!window.introMode){
  ctx.font = 'bold 11px Courier New';
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  ctx.strokeText('ROBOT', x, y + 58);
  ctx.fillStyle = '#fff';
  ctx.fillText('ROBOT', x, y + 58);
}

}
// Safety Officer
function drawSafetyOfficer(e) {
  var x    = e.x, y = e.y;
  var flip = e.vx < 0;
  var leg  = Math.sin(e.leg) * 9;  // leg walk animation

  ctx.save();
  if (flip) { ctx.translate(x * 2, 0); ctx.scale(-1, 1); }

  //legs
  ctx.strokeStyle = '#334';
  ctx.lineWidth   = 14; 
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 14, y + 30); ctx.lineTo(x - 16, y + 52 + leg); ctx.stroke(); 
  ctx.beginPath();
  ctx.moveTo(x + 14, y + 30); ctx.lineTo(x + 16, y + 52 - leg); ctx.stroke();
  ctx.lineCap = 'butt';

  // boots — big chunky black boots
  ctx.fillStyle   = '#222';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.roundRect(x - 28, y + 50 + leg, 22, 14, [4]);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x + 6,  y + 50 - leg, 22, 14, [4]);
  ctx.fill(); ctx.stroke();

  // boot toe caps — bright yellow safety toe
  ctx.fillStyle = '#f7c948';
  ctx.beginPath();
  ctx.roundRect(x - 28, y + 50 + leg, 10, 14, [4, 0, 0, 4]);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(x + 18, y + 50 - leg, 10, 14, [0, 4, 4, 0]);
  ctx.fill();

  // body
  // base shirt underneath
  ctx.fillStyle   = '#334';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.roundRect(x - 30, y - 10, 60, 42, [6]);
  ctx.fill(); ctx.stroke();

  // orange  vest on top
  ctx.fillStyle   = '#ff8800';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.moveTo(x - 30, y - 10);      // left shoulder
  ctx.lineTo(x - 30, y + 32);      // left bottom
  ctx.lineTo(x + 30, y + 32);      // right bottom
  ctx.lineTo(x + 30, y - 10);      // right shoulder
  ctx.lineTo(x + 14, y - 10);      // right lapel start
  ctx.lineTo(x + 8,  y + 14);      // right lapel bottom
  ctx.lineTo(x - 8,  y + 14);      // left lapel bottom
  ctx.lineTo(x - 14, y - 10);      // left lapel start
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  //  reflective stripes — two bright yellow horizontal bands
  ctx.fillStyle   = '#f7c948';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.roundRect(x - 30, y + 4,  60, 7, [2]);
  ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x - 30, y + 18, 60, 7, [2]);
  ctx.fill(); ctx.stroke();

  // badge on chest 
  ctx.fillStyle   = '#f7c948';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 6, y - 8, 14, 16, [2]);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.font      = 'bold 5px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('SAFE', x + 1, y - 2);
  ctx.fillText('TY', x + 1, y + 5);

  // neck
  ctx.fillStyle   = '#f5c8a0';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.roundRect(x - 14, y - 28, 28, 20, [4]); // wide thick neck
  ctx.fill(); ctx.stroke();

  // right arm
  ctx.strokeStyle = '#ff8800'; // orange vest sleeve
  ctx.lineWidth   = 16;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x + 28, y + 2);
  ctx.lineTo(x + 50, y - 10); // arm extends forward and slightly up
  ctx.stroke();
  ctx.lineCap = 'butt';

  // pointing finger 
  ctx.fillStyle   = '#f5c8a0';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.roundRect(x + 46, y - 16, 20, 8, [4]); // pointing finger
  ctx.fill(); ctx.stroke();
  // other fingers curled into fist
  ctx.fillStyle = '#f5c8a0';
  ctx.beginPath();
  ctx.roundRect(x + 44, y - 8, 16, 10, [4]);
  ctx.fill(); ctx.stroke();

  // left arm- holding foam sprayer
  ctx.strokeStyle = '#ff8800';
  ctx.lineWidth   = 16;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 28, y + 2);
  ctx.lineTo(x - 44, y + 16);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // foam sprayer body — red canister
  ctx.fillStyle   = '#cc2020';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.roundRect(x - 62, y + 8, 24, 16, [4]);
  ctx.fill(); ctx.stroke();

  // sprayer nozzle
  ctx.fillStyle   = '#888';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 72, y + 11, 12, 6, [2]);
  ctx.fill(); ctx.stroke();

  // sprayer handle
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 3;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 52, y + 24);
  ctx.lineTo(x - 52, y + 32);
  ctx.lineTo(x - 42, y + 32);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // canister label — yellow stripe
  ctx.fillStyle = '#f7c948';
  ctx.beginPath();
  ctx.roundRect(x - 58, y + 10, 8, 12, [2]);
  ctx.fill();

  // head
  ctx.fillStyle   = '#f5c8a0';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 3;
  ctx.beginPath();
  ctx.roundRect(x - 22, y - 56, 44, 46, [8, 8, 12, 12]); // wide square jaw
  ctx.fill(); ctx.stroke();

  //helmet
  ctx.fillStyle   = '#ff8800';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 3;
  // helmet dome
  ctx.beginPath();
  ctx.ellipse(x, y - 48, 26, 18, 0, Math.PI, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // helmet brim
  ctx.beginPath();
  ctx.roundRect(x - 30, y - 52, 60, 10, [3]);
  ctx.fill(); ctx.stroke();

  // helmet stripe — white stripe across top
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(x - 18, y - 64, 36, 6, [3]);
  ctx.fill();

  // helmet badge
  ctx.fillStyle   = '#f7c948';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.arc(x, y - 60, 6, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // face features 
  // small beady determined eyes
  ctx.fillStyle   = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth   = 1.5;
  ctx.beginPath(); ctx.arc(x - 10, y - 34, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + 10, y - 34, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // pupils — looking straight ahead
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(x - 9,  y - 34, 3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 11, y - 34, 3, 0, Math.PI * 2); ctx.fill();

  // eye reflection
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x - 8,  y - 36, 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 12, y - 36, 1.2, 0, Math.PI * 2); ctx.fill();

  // thick eyebrows 
  ctx.strokeStyle = '#333';
  ctx.lineWidth   = 3.5;
  ctx.lineCap     = 'round';
  ctx.beginPath(); ctx.moveTo(x - 16, y - 42); ctx.lineTo(x - 4, y - 40); ctx.stroke(); // left brow — angled down
  ctx.beginPath(); ctx.moveTo(x + 16, y - 42); ctx.lineTo(x + 4, y - 40); ctx.stroke(); // right brow — angled down
  ctx.lineCap = 'butt';

  // mouth - no smile
  ctx.strokeStyle = '#a06040';
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 22);
  ctx.lineTo(x + 10, y - 22); // dead straight line — zero expression
  ctx.stroke();
  ctx.lineCap = 'butt';

  // nose 
  ctx.strokeStyle = '#d4a070';
  ctx.lineWidth   = 2;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 28);
  ctx.lineTo(x,     y - 24);
  ctx.lineTo(x + 3, y - 28);
  ctx.stroke();
  ctx.lineCap = 'butt';

  ctx.restore();
if(!window.introMode){
  ctx.font = 'bold 11px Courier New';
  ctx.textAlign = 'center';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  ctx.strokeText('OFFICER', x, y + 72);
  ctx.fillStyle = '#fff';
  ctx.fillText('OFFICER', x, y + 72);
}

  
}


function drawEnemy(e) {
  if (e.type === 0) drawInspector(e);
  else if (e.type === 1) drawRobot(e);
  else if (e.type === 2) drawSafetyOfficer(e);
  else if (e.type === 3) drawChicken(e);
}

// Projectiles
function shootAt(enemy, tx, ty){ // takes 3 arguments: enemy shooting, tx/ty (target coordinates)
  var dx=tx-enemy.x, dy=ty-enemy.y; // calculates difference in x and y between enemy and target to determine direction to shoot
  var dist=Math.hypot(dx,dy); // calculates distance between two points using pythagorean theorem; gives total distance between enemy and target
  var spd=4+round*0.8; // speed of projectile; starts at 4, increases by 0.8 each round

  projectiles.push({ // creates projectle object and adds it to array
    x:enemy.x, y:enemy.y, // starts at enemy position
    vx:(dx/dist)*spd, vy:(dy/dist)*spd, // dx/dist dy/dist normalizes the direction vector to have length of 1, then multiplies by speed to get velocity components in x and y directions
    r:10, col:COLORS[enemy.type],// radius of projectile is 10, projectile inherits color  of the enemy that shot it
    dodgeable:true  //for future use to make some projectiles undogdeable, currently all are dodgeable
  });
}

function drawProjectile(p){ // draw main projectile circle
  ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); // draws projectile as circle based on its x,y,r properties; color based on enemy type that shot it; white stroke
  ctx.fillStyle=p.col; ctx.fill();
  ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
  // trail effect
  ctx.beginPath(); ctx.arc(p.x-p.vx*2,p.y-p.vy*2,p.r*0.5,0,Math.PI*2); // positions trail circle 2 frames behind projectile; half the size of projectile
  ctx.fillStyle='rgba(255,255,255,0.25)'; ctx.fill(); // semi-transparent white for trail; 25 opacity
}

// shield
function drawShield(){ 
  var W=canvas.width, H=canvas.height; // get canvas dimensions
  var cx=W/2, cy=H/2, r=90; // shield drawn at center of screen around orb, radius 90
  var alpha=shieldTimer>20?0.55:shieldTimer/20*0.55; // if shield timer is above 20 frames, use full opacity (.55); if shield timer is 20 or less, fade it out
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); // draws shield circle
  ctx.fillStyle='rgba(100,180,255,'+alpha+')'; // light blue - opacity based on how much time is left on shield timer; fades out in last 20 frames
  ctx.strokeStyle='rgba(150,220,255,0.9)'; ctx.lineWidth=4; // light blue stroke 
  ctx.fill(); ctx.stroke();
  // shield label
  ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.font='bold 13px Courier New'; ctx.textAlign='center'; // semi-transparent white, bold 13px Courier New, centered
  ctx.fillText('SHIELD',cx,cy-r-10); // draws "SHIELD" text above shield circle
}

function drawShieldCooldownHint(){ // if shield is on cooldown, show hint with seconds remaining; if shield is active or ready, don't show anything
  if(shieldCooldown<=0) return; // if shield is ready (cooldown is 0 or less), don't show cooldown hint
  var W=canvas.width, H=canvas.height; // get canvas dimensions
  var secs=Math.ceil(shieldCooldown/60); // converts cooldown from frames to seconds; game runs at 60 frames per second; math.ceil rounds to nearest whole #
  ctx.fillStyle='rgba(100,180,255,0.7)'; ctx.font='bold 13px Courier New'; ctx.textAlign='left'; // light blue, bold 13px Courier New, left aligned
  ctx.fillText('SHIELD: '+secs+'s cooldown', 20, H-20); // displays "SHIELD: Xs cooldown" in bottom left corner, where X is seconds remaining on cooldown; gives player feedback on when shield will be ready again
}

function drawShieldReadyHint(){ // if shield is ready but not active, show hint to raise arms to activate; if shield is on cooldown or already active, don't show anything
  if(shieldCooldown>0||shieldActive) return;  // if shield is still cooling down (cooldown > 0) or already active, don't show ready hint
  var H=canvas.height; // get canvas height for positioning text
  ctx.fillStyle='rgba(100,255,180,0.8)'; ctx.font='bold 13px Courier New'; ctx.textAlign='left';// light green, bold 13px Courier New, left aligned
  ctx.fillText('SHIELD READY — raise both arms!', 20, H-20); // displays "SHIELD READY - raise both arms!" in bottom left corner to prompt player to use shield when it's available; gives player feedback that they can activate shield and how to do it
}
//draw lab
function drawLab() {
  var W = canvas.width, H = canvas.height;

  // wall
  // dark purple background matching home screen
  ctx.fillStyle = '#1a0a2e';
  ctx.fillRect(0, 0, W, H);

  // floor
  // slightly lighter purple floor starting at 78% of screen height
  ctx.fillStyle = '#2a1245';
  ctx.fillRect(0, H * 0.78, W, H * 0.22);

  // floor dividing line with thick black cartoon outline
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.78);
  ctx.lineTo(W, H * 0.78);
  ctx.stroke();

  // floor tile lines — vertical lines across floor
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1.5;
  for (var x = 0; x < W; x += W / 10) {
    ctx.beginPath();
    ctx.moveTo(x, H * 0.78);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // left shelf
  drawShelf(W * 0.04, H * 0.12, W * 0.18, H);

  //right shelf
  drawShelf(W * 0.78, H * 0.12, W * 0.18, H);

  // wall details
  // subtle horizontal lines to look like brick
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (var y = H * 0.08; y < H * 0.78; y += H * 0.08) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}

// shelf helper
// draws a wooden shelf with test tubes and beakers on it
// x, y = top left corner of shelf area; shelfW = width of shelf
function drawShelf(x, y, shelfW, H) {

  // shelf board
  // wooden plank — brown rectangle with black outline
  ctx.fillStyle = '#5a3010';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x - 4, y + H * 0.18, shelfW + 8, 14, [3]);
  ctx.fill();
  ctx.stroke();

  // second shelf below
  ctx.beginPath();
  ctx.roundRect(x - 4, y + H * 0.38, shelfW + 8, 14, [3]);
  ctx.fill();
  ctx.stroke();

  // shelf support brackets on each side
  ctx.fillStyle = '#3a2008';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  // left bracket
  ctx.beginPath();
  ctx.moveTo(x + 8, y + H * 0.18);
  ctx.lineTo(x + 8, y + H * 0.18 + 30);
  ctx.lineTo(x + 28, y + H * 0.18 + 30);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // right bracket
  ctx.beginPath();
  ctx.moveTo(x + shelfW - 8, y + H * 0.18);
  ctx.lineTo(x + shelfW - 8, y + H * 0.18 + 30);
  ctx.lineTo(x + shelfW - 28, y + H * 0.18 + 30);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // top shelf test tubes
  var tubeColors = ['#39ff14', '#b44fff', '#f7c948', '#00e5ff', '#ff4444'];
  var tubeCount  = 5;
  var tubeSpacing = shelfW / (tubeCount + 1);

  for (var i = 0; i < tubeCount; i++) {
    var tx  = x + tubeSpacing * (i + 1); // evenly spaced x position
    var ty  = y + H * 0.18 - 52;         // sits on top of shelf
    var col = tubeColors[i % tubeColors.length];

    // glass tube body — rounded at bottom, open at top
    ctx.fillStyle   = 'rgba(200,220,255,0.15)'; // semi-transparent glass
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.roundRect(tx - 7, ty, 14, 48, [0, 0, 7, 7]); // rounded bottom only
    ctx.fill();
    ctx.stroke();

    // liquid inside tube — colored fill in bottom half
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.roundRect(tx - 6, ty + 24, 12, 22, [0, 0, 6, 6]);
    ctx.fill();
    ctx.globalAlpha = 1;

    // glow around liquid
    ctx.shadowColor = col;
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = col;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.roundRect(tx - 7, ty, 14, 48, [0, 0, 7, 7]);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;

    // bubbles rising in tube — animated using frameCount
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    var bubbleY = ty + 40 - ((frameCount * 0.8 + i * 20) % 36);
    ctx.beginPath();
    ctx.arc(tx, bubbleY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // bottom shelf beakers
  var beakerColors = ['#39ff14', '#f7c948', '#b44fff'];
  var beakerCount  = 3;
  var beakerSpacing = shelfW / (beakerCount + 1);

  for (var i = 0; i < beakerCount; i++) {
    var bx  = x + beakerSpacing * (i + 1); // x position
    var by  = y + H * 0.38 - 55;           // sits on bottom shelf
    var bw  = 22;                            // beaker width
    var bh  = 42;                            // beaker height
    var col = beakerColors[i % beakerColors.length];

    // beaker glass body — trapezoid shape (wider at top)
    ctx.fillStyle   = 'rgba(200,220,255,0.15)';
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.moveTo(bx - bw * 0.6, by);          // top left
    ctx.lineTo(bx + bw * 0.6, by);          // top right
    ctx.lineTo(bx + bw * 0.45, by + bh);    // bottom right (slightly narrower)
    ctx.lineTo(bx - bw * 0.45, by + bh);    // bottom left
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // beaker spout — small rectangle at top left
    ctx.fillStyle   = 'rgba(200,220,255,0.2)';
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(bx - bw * 0.6, by);
    ctx.lineTo(bx - bw * 0.75, by - 8);
    ctx.lineTo(bx - bw * 0.45, by - 8);
    ctx.lineTo(bx - bw * 0.3, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // liquid in beaker — fills bottom 60%
    ctx.fillStyle   = col;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(bx - bw * 0.55, by + bh * 0.4); // liquid surface left
    ctx.lineTo(bx + bw * 0.55, by + bh * 0.4); // liquid surface right
    ctx.lineTo(bx + bw * 0.45, by + bh);
    ctx.lineTo(bx - bw * 0.45, by + bh);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // glow on beaker liquid
    ctx.shadowColor = col;
    ctx.shadowBlur  = 12;
    ctx.strokeStyle = col;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx - bw * 0.55, by + bh * 0.4);
    ctx.lineTo(bx + bw * 0.55, by + bh * 0.4);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // measurement lines on beaker side
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth   = 1;
    for (var m = 1; m <= 3; m++) {
      var lineY = by + bh * (m / 4);
      ctx.beginPath();
      ctx.moveTo(bx + bw * 0.3, lineY);
      ctx.lineTo(bx + bw * 0.5, lineY);
      ctx.stroke();
    }

    // bubbles on surface of liquid — animated
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    if (frameCount % 30 < 15) { // blink on and off
      ctx.beginPath();
      ctx.arc(bx - 4, by + bh * 0.38, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(bx + 5, by + bh * 0.36, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

//Orb
function drawOrb(){
  var W=canvas.width, H=canvas.height; // get canvas dimensions
  var cx=W/2, cy=H/2, r=46; // orb is drawn at center of screen, radius 46
  ctx.beginPath(); ctx.arc(cx,cy,r+18,0,Math.PI*2); // draws larger circle around orb for glow effect; radius 18 larger than orb radius; color is bright green with low opacity for glow
  ctx.fillStyle='rgba(0,255,80,0.12)'; ctx.fill();

  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); // draws main orb circle
  ctx.fillStyle='hsl('+(120+(charge/100)*60)+',90%,50%)'; ctx.fill(); // orb color changes based on charge level; starts as bright green (120 hue) and shifts towards yellow (180 hue) as charge increases; saturation 90%, lightness 50% for bright colors
  ctx.strokeStyle='#fff'; ctx.lineWidth=3; ctx.stroke(); // white stroke around orb
  // charge arc
  ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=6; // semi-transparent white, thicker line for charge arc
  ctx.beginPath(); ctx.arc(cx,cy,r+10, // draws arc around orb to show charge level (progress ring)
    -Math.PI/2, // start angle at top of circle
    -Math.PI/2+(charge/100)*Math.PI*2) // end angle based on charge level; when charge is 100, end angle is full circle; when charge is 50, end angle is half circle, etc
     ctx.stroke(); 

  // health pips
  for(var i=0;i<3;i++){ // draws 3 circles around orb to show player health; full health = 3 green circles, 1 hit = 2 green circles and 1 red, 2 hits = 1 green and 2 red, 3 hits = all red; uses orbHits variable to determine how many hits player has taken and color of each circle
    var a=-Math.PI/2+(i/3)*Math.PI*2; // calculates angle for each health pip; spaces them evenly around orb starting at top (-Math.PI/2) and going clockwise; i/3 gives 0, 1/3, and 2/3 for three pips, which are then multiplied by 2*PI to get angles of 0, 120, and 240 degrees
    ctx.beginPath(); ctx.arc(cx+Math.cos(a)*(r+24),cy+Math.sin(a)*(r+24),7,0,Math.PI*2); // converts angle into x and y coordinates; placed 24 pixels outside orb edge; radius 7 for health pips
    ctx.fillStyle=i<orbHits?'#f00':'#0f0'; ctx.fill(); // if pip index is less than number of hits, color it red(damaged); if pip index is greater than or equal to number of hits, color it green (healthy)
  }
  ctx.fillStyle='#fff'; ctx.font='bold 12px Courier New'; ctx.textAlign='center'; // white, bold 12px Courier New, centered
  ctx.fillText('EXPERIMENT',cx,cy+r+36); // draws "EXPERIMENT" text below orb to label it
}

// Mad scientist 
var SEGS=[[11,12], // left to right shoulder
[11,13], // left shoulder to left elbow
[13,15], // left elbow to left wrist
[12,14], // right shoulder to right elbow
[14,16], // right elbow to right wrist
[11,23],// left shoulder to left hip 
[12,24], // right shoulder to right hip
[23,24], // left hip to right hip 
[23,25], // left hip to left knee
[25,27], // left knee to left ankle 
[24,26], // right hip to right knee
[26,28], // right knee to right ankle
[0,11], // nose to left shoulder
[0,12]]; // nose to right shoulder
// list of pairs of landmark index numbers; each pair is one line segment to draw

function screenPt(lmk){ // takes landmark position from MediaPipe (x and y between 0 and 1, relative to video feed), and converts to screen coordinates based on canvas size; also flips x coordinate because video is mirrored
  if(!lmk) return null;
  return { x:(1-lmk.x)*canvas.width, y:lmk.y*canvas.height };
}
function drawScientist(){
  if (!landmarks) return; // if MediaPipe hasn't detected a body yet, don't draw anything

  var W = canvas.width, H = canvas.height;
  var shCol = shieldActive ? '#44aaff' : '#00ff88'; // skeleton color: blue when shield is active, green when not

  // helper — converts landmark index to screen position
  function sp(i) {
    var l = getLM(i);
    return l ? screenPt(l) : null;
  }

  // get all the key body points we need
  var lSh = sp(11), rSh = sp(12);   // shoulders
  var lEl = sp(13), rEl = sp(14);   // elbows
  var lWr = sp(15), rWr = sp(16);   // wrists
  var lHip = sp(23), rHip = sp(24); // hips
  var lKn = sp(25), rKn = sp(26);   // knees
  var lAn = sp(27), rAn = sp(28);   // ankles
  var nose = sp(0);                  // nose — used to position the head

  if (!lSh || !rSh) return; // need at least shoulders to draw anything

  var sw = Math.abs(lSh.x - rSh.x); // shoulder width in pixels — used to scale everything proportionally
  var mid = { x: (lSh.x + rSh.x) / 2, y: (lSh.y + rSh.y) / 2 }; // midpoint between shoulders
  var hr = sw * 0.42; // head radius — scales with shoulder width so head size matches distance from camera

  // legs
  ctx.lineWidth = sw * 0.22; // leg thickness scales with shoulder width
  ctx.lineCap = 'round';     // rounded ends so joints look smooth
  ctx.strokeStyle = '#2a2a3a'; // dark navy colour for trousers

  // helper — draws a limb as a line through up to 3 points
  function drawLimb(a, b, c) {
    if (!a) return; // skip if first point isn't visible
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (b) ctx.lineTo(b.x, b.y);
    if (b && c) ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }

  drawLimb(lHip, lKn, lAn); // left leg: hip,  knee , ankle
  drawLimb(rHip, rKn, rAn); // right leg: hip , knee , ankle

  // shoes
  function drawShoe(ankle) {
    if (!ankle) return; // skip if ankle isn't visible
    ctx.fillStyle = '#111';  // dark shoe colour
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // draw oval shoe slightly in front of and below ankle position
    ctx.ellipse(ankle.x + sw * 0.06, ankle.y + sw * 0.05, sw * 0.13, sw * 0.06, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  drawShoe(lAn); // left shoe
  drawShoe(rAn); // right shoe

  // torso - lab coat
  if (lHip && rHip) { // only draw coat if hips are visible so we know where it ends

    // main coat body — filled shape connecting shoulders to hips
    ctx.fillStyle = '#eef0f5';  // off-white coat colour
    ctx.strokeStyle = '#b0b8cc'; // light grey outline
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lSh.x - sw * 0.12, lSh.y);   // top left (left shoulder)
    ctx.lineTo(lHip.x - sw * 0.18, lHip.y); // bottom left (left hip)
    ctx.lineTo(rHip.x + sw * 0.18, rHip.y); // bottom right (right hip)
    ctx.lineTo(rSh.x + sw * 0.12, rSh.y);   // top right (right shoulder)
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // left lapel — darker triangle on left side of coat opening
    ctx.fillStyle = '#d8dce8';
    ctx.beginPath();
    ctx.moveTo(mid.x, lSh.y + hr * 0.4);
    ctx.lineTo(lSh.x + sw * 0.08, lSh.y + hr * 1.1);
    ctx.lineTo(mid.x - sw * 0.1, lHip.y * 0.55 + lSh.y * 0.45);
    ctx.closePath();
    ctx.fill();

    // right lapel — mirrored triangle on right side
    ctx.beginPath();
    ctx.moveTo(mid.x, rSh.y + hr * 0.4);
    ctx.lineTo(rSh.x - sw * 0.08, rSh.y + hr * 1.1);
    ctx.lineTo(mid.x + sw * 0.1, rHip.y * 0.55 + rSh.y * 0.45);
    ctx.closePath();
    ctx.fill();

    // chest pocket — small rectangle on left side of coat
    ctx.fillStyle = '#ccd0de';
    ctx.strokeStyle = '#b0b8cc';
    ctx.lineWidth = 1;
    ctx.fillRect(lSh.x - sw * 0.04, (lSh.y + lHip.y) / 2, sw * 0.16, hr * 0.35);
    ctx.strokeRect(lSh.x - sw * 0.04, (lSh.y + lHip.y) / 2, sw * 0.16, hr * 0.35);
  }

  // arms - coat sleeves
  ctx.strokeStyle = '#eef0f5'; // white coat colour for sleeves
  ctx.lineWidth = sw * 0.18;   // slightly thinner than legs
  ctx.lineCap = 'round';
  drawLimb(lSh, lEl, lWr); // left arm: shoulder → elbow → wrist
  drawLimb(rSh, rEl, rWr); // right arm: shoulder → elbow → wrist

  // subtle outline on top of sleeve to give it definition
  ctx.strokeStyle = '#b0b8cc';
  ctx.lineWidth = 1.5;
  drawLimb(lSh, lEl, lWr);
  drawLimb(rSh, rEl, rWr);
  ctx.lineCap = 'butt'; // reset to flat ends

  // gloves
  function drawGlove(wrist) {
    if (!wrist) return; // skip if wrist isn't visible
    ctx.fillStyle = '#5599ee';  // blue rubber glove colour
    ctx.strokeStyle = '#3377cc'; // darker blue outline
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(wrist.x, wrist.y, sw * 0.1, 0, Math.PI * 2); // circle at wrist position
    ctx.fill();
    ctx.stroke();
  }
  drawGlove(lWr); // left glove
  drawGlove(rWr); // right glove

  // head
  // use nose position if visible, otherwise fall back to shoulder midpoint
  var hx = nose ? nose.x : mid.x;
  var hy = nose ? nose.y : mid.y - hr * 1.4;

  // neck — small rectangle connecting head to coat
  ctx.fillStyle = '#f0c090'; // skin colour
  ctx.fillRect(hx - sw * 0.08, hy + hr * 0.6, sw * 0.16, hr * 0.5);

  // face — slightly oval skin-toned ellipse
  ctx.fillStyle = '#f5c8a0';  // skin colour
  ctx.strokeStyle = '#d4a070'; // slightly darker outline
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(hx, hy, hr * 0.78, hr, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // hair
  ctx.fillStyle = '#eeeeee';  // white hair
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;

  // main hair poof — large bezier curve shape sitting behind and above head
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.82, hy - hr * 0.1); // start at left side of head
  ctx.bezierCurveTo(
    hx - hr * 1.4, hy - hr * 1.5,  // left control point — pulls hair out to the left
    hx - hr * 0.4, hy - hr * 2.1,  // top left control point
    hx, hy - hr * 1.9              // top center of hair
  );
  ctx.bezierCurveTo(
    hx + hr * 0.4, hy - hr * 2.1,  // top right control point
    hx + hr * 1.4, hy - hr * 1.5,  // right control point
    hx + hr * 0.82, hy - hr * 0.1  // end at right side of head
  );
  ctx.fill();
  ctx.stroke();

  // stray hair spikes — short lines shooting out from the poof for a wild look
  ctx.strokeStyle = '#dddddd';
  ctx.lineWidth = hr * 0.1;
  ctx.lineCap = 'round';
  var spikes = [
    [-1.5, -0.7], [-1.2, -1.5], [-0.5, -2.2], // left side spikes
    [0.3, -2.3], [1.1, -1.8], [1.45, -0.9]     // right side spikes
  ];
  for (var i = 0; i < spikes.length; i++) {
    ctx.beginPath();
    ctx.moveTo(hx + spikes[i][0] * hr * 0.65, hy + spikes[i][1] * hr * 0.55); // base of spike
    ctx.lineTo(hx + spikes[i][0] * hr * 0.95, hy + spikes[i][1] * hr * 0.85); // tip of spike
    ctx.stroke();
  }
  ctx.lineCap = 'butt'; // reset

  // goggles
  var gy = hy - hr * 0.08; // vertical center of goggles — slightly above face center

  // strap — horizontal line across head behind lenses
  ctx.strokeStyle = '#555';
  ctx.lineWidth = hr * 0.1;
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.88, gy);
  ctx.lineTo(hx + hr * 0.88, gy);
  ctx.stroke();

  // left lens — blue tinted circle
  ctx.fillStyle = 'rgba(80,180,255,0.38)';
  ctx.strokeStyle = '#777';
  ctx.lineWidth = hr * 0.1;
  ctx.beginPath();
  ctx.arc(hx - hr * 0.3, gy, hr * 0.27, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // right lens
  ctx.beginPath();
  ctx.arc(hx + hr * 0.3, gy, hr * 0.27, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // shine highlights — small white circles to make lenses look glossy
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(hx - hr * 0.37, gy - hr * 0.1, hr * 0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(hx + hr * 0.23, gy - hr * 0.1, hr * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // bridge — small line connecting the two lenses
  ctx.strokeStyle = '#777';
  ctx.lineWidth = hr * 0.07;
  ctx.beginPath();
  ctx.moveTo(hx - hr * 0.03, gy);
  ctx.lineTo(hx + hr * 0.03, gy);
  ctx.stroke();

  // head glow
  // subtle ring around head that changes color when shield is active
  ctx.beginPath();
  ctx.arc(hx, hy - hr * 0.1, hr * 1.05, 0, Math.PI * 2);
  ctx.strokeStyle = shCol; // green normally, blue when shield is active
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.35;  // semi-transparent so it's subtle
  ctx.stroke();
  ctx.globalAlpha = 1;     // reset opacity for everything drawn after
}
//collision
function distPS(px,py,ax,ay,bx,by){ // distance from point to line segment
  // takes 6 arguments: px, py (point coordinates - enemy or projectile); ax,ay to bx,by (line segment endpoints - body segments defined in SEGS array)
  var dx=bx-ax,dy=by-ay, // horizontal and vertical length of segment
  l=dx*dx+dy*dy; // length of segment squared; pythagorean theorem; used to normalize the distance calculation; if length is 0, means endpoints are the same point, so we just return distance from point to that one point
  if(!l) return Math.hypot(px-ax,py-ay);// if length is 0, return distance from point to the single endpoint
  var t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l)); // finds where on segement the closest point to (px,py) is as value t between 0 and 1; t=0 means closest point is at endpoint; t=1 means its at endpoint B and anything in between is somewhere along segment
  return Math.hypot(px-ax-t*dx,py-ay-t*dy);
} // dot product - project point onto line 

function bodyHitsPoint(px,py,radius){
  if(!landmarks) return false; // if no body detected, can't hit anything, so return false
  var W=canvas.width, H=canvas.height; // get canvas dimensions for converting landmark positions to screen coordinates
  for(var s=0;s<SEGS.length;s++){  // 
    var a=getLM(SEGS[s][0]), b=getLM(SEGS[s][1]);
    if(!a||!b) continue;  // skips segment if either of its landmarks are missing
    if(distPS(px,py,(1-a.x)*W,a.y*H,(1-b.x)*W,b.y*H)<radius) return true; // gets distance from point to segment; if distance is less than radius, it counts as a hit, so return true
  }
  return false; // if we check all segments and none of them are hit, return false
}

function hitsOrb(obj){ // checks if object (enemy or projectile) hits the orb by comparing distance from object's center to center of orb with sum of their radii; if distance is less than sum of radii, it counts as a hit
  return Math.hypot(obj.x-canvas.width/2,obj.y-canvas.height/2)<56+obj.r; // math.hypot gets straight line distance between object center and orb center; if distance is less than 56(orbs hit radius) +ibj.r = hit
}

// particles 
function burst(x,y,col){ 
  for(var i=0;i<10;i++){ // creates 10 paticles as a burst effect as position x,y with color col; called whenever something gets hit
    var a=Math.random()*Math.PI*2,sp=2+Math.random()*4; // random angle and speed for each particle; angle between 0 and 360; speed between 2 and 6
    particles.push({x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,col:col,r:4+Math.random()*3}); // creates particle position
    // x, y start at hit position
    // vx:Math.cos/sin - converts angle into x and y velocities; multiplied by sp to set speed of particle
    // life: 1 starts at full life, counsts down to 0 when partcile dies
    // col - color passed on, matching whatever got hit
    // r - random radius between 4 and 7 pixels so particles have some variation 
  }
}
function tickParticles(){
  for(var i=particles.length-1;i>=0;i--){ // loops through particles array backwards bc particles are removed when they die; preventing skipping particles when one is removed
    var p=particles[i]; //updates each particle every frame
    p.x+=p.vx; p.y+=p.vy; // moves particle by its velocity; travels further each frame
    p.vx*=0.9; p.vy*=0.9; p.life-=0.04; // multiply by .9 to reduce velocity to 90% of what it was - essentially losing momentum ; life reduced by 0.04 each frame
   
    if(p.life<=0){particles.splice(i,1);continue;}// when life hits 0, remove particle from array and skip to next iteration
    ctx.globalAlpha=p.life; ctx.fillStyle=p.col; // sets transparency for everything drawn after; as life goes from 1 to 0, particle becomes more transparent
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); // draws particle as circle based on its x,y,r properties; color based on what got hit; transparency based on life for fade out effect
  }
  ctx.globalAlpha=1; // reset global alpha to default for other drawings after particles are drawn ; reset back to 1 (fully opaque)
}

//  Lean dodge UI indicator 
function drawLeanIndicator(){
  var W=canvas.width, H=canvas.height; // get canvas dimensions for positioning text
  ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.font='12px Courier New'; ctx.textAlign='center'; // light white, 12px Courier New, centered
  ctx.fillText('← lean to dodge →', W/2, H-20); // draws faint hint text at bottom of screen to show player they can lean to dodge; always visible but low opacity 
  if(leanDir!==0){ // only runs if lean is detected; leanDir = 0 when player is standing still, -1 leaning left, 1 leaning right
    ctx.fillStyle=leanDir<0?'rgba(255,200,0,0.8)':'rgba(255,200,0,0.8)'; // yellow for leaning left and right; seperated for future use if i want to change based on direction
    ctx.font='bold 18px Courier New'; // font for lean indicator
    ctx.fillText(leanDir<0?'◄ DODGE!':'DODGE! ►', W/2, H-42); // chooses which version of text to show based on lean direction
    // leaning left = arrow on left side of text; leaning right = arrow on right side of text 
  }
}

// mainloop 
function loop(){
  if(!running) return; // checks if game is running; if not, exit loop to stop animation
  animId=requestAnimationFrame(loop); // requests next animation frame and calls loop again; creates continuous game loop that runs at 60 frames per second
  frameCount++; // increments frame count variable by 1 every loop iteration; used for leg animations and background effects

  var W=canvas.width, H=canvas.height; // get canvas dimensions
  var cx=W/2, cy=H/2;

  // Background
  drawLab();
  
  // detect poses
  // Shield
  if(shieldActive){ // only runs when shield is active; counts down shield timer and deactivates shield when timer runs out
    shieldTimer--; // reduces shield timer by 1 each frame; when it hits 0, shield will turn off
    if(shieldTimer<=0){ shieldActive=false; shieldCooldown=SHIELD_COOLDOWN; } // when shield timer hits 0, deactivate shield and set to cooldown
  }
  if(shieldCooldown>0) shieldCooldown--; // every frame the cooldown is above 0, reduce it by 1; when it hits 0, shield will be ready to use again
  if(!shieldActive && shieldCooldown<=0 && shieldPose()){ // shield activation check; three things need to be true; 
    // shield isnt already on, shield isnt cooling down, the player is currently holding arms above shoulders
    shieldActive=true; //  if all true, shield activates
    shieldTimer=SHIELD_DURATION; // sets shield countdown timer to full duration 
    burst(cx,cy,'#88ccff'); burst(cx,cy,'#44aaff'); // creates burst effect at orb position with light blue colors to show shield is active
  }
  // Lean
  if(leanCooldown>0) leanCooldown--; // if lean is on cooldown, reduce cooldown timer by 1 each frame; when it hits 0, player can lean again
  leanDir=detectLean(); // calls detectLean every frame and stores in leanDir - updates lean direction constantly soo dodge indicator and projectile deflection is always accurate
  // returns -1 for left lean, 1 for right lean, 0 for no lean

  // draw - keep order (all layered)
  drawOrb(); // called first so its sits behind everything else; draws the orb in the center of the screen
  if(shieldActive) drawShield(); // shield only drawn when active. sits on top of or
  drawScientist();// scientist drawn on top of everything
  // all UI text drawn on top of everything so always visible 
  drawShieldCooldownHint();
  drawShieldReadyHint();
  drawLeanIndicator();

  // Charge - increases every frame
  charge=Math.min(100, charge+0.05*(1+round*0.5));
  // 0.5 base charge rate per frame
  // multiplier: round 1 = 1.5x, round 2 = 2x, round 3 = 2.5x; charge increases faster in higher rounds to make up for increased difficulty and help player get to next round faster
  updateHUD(); // called every frame to update charge display on orb or other HUB elements

  // spawn enemies 
  spawnTimer++; // increases spawn timer by 1 each frame
  if(spawnTimer>=getSpawnRate()){ // checks whether enough frames have passed to spawn a new wave of enemies
    spawnTimer=0; // reset spawn timer to 0 to start counting for next spawn
    for(var n=0;n<round;n++) spawnEnemy(); // spawns one enemey per round; so in round 1 spawns 1 enemy, round 2 spawns 2 enemies, etc; makes higher rounds more challenging with more enemies to deal with
  }

  // update enemies
  for(var i=enemies.length-1;i>=0;i--){ // loops backwards through enemies array
    var e=enemies[i]; // updates enemy position
    e.x+=e.vx; // moves enemy horizontally based on its velocity; + vx moves right, -vx moves left
    // no vertical movement for enemies; they only walk straight across screen
     e.leg+=0.18; // updates leg animation by increasing leg property; used in drawEnemy to create walking motion; higher value = faster leg movement

    // Shoot at orb
    e.shootTimer--; // counts down by 1 every frame
    if(e.shootTimer<=0){ // when shoot timer hits 0, enemy shoots a projectile towards the orb
      e.shootTimer=e.shootInterval; // reset shoot timer to shoot interval so enemy will shoot again after that many frames
      shootAt(e, cx, cy);// creates projectile aimed at center of ob
    }

    // checks if body is touching the enemy; e.r + 18 is hit radius (enemys own radius + extra buffer to make it easier to hit enemies);
    if(bodyHitsPoint(e.x,e.y,e.r+18)){
      burst(e.x,e.y,COLORS[e.type]); // creates explosion effect in the enemys color
      enemies.splice(i,1); // removes enemy from array since its been hit
      charge=Math.min(100,charge+6); // gets a 6 point boost as a reward for hitting enemy
      continue; // skips rest of the loop body for this enemy since its hit and removed
    }
    if(hitsOrb(e)){ // check if enemy has reached orb, if so:
      burst(e.x,e.y,'rgb(236, 23, 23)'); // red burst explosion to show orb is hit
      enemies.splice(i,1); // remove enemy from array since it has hit the orb
      if(!shieldActive){ // if shield isn't active when enemy hits orb, player takes damage
        orbHits++; charge=Math.max(0,charge-12); updateHUD(); // increase orbHits by 1 to track damage, reduce charge by 12 points as penalty for taking damage, and update HUD to reflect new charge level
        if(orbHits>=3){ doGameOver(); return; }// if player has taken 3 hits, end the game and exit loop
      }
      continue; // skips drawing since enemy is removed
    }
    if(e.x<-120||e.x>W+120){ enemies.splice(i,1); continue; } // if enemy has moved off screen (with some buffer), remove it from array and skip to next iteration
    drawEnemy(e);
  }

  //update projectiles 
  for(var i=projectiles.length-1;i>=0;i--){ // loop backwards throuh projectiles array to update each projectile
    var p=projectiles[i]; // update position by adding its veloocity to coordinates
    p.x+=p.vx; p.y+=p.vy; // projectiles move horizontally by vx and vertically by vy each frame

    // Body block - checks if projectile is touching players body 
    if(bodyHitsPoint(p.x,p.y,p.r+14)){ // p.r + 14 is hit radius for projectile; if projectile is within this distance from any body segment, it counts as a block
      burst(p.x,p.y,'#fff');// white burst effect to show projectile is blocked by body
      projectiles.splice(i,1); // remove projectile from array since it has been blocked
      charge=Math.min(100,charge+3); // small bonus for blocking - 6 points
      continue; // skip rest of loop body since projectile is blocked and removed
    }

    // Lean dodge two conditions must be true: player currently leaning in some direction, and lean cooldown has expired
    if(leanDir!==0 && leanCooldown<=0){
      var lHip=getLM(23), rHip=getLM(24); // gets hip landmarks 
      if(lHip&&rHip){
        var hipSx=(1-(lHip.x+rHip.x)/2)*W; // calculates average x position of hips and converts to screen coordinates
        var hipSy=((lHip.y+rHip.y)/2)*H; // calculates average y position of hips and converts to screen coordinates
        if(Math.hypot(p.x-hipSx,p.y-hipSy)<120){ // checks if projectile is within 120 pixels of hip position; if so, it counts as a successful lean dodge and projectile is deflected
          projectiles.splice(i,1); // remove projectile from array since it has been dodged
          leanCooldown=30; // sets lean cooldown (.5 seconds) to prevent player from using 1 lean for multiple projectiles
          continue;
        }
      }
    }

    // Shield and orb hit
    if(hitsOrb(p)){ // checks if projectile hits orb; if so, check if shield is active to determine outcome
      if(shieldActive){ // if shield is active, projectile is blocked and player is safe
        burst(p.x,p.y,'#44aaff'); // blue burst effect to show projectile is blocked by shield
        projectiles.splice(i,1); // remove projectile from array since it has been blocked
        continue; // skip rest of loop body since projectile is blocked and removed
      } else { // if shield isn't active, projectile hits orb and player takes damage
        burst(p.x,p.y,'#f00'); // red burst effect to show projectile hits orb
        projectiles.splice(i,1); // remove projectile from array since it has hit the orb
        orbHits++; charge=Math.max(0,charge-10); updateHUD(); // increase orbHits by 1 to track damage, reduce charge by 10 points as penalty for taking damage, and update HUD to reflect new charge level
        if(orbHits>=3){ doGameOver(); return; } // if player has taken 3 hits, end the game and exit loop
        continue; // skip rest of loop body since projectile has hit the orb and is removed
      }
    }

    // Off screen
    if(p.x<-50||p.x>W+50||p.y<-50||p.y>H+50){ projectiles.splice(i,1); continue; } // if projectile has moved off screen (with some buffer), remove it from array and skip to next iteration
    drawProjectile(p); // draw projectile if it hasn't been removed by any of the above conditions
  }

  tickParticles(); // updates and draws particles every frame; called at end of loop so that particles appear on top of everything else; creates explosion effects that linger briefly after hits

  if(charge>=100 && !transitioning) endRound(); // if charge reaches 100 and we're not already in a transition, end the round and start the next one; checks transitioning variable to prevent multiple triggers of endRound if charge is still above 100 for multiple frames
  
}