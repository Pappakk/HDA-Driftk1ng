

const METER_SCALE=30;

// === Speldata ===
let playerData = JSON.parse(localStorage.getItem("driftPlayerData") || "{}");
if(!playerData.score) playerData = {score:0, upgrades:{motor:0,dack:0,diff:0}};
saveData();
function saveData(){ localStorage.setItem("driftPlayerData", JSON.stringify(playerData)); }

// === Garagelogik ===
let garageApp=null;
function openGarage(app){
  document.getElementById("menu").style.display="none";
  document.getElementById("garageUI").style.display="flex";
  document.getElementById("garageScore").innerText=`Dina poäng: ${playerData.score}`;
  garageApp = app; // Återanvänd huvud-appen
  garageApp.stage.removeChildren(); // Rensa scenen
  PIXI.Assets.load('Garage.png').then(tex=>{
    const bg=new PIXI.Sprite(tex);
    bg.anchor.set(0.5);
    bg.x=garageApp.screen.width/2;
    bg.y=garageApp.screen.height/2;
    garageApp.stage.addChild(bg);
  });
}
function buyUpgrade(type){
  const costs={motor:1000,dack:800,diff:1200};
  if(playerData.score>=costs[type]){
    playerData.score-=costs[type];
    playerData.upgrades[type]++;
    saveData();
    showNotification(`Du köpte ${type}! (nivå ${playerData.upgrades[type]})`);
  } else {
    showNotification("Inte tillräckligt med poäng!", true);
  }
  document.getElementById("garageScore").innerText=`Dina poäng: ${playerData.score}`;
}
function backToMenu(){
    document.getElementById("garageUI").style.display = "none";
    document.getElementById("menu").style.display = "flex";
    if (garageApp) {
        garageApp.stage.removeChildren(); // Rensa garaget
    }
}

function showNotification(message, isError = false) {
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.position = 'absolute';
    notification.style.bottom = '20px';
    notification.style.left = '50%';
    notification.style.transform = 'translateX(-50%)';
    notification.style.padding = '10px 20px';
    notification.style.borderRadius = '5px';
    notification.style.backgroundColor = isError ? 'rgba(255, 0, 0, 0.7)' : 'rgba(0, 128, 0, 0.7)';
    notification.style.color = 'white';
    notification.style.fontFamily = 'sans-serif';
    notification.style.zIndex = '100';
    document.body.appendChild(notification);
    setTimeout(() => {
        if (notification.parentNode) {
            document.body.removeChild(notification);
        }
    }, 3000);
}


// === Bana ===
class Game {
  constructor(app){
    this.app = app; // Återanvänd den existerande PIXI-appen
    this.keys={}; this.textures={car:[],track:null,cone:null};
    this.world=new planck.World({gravity:planck.Vec2(0,0)});
    this.worldContainer=new PIXI.Container();
    this.app.stage.addChild(this.worldContainer);
    this.car=null; this.cones=[];
    this.wallSprites=[]; this.score=0; this.combo=0; this.paused = false;
    this.lastDriveForce=0; this.throttleLevel=0; 
    this.setupInput(); 
    this.loadAssets().then(()=>this.setupScene());
  }

  setupInput(){
    addEventListener("keydown", e=>{
      this.keys[e.key]=true;
      if(e.key==="F2"){
        const banner=document.getElementById("devBanner");
        const show=(banner.style.display==="none");
        banner.style.display= show ? "flex":"none";
        if(this.wallSprites){
          for(const w of this.wallSprites) w.visible=show;
        }
      }
      if(e.key==="r"||e.key==="R"){ this.resetCar(); }
      if(e.key==='p' || e.key==='P'){ this.togglePause(); }
    });
    addEventListener("keyup", e=>this.keys[e.key]=false);
  }

  togglePause(){
      this.paused = !this.paused;
      // Här kan du visa en pausmeny/overlay om du vill
  }

