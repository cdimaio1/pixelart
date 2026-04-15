// variables from game.html
var canvas    = document.getElementById('game-canvas'); // full drawing screen
var ctx       = canvas.getContext('2d'); // drawng tool
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

// Resize canvas to fill window and update on resize
function resize(){ canvas.width=window.innerWidth; canvas.height=window.innerHeight; }
resize();
window.addEventListener('resize', resize);

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

ovBtn.addEventListener('click', function(){ // // when start button is clicked... 
  ovBtn.disabled=true; // when button is clicked, disable it to prevent multiple clicks while game is starting
  ovTitle.textContent='LOADING...'; // shows loading message
  ovMsg.textContent='Starting body tracking...'; // shows body tracking message
  resetGame();// resets all game variables to initial state - if a player, wanted to play again needs to reset everything
  if(!pose){ initPose(); }// checks if MediaPipe has been swt up yet; if pose is null (only when user plays for very first time), calls initPose() to set up MediaPipe and start camers
  else { overlay.classList.remove('show'); startRound(); } // if pose already exists (player has played before), skip setup and jump right into starting the round, MediaPipe already running
});

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

function drawEnemy(e){  // draws enemy on canvas based on its properties; called each frame for each enemy in array
  var col=COLORS[e.type]; // gets color for enemy based on its type property
  var ex=e.vx>0?-1:1; // calculates direction enemy is facing based on its velocity; if vx is positive (moving right), ex is -1 (facing left); if vx is negative (moving left), ex is 1 (facing right);  used to flip enemy features so they look in the direction they're moving
  // body
  ctx.beginPath(); ctx.arc(e.x,e.y,e.r,0,Math.PI*2); // draws main body circle; takes x,y,radius,start angle, and end angle [full circle]; color based on enemy type; white stroke 
  ctx.fillStyle=col; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();

  // eyes
  ctx.fillStyle='#fff'; // fill eyes with white
  ctx.beginPath(); ctx.arc(e.x+ex*e.r*0.25,e.y-e.r*0.2,e.r*0.17,0,Math.PI*2); ctx.fill(); // draw left eye
  ctx.beginPath(); ctx.arc(e.x+ex*e.r*0.55,e.y-e.r*0.2,e.r*0.17,0,Math.PI*2); ctx.fill(); // draw right eye
  ctx.fillStyle='#000'; // black pupils
  ctx.beginPath(); ctx.arc(e.x+ex*e.r*0.27,e.y-e.r*0.2,e.r*0.08,0,Math.PI*2); ctx.fill(); // draw left pupil
  ctx.beginPath(); ctx.arc(e.x+ex*e.r*0.57,e.y-e.r*0.2,e.r*0.08,0,Math.PI*2); ctx.fill(); // draw right pupil

  // label
  ctx.fillStyle='#fff'; ctx.font='bold 10px Courier New'; ctx.textAlign='center'; // label text is white, bold 10px Courier New, centered on x position of enemy
  ctx.fillText(LABELS[e.type],e.x,e.y+e.r+13); // draws label below enemy

  // legs
  ctx.strokeStyle=col; ctx.lineWidth=4; ctx.lineCap='round'; // set stroke style for legs
  var lk=Math.sin(e.leg)*10; // leg animation based on sine wave between -10 and 10 - creates walking motion for enemy
  ctx.beginPath(); ctx.moveTo(e.x-e.r*0.3,e.y+e.r); ctx.lineTo(e.x-e.r*0.3,e.y+e.r+16+lk); ctx.stroke(); // draw left leg; moves opposite of right leg for walking motion; add 1k to y position
  ctx.beginPath(); ctx.moveTo(e.x+e.r*0.3,e.y+e.r); ctx.lineTo(e.x+e.r*0.3,e.y+e.r+16-lk); ctx.stroke(); // draw right leg; moves opposite of left leg for walking motion; subtract 1k from y position
  ctx.lineCap='butt'; // reset line cap to default for other drawings
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
  if(!landmarks) return; // if mediaPipe hasn't detected a person yet, landmarks will be null, so don't try to draw anything
  var shCol = shieldActive ? '#2c97ed' : '#1eb10d'; // skeleton color changes based on shield state; bright blue when shield is active, bright green when not
  // loop through every segment in SEGS array and draw a line for each one; for each:
  ctx.strokeStyle=shCol; ctx.lineWidth=8; ctx.lineCap='round';
  for(var s=0;s<SEGS.length;s++){ // 
    var a=getLM(SEGS[s][0]), b=getLM(SEGS[s][1]); // gets the two landmarks that define the endpoints of the segment
    if(!a||!b) continue; // if either landmark is missing (not detected or low confidence), skip drawing this segment
    var sa=screenPt(a), sb=screenPt(b); // converts landmark positions to screen coordinates for drawing
    ctx.beginPath(); ctx.moveTo(sa.x,sa.y); // lifts pen to start point
     ctx.lineTo(sb.x,sb.y);  // draws line to end point
     ctx.stroke(); // strokes the line
  }

  ctx.lineCap='butt'; // flat ends on lines
  ctx.fillStyle='#fff'; // white circles for joints
  for(var i=0;i<33;i++){ // loop through all 33 landmarks; draw a circle for each one to show joints; if landmark is missing, skip it
    var p=getLM(i); if(!p) continue; // gets landmark position; if missing, skip to next iteration
    var sp=screenPt(p); // converts landmark position to screen coordinates
    ctx.beginPath(); ctx.arc(sp.x,sp.y,5,0,Math.PI*2); ctx.fill(); // draws circle at joint position; radius 5, filled with white
  }
  var nose=getLM(0), lSh=getLM(11), rSh=getLM(12); // gets nose and shoulder landmarks to position shield indicator; if nose is missing, won't draw shield indicator; if shoulders are missing, will use default size for indicator
  if(nose){
    var hr=lSh&&rSh?Math.abs((1-lSh.x)-(1-rSh.x))*canvas.width*0.22:30; // gets pixel distance between two shoulders; .22 makes head radius 22% of that width  - head size will scale based on how far or close you are from camera
    var sn=screenPt(nose); // gets screen coordinates of nose to use as center point for shield indicator
    ctx.beginPath(); ctx.arc(sn.x,sn.y-hr*0.5,hr,0,Math.PI*2); // // draws circle half a radius above the nose
    ctx.fillStyle='rgba(0,255,136,0.2)'; ctx.fill(); // light green with low opacity for shield indicator background
    ctx.strokeStyle=shCol; ctx.lineWidth=3; ctx.stroke();
  }
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
  ctx.fillStyle='#0a0a1a'; ctx.fillRect(0,0,W,H); // fill background with dark color every frame
  ctx.strokeStyle='#222'; ctx.lineWidth=2; // draws subtle horizontal line for floor line
  ctx.beginPath(); ctx.moveTo(0,H*0.82); ctx.lineTo(W,H*0.82); ctx.stroke(); // picks up pen, moves to left edge at 82% of screen height, draws line to right edge at same height, then strokes it to make it visible

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