  async loadAssets(){
    const assets=await PIXI.Assets.load(['Bmw_sprite.png','Track.png','Cone_sprite.png']);
    const carSheet=assets['Bmw_sprite.png'];
    this.textures.track=assets['Track.png']; this.textures.cone=assets['Cone_sprite.png'];
    const COLS=8,ROWS=4,fw=Math.floor(carSheet.width/COLS),fh=Math.floor(carSheet.height/ROWS);
    for(let i=0;i<ROWS*COLS;i++){
      const col=i%COLS,row=Math.floor(i/COLS);
      const rect=new PIXI.Rectangle(col*fw,row*fh,fw,fh);
      this.textures.car.push(new PIXI.Texture(carSheet.baseTexture,rect));
    }
  }

  setupScene(){
    const track=new PIXI.Sprite(this.textures.track); track.anchor.set(0.5); this.worldContainer.addChild(track);
    const conePositions=[{x:200,y:100},{x:-150,y:50},{x:0,y:-200},{x:300,y:-150}];
    for(const pos of conePositions){
      const sprite=new PIXI.Sprite(this.textures.cone);
      sprite.anchor.set(0.5);
      sprite.scale.set(0.2); this.worldContainer.addChild(sprite);
      const body=this.world.createDynamicBody({position:planck.Vec2(pos.x/METER_SCALE,pos.y/METER_SCALE),linearDamping:1.5,angularDamping:2.0});
      const fix=body.createFixture(planck.Circle(0.25),{density:0.5,restitution:0.2,friction:0.6}); fix.setUserData("cone");
      this.cones.push({sprite,body});
    }
    const carSprite=new PIXI.Sprite(this.textures.car[0]);
    carSprite.anchor.set(0.5);
    carSprite.scale.set(0.5);
    this.app.stage.addChild(carSprite);
    const carBody=this.world.createDynamicBody({position:planck.Vec2(0,0),angle:-Math.PI/2,angularDamping:3.5});
    carBody.createFixture(planck.Box(4.3/2, 1.8/2), { density: 150.0, friction: 0.8 });
    this.car={sprite:carSprite,body:carBody,totalFrames:this.textures.car.length,
      params:{maxDriveForce:1200+playerData.upgrades.motor*800,
              maxBrakeForce:3500,maxSteerAngle:Math.PI/5,
              gripFactor: 2.0 - playerData.upgrades.dack * 0.2,
              dragFactor: 2.0 }};
    this.world.on("begin-contact",c=>{
      const a=c.getFixtureA().getUserData(),b=c.getFixtureB().getUserData();
      if(a==="cone"||b==="cone")this.onHitCone();
    });

    // === Vägglista ===
    const walls=[
      {x:0,y:-300,w:600,h:20}, // topp
      {x:0,y:300,w:600,h:20},  // botten
      {x:-300,y:0,w:20,h:600}, // vänster
      {x:300,y:0,w:20,h:600},  // höger
      {x:0,y:0,w:100,h:20},    // mittvägg
    ];
    for(const wall of walls){
      const body=this.world.createBody({type:"static",position:planck.Vec2(wall.x/METER_SCALE,wall.y/METER_SCALE)});
      body.createFixture(planck.Box(wall.w/2/METER_SCALE,wall.h/2/METER_SCALE));
      const gfx=new PIXI.Graphics();
      gfx.beginFill(0x00ff00,0.3);
      gfx.drawRect(-wall.w/2,-wall.h/2,wall.w,wall.h);
      gfx.endFill();
      gfx.x=wall.x; gfx.y=wall.y; gfx.visible=false;
      this.worldContainer.addChild(gfx);
      this.wallSprites.push(gfx);
    }

    document.getElementById("hud").style.display="block";
    this.app.ticker.add(()=>this.gameLoop());
  }

  resetCar(){
    this.car.body.setTransform(planck.Vec2(0,0), Math.PI/2);
    this.car.body.setLinearVelocity(planck.Vec2(0,0));
    this.car.body.setAngularVelocity(0);
  }

  onHitCone(){ this.score-=100; this.combo=0; }

  updatePhysics(){
    if (this.paused) return; // Hoppa över fysik om spelet är pausat

    const b=this.car.body, p=this.car.params;

    const v=b.getLinearVelocity();
    const forward=b.getWorldVector(planck.Vec2(0,1));
    const fwdSpeed = planck.Vec2.dot(v, forward);

    // 1. Anisotropisk friktion (motverka sidoglidning)
    // Detta är kärnan i "drifting"-känslan. Vi applicerar en kraft som motverkar bilens sidorörelse.
    const right=b.getWorldVector(planck.Vec2(0,1));
    let latVel=right.mul(planck.Vec2.dot(v,right));
    let latImpulse=latVel.mul(-b.getMass());
    const maxLatImp = b.getMass() * p.gripFactor; // gripFactor bestämmer hur mycket grepp däcken har.
    if(latImpulse.length() > maxLatImp){
      latImpulse=latImpulse.mul(maxLatImp/latImpulse.length());
    }
    b.applyLinearImpulse(latImpulse,b.getWorldCenter());

    // 2. Styrning (applicera vridmoment)
    // Styrningen är hastighetskänslig, vilket gör bilen lättare att kontrollera i låga hastigheter.
    let steerRequest = 0;
    if(this.keys['ArrowLeft'] || this.keys['a']) steerRequest = -1;
    if(this.keys['ArrowRight'] || this.keys['d']) steerRequest = 1;
    const turnSpeed = 150 + Math.abs(fwdSpeed) * 2; 
    const turnPerTimeStep = turnSpeed / 60.0;
    const desiredAngVel = steerRequest * turnPerTimeStep;
    const angVel = b.getAngularVelocity();
    const torque = b.getInertia() * (desiredAngVel - angVel) * -1; 
    b.applyTorque(torque);

    // 3. Gas, broms och handbroms
    const throttleTarget = (this.keys['ArrowUp'] || this.keys['w']) ? 1.0 : 0.0;
    this.throttleLevel += (throttleTarget - this.throttleLevel) * 0.1; // Mjuk gasrespons
    if(Math.abs(this.throttleLevel) < 0.01) this.throttleLevel = 0;
    let Fx = p.maxDriveForce * this.throttleLevel;
    if(this.keys['ArrowDown'] || this.keys['s']) Fx -= p.maxBrakeForce;
    if(this.keys[' ']) Fx = (Fx > 0 ? Fx * 0.5 : Fx) - p.maxBrakeForce; // Handbromsen minskar gas och applicerar broms

    // 4. Drivkraft och motstånd
    const driveForceVec = forward.mul(Fx);
    // Kvadratiskt luftmotstånd för en mer realistisk känsla.
    const dragForceMag = -p.dragFactor * fwdSpeed * Math.abs(fwdSpeed); 
    const dragForceVec = forward.mul(dragForceMag);
    const totalForce = driveForceVec.add(dragForceVec);
    b.applyForceToCenter(totalForce);

    this.world.step(1/60,8,3);

    // 5. Maxhastighet
    const MAX_SPEED=60;
    const vNow=b.getLinearVelocity();
    const len=vNow.length();
    if(len > MAX_SPEED) b.setLinearVelocity(vNow.mul(MAX_SPEED/len));

    this.lastDriveForce = Fx; // Spara för dev-bannern
  }

  updateGraphics(){
    const b=this.car.body,s=this.car.sprite,pos=b.getPosition(),ang=b.getAngle();
    // Uppdatera bilens sprite baserat på dess vinkel
    let angNorm=(ang - Math.PI/2)%(2*Math.PI);
    if(angNorm<0)angNorm+=2*Math.PI;
    const idx=Math.round((angNorm/(2*Math.PI))*this.car.totalFrames)%this.car.totalFrames;
    s.texture=this.textures.car[idx];
    
    // Centrera kameran på bilen
    s.position.set(this.app.screen.width/2,this.app.screen.height/2);
    this.worldContainer.x=-pos.x*METER_SCALE+this.app.screen.width/2;
    this.worldContainer.y=-pos.y*METER_SCALE+this.app.screen.height/2;

    for(const c of this.cones){
      const cp=c.body.getPosition();
      c.sprite.x=cp.x*METER_SCALE; c.sprite.y=cp.y*METER_SCALE; c.sprite.rotation=c.body.getAngle();
    }
    const vel=b.getLinearVelocity(),speed=vel.length()*3.6;
    document.getElementById("hud").innerText=`Hastighet: ${speed.toFixed(1)} km/h\nScore: ${this.score}\nCombo: ${this.combo}`;
  }

  updateDevBanner(){
    const stats=document.getElementById("devStats");
    const vel=this.car.body.getLinearVelocity();
    const speed=vel.length()*3.6;
    stats.innerText=`Speed: ${speed.toFixed(1)} km/h | DriveForce: ${this.lastDriveForce.toFixed(1)}`;

    // Uppdatera parametrar och värde-etiketter från sliders
    const driveSlider = document.getElementById("driveForceSlider");
    this.car.params.maxDriveForce = parseFloat(driveSlider.value);
    document.getElementById("driveForceValue").innerText = driveSlider.value;

    const brakeSlider = document.getElementById("brakeForceSlider");
    this.car.params.maxBrakeForce = parseFloat(brakeSlider.value);
    document.getElementById("brakeForceValue").innerText = brakeSlider.value;

    const gripSlider = document.getElementById("gripSlider");
    this.car.params.gripFactor = parseFloat(gripSlider.value);
    document.getElementById("gripValue").innerText = gripSlider.value;

    this.car.body.m_angularDamping = parseFloat(document.getElementById("angularDampingSlider").value);
    document.getElementById("angularDampingValue").innerText = this.car.body.m_angularDamping.toFixed(1);

    const dragSlider = document.getElementById("dragSlider");
    this.car.params.dragFactor = parseFloat(dragSlider.value);
    document.getElementById("dragValue").innerText = dragSlider.value;

    const steerSlider = document.getElementById("steerSlider");
    this.car.params.maxSteerAngle = parseFloat(steerSlider.value);
    document.getElementById("steerValue").innerText = steerSlider.value;

    document.getElementById("ebrakeIndicator").innerText=this.keys[' ']?'Handbroms: PÅ':'Handbroms: AV';
  }

  gameLoop(){ 
      if(this.paused) return; // Kör inte loopen om spelet är pausat
      this.updatePhysics(); 
      this.updateGraphics(); 
      this.updateDevBanner(); 
    }
}

// === App-initiering ===
const mainApp = new PIXI.Application({ resizeTo: window, backgroundColor: 0x111111 });
document.body.appendChild(mainApp.view);

let gameInstance = null;

document.getElementById("btnTrack").onclick=()=>{
  document.getElementById("menu").style.display="none";
  gameInstance = new Game(mainApp); // Skicka med huvud-appen
};
document.getElementById("btnGarage").onclick=()=>{
  openGarage(mainApp); // Skicka med huvud-appen
};

document.getElementById('btnInstructions').onclick = () => {
    document.getElementById('instructionsModal').style.display = 'flex';
};

document.getElementById('closeInstructions').onclick = () => {
    document.getElementById('instructionsModal').style.display = 'none';
};

document.getElementById("resetDevDefaults").onclick = () => {
  const defaults = {
    driveForce: 1200, brakeForce: 3500, gripFactor: 2.0, angularDamping: 3.5, dragFactor: 2.0, steerAngle: 0.52
  };

  document.getElementById("driveForceSlider").value = defaults.driveForce;
  document.getElementById("brakeForceSlider").value = defaults.brakeForce;
  document.getElementById("gripSlider").value = defaults.gripFactor;
  document.getElementById("angularDampingSlider").value = defaults.angularDamping;
  document.getElementById("dragSlider").value = defaults.dragFactor;
  document.getElementById("steerSlider").value = defaults.steerAngle;

  if (gameInstance) {
    gameInstance.updateDevBanner();
  }
};
